// src/__tests__/bot-summarize.test.ts — vitest для /summarize command (quick-260519-lxu).
// Mock'ает storage.listWeek + upload/llm.buildLlmNarrative + channels-store
// (последний не используется но импортируется bot.ts → нужно глушить).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleCommand } from "../bot.js";
import { listWeek } from "../upload/storage.js";
import { buildLlmNarrative } from "../upload/llm.js";
import { parseWorkbook } from "../upload/parser.js";

// Глушим channels-store (импортируется bot.ts в module-init).
vi.mock("../channels-store.js", () => ({
  loadChannels: vi.fn().mockReturnValue([]),
  mutate: vi.fn(),
  saveChannels: vi.fn(),
}));

// Mock storage.listWeek — управляет сценариями (нет файлов / только prices / пара).
vi.mock("../upload/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../upload/storage.js")>(
    "../upload/storage.js"
  );
  return {
    ...actual,
    listWeek: vi.fn(),
  };
});

// Mock buildLlmNarrative — никаких реальных DeepSeek-вызовов в тестах.
vi.mock("../upload/llm.js", () => ({
  buildLlmNarrative: vi.fn(),
}));

// Mock parser.parseWorkbook — чтобы reparseFromDisk не пытался читать xlsx с диска
// (мы мокаем readFileSync ниже, но если parser попытается распарсить пустой buffer,
// получим throw до llm). Возвращаем фиктивный набор строк, достаточный для analyze().
vi.mock("../upload/parser.js", () => ({
  parseWorkbook: vi.fn(),
}));

// Mock fs.readFileSync для reparseFromDisk: возвращаем dummy ТОЛЬКО для путей
// внутри data/uploads/ (где лежат xlsx). Для всех остальных путей (refineries.json
// и пр.) — реальный readFileSync, иначе loadRefineries() упадёт с JSON parse error.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn((p: unknown, opts?: unknown) => {
      const pathStr = typeof p === "string" ? p : String(p);
      if (pathStr.includes("/uploads/") && pathStr.endsWith(".xlsx")) {
        return Buffer.from("dummy-xlsx");
      }
      return actual.readFileSync(p as Parameters<typeof actual.readFileSync>[0], opts as Parameters<typeof actual.readFileSync>[1]);
    }),
  };
});

const mockedListWeek = vi.mocked(listWeek);
const mockedBuildLlmNarrative = vi.mocked(buildLlmNarrative);
const mockedParseWorkbook = vi.mocked(parseWorkbook);

// Helper: парсить тело sendMessage из fetch.
function fetchCallsTo(method: string): Array<Record<string, unknown>> {
  const fetchMock = vi.mocked(globalThis.fetch);
  return fetchMock.mock.calls
    .filter(([url]) => typeof url === "string" && url.includes(`/${method}`))
    .map(([, init]) =>
      JSON.parse(((init as RequestInit | undefined)?.body as string) ?? "{}")
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
      text: async () => "",
    })
  );
  // Default: parseWorkbook returns rows that make analyze() not throw.
  mockedParseWorkbook.mockResolvedValue([
    {
      type: "birzha_prices",
      refineryRaw: "A",
      refineryCanonical: "A",
      date: new Date("2026-04-30T00:00:00Z"),
      priceRub: 100,
    },
    {
      type: "birzha_prices",
      refineryRaw: "A",
      refineryCanonical: "A",
      date: new Date("2026-05-08T00:00:00Z"),
      priceRub: 110,
    },
  ]);
});

describe("/summarize — allowlist gating", () => {
  it("non-allowlist user → silent ignore (no fetch)", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: true,
      hasFca: true,
      hasVolumes: false,
      lastRunAt: null,
    });
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 999 }, // not in allowlist
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockedBuildLlmNarrative).not.toHaveBeenCalled();
  });
});

describe("/summarize — no files this week", () => {
  it("replies with 'файлов не загружено' when week is empty", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: false,
      hasFca: false,
      hasVolumes: false,
      lastRunAt: null,
    });
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toMatch(/файлов не загружено/);
    expect(mockedBuildLlmNarrative).not.toHaveBeenCalled();
  });
});

describe("/summarize — only one of the pair", () => {
  it("prices only → 'Нужны оба типа'", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: true,
      hasFca: false,
      hasVolumes: false,
      lastRunAt: null,
    });
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls[0].text).toMatch(/Нужны оба типа/);
    expect(sendCalls[0].text).toMatch(/prices/);
    expect(mockedBuildLlmNarrative).not.toHaveBeenCalled();
  });

  it("fca only → 'Нужны оба типа' with fca in present list", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: false,
      hasFca: true,
      hasVolumes: true,
      lastRunAt: null,
    });
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls[0].text).toMatch(/Нужны оба типа/);
    expect(sendCalls[0].text).toMatch(/fca/);
    expect(sendCalls[0].text).toMatch(/volumes/);
    expect(mockedBuildLlmNarrative).not.toHaveBeenCalled();
  });
});

describe("/summarize — happy path (pair present)", () => {
  it("calls buildLlmNarrative and sends parts via sendMessage(parse_mode=Markdown)", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: true,
      hasFca: true,
      hasVolumes: false,
      lastRunAt: null,
    });
    mockedBuildLlmNarrative.mockResolvedValue([
      "*Сводка*\n\nЗа период с 30 апреля по 8 мая лидирует Газпромнефть.",
    ]);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    expect(mockedBuildLlmNarrative).toHaveBeenCalledTimes(1);
    const sendCalls = fetchCallsTo("sendMessage");
    // 1 progress + 1 narrative part
    expect(sendCalls.length).toBe(2);
    const progress = sendCalls.find((c) => String(c.text).includes("Готовлю"));
    expect(progress).toBeDefined();
    const narrative = sendCalls.find((c) => String(c.text).includes("Газпромнефть"));
    expect(narrative).toBeDefined();
    expect(narrative!.parse_mode).toBe("Markdown");
  });

  it("sends each narrative chunk as a separate sendMessage call", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: true,
      hasFca: true,
      hasVolumes: false,
      lastRunAt: null,
    });
    mockedBuildLlmNarrative.mockResolvedValue([
      "(1/2)\nчасть один",
      "(2/2)\nчасть два",
    ]);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    // 1 progress + 2 narrative parts
    expect(sendCalls.length).toBe(3);
    expect(sendCalls.some((c) => String(c.text).includes("часть один"))).toBe(
      true
    );
    expect(sendCalls.some((c) => String(c.text).includes("часть два"))).toBe(
      true
    );
  });
});

describe("/summarize — DeepSeek failure", () => {
  it("replies with '❌ Не удалось получить LLM-сводку' when buildLlmNarrative throws", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: true,
      hasFca: true,
      hasVolumes: false,
      lastRunAt: null,
    });
    mockedBuildLlmNarrative.mockRejectedValue(new Error("ECONNRESET"));
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    // 1 progress + 1 error
    const err = sendCalls.find((c) =>
      String(c.text).includes("Не удалось получить LLM-сводку")
    );
    expect(err).toBeDefined();
    expect(String(err!.text)).toMatch(/ECONNRESET/);
  });
});

describe("/summarize — suffix @botname", () => {
  it("/summarize@MyBot is recognised", async () => {
    mockedListWeek.mockReturnValue({
      hasPrices: false,
      hasFca: false,
      hasVolumes: false,
      lastRunAt: null,
    });
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize@MyBot",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toMatch(/файлов не загружено/);
  });
});
