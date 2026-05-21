// src/bot-bitum.ts — handlers для 4 битум-команд + TG-05 upload + learning UX +
// publish/reset confirm flows. Импортируется из src/bot.ts; bot.ts роутит cmd → handler.

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { log } from "./logger.js";
import { classifyFile } from "./bitum/classifier.js";
import { appendLearned } from "./bitum/learned-signatures.js";
import {
  parseBirzhaPrices,
  parseBirzhaVolumes,
  parseFcaSellers,
  parseAllPrices,
  parseBitumPriceNew,
} from "./bitum/parsers/index.js";
import {
  isoWeekFolder,
  saveUpload,
  listWeekV5,
  findLatestWeekWithUploads,
  weekDir,
  resetWeek,
  writeLastRun,
} from "./bitum/storage.js";
import {
  renderBitumReport,
  chunkBitumHtml,
  type ReporterPayload,
} from "./bitum/reporter.js";
import {
  encodeReportForLlm,
  buildBitumNarrative,
  type NarrativeResult,
} from "./bitum/llm.js";
import { byCompanyFixedOrder, deltasFor } from "./bitum/analyzer.js";
import { loadRefineries } from "./bitum/refineries.js";
import type {
  KnownBitumType,
  ClassifyResult,
  WeekStatusV5,
  RefineryEntry,
} from "./bitum/types.js";

// Re-use helpers from src/bot.ts — экспортированы в Task 5.1.
import {
  tgFetch,
  sendHtml,
  sendPlain,
  type TgMessage,
  type TgCallbackQuery,
  type TgInlineKeyboardButton,
} from "./bot.js";

const CHANNEL_ID_ENV = "TG_CHANNEL_ID";

// =============================================================================
// Pending state для confirm flows (D-11, D-12, D-14).
// In-memory; рестарт бота → pending теряются.
// Экспортированы для тестов (mock'ить pending state).
// =============================================================================

interface PendingPublish {
  html: string;
  chatId: number;
  createdAt: number;
}
const pendingPublishByMsgId = new Map<number, PendingPublish>();

interface PendingReset {
  week: string;
  chatId: number;
  createdAt: number;
}
const pendingResetByMsgId = new Map<number, PendingReset>();

interface PendingLearning {
  buffer: Buffer;
  originalFileName: string;
  meta: ClassifyResult["meta"];
  chatId: number;
  createdAt: number;
}
const pendingLearningByMsgId = new Map<number, PendingLearning>();

/**
 * Тестовый helper — очистить in-memory pending state между тестами.
 */
export function _resetPendingStateForTests(): void {
  pendingPublishByMsgId.clear();
  pendingResetByMsgId.clear();
  pendingLearningByMsgId.clear();
}

// =============================================================================
// Inline-keyboard layouts.
// =============================================================================

const LEARNING_KEYBOARD: TgInlineKeyboardButton[][] = [
  [{ text: "birzha_prices", callback_data: "bs:birzha_prices" }],
  [{ text: "birzha_volumes", callback_data: "bs:birzha_volumes" }],
  [{ text: "fca_sellers", callback_data: "bs:fca_sellers" }],
  [{ text: "all_prices", callback_data: "bs:all_prices" }],
  [{ text: "bitum_price_new", callback_data: "bs:bitum_price_new" }],
  [{ text: "❌ не битум", callback_data: "bs:not_bitum" }],
];

// =============================================================================
// Reusable: load all 5 types from week & build reporter payload.
// =============================================================================

async function loadWeekPayload(week: string): Promise<{
  payload: ReporterPayload;
  status: WeekStatusV5;
  dict: RefineryEntry[];
}> {
  const dict = loadRefineries();
  const status = listWeekV5(week);
  const payload: ReporterPayload = { files: {} };

  if (status.hasBirzhaPrices) {
    const buf = readFileSync(path.join(weekDir(week), "birzha_prices.xlsx"));
    const r = await parseBirzhaPrices(buf, dict);
    payload.prices = r.rows;
    payload.files.birzhaPricesFile = "birzha_prices.xlsx";
  }
  if (status.hasBirzhaVolumes) {
    const buf = readFileSync(
      path.join(weekDir(week), "birzha_volumes.xlsx"),
    );
    const r = await parseBirzhaVolumes(buf, dict);
    payload.volumes = r.rows;
    payload.files.birzhaVolumesFile = "birzha_volumes.xlsx";
  }
  if (status.hasFcaSellers) {
    // MIGRATE-03: предпочесть fca_sellers.xlsx, fallback на legacy fca.xlsx
    const newPath = path.join(weekDir(week), "fca_sellers.xlsx");
    const legacyPath = path.join(weekDir(week), "fca.xlsx");
    const filePath = existsSync(newPath) ? newPath : legacyPath;
    const buf = readFileSync(filePath);
    const r = await parseFcaSellers(buf, dict);
    payload.fca = r.rows;
    payload.files.fcaSellersFile = path.basename(filePath);
  }
  if (status.hasAllPrices) {
    const buf = readFileSync(path.join(weekDir(week), "all_prices.xlsx"));
    const r = await parseAllPrices(buf, dict);
    payload.allPrices = r.rows;
    payload.files.allPricesFile = "all_prices.xlsx";
  }
  if (status.hasBitumPriceNew) {
    const buf = readFileSync(
      path.join(weekDir(week), "bitum_price_new.xlsx"),
    );
    const r = await parseBitumPriceNew(buf);
    if (r.rows.length > 0) payload.bitumSnapshot = r.rows[0];
    payload.files.bitumPriceNewFile = "bitum_price_new.xlsx";
  }
  return { payload, status, dict };
}

