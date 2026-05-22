// src/bot.ts — Telegram bot polling + commands handler.
// Использует тот же TG_BOT_TOKEN, что и delivery (D-01). CRUD-обёртки рядом с handler'ами (D-16).

import { mutate, loadChannels, type ChannelEntry } from "./channels-store.js";
import { log } from "./logger.js";

// =============================================================================
// Telegram API минимальные типы — чтобы избежать `any` в polling/handlers.
// =============================================================================

export interface TgUser {
  id: number;
}
export interface TgChat {
  id: number;
}
export interface TgDocument {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}
export interface TgMessage {
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
export interface TgCallbackQuery {
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
export interface TgInlineKeyboardButton {
  text: string;
  callback_data: string;
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
// исходящим сообщениям бот→пользователь.
const MAIN_KEYBOARD: TgReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "📊 Статус загрузок" }, { text: "🧠 Отчёт битум" }],
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
 */
export function normalizeUsername(raw: string): string | null {
  const trimmed = raw.trim();
  const stripped = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!USERNAME_REGEX.test(stripped)) return null;
  return stripped;
}

/**
 * Обёртка над fetch к Bot API. На !res.ok — throw c HTTP-кодом и телом ответа.
 */
export async function tgFetch<T>(
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
export async function sendReply(
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
    reply_markup: MAIN_KEYBOARD,
  });
}

/**
 * Вариант sendReply с inline-keyboard (D-11/D-13). Используется для подтверждения
 * /remove_channel — две кнопки confirm/cancel.
 */
export async function sendReplyWithKeyboard(
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
 * Шлёт plain-text сообщение в чат БЕЗ reply_to.
 */
export async function sendPlain(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  await tgFetch<{ ok: boolean }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: MAIN_KEYBOARD,
  });
}

/**
 * Шлёт HTML-сообщение (parse_mode: "HTML"). Whitelist: <b>, <i>, <u>, <s>,
 * <code>, <pre>, <a>, <blockquote>, <tg-spoiler>. Без <h1>/<hr>/<br>.
 */
export async function sendHtml(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  await tgFetch<{ ok: boolean }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: MAIN_KEYBOARD,
  });
}

// =============================================================================
// Telegram file download helper.
// =============================================================================

/**
 * Скачивает файл по file_id через Bot API: getFile → file_path → fetch.
 * Возвращает Buffer + предложенное имя.
 */
export async function downloadTgFile(
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
    fileName: fallbackName,
  };
}

// =============================================================================
// CRUD-обёртки (D-16): живут рядом с handler'ами.
// =============================================================================

/**
 * Возвращает текстовое представление текущего списка каналов.
 */
export function listChannels(): string {
  const channels = loadChannels();
  if (channels.length === 0) return "Список каналов пуст";
  const lines = channels.map((c, i) => `${i + 1}. @${c.username}`);
  return `Каналов: ${channels.length}\n` + lines.join("\n");
}

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
// Document handler — bitum-wiring (Task 10 будет финализировать).
// Между Task 1 и Task 10 handleDocument временно отвечает «not implemented».
// =============================================================================

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
  // Placeholder до Task 10 — bitum-wiring добавит реальный bridge в handleBitumDocument.
  await sendPlain(
    token,
    msg.chat.id,
    "⚠️ Битум-пайплайн в процессе настройки. Попробуйте позже."
  );
}

// =============================================================================
// Command router.
// =============================================================================

/**
 * Маршрутизирует команды от allowlist'а. Не-allowlist → silent ignore + log.info.
 */
