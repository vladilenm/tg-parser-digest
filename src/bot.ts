// src/bot.ts — Telegram bot polling + commands handler.
// Использует тот же TG_BOT_TOKEN, что и delivery (D-01). CRUD-обёртки рядом с handler'ами (D-16).

import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { mutate, loadChannels, type ChannelEntry } from "./channels-store.js";
import { log } from "./logger.js";
import { detectUploadType } from "./upload/detect.js";
import { parseWorkbook } from "./upload/parser.js";
import { loadRefineries } from "./upload/refineries.js";
import {
  isoWeekFolder,
  listWeek,
  saveUpload,
  weekDir,
  writeLastRun,
} from "./upload/storage.js";
import { analyze } from "./upload/analyzer.js";
import { renderMarkdown } from "./upload/renderer.js";
import { buildLlmNarrative } from "./upload/llm.js";
import path from "node:path";
import type { ParsedRow, UploadType } from "./upload/types.js";

// =============================================================================
// Telegram API минимальные типы — чтобы избежать `any` в polling/handlers.
// =============================================================================

interface TgUser {
  id: number;
}
interface TgChat {
  id: number;
}
interface TgDocument {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  document?: TgDocument;
}
interface TgFile {
  file_id: string;
  file_path?: string;
  file_size?: number;
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
interface TgGetUpdatesResponse {
  ok: boolean;
  result: TgUpdate[];
  description?: string;
}
interface TgInlineKeyboardButton {
  text: string;
  callback_data: string;
}
interface TgReplyMarkup {
  inline_keyboard: TgInlineKeyboardButton[][];
}

// BOT-UI-01 / D-01 / D-05: reply-keyboard 2×2 под полем ввода.
// Текст кнопки = текст сообщения, который юзер шлёт боту (Telegram эмулирует input);
// в handleCommand есть EMOJI_BUTTON_MAP, который нормализует такой text → "/cmd".
interface TgKeyboardButton {
  text: string;
}
interface TgReplyKeyboardMarkup {
  keyboard: TgKeyboardButton[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
}

// BOT-UI-01 / D-05: единая 2×2 нижняя клавиатура. Прикладывается ко всем
// исходящим сообщениям бот→пользователь, КРОМЕ sendReplyWithKeyboard (inline
// confirm/cancel для /remove_channel — одновременно reply+inline нельзя:
// Telegram примет inline и проигнорирует reply, при этом нижняя клавиатура
// у юзера может временно «исчезнуть» — вернётся со следующим sendMessage).
const MAIN_KEYBOARD: TgReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "📊 Статус загрузок" }, { text: "🧠 Сделать сводку" }],
    [{ text: "📋 Каналы новостей" }, { text: "❓ Помощь" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

// =============================================================================
// Module-level state.
// =============================================================================

const TG_API = "https://api.telegram.org";
const POLL_TIMEOUT_SEC = 30;
// Telegram username regex: 5-32 символа, начинается с буквы, далее буквы/цифры/_.
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

let lastOffset = 0;
let stopRequested = false;
let pollingActive = false;

// =============================================================================
// Helpers.
// =============================================================================

/**
 * Парсит BOT_ALLOWED_USER_IDS (comma-separated numeric) в Set<number>.
 * Пустые/нечисловые/неположительные токены отбрасываются.
 * WR-01: строгий regex — только positive integer без префикса/суффикса
 * (Number.parseInt("12345abc") даёт 12345 и тихо расширяет allowlist на ошибочное число;
 * для security-чувствительной env-переменной это потенциально опасно).
 * Экспорт для unit-тестов (Plan 4).
 */
export function parseAllowlist(envValue: string | undefined): Set<number> {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[1-9]\d*$/.test(s))
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

/**
 * Strip leading `@`, валидация по USERNAME_REGEX.
 * Регистр НЕ меняем (Telegram username case-insensitive, но храним как ввели).
 * Возвращает username без `@` или null если не валиден.
 * Экспорт для unit-тестов (Plan 4).
 */
export function normalizeUsername(raw: string): string | null {
  const trimmed = raw.trim();
  const stripped = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!USERNAME_REGEX.test(stripped)) return null;
  return stripped;
}

/**
 * Обёртка над fetch к Bot API. На !res.ok — throw c HTTP-кодом и телом ответа.
 * Паттерн скопирован из src/deliver.ts:72-81.
 */
async function tgFetch<T>(
  token: string,
  method: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody = await res.text();
    throw new Error(
      `[bot] ${method} failed: ${res.status} ${responseBody.slice(0, 300)}`
    );
  }
  return (await res.json()) as T;
}

