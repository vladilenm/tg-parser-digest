// src/bot-bitum.ts — битум-handlers v5.1 (always-ask UX, 4 команды).
// 6 экспортов: handleBitumDocument, handleBitumStatus, handleBitumReport,
// handleBitumReset, handleBitumAdd, handleBitumCallback.
// T-04-01: BITUM_MAX_XLSX_BYTES (default 10MB) pre-check на размер xlsx.
// T-04-06: escapeHtml + sanitize control chars (см. reporter.ts / manual-numbers.ts).
// T-04-07: error reply slice(0, 300) без token.
// Default — нужно подтверждение оператора на execute-phase:
//   - /bitum_add syntax: split first "="
//   - REPORT_TTL_MS = 15 min для pendingReports
//   - BITUM_CROSS_CHECK_THRESHOLD env (default 1.0)
//   - BITUM_MAX_XLSX_BYTES env (default 10*1024*1024)

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { log } from "./logger.js";
import {
  sendHtml,
  sendPlain,
  sendReplyWithKeyboard,
  tgFetch,
  type TgCallbackQuery,
  type TgInlineKeyboardButton,
  type TgMessage,
} from "./bot.js";
import { sendToChannel, chunkHtml } from "./deliver.js";
import {
  BITUM_BUTTON_LABELS,
  BITUM_TYPES,
  type BitumType,
  type ManualNumber,
  type ParsedByType,
} from "./bitum/types.js";
import {
  getWeekStatus,
  isoWeekFolder,
  resetWeek,
  saveXlsx,
  weekDir,
} from "./bitum/storage.js";
import {
  addManualNumber,
  clearManualNumbers,
  listManualNumbers,
} from "./bitum/manual-numbers.js";
import {
  loadRefineriesDict,
  type RefineriesDict,
} from "./bitum/refineries.js";
import {
  parseBirzhaPrices,
  parseBirzhaVolumes,
  parseBitumPriceNew,
  parseFcaSellers,
} from "./bitum/parsers/index.js";
import { analyzeBitum } from "./bitum/analyzer.js";
import { buildReport } from "./bitum/reporter.js";

// =============================================================================
// Module-level state.
// =============================================================================

interface PendingUpload {
  buffer: Buffer;
  fileName: string;
  uploadedAt: number;
}
const pendingUploads = new Map<number, PendingUpload>(); // key: originalMsgId

interface PendingReport {
  html: string;
  requestedBy: number;
  createdAt: number;
}
const pendingReports = new Map<string, PendingReport>(); // key: previewHashShort

// Default — нужно подтверждение оператора на execute-phase:
const REPORT_TTL_MS = 15 * 60 * 1000;
const BITUM_MAX_XLSX_BYTES = Number(
  process.env.BITUM_MAX_XLSX_BYTES ?? 10 * 1024 * 1024
);

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function currentWeek(msg?: TgMessage): string {
  // Используем UTC+3 (MSK).
  void msg;
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  return isoWeekFolder(now);
}

// =============================================================================
// handleBitumDocument — приём xlsx + inline-keyboard выбора типа.
// =============================================================================

export async function handleBitumDocument(
  token: string,
  msg: TgMessage,
  buffer: Buffer,
  fileName: string
): Promise<void> {
  const chatId = msg.chat.id;
  // T-04-01: размер
  if (buffer.length > BITUM_MAX_XLSX_BYTES) {
    log.warn(
      `[bitum] document rejected: size=${buffer.length} > max=${BITUM_MAX_XLSX_BYTES}`
    );
    await sendPlain(
      token,
      chatId,
      `⚠️ Файл слишком большой (>${Math.round(BITUM_MAX_XLSX_BYTES / 1024 / 1024)} МБ). Отклонено.`
    );
    return;
  }
  // Save to pendingUploads, attach inline-keyboard.
  pendingUploads.set(msg.message_id, {
    buffer,
    fileName,
    uploadedAt: Date.now(),
  });
  const sizeKb = Math.round(buffer.length / 1024);
  const keyboard: TgInlineKeyboardButton[][] = [
    ...BITUM_TYPES.map((t): TgInlineKeyboardButton[] => [
      {
        text: BITUM_BUTTON_LABELS[t],
        callback_data: `bu:${t}:${msg.message_id}`,
      },
    ]),
    [
      {
        text: "❌ Не битум / Отмена",
        callback_data: `bu:cancel:${msg.message_id}`,
      },
    ],
  ];
  await sendReplyWithKeyboard(
    token,
    chatId,
    msg.message_id,
    `Я получил xlsx «${fileName}» (${sizeKb} КБ). Что это за файл?`,
    keyboard
  );
}