// =============================================================================
// BITUM-TG-01: /bitum_status
// =============================================================================

export async function handleBitumStatus(
  token: string,
  msg: TgMessage,
): Promise<void> {
  const week = findLatestWeekWithUploads() ?? isoWeekFolder(new Date());
  const status = listWeekV5(week);
  const lines = [
    `<b>Битум-неделя ${week}</b>`,
    `Чек-лист (${status.presentCount}/5):`,
    `- birzha_prices: ${status.hasBirzhaPrices ? "✅" : "❌"}`,
    `- birzha_volumes: ${status.hasBirzhaVolumes ? "✅" : "❌"}`,
    `- fca_sellers: ${status.hasFcaSellers ? "✅" : "❌"}`,
    `- all_prices: ${status.hasAllPrices ? "✅" : "❌"}`,
    `- bitum_price_new: ${status.hasBitumPriceNew ? "✅" : "❌"}`,
    `Последний прогон: ${status.lastRunAt ?? "—"}`,
  ];
  await sendHtml(token, msg.chat.id, lines.join("\n"));
}

// =============================================================================
// BITUM-TG-02: /bitum_preview — рендерит и шлёт В DM (НЕ публикует)
// =============================================================================

export async function handleBitumPreview(
  token: string,
  msg: TgMessage,
): Promise<void> {
  const chatId = msg.chat.id;
  try {
    await sendPlain(token, chatId, "📊 Готовлю превью отчёта…");
    const week = findLatestWeekWithUploads() ?? isoWeekFolder(new Date());
    const { payload, status, dict } = await loadWeekPayload(week);
    if (status.presentCount === 0) {
      await sendHtml(
        token,
        chatId,
        `<b>❓ За неделю ${week} файлов не загружено.</b>\nЗагрузите xlsx и повторите.`,
      );
      return;
    }

    // Optional LLM framing
    let framingSentences: NarrativeResult | undefined;
    try {
      if (process.env.DEEPSEEK_API_KEY) {
        const birzhaDeltas = deltasFor(payload.prices ?? [], "birzha");
        const fcaDeltas = deltasFor(payload.fca ?? [], "fca");
        const groups = byCompanyFixedOrder(
          [...birzhaDeltas, ...fcaDeltas],
          dict,
        );
        const dates = [
          ...(payload.prices ?? []),
          ...(payload.fca ?? []),
        ].map((r) => r.date);
        if (dates.length > 0) {
          const period = {
            start: dates.reduce((a, b) => (a < b ? a : b)),
            end: dates.reduce((a, b) => (a > b ? a : b)),
          };
          const llmPayload = encodeReportForLlm(
            groups,
            period,
            payload.bitumSnapshot,
            !!payload.volumes,
          );
          const narrative = await buildBitumNarrative(llmPayload);
          framingSentences = narrative;
        }
      }
    } catch (err) {
      log.warn(
        `[bitum-bot] LLM narrative failed: ${(err as Error).message}; продолжаем без framing`,
      );
    }

    const report = renderBitumReport(payload, { dict, framingSentences });
    const parts = chunkBitumHtml(report.html);
    for (const part of parts) {
      await sendHtml(token, chatId, part);
    }
    writeLastRun(week, new Date());
  } catch (err) {
    const m = (err as Error).message ?? String(err);
    log.error(`[bitum-bot] /bitum_preview error: ${m}`);
    await sendPlain(token, chatId, `⚠️ Ошибка: ${m.slice(0, 300)}`);
  }
}

// =============================================================================
// BITUM-TG-03: /bitum_report — preview + inline-keyboard publish/cancel (D-11)
// =============================================================================

