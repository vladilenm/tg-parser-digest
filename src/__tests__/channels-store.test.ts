// src/__tests__/channels-store.test.ts — Vitest для channels-store (Phase 1 STORE-01..02).
// Покрывает: happy-path load, Zod failures, atomic write, mutex concurrency (Promise.all),
// missing-file throw (no YAML fallback).

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

function readJsonFromDisk(): { channels: ChannelEntry[] } {
  return JSON.parse(readFileSync("./channels.json", "utf8"));
}

// ---------------------------------------------------------------------------
// STORE-01: loadChannels happy-path + Zod failure
// ---------------------------------------------------------------------------

describe("loadChannels (STORE-01)", () => {
  it("читает массив каналов из валидного channels.json", () => {
    writeJson([
      { username: "ch1" },
      { username: "ch2" },
    ]);
    const result = loadChannels();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ username: "ch1" });
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
      JSON.stringify({ channels: [{}] }),
      "utf8"
    );
    expect(() => loadChannels()).toThrow();
  });

  it("throws если channels.json отсутствует — никакого YAML-фоллбека", () => {
    // tmpdir пустой; никакого channels.json — фоллбек был удалён в quick-260506-dht.
    expect(() => loadChannels()).toThrow(/channels\.json not found/);
  });
});

// ---------------------------------------------------------------------------
// STORE-02: saveChannels (atomic write) + mutex concurrency
// ---------------------------------------------------------------------------

describe("saveChannels + mutex (STORE-02)", () => {
  it("saveChannels пишет валидный JSON с двухпробельным отступом (D-04)", async () => {
    await saveChannels([{ username: "ch1" }]);
    const raw = readFileSync("./channels.json", "utf8");
    // D-04: двухпробельный отступ.
    expect(raw).toContain('  "channels"');
    expect(raw).toContain('    "username"');
    // Round-trip через loadChannels.
    expect(loadChannels()).toEqual([{ username: "ch1" }]);
  });

  it("после saveChannels старый .tmp не остаётся на диске (rename, не copy)", async () => {
    await saveChannels([{ username: "ch1" }]);
    expect(existsSync("./channels.json")).toBe(true);
    expect(existsSync("./channels.json.tmp")).toBe(false);
  });

  it("CRITICAL: Promise.all из двух concurrent mutate сохраняет ОБА канала (success criterion #3)", async () => {
    // Предусловие: стартовый файл с одним каналом.
    writeJson([{ username: "base" }]);

    // Две конкурентные mutate-операции — имитируют race "бот добавляет / cron читает".
    await Promise.all([
      mutate((current) => [...current, { username: "added-by-bot" }]),
      mutate((current) => [...current, { username: "added-by-cron" }]),
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