// =============================================================================
// handleBitumStatus — чек-лист текущей недели.
// =============================================================================

export async function handleBitumStatus(
  token: string,
  msg: TgMessage
): Promise<void> {
  try {
    const week = currentWeek(msg);
    const status = await getWeekStatus(week);
    const lines: string[] = [`<b>Битум-неделя ${escapeHtml(week)}</b>`];
    for (const t of BITUM_TYPES) {
      const mark = status.present[t] ? "✅" : "❌";
      lines.push(`• ${BITUM_BUTTON_LABELS[t]}: ${mark}`);
    }
    lines.push(`• Ручные числа: ${status.manualNumbersCount} запис(ей)`);
    lines.push(
      `Последнее обновление: ${status.lastUpdatedAt ?? "—"}`
    );
    await sendHtml(token, msg.chat.id, lines.join("\n"));
  } catch (err) {
    const m = (err as Error).message ?? String(err);
    log.error(`[bitum] handleBitumStatus error: ${m}`);
    await sendPlain(token, msg.chat.id, `⚠️ Ошибка: ${m.slice(0, 300)}`);
  }
}

// =============================================================================
// handleBitumReport — собрать дайджест + preview + confirm/cancel.
// =============================================================================

async function loadAndParseWeek(
  week: string,
  dict: RefineriesDict
): Promise<ParsedByType> {
  const dir = weekDir(week);
  const result: ParsedByType = {
    birzha_volumes: null,
    birzha_prices: null,
    fca_sellers: null,
    bitum_price_new: null,
  };
  for (const t of BITUM_TYPES) {
    const filePath = path.join(dir, `${t}.xlsx`);
    if (!existsSync(filePath)) continue;
    try {
      const buf = readFileSync(filePath);
      switch (t) {
        case "birzha_volumes": {
          const r = await parseBirzhaVolumes(buf, dict);
          result.birzha_volumes = r.rows;
          break;
        }
        case "birzha_prices": {
          const r = await parseBirzhaPrices(buf, dict);
          result.birzha_prices = r.rows;
          break;
        }
        case "fca_sellers": {
          const r = await parseFcaSellers(buf, dict);
          result.fca_sellers = r.rows;
          break;
        }
        case "bitum_price_new": {
          const r = await parseBitumPriceNew(buf, dict);
          result.bitum_price_new = r.rows;
          break;
        }
      }
    } catch (err) {
      log.error(
        `[bitum] parse ${t} failed: ${(err as Error).message ?? String(err)}`
      );
    }
  }
  return result;
}

