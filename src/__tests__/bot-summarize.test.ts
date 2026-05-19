// src/__tests__/bot-summarize.test.ts — vitest для /summarize command (quick-260519-lxu).
// Mock'ает storage.listWeek + upload/llm.buildLlmNarrative + channels-store
// (последний не используется но импортируется bot.ts → нужно глушить).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleCommand } from "../bot.js";
import { listWeek } from "../upload/storage.js";
import { buildLlmNarrative } from "../upload/llm.js";
import { parseWorkbook } from "../upload/parser.js";
import { generateChartUrl } from "../upload/chart.js";

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

// quick-260519-ojk: Mock generateChartUrl — никаких реальных quickchart.io-вызовов.
// Default в beforeEach ниже: mockResolvedValue(null) — старые 8 тестов остаются
// зелёными (chart-step просто пропускается). Новые тесты явно перезаписывают
// mock через mockedGenerateChartUrl.mockResolvedValueOnce(...).
vi.mock("../upload/chart.js", () => ({
  generateChartUrl: vi.fn(),
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
const mockedGenerateChartUrl = vi.mocked(generateChartUrl);

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
  // quick-260519-ojk: default null — chart-step пропускается, существующие 8
  // тестов /summarize не упадут из-за лишнего sendPhoto-вызова. Тесты chart-
  // блока (внизу) явно перезаписывают через mockResolvedValueOnce.
  mockedGenerateChartUrl.mockResolvedValue(null);
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

// =============================================================================
// quick-260519-ojk: chart-блок поверх narrative.
// =============================================================================
describe("/summarize — chart (quick-260519-ojk)", () => {
  beforeEach(() => {
    // Все эти тесты — happy-path narrative (pair собран). Mock-listWeek един.
    mockedListWeek.mockReturnValue({
      hasPrices: true,
      hasFca: true,
      hasVolumes: false,
      lastRunAt: null,
    });
    mockedBuildLlmNarrative.mockResolvedValue([
      "*Сводка*\n\nLLM narrative.",
    ]);
  });

  it("sends PNG chart via sendPhoto after narrative when chartUrl is non-null", async () => {
    mockedGenerateChartUrl.mockResolvedValueOnce(
      "https://quickchart.io/chart/render/abc123"
    );
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    expect(mockedGenerateChartUrl).toHaveBeenCalledTimes(1);
    const photoCalls = fetchCallsTo("sendPhoto");
    expect(photoCalls.length).toBe(1);
    expect(photoCalls[0].photo).toBe(
      "https://quickchart.io/chart/render/abc123"
    );
    expect(String(photoCalls[0].caption)).toMatch(/Δ цены/);
    expect(photoCalls[0].chat_id).toBe(555);
  });

  it("does NOT call sendPhoto when generateChartUrl returns null", async () => {
    mockedGenerateChartUrl.mockResolvedValueOnce(null);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await handleCommand("token", msg, allowlist);
    expect(mockedGenerateChartUrl).toHaveBeenCalledTimes(1);
    const photoCalls = fetchCallsTo("sendPhoto");
    expect(photoCalls.length).toBe(0);
    // Narrative всё равно доставлен.
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.some((c) => String(c.text).includes("LLM narrative"))).toBe(
      true
    );
  });

  it("does NOT crash handler when generateChartUrl throws unexpectedly", async () => {
    mockedGenerateChartUrl.mockRejectedValueOnce(new Error("unexpected boom"));
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    // Не должно throw'ать — narrative уже доставлен, chart-fail только log.warn.
    await expect(handleCommand("token", msg, allowlist)).resolves.not.toThrow();
    // Narrative всё равно доставлен.
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.some((c) => String(c.text).includes("LLM narrative"))).toBe(
      true
    );
    // sendPhoto НЕ вызывался (throw случился до tgFetch).
    const photoCalls = fetchCallsTo("sendPhoto");
    expect(photoCalls.length).toBe(0);
    // Также не должно появиться сообщение про «Не удалось получить LLM-сводку» —
    // narrative-шаг прошёл успешно.
    expect(
      sendCalls.some((c) => String(c.text).includes("Не удалось получить LLM-сводку"))
    ).toBe(false);
  });

  it("does NOT call sendPhoto when sendPhoto-tgFetch returns 400 (TG can't fetch URL)", async () => {
    // Симулируем сценарий: chartUrl получен, но tgFetch sendPhoto падает с 400
    // (например, URL приватный или quickchart cached out). Hand'ler не падает,
    // narrative доставлен, sendPhoto одна попытка — потом catch + warn.
    mockedGenerateChartUrl.mockResolvedValueOnce(
      "https://quickchart.io/chart/render/xyz"
    );
    // Перехватываем fetch: для sendPhoto возвращаем 400.
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/sendPhoto")) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({}),
          text: async () => "PHOTO_INVALID_URL",
        } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ ok: true, result: [] }),
        text: async () => "",
      } as unknown as Response;
    });
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/summarize",
    };
    await expect(handleCommand("token", msg, allowlist)).resolves.not.toThrow();
    // sendPhoto был вызван 1 раз (попытка), narrative — отправлен ранее.
    const photoCalls = fetchCallsTo("sendPhoto");
    expect(photoCalls.length).toBe(1);
    // Узлы narrative-доставки прошли успешно.
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.some((c) => String(c.text).includes("LLM narrative"))).toBe(
      true
    );
  });
});
