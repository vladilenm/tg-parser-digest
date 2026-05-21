import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  handleBitumStatus,
  handleBitumPreview,
  handleBitumReport,
  handleBitumReset,
  handleBitumDocument,
  _resetPendingStateForTests,
} from "../bot-bitum.js";
import { saveUpload, isoWeekFolder, weekDir } from "../bitum/storage.js";

const FAKE_TOKEN = "test-token";
const FAKE_MSG = (chatId = 12345, messageId = 100) => ({
  message_id: messageId,
  chat: { id: chatId },
});

// =============================================================================
// Mock global fetch for tgFetch calls. Each test resets between runs.
// =============================================================================

let fetchCalls: Array<{ method: string; body: Record<string, unknown> }> = [];
let fetchResponses: Array<unknown> = [];

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  _resetPendingStateForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const m = url.match(/\/bot[^/]+\/([^?]+)/);
      const method = m ? m[1] : "unknown";
      const body = JSON.parse(init.body);
      fetchCalls.push({ method, body });
      const next = fetchResponses.shift();
      return {
        ok: true,
        status: 200,
        json: async () => next ?? { ok: true, result: { message_id: 200 } },
        text: async () => "",
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function makeBufferXlsx(
  build: (ws: ExcelJS.Worksheet) => void,
  sheetName = "Sheet1",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  build(ws);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

// =============================================================================
// Tests
// =============================================================================

describe("bot-bitum: command handlers", () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "bitum-bot-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("handleBitumStatus sends HTML with 5-item checklist (BITUM-TG-01)", async () => {
    await handleBitumStatus(FAKE_TOKEN, FAKE_MSG());
    expect(fetchCalls).toHaveLength(1);
    const text = fetchCalls[0].body.text as string;
    expect(text).toContain("Битум-неделя");
    expect(text).toContain("Чек-лист");
    expect(text).toContain("birzha_prices");
    expect(text).toContain("birzha_volumes");
    expect(text).toContain("fca_sellers");
    expect(text).toContain("all_prices");
    expect(text).toContain("bitum_price_new");
  });

  it("handleBitumPreview empty week → '❓ файлов не загружено'", async () => {
    // Need DEEPSEEK_API_KEY to NOT be set so LLM branch is skipped.
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      await handleBitumPreview(FAKE_TOKEN, FAKE_MSG());
      // First call: progress 📊, then ❓ files not uploaded
      const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
      expect(allTexts).toContain("файлов не загружено");
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });

  it("handleBitumReset on empty week → 'уже пуста'", async () => {
    await handleBitumReset(FAKE_TOKEN, FAKE_MSG());
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("уже пуста");
  });

  it("handleBitumReset on non-empty week → inline-keyboard confirm (D-12)", async () => {
    const buf = Buffer.from("xx");
    await saveUpload(buf, "birzha_prices", isoWeekFolder(new Date()));
    fetchResponses.push({ ok: true, result: { message_id: 500 } });
    await handleBitumReset(FAKE_TOKEN, FAKE_MSG());
    const last = fetchCalls[fetchCalls.length - 1];
    const replyMarkup = last.body.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    expect(replyMarkup.inline_keyboard[0][0].callback_data).toBe("br:confirm");
    expect(replyMarkup.inline_keyboard[0][1].callback_data).toBe("br:cancel");
  });

  it("handleBitumReport empty week → '❓ файлов не загружено'", async () => {
    await handleBitumReport(FAKE_TOKEN, FAKE_MSG());
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("файлов не загружено");
  });

  it("handleBitumDocument confidence=1.0 → save + TG-05 response (D-13)", async () => {
    const buf = await makeBufferXlsx((ws) => {
      ws.getCell("A1").value = "Битум цены продавцов FCA, руб./тонн";
      ws.getCell("A3").value = "Пункт отгрузки";
      ws.getCell("B3").value = "Регион";
    });
    await handleBitumDocument(FAKE_TOKEN, FAKE_MSG(), buf, "test.xlsx");
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Файл распознан: fca_sellers");
    expect(allTexts).toContain("Сохранён");
    expect(allTexts).toContain("Парсинг:");
    expect(allTexts).toContain("Неделя");
    // saved on disk
    const week = isoWeekFolder(new Date());
    expect(existsSync(path.join(weekDir(week), "fca_sellers.xlsx"))).toBe(
      true,
    );
  });

  it("handleBitumDocument confidence<1 → learning keyboard, no save (D-14)", async () => {
    // A1 only (confidence=0.7) → learning UX
    const buf = await makeBufferXlsx((ws) => {
      ws.getCell("A1").value = "Цена битум на бирже, руб./тонн";
    });
    fetchResponses.push({ ok: true, result: { message_id: 600 } });
    await handleBitumDocument(FAKE_TOKEN, FAKE_MSG(), buf, "weird.xlsx");
    // Should send keyboard, not save
    const last = fetchCalls[fetchCalls.length - 1];
    const replyMarkup = last.body.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    };
    expect(replyMarkup.inline_keyboard).toHaveLength(6); // 5 types + not_bitum
    expect(replyMarkup.inline_keyboard[0][0].callback_data).toBe(
      "bs:birzha_prices",
    );
    expect(replyMarkup.inline_keyboard[5][0].callback_data).toBe(
      "bs:not_bitum",
    );
    // File NOT saved
    const week = isoWeekFolder(new Date());
    expect(existsSync(path.join(weekDir(week), "birzha_prices.xlsx"))).toBe(
      false,
    );
  });

  it("handleBitumDocument type=unknown → learning keyboard", async () => {
    const buf = await makeBufferXlsx((ws) => {
      ws.getCell("A1").value = "Random text";
    });
    fetchResponses.push({ ok: true, result: { message_id: 700 } });
    await handleBitumDocument(FAKE_TOKEN, FAKE_MSG(), buf, "random.xlsx");
    const last = fetchCalls[fetchCalls.length - 1];
    expect(last.body.text).toContain("Укажите правильный тип");
  });
});