export async function handleBitumReport(
  token: string,
  msg: TgMessage
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from?.id ?? 0;
  try {
    const week = currentWeek(msg);
    const status = await getWeekStatus(week);
    const anyPresent = BITUM_TYPES.some((t) => status.present[t]);
    if (!anyPresent && status.manualNumbersCount === 0) {
      await sendPlain(
        token,
        chatId,
        `Битум-неделя ${week} пуста — нет файлов и нет ручных чисел. Загрузите xlsx или /bitum_add.`
      );
      return;
    }
    const dict = loadRefineriesDict();
    const thresholdPct = Number(
      process.env.BITUM_CROSS_CHECK_THRESHOLD ?? 1.0
    );
    const parsed = await loadAndParseWeek(week, dict);
    const manual: ManualNumber[] = await listManualNumbers(week);
    const analysis = analyzeBitum(parsed, dict, { thresholdPct });
    const { html } = buildReport(analysis, manual, status);
    // Chunked send preview to DM (use chunkHtml to stay under TG limit).
    const parts = chunkHtml(html);
    for (const p of parts) {
      await sendHtml(token, chatId, p);
    }
    // Confirm keyboard.
    const hash = shortHash(html);
    pendingReports.set(hash, {
      html,
      requestedBy: userId,
      createdAt: Date.now(),
    });
    setTimeout(() => {
      pendingReports.delete(hash);
    }, REPORT_TTL_MS);
    const confirmKeyboard: TgInlineKeyboardButton[][] = [
      [
        { text: "📤 Опубликовать", callback_data: `br:publish:${hash}` },
        { text: "❌ Отмена", callback_data: `br:cancel:${hash}` },
      ],
    ];
    await sendReplyWithKeyboard(
      token,
      chatId,
      msg.message_id,
      `Опубликовать отчёт в канал?`,
      confirmKeyboard
    );
  } catch (err) {
    const m = (err as Error).message ?? String(err);
    log.error(`[bitum] handleBitumReport error: ${m}`);
    await sendPlain(token, chatId, `⚠️ Ошибка: ${m.slice(0, 300)}`);
  }
}

// =============================================================================
// handleBitumReset — сбросить текущую неделю (xlsx + ручные числа).
// =============================================================================

export async function handleBitumReset(
  token: string,
  msg: TgMessage
): Promise<void> {
  try {
    const week = currentWeek(msg);
    const status = await getWeekStatus(week);
    const anyPresent = BITUM_TYPES.some((t) => status.present[t]);
    if (!anyPresent && status.manualNumbersCount === 0) {
      await sendPlain(
        token,
        msg.chat.id,
        `Неделя ${week} пуста, нечего сбрасывать.`
      );
      return;
    }
    const presentTypes = BITUM_TYPES.filter((t) => status.present[t]).map(
      (t) => `${t}.xlsx`
    );
    const presentList = [
      ...presentTypes,
      ...(status.manualNumbersCount > 0
        ? [`manual-numbers.json (${status.manualNumbersCount})`]
        : []),
    ].join(", ");
    const keyboard: TgInlineKeyboardButton[][] = [
      [
        { text: "✅ Сбросить", callback_data: `brs:confirm:${week}` },
        { text: "❌ Отмена", callback_data: `brs:cancel:${week}` },
      ],
    ];
    await sendReplyWithKeyboard(
      token,
      msg.chat.id,
      msg.message_id,
      `Сбросить битум-неделю ${week}? Будут удалены: ${presentList}.`,
      keyboard
    );
  } catch (err) {
    const m = (err as Error).message ?? String(err);
    log.error(`[bitum] handleBitumReset error: ${m}`);
    await sendPlain(token, msg.chat.id, `⚠️ Ошибка: ${m.slice(0, 300)}`);
  }
}

// =============================================================================
// handleBitumAdd — добавить ручное число (label=value).
// =============================================================================

export async function handleBitumAdd(
  token: string,
  msg: TgMessage
): Promise<void> {
  const chatId = msg.chat.id;
  try {
    const text = (msg.text ?? "").trim();
    // Strip command prefix "/bitum_add" (with optional @botname suffix).
    const m = /^\/bitum_add(?:@\w+)?\s*(.*)$/i.exec(text);
    if (!m) {
      await sendPlain(
        token,
        chatId,
        `Использование: /bitum_add <label>=<value>\nПример: /bitum_add Средняя цена БНД=28336 ₽/т`
      );
      return;
    }
    const arg = m[1];
    const eqIdx = arg.indexOf("=");
    if (eqIdx <= 0 || eqIdx === arg.length - 1) {
      await sendPlain(
        token,
        chatId,
        `Использование: /bitum_add <label>=<value>\nПример: /bitum_add Средняя цена БНД=28336 ₽/т`
      );
      return;
    }
    const label = arg.slice(0, eqIdx).trim();
    const value = arg.slice(eqIdx + 1).trim();
    if (!label || !value) {
      await sendPlain(
        token,
        chatId,
        `Использование: /bitum_add <label>=<value>`
      );
      return;
    }
    const week = currentWeek(msg);
    await addManualNumber(week, label, value);
    const list = await listManualNumbers(week);
    await sendPlain(
      token,
      chatId,
      `✅ Добавлено: ${label} = ${value}. Сейчас записей в неделе ${week}: ${list.length}.`
    );
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    log.error(`[bitum] handleBitumAdd error: ${errMsg}`);
    await sendPlain(token, chatId, `⚠️ Ошибка: ${errMsg.slice(0, 300)}`);
  }
}