export async function handleBitumReport(
  token: string,
  msg: TgMessage,
): Promise<void> {
  const chatId = msg.chat.id;
  try {
    const week = findLatestWeekWithUploads() ?? isoWeekFolder(new Date());
    const { payload, status, dict } = await loadWeekPayload(week);
    if (status.presentCount === 0) {
      await sendHtml(
        token,
        chatId,
        `<b>❓ За неделю ${week} файлов не загружено.</b>`,
      );
      return;
    }
    const report = renderBitumReport(payload, { dict });
    const parts = chunkBitumHtml(report.html);
    for (const part of parts) {
      await sendHtml(token, chatId, part);
    }
    // Финальное сообщение с кнопками publish/cancel
    const keyboard: TgInlineKeyboardButton[][] = [
      [
        { text: "📤 Опубликовать в канал", callback_data: "bp:confirm" },
        { text: "❌ Отмена", callback_data: "bp:cancel" },
      ],
    ];
    const promptResp = await tgFetch<{
      ok: boolean;
      result: { message_id: number };
    }>(token, "sendMessage", {
      chat_id: chatId,
      text: "Опубликовать отчёт в TG_CHANNEL_ID?",
      reply_markup: { inline_keyboard: keyboard },
    });
    const promptMsgId = promptResp.result.message_id;
    pendingPublishByMsgId.set(promptMsgId, {
      html: report.html,
      chatId,
      createdAt: Date.now(),
    });
  } catch (err) {
    const m = (err as Error).message ?? String(err);
    log.error(`[bitum-bot] /bitum_report error: ${m}`);
    await sendPlain(token, chatId, `⚠️ Ошибка: ${m.slice(0, 300)}`);
  }
}

// =============================================================================
// BITUM-TG-04: /bitum_reset — inline-keyboard confirm (D-12)
// =============================================================================

export async function handleBitumReset(
  token: string,
  msg: TgMessage,
): Promise<void> {
  const chatId = msg.chat.id;
  const week = findLatestWeekWithUploads() ?? isoWeekFolder(new Date());
  const status = listWeekV5(week);
  if (status.presentCount === 0) {
    await sendPlain(token, chatId, `Папка ${week} уже пуста.`);
    return;
  }
  const keyboard: TgInlineKeyboardButton[][] = [
    [
      { text: "✅ Сбросить", callback_data: "br:confirm" },
      { text: "❌ Отмена", callback_data: "br:cancel" },
    ],
  ];
  const promptResp = await tgFetch<{
    ok: boolean;
    result: { message_id: number };
  }>(token, "sendMessage", {
    chat_id: chatId,
    text: `Сбросить неделю ${week}? Будет удалено ${status.presentCount} xlsx файл(ов). Операция деструктивная, без backup.`,
    reply_markup: { inline_keyboard: keyboard },
  });
  pendingResetByMsgId.set(promptResp.result.message_id, {
    week,
    chatId,
    createdAt: Date.now(),
  });
}

// =============================================================================
// BITUM-TG-05: handleBitumDocument — xlsx upload response (TG-05, D-13, D-14)
// =============================================================================

interface ParseSummary {
  rowCount: number;
  refineryCount: number;
  errorCount: number;
  periodStr: string;
}

async function parseByType(
  type: KnownBitumType,
  buffer: Buffer,
): Promise<ParseSummary> {
  const dict = loadRefineries();
  switch (type) {
    case "birzha_prices": {
      const r = await parseBirzhaPrices(buffer, dict);
      const refs = new Set(r.rows.map((x) => x.refineryCanonical));
      const dates = r.rows.map((x) => x.date);
      return {
        rowCount: r.rows.length,
        refineryCount: refs.size,
        errorCount: r.errors.length,
        periodStr: dateRange(dates),
      };
    }
    case "birzha_volumes": {
      const r = await parseBirzhaVolumes(buffer, dict);
      const refs = new Set(r.rows.map((x) => x.refineryCanonical));
      const dates = r.rows.map((x) => x.date);
      return {
        rowCount: r.rows.length,
        refineryCount: refs.size,
        errorCount: r.errors.length,
        periodStr: dateRange(dates),
      };
    }
    case "fca_sellers": {
      const r = await parseFcaSellers(buffer, dict);
      const refs = new Set(r.rows.map((x) => x.refineryCanonical));
      const dates = r.rows.map((x) => x.date);
      return {
        rowCount: r.rows.length,
        refineryCount: refs.size,
        errorCount: r.errors.length,
        periodStr: dateRange(dates),
      };
    }
    case "all_prices": {
      const r = await parseAllPrices(buffer, dict);
      const refs = new Set(r.rows.map((x) => x.pointOfShipment));
      const dates = r.rows.map((x) => x.date);
      return {
        rowCount: r.rows.length,
        refineryCount: refs.size,
        errorCount: r.errors.length,
        periodStr: dateRange(dates),
      };
    }
    case "bitum_price_new": {
      const r = await parseBitumPriceNew(buffer);
      const date = r.rows[0]?.date;
      return {
        rowCount: r.rows.length,
        refineryCount: r.rows.length,
        errorCount: r.errors.length,
        periodStr: date ? date.toISOString().slice(0, 10) : "—",
      };
    }
  }
}