export async function handleCommand(
  token: string,
  msg: TgMessage,
  allowlist: Set<number>
): Promise<void> {
  const userId = msg.from?.id;
  const rawText = msg.text?.trim() ?? "";
  const EMOJI_BUTTON_MAP: Record<string, string> = {
    "📊 Статус загрузок": "/bitum_status",
    "🧠 Отчёт битум": "/bitum_report",
    "📋 Каналы новостей": "/channels",
    "❓ Помощь": "/help",
  };
  const text = EMOJI_BUTTON_MAP[rawText] ?? rawText;
  if (!userId || !text.startsWith("/")) return;

  const firstWord = text.split(/\s+/)[0];
  const cmd = firstWord.split("@")[0]; // "/channels@MyBot" → "/channels"

  if (!allowlist.has(userId)) {
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
  if (cmd === "/start") {
    await sendReply(
      token,
      msg.chat.id,
      msg.message_id,
      "Привет! Я бот-помощник. Доступные действия — на клавиатуре ниже или через меню / слева от поля ввода."
    );
    return;
  }
  if (cmd === "/help") {
    const helpText = [
      "Доступные команды:",
      "  /channels, /add_channel @name, /remove_channel @name",
    ].join("\n");
    await sendReply(token, msg.chat.id, msg.message_id, helpText);
    return;
  }
  // Прочие команды игнорируются молча.
}

// =============================================================================
// Callback query handler: /remove_channel confirmation flow.
// =============================================================================

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

export async function handleCallbackQuery(
  token: string,
  cb: TgCallbackQuery,
  allowlist: Set<number>
): Promise<void> {
  const userId = cb.from.id;
  const data = cb.data ?? "";

  if (!allowlist.has(userId)) {
    log.info(`[bot] denied: from=${userId} cmd=callback:${data}`);
    return;
  }

  const parsed = parseRemoveCallbackData(data);
  if (!parsed || !cb.message) {
    await tgFetch<{ ok: boolean }>(token, "answerCallbackQuery", {
      callback_query_id: cb.id,
    });
    return;
  }

  const { username, action } = parsed;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;

  try {
    await tgFetch<{ ok: boolean }>(token, "answerCallbackQuery", {
      callback_query_id: cb.id,
    });
  } catch (err) {
    log.warn(
      `[bot] answerCallbackQuery failed: ${(err as Error).message}`
    );
  }

  let newText: string;
  if (action === "cancel") {
    newText = `Отмена удаления @${username}.`;
  } else {
    const status = await removeChannel(username);
    newText =
      status === "removed"
        ? `Удалён @${username}.`
        : `@${username} не найден в списке (возможно, уже удалён).`;
  }

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

async function registerBotCommands(token: string): Promise<void> {
  const commands = [
    { command: "start", description: "Запустить бота / показать меню" },
    { command: "help", description: "Инструкция" },
    { command: "channels", description: "Список каналов" },
    { command: "add_channel", description: "Добавить канал" },
    { command: "remove_channel", description: "Удалить канал" },
  ];
  try {
    await tgFetch<{ ok: boolean }>(token, "setMyCommands", { commands });
    log.info(`[bot] setMyCommands ok (${commands.length} commands)`);
  } catch (err) {
    log.warn(`[bot] setMyCommands failed: ${(err as Error).message}`);
  }
}

async function pollLoop(
  token: string,
  allowlist: Set<number>
): Promise<void> {
  try {
    await tgFetch<{ ok: boolean }>(token, "deleteWebhook", {
      drop_pending_updates: false,
    });
    log.info("[bot] deleteWebhook ok (drop_pending_updates=false)");
  } catch (err) {
    log.error(`[bot] deleteWebhook failed: ${(err as Error).message}`);
  }

  await registerBotCommands(token);

  const backoffMs = [1000, 2000, 4000];
  let backoffIdx = 0;

  while (!stopRequested) {
    try {
      await pollOnce(token, allowlist);
      backoffIdx = 0;
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

export async function startBot(): Promise<void> {
  const token = process.env.TG_BOT_TOKEN;
  const allowlistRaw = process.env.BOT_ALLOWED_USER_IDS;
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

export function stopBot(): void {
  stopRequested = true;
}

export function isBotPolling(): boolean {
  return pollingActive;
}