/**
 * D-09/D-10: ответ на команду — sendMessage в тот же chat,
 * с reply_to_message_id, plain-text без HTML/Markdown форматирования.
 */
async function sendReply(
  token: string,
  chatId: number,
  replyToMessageId: number,
  text: string
): Promise<void> {
  await tgFetch<{ ok: boolean }>(token, "sendMessage", {
    chat_id: chatId,
    reply_to_message_id: replyToMessageId,
    text,
    disable_web_page_preview: true,
    // BOT-UI-01 / D-05: каждый ответ бота включает нижнюю клавиатуру 2×2.
    reply_markup: MAIN_KEYBOARD,
  });
}

/**
 * Вариант sendReply с inline-keyboard (D-11/D-13). Используется для подтверждения
 * /remove_channel — две кнопки confirm/cancel.
 * Plain-text без HTML/Markdown форматирования (D-10), reply_to_message_id (D-09).
 */
async function sendReplyWithKeyboard(
  token: string,
  chatId: number,
  replyToMessageId: number,
  text: string,
  keyboard: TgInlineKeyboardButton[][]
): Promise<void> {
  await tgFetch<{ ok: boolean }>(token, "sendMessage", {
    chat_id: chatId,
    reply_to_message_id: replyToMessageId,
    text,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Шлёт plain-text сообщение в чат БЕЗ reply_to (для прогресс-индикаторов и финального
 * отчёта в DM, где «свежий» thread читабельнее, чем replies-кружочки).
 */
async function sendPlain(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  await tgFetch<{ ok: boolean }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    // BOT-UI-01 / D-05: прогресс-уведомления и финальный отчёт тоже несут клавиатуру.
    reply_markup: MAIN_KEYBOARD,
  });
}

/**
 * Шлёт Markdown-сообщение (parse_mode: "Markdown") — используется для финального
 * отчёта upload-pipeline. Markdown V1 (не V2) — меньше escape-боли.
 */
async function sendMarkdown(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  await tgFetch<{ ok: boolean }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    // BOT-UI-01 / D-05: финальный markdown-отчёт upload-pipeline / LLM narrative
    // тоже несут клавиатуру.
    reply_markup: MAIN_KEYBOARD,
  });
}

// =============================================================================
// Upload pipeline helpers (Plan quick-260519-l11).
// =============================================================================

/**
 * Текущая неделя в часовом поясе MSK (UTC+3).
 * Используется только для команды /upload_status — для save-операций мы берём
 * неделю из latest-date файла, а не из «сейчас».
 */
function currentMskWeek(): string {
  const nowUtc = Date.now();
  const mskDate = new Date(nowUtc + 3 * 3600 * 1000);
  return isoWeekFolder(mskDate);
}

/**
 * Скачивает файл по file_id через Bot API: getFile → file_path → fetch.
 * Возвращает Buffer + предложенное имя (из document.file_name или file_path basename).
 */
