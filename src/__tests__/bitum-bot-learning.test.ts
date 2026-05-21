import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  handleBitumCallback,
  _resetPendingStateForTests,
  _setPendingPublishForTests,
  _setPendingResetForTests,
  _setPendingLearningForTests,
} from "../bot-bitum.js";
import { saveUpload, isoWeekFolder, weekDir } from "../bitum/storage.js";

const FAKE_TOKEN = "test-token";

// Mock fetch
let fetchCalls: Array<{ method: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  fetchCalls = [];
  _resetPendingStateForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const m = url.match(/\/bot[^/]+\/([^?]+)/);
      const method = m ? m[1] : "unknown";
      const body = JSON.parse(init.body);
      fetchCalls.push({ method, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 999 } }),
        text: async () => "",
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FAKE_CB = (data: string, msgId = 200) => ({
  id: "cb-1",
  from: { id: 12345 },
  message: { message_id: msgId, chat: { id: 12345 } },
  data,
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

describe("bot-bitum: learning UX callback (D-14)", () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "bitum-bot-learn-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("non-bitum callback prefix → returns false (not handled)", async () => {
    const handled = await handleBitumCallback(
      FAKE_TOKEN,
      FAKE_CB("rm:channel123") as any,
    );
    expect(handled).toBe(false);
  });

  it("bs:not_bitum → 'Не сохранено'", async () => {
    const buf = Buffer.from("xx");
    _setPendingLearningForTests(200, {
      buffer: buf,
      originalFileName: "weird.xlsx",
      meta: { a1: "what" },
      chatId: 12345,
      createdAt: Date.now(),
    });
    await handleBitumCallback(FAKE_TOKEN, FAKE_CB("bs:not_bitum") as any);
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Не сохранено");
    expect(allTexts).toContain("weird.xlsx");
  });

  it("bs:fca_sellers → appendLearned + save + TG-05 response", async () => {
    const buf = await makeBufferXlsx((ws) => {
      ws.getCell("A1").value = "Битум цены продавцов FCA, руб./тонн";
      ws.getCell("A3").value = "Пункт отгрузки";
      ws.getCell("B3").value = "Регион";
    });
    _setPendingLearningForTests(200, {
      buffer: buf,
      originalFileName: "weird.xlsx",
      meta: { a1: "custom marker" },
      chatId: 12345,
      createdAt: Date.now(),
    });
    await handleBitumCallback(FAKE_TOKEN, FAKE_CB("bs:fca_sellers") as any);
    const week = isoWeekFolder(new Date());
    expect(existsSync(path.join(weekDir(week), "fca_sellers.xlsx"))).toBe(
      true,
    );
    // signatures-learned.json updated
    const learnedFile = path.join(tmpDir, "bitum", "signatures-learned.json");
    expect(existsSync(learnedFile)).toBe(true);
    const learned = JSON.parse(readFileSync(learnedFile, "utf8"));
    expect(learned[0].type).toBe("fca_sellers");
    expect(learned[0].a1).toBe("custom marker");
    // Response
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Сохранён как fca_sellers");
  });

  it("bp:cancel → 'Отмена: отчёт НЕ опубликован'", async () => {
    _setPendingPublishForTests(200, {
      html: "<b>some</b>",
      chatId: 12345,
      createdAt: Date.now(),
    });
    await handleBitumCallback(FAKE_TOKEN, FAKE_CB("bp:cancel") as any);
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Отмена");
    expect(allTexts).toContain("НЕ опубликован");
  });

  it("bp:confirm with TG_CHANNEL_ID set → sends to channel", async () => {
    const prev = process.env.TG_CHANNEL_ID;
    process.env.TG_CHANNEL_ID = "-100123";
    try {
      _setPendingPublishForTests(200, {
        html: "<b>Report</b>",
        chatId: 12345,
        createdAt: Date.now(),
      });
      await handleBitumCallback(FAKE_TOKEN, FAKE_CB("bp:confirm") as any);
      // One sendMessage to channel + one confirmation
      const channelMsgs = fetchCalls.filter(
        (c) => c.body.chat_id === "-100123",
      );
      expect(channelMsgs.length).toBeGreaterThanOrEqual(1);
      const ackTexts = fetchCalls
        .filter((c) => c.body.chat_id === 12345)
        .map((c) => c.body.text as string)
        .join("\n");
      expect(ackTexts).toContain("Опубликовано в канал");
    } finally {
      if (prev === undefined) delete process.env.TG_CHANNEL_ID;
      else process.env.TG_CHANNEL_ID = prev;
    }
  });

  it("bp:confirm without TG_CHANNEL_ID → error", async () => {
    const prev = process.env.TG_CHANNEL_ID;
    delete process.env.TG_CHANNEL_ID;
    try {
      _setPendingPublishForTests(200, {
        html: "<b>x</b>",
        chatId: 12345,
        createdAt: Date.now(),
      });
      await handleBitumCallback(FAKE_TOKEN, FAKE_CB("bp:confirm") as any);
      const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
      expect(allTexts).toContain("TG_CHANNEL_ID не задан");
    } finally {
      if (prev !== undefined) process.env.TG_CHANNEL_ID = prev;
    }
  });

  it("br:confirm → resetWeek + ответ deleted files", async () => {
    const buf = Buffer.from("x");
    await saveUpload(buf, "birzha_prices", "2026-W19");
    await saveUpload(buf, "fca_sellers", "2026-W19");
    _setPendingResetForTests(200, {
      week: "2026-W19",
      chatId: 12345,
      createdAt: Date.now(),
    });
    await handleBitumCallback(FAKE_TOKEN, FAKE_CB("br:confirm") as any);
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Сброшена неделя 2026-W19");
    expect(allTexts).toContain("birzha_prices.xlsx");
    expect(allTexts).toContain("fca_sellers.xlsx");
  });

  it("br:cancel → 'Отмена: файлы НЕ удалены'", async () => {
    _setPendingResetForTests(200, {
      week: "2026-W19",
      chatId: 12345,
      createdAt: Date.now(),
    });
    await handleBitumCallback(FAKE_TOKEN, FAKE_CB("br:cancel") as any);
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Отмена");
    expect(allTexts).toContain("НЕ удалены");
  });

  it("expired publish session → guidance message", async () => {
    // No pending state set
    await handleBitumCallback(FAKE_TOKEN, FAKE_CB("bp:confirm") as any);
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Сессия publish истекла");
  });

  it("expired reset session → guidance message", async () => {
    await handleBitumCallback(FAKE_TOKEN, FAKE_CB("br:confirm") as any);
    const allTexts = fetchCalls.map((c) => c.body.text as string).join("\n");
    expect(allTexts).toContain("Сессия reset истекла");
  });
});