// =============================================================================
// handleBitumCallback — обработка bu: / br: / brs: callbacks.
// Возвращает true если handler обработал callback, false иначе.
// =============================================================================

async function editText(
  token: string,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  try {
    await tgFetch<{ ok: boolean }>(token, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (err) {
    log.warn(
      `[bitum] editMessageReplyMarkup failed: ${(err as Error).message}`
    );
  }
  try {
    await tgFetch<{ ok: boolean }>(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
    });
  } catch (err) {
    log.warn(`[bitum] editMessageText failed: ${(err as Error).message}`);
  }
}

async function answerCb(token: string, cbId: string): Promise<void> {
  try {
    await tgFetch<{ ok: boolean }>(token, "answerCallbackQuery", {
      callback_query_id: cbId,
    });
  } catch (err) {
    log.warn(`[bitum] answerCallbackQuery failed: ${(err as Error).message}`);
  }
}

function isBitumType(s: string): s is BitumType {
  return (BITUM_TYPES as readonly string[]).includes(s);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function handleBitumCallback(
  token: string,
  cb: TgCallbackQuery
): Promise<boolean> {
  const data = cb.data ?? "";
  if (!/^(bu|br|brs):/.test(data)) return false;
  if (!cb.message) {
    await answerCb(token, cb.id);
    return true;
  }
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  await answerCb(token, cb.id);

  // bu:{type|cancel}:{originalMsgId}
  if (data.startsWith("bu:")) {
    const parts = data.split(":");
    if (parts.length < 3) {
      await editText(token, chatId, messageId, "⚠️ Невалидный callback.");
      return true;
    }
    const action = parts[1];
    const originalMsgId = Number(parts[2]);
    const pending = pendingUploads.get(originalMsgId);
    if (!pending) {
      await editText(
        token,
        chatId,
        messageId,
        "⏳ Сессия загрузки истекла. Пришлите файл ещё раз."
      );
      return true;
    }
    if (action === "cancel") {
      pendingUploads.delete(originalMsgId);
      await editText(token, chatId, messageId, "❌ Загрузка отменена.");
      return true;
    }
    if (!isBitumType(action)) {
      await editText(token, chatId, messageId, "⚠️ Невалидный тип файла.");
      pendingUploads.delete(originalMsgId);
      return true;
    }
    const type: BitumType = action;
    try {
      const week = currentWeek(cb.message);
      await saveXlsx(week, type, pending.buffer);
      const dict = loadRefineriesDict();
      let rowsCount = 0;
      let errorsCount = 0;
      let dateFrom = "";
      let dateTo = "";
      try {
        switch (type) {
          case "birzha_volumes": {
            const r = await parseBirzhaVolumes(pending.buffer, dict);
            rowsCount = r.rows.length;
            errorsCount = r.errors.length;
            if (r.rows.length > 0) {
              const dates = r.rows.map((x) => x.date).sort();
              dateFrom = dates[0];
              dateTo = dates[dates.length - 1];
            }
            break;
          }
          case "birzha_prices": {
            const r = await parseBirzhaPrices(pending.buffer, dict);
            rowsCount = r.rows.length;
            errorsCount = r.errors.length;
            if (r.rows.length > 0) {
              const dates = r.rows.map((x) => x.date).sort();
              dateFrom = dates[0];
              dateTo = dates[dates.length - 1];
            }
            break;
          }
          case "fca_sellers": {
            const r = await parseFcaSellers(pending.buffer, dict);
            rowsCount = r.rows.length;
            errorsCount = r.errors.length;
            if (r.rows.length > 0) {
              dateFrom = r.rows[0].date;
              dateTo = r.rows[0].date;
            }
            break;
          }
          case "bitum_price_new": {
            const r = await parseBitumPriceNew(pending.buffer, dict);
            rowsCount = r.rows.length;
            errorsCount = r.errors.length;
            if (r.rows.length > 0) {
              const dates = r.rows.map((x) => x.date).sort();
              dateFrom = dates[0];
              dateTo = dates[dates.length - 1];
            }
            break;
          }
        }
      } catch (err) {
        log.error(
          `[bitum] parse after save failed: ${(err as Error).message}`
        );
      }
      const status = await getWeekStatus(week);
      const checklist = BITUM_TYPES.map((t) => (status.present[t] ? "✅" : "❌")).join(
        ""
      );
      const dateRange =
        dateFrom && dateTo ? `${dateFrom}..${dateTo}` : "(нет данных о датах)";
      await editText(
        token,
        chatId,
        messageId,
        `✅ Сохранено как ${type}.xlsx.\nПериод: ${dateRange}.\nРаспознано ${rowsCount} строк, ошибок: ${errorsCount}.\nЧек-лист недели: ${checklist}`
      );
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      log.error(`[bitum] saveXlsx failed: ${m}`);
      await editText(
        token,
        chatId,
        messageId,
        `⚠️ Ошибка сохранения: ${m.slice(0, 300)}`
      );
    } finally {
      pendingUploads.delete(originalMsgId);
    }
    return true;
  }

  // br:{publish|cancel}:{hash}
  if (data.startsWith("br:")) {
    const parts = data.split(":");
    if (parts.length < 3) {
      await editText(token, chatId, messageId, "⚠️ Невалидный callback.");
      return true;
    }
    const action = parts[1];
    const hash = parts[2];
    const pending = pendingReports.get(hash);
    if (!pending) {
      await editText(
        token,
        chatId,
        messageId,
        "⏳ Превью истёк (15 мин). Повторите /bitum_report."
      );
      return true;
    }
    if (action === "publish") {
      try {
        await sendToChannel(pending.html);
        log.info(
          `[bitum] publish: userId=${cb.from.id} hash=${hash} chars=${pending.html.length}`
        );
        await editText(token, chatId, messageId, "📤 Опубликовано в канал.");
      } catch (err) {
        const m = (err as Error).message ?? String(err);
        log.error(`[bitum] sendToChannel failed: ${m}`);
        await editText(
          token,
          chatId,
          messageId,
          `⚠️ Ошибка публикации: ${m.slice(0, 300)}`
        );
      } finally {
        pendingReports.delete(hash);
      }
      return true;
    }
    if (action === "cancel") {
      pendingReports.delete(hash);
      await editText(token, chatId, messageId, "❌ Публикация отменена.");
      return true;
    }
    return true;
  }

  // brs:{confirm|cancel}:{week}
  if (data.startsWith("brs:")) {
    const parts = data.split(":");
    if (parts.length < 3) {
      await editText(token, chatId, messageId, "⚠️ Невалидный callback.");
      return true;
    }
    const action = parts[1];
    const week = parts[2];
    if (action === "confirm") {
      try {
        const r = await resetWeek(week);
        await clearManualNumbers(week);
        log.info(
          `[bitum] reset: userId=${cb.from.id} week=${week} deleted=${r.deletedFiles.length}`
        );
        await editText(
          token,
          chatId,
          messageId,
          `✅ Неделя ${escapeHtml(week)} сброшена. Удалено файлов: ${r.deletedFiles.length}.`
        );
      } catch (err) {
        const m = (err as Error).message ?? String(err);
        log.error(`[bitum] reset failed: ${m}`);
        await editText(
          token,
          chatId,
          messageId,
          `⚠️ Ошибка сброса: ${m.slice(0, 300)}`
        );
      }
      return true;
    }
    if (action === "cancel") {
      await editText(token, chatId, messageId, "❌ Сброс отменён.");
      return true;
    }
  }

  return false;
}