function dateRange(dates: Date[]): string {
  if (dates.length === 0) return "—";
  const min = dates.reduce((a, b) => (a < b ? a : b)).toISOString().slice(0, 10);
  const max = dates.reduce((a, b) => (a > b ? a : b)).toISOString().slice(0, 10);
  return min === max ? min : `${min}..${max}`;
}

export async function handleBitumDocument(
  token: string,
  msg: TgMessage,
  buffer: Buffer,
  originalFileName: string,
): Promise<void> {
  const chatId = msg.chat.id;
  try {
    const cls: ClassifyResult = await classifyFile(buffer);
    log.info(
      `[bitum-bot] classify: file=${originalFileName} type=${cls.type} conf=${cls.confidence}`,
    );

    // D-14: classifier learning UX при confidence < 1 OR unknown
    if (cls.confidence < 1 || cls.type === "unknown") {
      const promptResp = await tgFetch<{
        ok: boolean;
        result: { message_id: number };
      }>(token, "sendMessage", {
        chat_id: chatId,
        text: `Файл "${originalFileName}" — confidence ${cls.confidence.toFixed(2)}, type=${cls.type}. Укажите правильный тип:`,
        reply_markup: { inline_keyboard: LEARNING_KEYBOARD },
      });
      pendingLearningByMsgId.set(promptResp.result.message_id, {
        buffer,
        originalFileName,
        meta: cls.meta,
        chatId,
        createdAt: Date.now(),
      });
      return;
    }

    // confidence === 1 → save + parse + ONE response (TG-05).
    // cls.type здесь гарантированно KnownBitumType (early return выше отсёк "unknown").
    const week = isoWeekFolder(new Date());
    await saveUpload(buffer, cls.type as KnownBitumType, week);
    const parseResult = await parseByType(
      cls.type as KnownBitumType,
      buffer,
    );
    const status = listWeekV5(week);
    const checkListLines = [
      `- birzha_prices: ${status.hasBirzhaPrices ? "✅" : "❌"}`,
      `- birzha_volumes: ${status.hasBirzhaVolumes ? "✅" : "❌"}`,
      `- fca_sellers: ${status.hasFcaSellers ? "✅" : "❌"}`,
      `- all_prices: ${status.hasAllPrices ? "✅" : "❌"}`,
      `- bitum_price_new: ${status.hasBitumPriceNew ? "✅" : "❌"}`,
    ];
    const text = [
      `<b>✅ Файл распознан: ${cls.type}</b> (confidence ${cls.confidence.toFixed(2)})`,
      `Сохранён: data/uploads/${week}/${cls.type}.xlsx`,
      `Парсинг: rows=${parseResult.rowCount}, refineries=${parseResult.refineryCount}, errors=${parseResult.errorCount}`,
      `Период: ${parseResult.periodStr}`,
      ``,
      `<b>Неделя ${week} (${status.presentCount}/5):</b>`,
      ...checkListLines,
    ].join("\n");
    await sendHtml(token, chatId, text);
  } catch (err) {
    const m = (err as Error).message ?? String(err);
    log.error(`[bitum-bot] handleBitumDocument error: ${m}`);
    await sendPlain(token, chatId, `⚠️ Ошибка: ${m.slice(0, 300)}`);
  }
}

// =============================================================================
// Callback router for `bs:` (signature learn), `bp:` (publish), `br:` (reset).
// Returns true if handled (caller should NOT continue with other handlers).
// =============================================================================

