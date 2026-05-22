// src/bot.ts — Telegram bot polling + commands handler.
// Использует тот же TG_BOT_TOKEN, что и delivery (D-01).
// Phase 4 v5.1: bitum-handlers wired через src/bot-bitum.ts (Task 10).

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
interface TgKeyboardButton {
  text: string;
}
interface TgReplyKeyboardMarkup {
  keyboard: TgKeyboardButton[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
}

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
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

let lastOffset = 0;
let stopRequested = false;
let pollingActive = false;

// =============================================================================
// Helpers.
// =============================================================================

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

export function normalizeUsername(raw: string): string | null {
  const trimmed = raw.trim();
  const stripped = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!USERNAME_REGEX.test(stripped)) return null;
  return stripped;
}

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
// Bitum-handlers wiring (Phase 4 v5.1, Task 10).
// Импорт PLACED HERE (not at top) — bot-bitum.ts импортирует send* / tgFetch /
// типы из этого файла; чтобы избежать циклической инициализации, объявляем
// helpers выше.
// =============================================================================

import {
  handleBitumDocument,
  handleBitumStatus,
  handleBitumReport,
  handleBitumReset,
  handleBitumAdd,
  handleBitumCallback,
} from "./bot-bitum.js";

// =============================================================================
// CRUD-обёртки (D-16): живут рядом с handler'ами.
// =============================================================================

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
// Document handler — bitum-wiring.
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
  const chatId = msg.chat.id;
  try {
    // T-04-01 первый уровень — pre-check размера до загрузки.
    const MAX = Number(
      process.env.BITUM_MAX_XLSX_BYTES ?? 10 * 1024 * 1024
    );
    if (doc.file_size && doc.file_size > MAX) {
      await sendPlain(
        token,
        chatId,
        `⚠️ Файл слишком большой (>${Math.round(MAX / 1024 / 1024)} МБ). Отклонено.`
      );
      return;
    }
    await sendPlain(token, chatId, "⏳ Получаю файл…");
    const { buffer, fileName } = await downloadTgFile(
      token,
      doc.file_id,
      doc.file_name ?? "upload.xlsx"
    );
    log.info(
      `[bot] document received: from=${userId} name=${fileName} size=${buffer.length}`
    );
    await handleBitumDocument(token, msg, buffer, fileName);
  } catch (err) {
    const msgText = (err as Error).message ?? String(err);
    log.error(`[bot] handleDocument error: ${msgText}`);
    try {
      await sendPlain(token, chatId, `⚠️ Ошибка: ${msgText.slice(0, 300)}`);
    } catch {
      // tgFetch уже залогирован.
    }
  }
}

// =============================================================================
// Command router.
// =============================================================================

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
  const cmd = firstWord.split("@")[0];

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
  // Phase 4 v5.1 bitum-команды.
  if (cmd === "/bitum_status") {
    await handleBitumStatus(token, msg);
    return;
  }
  if (cmd === "/bitum_report") {
    await handleBitumReport(token, msg);
    return;
  }
  if (cmd === "/bitum_reset") {
    await handleBitumReset(token, msg);
    return;
  }
  if (cmd === "/bitum_add") {
    await handleBitumAdd(token, msg);
    return;
  }
  if (cmd === "/start") {
    await sendReply(
      token,
      msg.chat.id,
      msg.message_id,
      "Привет! Я бот по битуму. Пришлите xlsx — я спрошу что это, накоплю недельный пакет и соберу отчёт по /bitum_report. Список команд — на клавиатуре ниже или /help."
    );
    return;
  }
  if (cmd === "/help") {
    const helpText = [
      "Битум-неделя (пакет 4 xlsx):",
      "  /bitum_status — что уже загружено",
      "  /bitum_add label=value — добавить ручное число",
      "  /bitum_report — собрать отчёт и опубликовать в канал",
      "  /bitum_reset — обнулить текущую неделю",
      "",
      "Как пользоваться:",
      "1. Пришлите xlsx — бот спросит «какой это файл?» (4 варианта + Отмена).",
      "2. Когда нужны — /bitum_add для ручных чисел, /bitum_status для проверки.",
      "3. /bitum_report → preview в DM → «📤 Опубликовать» или «❌ Отмена».",
      "",
      "Каналы новостей:",
      "  /channels, /add_channel @name, /remove_channel @name",
    ].join("\n");
    await sendReply(token, msg.chat.id, msg.message_id, helpText);
    return;
  }
  // Прочие команды игнорируются молча.
}

// =============================================================================
// Callback query handler.
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

  // Phase 4 v5.1: bitum callbacks (bu:/br:/brs:) routed first.
  if (/^(bu|br|brs):/.test(data)) {
    const handled = await handleBitumCallback(token, cb);
    if (handled) return;
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
    { command: "bitum_status", description: "Чек-лист битум-недели" },
    {
      command: "bitum_report",
      description: "Битум-отчёт (preview → канал)",
    },
    {
      command: "bitum_reset",
      description: "Сбросить текущую битум-неделю",
    },
    { command: "bitum_add", description: "Добавить ручное число" },
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
