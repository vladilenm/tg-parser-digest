// src/__tests__/channels-store.test.ts — Vitest для channels-store (Phase 1 STORE-01..03).
// Покрывает: happy-path load, atomic write, mutex concurrency (Promise.all),
// auto-migration YAML→JSON, идемпотентность миграции, both-files-missing throw.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ВАЖНО: каждый тест создаёт изолированный tmpdir и делает process.chdir.
// channels-store читает "./channels.json" относительно cwd.
// Импортируем модуль ОДИН раз (module-level lockChain переживает между тестами,
// но это OK: каждый тест await'ит свои операции).
import {
  loadChannels,
  saveChannels,
  mutate,
  CHANNELS_PATH,
  type ChannelEntry,
} from "../channels-store.js";

const ORIGINAL_CWD = process.cwd();
let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "channels-store-test-"));
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  rmSync(workdir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeJson(channels: ChannelEntry[]): void {
  writeFileSync("./channels.json", JSON.stringify({ channels }, null, 2), "utf8");
}

function writeYaml(channels: ChannelEntry[]): void {
  // Минимальный валидный YAML — простой случай хватает.
  const lines = ["channels:"];
  for (const c of channels) {
    lines.push(`  - username: "${c.username}"`);
    if (c.priority !== undefined) {
      lines.push(`    priority: ${c.priority}`);
    }
  }
  writeFileSync("./channels.yaml", lines.join("\n") + "\n", "utf8");
}

function readJsonFromDisk(): { channels: ChannelEntry[] } {
  return JSON.parse(readFileSync("./channels.json", "utf8"));
}

// ---------------------------------------------------------------------------
// STORE-01: loadChannels happy-path + Zod failure
// ---------------------------------------------------------------------------

describe("loadChannels (STORE-01)", () => {
  it("читает массив каналов из валидного channels.json", () => {
    writeJson([
      { username: "ch1", priority: 1 },
      { username: "ch2" },
    ]);
    const result = loadChannels();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ username: "ch1", priority: 1 });
    expect(result[1]).toEqual({ username: "ch2" });
  });

  it("CHANNELS_PATH экспортируется как './channels.json'", () => {
    expect(CHANNELS_PATH).toBe("./channels.json");
  });

  it("throws при битом JSON-синтаксисе (D-03)", () => {
    writeFileSync("./channels.json", "{not valid json", "utf8");
    expect(() => loadChannels()).toThrow(/failed to parse/);
  });

  it("throws при пустом массиве каналов (Zod .min(1))", () => {
    writeFileSync("./channels.json", JSON.stringify({ channels: [] }), "utf8");
    expect(() => loadChannels()).toThrow();
  });

  it("throws при отсутствии username", () => {
    writeFileSync(
      "./channels.json",
      JSON.stringify({ channels: [{ priority: 1 }] }),
      "utf8"
    );
    expect(() => loadChannels()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// STORE-02: saveChannels (atomic write) + mutex concurrency
// ---------------------------------------------------------------------------

describe("saveChannels + mutex (STORE-02)", () => {
  it("saveChannels пишет валидный JSON с двухпробельным отступом (D-04)", async () => {
    await saveChannels([{ username: "ch1", priority: 1 }]);
    const raw = readFileSync("./channels.json", "utf8");
    // D-04: двухпробельный отступ.
    expect(raw).toContain('  "channels"');
    expect(raw).toContain('    "username"');
    // Round-trip через loadChannels.
    expect(loadChannels()).toEqual([{ username: "ch1", priority: 1 }]);
  });

  it("после saveChannels старый .tmp не остаётся на диске (rename, не copy)", async () => {
    await saveChannels([{ username: "ch1" }]);
    expect(existsSync("./channels.json")).toBe(true);
    expect(existsSync("./channels.json.tmp")).toBe(false);
  });

  it("CRITICAL: Promise.all из двух concurrent mutate сохраняет ОБА канала (success criterion #3)", async () => {
    // Предусловие: стартовый файл с одним каналом.
    writeJson([{ username: "base", priority: 0 }]);

    // Две конкурентные mutate-операции — имитируют race "бот добавляет / cron читает".
    await Promise.all([
      mutate((current) => [...current, { username: "added-by-bot", priority: 99 }]),
      mutate((current) => [...current, { username: "added-by-cron", priority: 100 }]),
    ]);

    // ОБА канала должны оказаться в финальном файле, ни один не потерян.
    const final = loadChannels();
    const usernames = final.map((c) => c.username);
    expect(usernames).toContain("base");
    expect(usernames).toContain("added-by-bot");
    expect(usernames).toContain("added-by-cron");
    expect(final).toHaveLength(3);

    // Файл валидный JSON, не повреждён.
    const onDisk = readJsonFromDisk();
    expect(onDisk.channels).toHaveLength(3);
  });

  it("стресс-тест: 10 concurrent mutate сохраняют все 10 добавлений", async () => {
    writeJson([{ username: "base" }]);

    const ops = Array.from({ length: 10 }, (_, i) =>
      mutate((current) => [...current, { username: `concurrent-${i}` }])
    );
    await Promise.all(ops);

    const final = loadChannels();
    expect(final).toHaveLength(11); // base + 10 concurrent
    for (let i = 0; i < 10; i++) {
      expect(final.map((c) => c.username)).toContain(`concurrent-${i}`);
    }
  });

  it("при throw из fn внутри mutate — основной channels.json НЕ модифицируется", async () => {
    writeJson([{ username: "ch1" }]);
    await expect(
      mutate(() => {
        throw new Error("simulated failure inside fn");
      })
    ).rejects.toThrow(/simulated failure/);

    // Файл остался прежним.
    const final = loadChannels();
    expect(final).toEqual([{ username: "ch1" }]);
  });

  it("после rejected mutate — следующая mutate-операция работает корректно (mutex не залип)", async () => {
    writeJson([{ username: "ch1" }]);

    await expect(
      mutate(() => {
        throw new Error("first op fails");
      })
    ).rejects.toThrow();

    // Следующая операция должна нормально пройти.
    await mutate((current) => [...current, { username: "ch2" }]);
    expect(loadChannels()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// STORE-03: auto-migration YAML→JSON
// ---------------------------------------------------------------------------

describe("auto-migration YAML→JSON (STORE-03)", () => {
  it("при отсутствии channels.json и наличии channels.yaml — мигрирует и логирует", () => {
    writeYaml([
      { username: "ch1", priority: 1 },
      { username: "ch2", priority: 2 },
    ]);

    // Spy на console.log (log.info → console.log в src/logger.ts).
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = loadChannels();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ username: "ch1", priority: 1 });
    expect(existsSync("./channels.json")).toBe(true);

    // D-13: лог содержит подстроку "migrated channels.yaml".
    const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
    const migrationLog = logCalls.find((line) => line.includes("migrated"));
    expect(migrationLog).toBeDefined();
    expect(migrationLog).toContain("channels.yaml");
    expect(migrationLog).toContain("channels.json");
    expect(migrationLog).toContain("(2 каналов)");
  });

  it("после миграции channels.yaml ОСТАЁТСЯ на диске (D-12)", () => {
    writeYaml([{ username: "ch1" }]);
    loadChannels();
    expect(existsSync("./channels.yaml")).toBe(true); // не удалён
    expect(existsSync("./channels.json")).toBe(true); // создан
  });

  it("идемпотентность: второй loadChannels() НЕ повторяет миграцию", () => {
    writeYaml([{ username: "ch1" }]);
    loadChannels(); // первый — мигрирует

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = loadChannels(); // второй — НЕ должен мигрировать
    expect(result).toEqual([{ username: "ch1" }]);

    const logCalls = logSpy.mock.calls.map((c) => c.join(" "));
    const migrationLog = logCalls.find((line) => line.includes("migrated"));
    expect(migrationLog).toBeUndefined();
  });

  it("throws когда оба файла отсутствуют (D-13)", () => {
    // ни channels.json, ни channels.yaml не созданы — tmpdir пустой.
    expect(() => loadChannels()).toThrow(/no source file/);
  });
});