export async function handleBitumCallback(
  token: string,
  cb: TgCallbackQuery,
): Promise<boolean> {
  const data = cb.data ?? "";
  if (
    !data.startsWith("bs:") &&
    !data.startsWith("bp:") &&
    !data.startsWith("br:")
  ) {
    return false;
  }
  // ACK
  try {
    await tgFetch(token, "answerCallbackQuery", {
      callback_query_id: cb.id,
    });
  } catch {
    /* ignore ack failures */
  }

  const msgId = cb.message?.message_id;
  if (!msgId || !cb.message) return true;

  if (data.startsWith("bs:")) {
    const choice = data.slice(3);
    const pending = pendingLearningByMsgId.get(msgId);
    if (!pending) {
      await sendPlain(
        token,
        cb.message.chat.id,
        "Сессия learning истекла (рестарт бота?). Перешлите файл заново.",
      );
      return true;
    }
    pendingLearningByMsgId.delete(msgId);
    if (choice === "not_bitum") {
      await sendPlain(
        token,
        cb.message.chat.id,
        `Не сохранено: "${pending.originalFileName}" помечен как «не битум».`,
      );
      return true;
    }
    const type = choice as KnownBitumType;
    await appendLearned({
      type,
      a1: pending.meta.a1,
      a3: pending.meta.a3,
      b3: pending.meta.b3,
      sheetName: pending.meta.sheetName,
      learnedAt: new Date().toISOString(),
    });
    const week = isoWeekFolder(new Date());
    await saveUpload(pending.buffer, type, week);
    const parseResult = await parseByType(type, pending.buffer);
    const status = listWeekV5(week);
    const text = [
      `<b>✅ Сохранён как ${type}</b> (learned: A1="${pending.meta.a1 ?? "?"}")`,
      `Сохранён: data/uploads/${week}/${type}.xlsx`,
      `Парсинг: rows=${parseResult.rowCount}, refineries=${parseResult.refineryCount}, errors=${parseResult.errorCount}`,
      ``,
      `<b>Неделя ${week} (${status.presentCount}/5)</b>`,
    ].join("\n");
    await sendHtml(token, cb.message.chat.id, text);
    return true;
  }

  if (data.startsWith("bp:")) {
    const action = data.slice(3);
    const pending = pendingPublishByMsgId.get(msgId);
    if (!pending) {
      await sendPlain(
        token,
        cb.message.chat.id,
        "Сессия publish истекла. Перезапустите /bitum_report.",
      );
      return true;
    }
    pendingPublishByMsgId.delete(msgId);
    if (action === "cancel") {
      await sendPlain(
        token,
        cb.message.chat.id,
        "❌ Отмена: отчёт НЕ опубликован.",
      );
      return true;
    }
    if (action === "confirm") {
      const channelId = process.env[CHANNEL_ID_ENV];
      if (!channelId) {
        await sendPlain(
          token,
          cb.message.chat.id,
          `❌ ${CHANNEL_ID_ENV} не задан — не могу опубликовать.`,
        );
        return true;
      }
      const parts = chunkBitumHtml(pending.html);
      for (const part of parts) {
        await tgFetch(token, "sendMessage", {
          chat_id: channelId,
          text: part,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      }
      await sendPlain(
        token,
        cb.message.chat.id,
        `✅ Опубликовано в канал (${parts.length} part(s)).`,
      );
      return true;
    }
  }

  if (data.startsWith("br:")) {
    const action = data.slice(3);
    const pending = pendingResetByMsgId.get(msgId);
    if (!pending) {
      await sendPlain(
        token,
        cb.message.chat.id,
        "Сессия reset истекла. Перезапустите /bitum_reset.",
      );
      return true;
    }
    pendingResetByMsgId.delete(msgId);
    if (action === "cancel") {
      await sendPlain(
        token,
        cb.message.chat.id,
        "❌ Отмена: файлы НЕ удалены.",
      );
      return true;
    }
    if (action === "confirm") {
      const deleted = resetWeek(pending.week);
      await sendHtml(
        token,
        cb.message.chat.id,
        `<b>✅ Сброшена неделя ${pending.week}</b>\nУдалено: ${deleted.length === 0 ? "—" : deleted.join(", ")}`,
      );
      return true;
    }
  }
  return true;
}

// =============================================================================
// Test helpers — expose pending Maps для unit-тестов.
// =============================================================================

/**
 * Тестовый helper — добавить pending publish entry (для тестирования handleBitumCallback).
 */
export function _setPendingPublishForTests(
  msgId: number,
  entry: { html: string; chatId: number; createdAt: number },
): void {
  pendingPublishByMsgId.set(msgId, entry);
}

export function _setPendingResetForTests(
  msgId: number,
  entry: { week: string; chatId: number; createdAt: number },
): void {
  pendingResetByMsgId.set(msgId, entry);
}

export function _setPendingLearningForTests(
  msgId: number,
  entry: {
    buffer: Buffer;
    originalFileName: string;
    meta: ClassifyResult["meta"];
    chatId: number;
    createdAt: number;
  },
): void {
  pendingLearningByMsgId.set(msgId, entry);
}