async function downloadTgFile(
  token: string,
  fileId: string,
  fallbackName: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const meta = await tgFetch<{ ok: boolean; result: TgFile }>(
    token,
    "getFile",
    { file_id: fileId }
  );
  const filePath = meta.result.file_path;
  if (!filePath) {
    throw new Error("[bot] getFile: no file_path in response");
  }
  const url = `${TG_API}/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `[bot] download failed: HTTP ${res.status} ${res.statusText}`
    );
  }
  const arr = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arr),
    fileName: fallbackName || path.basename(filePath),
  };
}

/**
 * Обрабатывает document-сообщение от allowlist-юзера: detect → save →
 * (если пара prices+fca собрана) → analyze → send Markdown.
 *
 * Не-allowlist → silent ignore (как handleCommand).
 * Любые throw из pipeline ловятся локальным try/catch и репортятся юзеру коротким текстом.
 */
export async function handleDocument(
  token: string,
  msg: TgMessage,
  allowlist: Set<number>
): Promise<void> {
  const userId = msg.from?.id;
  const doc = msg.document;
  if (!userId || !doc) return;

  if (!allowlist.has(userId)) {
    log.info(`[bot] denied: from=${userId} cmd=document`);
    return;
  }

  const chatId = msg.chat.id;
  try {
    await sendPlain(token, chatId, "⏳ Сохраняю файл…");

    // 1) Download
    const { buffer, fileName } = await downloadTgFile(
      token,
      doc.file_id,
      doc.file_name ?? "upload.xlsx"
    );
    log.info(
      `[bot] document received: from=${userId} name=${fileName} size=${buffer.length}`
    );

    // 2) Detect by A1 marker
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const type = detectUploadType(wb);
    if (!type) {
      await sendPlain(
        token,
        chatId,
        `❓ Не удалось определить тип файла по A1.\nОжидаемые маркеры:\n- "Цена битум на бирже"\n- "Объем битум на бирже"\n- "Битум цены продавцов FCA"`
      );
      return;
    }

    // 3) Parse THIS upload (to know latest date → which week folder)
    const dict = loadRefineries();
    const rows = await parseWorkbook(buffer, type, dict);
    if (rows.length === 0) {
      await sendPlain(
        token,
        chatId,
        `⚠️ Файл распознан как ${type}, но строки с данными не найдены.`
      );
      return;
    }
    let latest = rows[0].date;
    for (const r of rows) {
      if (r.date.getTime() > latest.getTime()) latest = r.date;
    }
    const week = isoWeekFolder(latest);

    // 4) Save
    await saveUpload(buffer, type, week);
    await sendPlain(
      token,
      chatId,
      `✅ Сохранён ${type}.xlsx в data/uploads/${week}/`
    );

    // 5) If prices + fca both present → re-parse from disk and analyze
    const status = listWeek(week);
    if (status.hasPrices && status.hasFca) {
      await sendPlain(token, chatId, "🔍 Считаю Δ цен…");
      const pricesRows = await reparseFromDisk(week, "birzha_prices", dict);
      const fcaRows = await reparseFromDisk(week, "fca", dict);
      const volumeRows = status.hasVolumes
        ? await reparseFromDisk(week, "birzha_volumes", dict)
        : [];
      await sendPlain(token, chatId, "📊 Готовлю сводку…");
      const result = analyze(pricesRows, fcaRows, volumeRows, dict);
      const parts = renderMarkdown(result);
      for (const part of parts) {
        await sendMarkdown(token, chatId, part);
      }
      writeLastRun(week, new Date());
    } else {
      await sendPlain(
        token,
        chatId,
        `📦 Жду пару (нужны prices + fca). Сейчас в ${week}: prices=${status.hasPrices ? "✅" : "❌"}, fca=${status.hasFca ? "✅" : "❌"}, volumes=${status.hasVolumes ? "✅" : "❌"}.`
      );
    }
  } catch (err) {
    const msgText = (err as Error).message ?? String(err);
    log.error(`[bot] handleDocument error: ${msgText}`);
    try {
      await sendPlain(
        token,
        chatId,
        `⚠️ Ошибка: ${msgText.slice(0, 300)}`
      );
    } catch {
      // Если даже плейн сообщение не уходит — pollOnce поймает в outer try/catch.
    }
  }
}

/**
 * Перечитать xlsx с диска (для weekly state). Используется при сборе пары
 * prices+fca, чтобы не зависеть от того, что в данный момент прислал юзер.
 */
async function reparseFromDisk(
  week: string,
  type: UploadType,
  dict: ReturnType<typeof loadRefineries>
): Promise<ParsedRow[]> {
  const filePath = path.join(weekDir(week), `${type}.xlsx`);
  const buf = readFileSync(filePath);
  return parseWorkbook(buf, type, dict);
}

// =============================================================================
// /summarize (quick-260519-lxu): LLM-narrative поверх битум-аплоадов текущей недели.
// НЕ дублирует структурный отчёт handleDocument (его генерирует upload-pipeline
// при ингесте) — даёт human-readable обзор от DeepSeek. Файлы НЕ пишет на диск.
// =============================================================================

/**
 * Обработчик /summarize. Вынесен из handleCommand для тестируемости
 * (mock OpenAI client инжектируется через env DEEPSEEK_API_KEY + патч OpenAI).
 *
 * Сценарии ответа:
 *   1) В текущей недельной папке нет файлов → "За эту неделю файлов не загружено..."
 *   2) Есть только один из пары prices/fca → "Нужны оба типа. Сейчас есть: <list>..."
 *   3) Есть пара → analyze() → buildLlmNarrative() → sendMarkdown по частям
 *   4) DeepSeek упал → "❌ Не удалось получить LLM-сводку: <reason>..."
 *
 * Не пишет на диск (никаких writeLastRun) — /summarize читает существующее состояние.
 */
export async function handleSummarizeCommand(
  token: string,
  msg: TgMessage
): Promise<void> {
  const chatId = msg.chat.id;
  const week = currentMskWeek();
  const status = listWeek(week);

  // Сценарий 1: вообще ничего не загружено.
  if (!status.hasPrices && !status.hasFca && !status.hasVolumes) {
    await sendReply(
      token,
      chatId,
      msg.message_id,
      `❓ За эту неделю (${week}) файлов не загружено. Перешлите xlsx с биржей и FCA, потом повторите /summarize.`
    );
    return;
  }

  // Сценарий 2: только один из пары prices/fca.
  if (!status.hasPrices || !status.hasFca) {
    const present: string[] = [];
    if (status.hasPrices) present.push("prices");
    if (status.hasFca) present.push("fca");
    if (status.hasVolumes) present.push("volumes");
    const presentStr = present.length > 0 ? present.join(", ") : "—";
    await sendReply(
      token,
      chatId,
      msg.message_id,
      `❓ Нужны оба типа (биржа + FCA). Сейчас в ${week} есть: ${presentStr}. Дозагрузите недостающие и повторите /summarize.`
    );
    return;
  }

  // Сценарий 3: пара собрана → analyze + LLM narrative.
  try {
    await sendPlain(token, chatId, "🤖 Готовлю LLM-сводку…");
    const dict = loadRefineries();
    const pricesRows = await reparseFromDisk(week, "birzha_prices", dict);
    const fcaRows = await reparseFromDisk(week, "fca", dict);
    const volumeRows = status.hasVolumes
      ? await reparseFromDisk(week, "birzha_volumes", dict)
      : [];
    const result = analyze(pricesRows, fcaRows, volumeRows, dict);
    const parts = await buildLlmNarrative(result);
    for (const part of parts) {
      await sendMarkdown(token, chatId, part);
    }
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    log.error(`[bot] /summarize error: ${errMsg}`);
    await sendPlain(
      token,
      chatId,
      `❌ Не удалось получить LLM-сводку: ${errMsg.slice(0, 300)}. Структурный отчёт доступен в предыдущих сообщениях после /upload.`
    );
  }
}

// =============================================================================
// CRUD-обёртки (D-16): живут рядом с handler'ами, используют mutate() из Phase 1.
// =============================================================================

/**
 * Возвращает текстовое представление текущего списка каналов.
 * BOT-01.
 */
export function listChannels(): string {
  const channels = loadChannels();
  if (channels.length === 0) return "Список каналов пуст";
  const lines = channels.map((c, i) => `${i + 1}. @${c.username}`);
  return `Каналов: ${channels.length}\n` + lines.join("\n");
}

/**
 * Идемпотентное добавление канала. Возвращает "added" / "exists".
 * BOT-02.
 */
export async function addChannel(
  username: string
): Promise<"added" | "exists"> {
  let result: "added" | "exists" = "added";
  await mutate((channels: ChannelEntry[]) => {
    if (channels.some((c) => c.username === username)) {
      result = "exists";
      return channels;
    }
    return [...channels, { username }];
  });
  return result;
}

/**
 * Идемпотентное удаление канала. Возвращает "removed" / "missing".
 * BOT-03 (handler сам вызывается из Plan 2).
 */
export async function removeChannel(
  username: string
): Promise<"removed" | "missing"> {
  let result: "removed" | "missing" = "removed";
  await mutate((channels: ChannelEntry[]) => {
    const next = channels.filter((c) => c.username !== username);
    if (next.length === channels.length) result = "missing";
    return next;
  });
  return result;
}

// =============================================================================
// Command router.
// =============================================================================

/**
 * Маршрутизирует команды от allowlist'а. Не-allowlist → silent ignore + log.info (D-07/D-08).
 * Поддерживает suffix `@botname` (`/channels@MyBot` → `/channels`).
 * Экспорт для unit-тестов (Plan 4).
 */
export async function handleCommand(
  token: string,
  msg: TgMessage,
  allowlist: Set<number>
): Promise<void> {
  const userId = msg.from?.id;
  const rawText = msg.text?.trim() ?? "";
  // BOT-UI-05 / D-01: reply-клавиатура шлёт текст кнопки как обычное сообщение
  // от юзера; нормализуем до /command, чтобы дальше handler работал унифицированно.
  // Иначе firstWord = "📊", cmd = "📊" — не команда и тихо игнорилось бы.
  const EMOJI_BUTTON_MAP: Record<string, string> = {
    "📊 Статус загрузок": "/upload_status",
    "🧠 Сделать сводку": "/summarize",
    "📋 Каналы новостей": "/channels",
    "❓ Помощь": "/help",
  };
  const text = EMOJI_BUTTON_MAP[rawText] ?? rawText;
  if (!userId || !text.startsWith("/")) return;

  // Извлекаем команду (до пробела или конца) с учётом suffix'а @botname.
  const firstWord = text.split(/\s+/)[0];
  const cmd = firstWord.split("@")[0]; // "/channels@MyBot" → "/channels"

  if (!allowlist.has(userId)) {
    // D-08: info-level, формат `[bot] denied: from=%d cmd=%s`.
    log.info(`[bot] denied: from=${userId} cmd=${cmd}`);
    return;
  }

  if (cmd === "/channels") {
    const reply = listChannels();
    await sendReply(token, msg.chat.id, msg.message_id, reply);
    return;
  }
  if (cmd === "/add_channel") {
    const arg = text.slice(firstWord.length).trim();
    if (!arg) {
      await sendReply(
        token,
        msg.chat.id,
        msg.message_id,
        "Использование: /add_channel <username>\nНапример: /add_channel @durov"
      );
      return;
    }
    const u = normalizeUsername(arg);
    if (!u) {
      await sendReply(
        token,
        msg.chat.id,
        msg.message_id,
        `Невалидный username: ${arg}\nДопустимы: 5-32 символа, начинается с буквы, далее буквы/цифры/_`
      );
      return;
    }
    const status = await addChannel(u);
    const reply =
      status === "added"
        ? `Добавлен @${u}. Будет использован в следующем прогоне в 20:15 MSK.`
        : `@${u} уже в списке.`;
    await sendReply(token, msg.chat.id, msg.message_id, reply);
    return;
  }
  if (cmd === "/remove_channel") {
    const arg = text.slice(firstWord.length).trim();
    if (!arg) {
      await sendReply(
        token,
        msg.chat.id,
        msg.message_id,
        "Использование: /remove_channel <username>\nНапример: /remove_channel @durov"
      );
      return;
    }
    const u = normalizeUsername(arg);
    if (!u) {
      await sendReply(
        token,
        msg.chat.id,
        msg.message_id,
        `Невалидный username: ${arg}\nДопустимы: 5-32 символа, начинается с буквы, далее буквы/цифры/_`
      );
      return;
    }
    // D-11: callback_data самодостаточный — username внутри. Лимит 64 байта,
    // username ≤32 символов → влезает с большим запасом.
    const keyboard: TgInlineKeyboardButton[][] = [
      [
        { text: "Удалить", callback_data: `rm:${u}:confirm` },
        { text: "Отмена", callback_data: `rm:${u}:cancel` },
      ],
    ];
    await sendReplyWithKeyboard(
      token,
      msg.chat.id,
      msg.message_id,
      `Удалить @${u} из списка каналов?`,
      keyboard
    );
    return;
  }
  if (cmd === "/upload_status") {
    const week = currentMskWeek();
    const status = listWeek(week);
    const lines = [
      `Папка ${week}:`,
      `- prices: ${status.hasPrices ? "✅" : "❌"}`,
      `- fca: ${status.hasFca ? "✅" : "❌"}`,
      `- volumes: ${status.hasVolumes ? "✅" : "❌"}`,
      `Последний прогон: ${
        status.lastRunAt ? status.lastRunAt.toISOString() : "—"
      }`,
    ];
    await sendReply(token, msg.chat.id, msg.message_id, lines.join("\n"));
    return;
  }
  if (cmd === "/summarize") {
    // quick-260519-lxu: LLM-narrative от DeepSeek поверх битум-аплоадов недели.
    await handleSummarizeCommand(token, msg);
    return;
  }
  if (cmd === "/start") {
    // BOT-UI-03: приветствие + reply-клавиатура (MAIN_KEYBOARD приклеит sendReply).
    await sendReply(
      token,
      msg.chat.id,
      msg.message_id,
      "Привет! Я бот-помощник по битуму. Доступные действия — на клавиатуре ниже или через меню / слева от поля ввода."
    );
    return;
  }
  if (cmd === "/help") {
    // BOT-UI-04: инструкция (xlsx upload + основные команды).
    const helpText = [
      "Как пользоваться:",
      "",
      "1. Пришлите xlsx-файл (биржа / биржа-объёмы / FCA) — бот распознает тип по A1 и сохранит в data/uploads/YYYY-WW.",
      "2. После загрузки пары (биржа + FCA) — нажмите «🧠 Сделать сводку» (или /summarize) для LLM-обзора.",
      "3. «📊 Статус загрузок» (/upload_status) — что лежит в текущей неделе.",
      "4. «📋 Каналы новостей» (/channels) — управление списком каналов для ежедневного дайджеста (отдельный пайплайн).",
      "",
      "Дополнительно: /add_channel @name, /remove_channel @name.",
    ].join("\n");
    await sendReply(token, msg.chat.id, msg.message_id, helpText);
    return;
  }
  // Прочие команды игнорируются молча.
}

// =============================================================================
// Callback query handler (D-11/D-12/D-13/D-14): /remove_channel confirmation flow.
// =============================================================================

/**
 * Парсит callback_data формата `rm:<username>:confirm` или `rm:<username>:cancel` (D-11).
 * Возвращает { username, action } или null если формат невалиден.
 * Экспорт для unit-тестов (Plan 4).
 */
export function parseRemoveCallbackData(
  data: string
): { username: string; action: "confirm" | "cancel" } | null {
  const parts = data.split(":");
  if (parts.length !== 3 || parts[0] !== "rm") return null;
  const username = parts[1];
  const action = parts[2];
  if (!username || (action !== "confirm" && action !== "cancel")) return null;
  return { username, action };
}

/**
 * Обработчик callback_query от inline-кнопок /remove_channel.
 * D-12: любой allowlist-юзер (не только инициатор) может нажать.
 * D-07/D-08: не-allowlist → silent ignore (без answerCallbackQuery!) + log.info.
 * D-13: editMessageReplyMarkup (убираем кнопки) + editMessageText (новый текст).
 * D-14: removeChannel идемпотентен — повторный confirm после первого даёт "missing".
 * W-3: каждый editMessage* в свой try/catch — Telegram возвращает 400 если "message
 * is not modified" / message удалён юзером, эти ошибки не должны валить handler.
 *
 * Экспорт для unit-тестов (Plan 4).
 */
export async function handleCallbackQuery(
  token: string,
  cb: TgCallbackQuery,
  allowlist: Set<number>
): Promise<void> {
  const userId = cb.from.id;
  const data = cb.data ?? "";

  // D-07/D-08/D-12: не-allowlist пользователь — silent ignore.
  // ВАЖНО: НЕ вызываем answerCallbackQuery — иначе клиент получит ack и поймёт,
  // что бот его «увидел». Silent ignore = клиент видит вечный "loading" 15 минут,
  // потом Telegram сам очищает callback. Это и есть желаемое поведение.
  if (!allowlist.has(userId)) {
    log.info(`[bot] denied: from=${userId} cmd=callback:${data}`);
    return;
  }

  const parsed = parseRemoveCallbackData(data);
  if (!parsed || !cb.message) {
    // Неизвестный формат или отсутствует message (например, inline-mode) —
    // отвечаем нейтральным answerCallbackQuery без действий (graceful).
    await tgFetch<{ ok: boolean }>(token, "answerCallbackQuery", {
      callback_query_id: cb.id,
    });
    return;
  }

  const { username, action } = parsed;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;

  // ack callback (обязательно в течение 15 мин — иначе клиент покажет loading).
  // WR-02: ack лучший-effort, его сетевая ошибка не должна срывать removeChannel
  // ниже. Если сеть нестабильна и ack падает — продолжаем основное действие,
  // иначе пользователь нажимает кнопку, видит, что ничего не произошло, и кнопки
  // остаются — повторное нажатие приводит к тому же результату при flaky-сети.
  try {
    await tgFetch<{ ok: boolean }>(token, "answerCallbackQuery", {
      callback_query_id: cb.id,
    });
  } catch (err) {
    log.warn(
      `[bot] answerCallbackQuery failed: ${(err as Error).message}`
    );
    // продолжаем — ack лучший-effort, основная операция (mutate + edit) ниже.
  }

  let newText: string;
  if (action === "cancel") {
    newText = `Отмена удаления @${username}.`;
  } else {
    // confirm — D-14: idempotent.
    const status = await removeChannel(username);
    newText =
      status === "removed"
        ? `Удалён @${username}.`
        : `@${username} не найден в списке (возможно, уже удалён).`;
  }

  // D-13: сначала убираем кнопки, потом обновляем текст. Если editMessageText
  // упадёт — кнопки всё равно убраны и пользователь не нажмёт повторно.
  // W-3: каждый editMessage* в свой try/catch.
  try {
    await tgFetch<{ ok: boolean }>(token, "editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (err) {
    log.warn(
      `[bot] editMessageReplyMarkup failed: ${(err as Error).message}`
    );
  }
  try {
    await tgFetch<{ ok: boolean }>(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: newText,
    });
  } catch (err) {
    log.warn(`[bot] editMessageText failed: ${(err as Error).message}`);
  }
}

// =============================================================================
// Polling loop.
// =============================================================================

async function pollOnce(
  token: string,
  allowlist: Set<number>
): Promise<void> {
  const resp = await tgFetch<TgGetUpdatesResponse>(token, "getUpdates", {
    offset: lastOffset,
    timeout: POLL_TIMEOUT_SEC,
    allowed_updates: ["message", "callback_query"],
  });
  if (!resp.ok) {
    log.warn(
      `[bot] getUpdates returned ok=false: ${
        resp.description ?? "(no description)"
      }`
    );
    return;
  }
  for (const upd of resp.result) {
    // W-1: сдвигаем offset на update_id + 1 — иначе тот же update прилетит снова.
    lastOffset = Math.max(lastOffset, upd.update_id + 1);
    try {
      if (upd.message) {
        if (upd.message.document) {
          await handleDocument(token, upd.message, allowlist);
        } else if (upd.message.text) {
          await handleCommand(token, upd.message, allowlist);
        }
      } else if (upd.callback_query) {
        await handleCallbackQuery(token, upd.callback_query, allowlist);
      }
    } catch (err) {
      log.error(`[bot] handler error: ${(err as Error).message}`);
    }
  }
}

async function pollLoop(
  token: string,
  allowlist: Set<number>
): Promise<void> {
  // D-03: deleteWebhook ОБЯЗАТЕЛЕН до первого getUpdates.
  // drop_pending_updates: false — сохраняем очередь команд за время рестарта.
  try {
    await tgFetch<{ ok: boolean }>(token, "deleteWebhook", {
      drop_pending_updates: false,
    });
    log.info("[bot] deleteWebhook ok (drop_pending_updates=false)");
  } catch (err) {
    log.error(`[bot] deleteWebhook failed: ${(err as Error).message}`);
    // Продолжаем — getUpdates даст 409 если webhook остался, поймаем в catch ниже.
  }

  // Exp.backoff: 1000/2000/4000ms (паттерн из telegram.ts reconnect).
  const backoffMs = [1000, 2000, 4000];
  let backoffIdx = 0;

  while (!stopRequested) {
    try {
      await pollOnce(token, allowlist);
      backoffIdx = 0; // успех — сброс backoff'а
    } catch (err) {
      const delay = backoffMs[Math.min(backoffIdx, backoffMs.length - 1)];
      log.error(
        `[bot] poll error: ${(err as Error).message}; retry in ${delay}ms`
      );
      backoffIdx++;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// =============================================================================
// Public lifecycle.
// =============================================================================

/**
 * Запуск polling-loop'а. Если TG_BOT_TOKEN или BOT_ALLOWED_USER_IDS не задан —
 * warn + return (D-04). Контракт со стороны run.ts (Plan 3): startBot НЕ throw'ает
 * наверх — внутренний try/catch логирует финальный crash. Resilience обеспечивается
 * exp.backoff внутри pollLoop. Run.ts вызывает startBot() как fire-and-forget
 * с outer try/catch только для финального alert (без restart-loop'а).
 */
export async function startBot(): Promise<void> {
  const token = process.env.TG_BOT_TOKEN;
  const allowlistRaw = process.env.BOT_ALLOWED_USER_IDS;
  // D-04: симметрично src/alert.ts:23-32 — нет env → warn + return, daemon живёт.
  if (!token || !allowlistRaw) {
    log.warn(
      "[bot] TG_BOT_TOKEN или BOT_ALLOWED_USER_IDS не задан — bot polling выключен"
    );
    return;
  }
  const allowlist = parseAllowlist(allowlistRaw);
  if (allowlist.size === 0) {
    log.warn(
      "[bot] BOT_ALLOWED_USER_IDS пуст после парсинга — bot polling выключен"
    );
    return;
  }
  stopRequested = false;
  pollingActive = true;
  log.info(`[bot] polling started (allowlist size=${allowlist.size})`);
  try {
    await pollLoop(token, allowlist);
  } catch (err) {
    log.error(`[bot] poll loop crashed: ${(err as Error).message}`);
  } finally {
    pollingActive = false;
    log.info("[bot] polling stopped");
  }
}

/**
 * Сигнал остановки polling-loop'а. Текущий getUpdates завершится максимум через
 * POLL_TIMEOUT_SEC секунд (long-polling возвращает результаты раньше при наличии
 * updates). После выхода из pollLoop pollingActive=false, что shutdown() в run.ts
 * может опросить через isBotPolling().
 */
export function stopBot(): void {
  stopRequested = true;
}

/**
 * Возвращает текущее состояние polling-loop'а. Используется shutdown() в run.ts
 * для ожидания graceful завершения.
 */
export function isBotPolling(): boolean {
  return pollingActive;
}
