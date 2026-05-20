// src/deliver.ts — доставка HTML-дайджеста в приватный Telegram-канал через Bot API.
// Использует встроенный fetch (Node 20.6+), без каких-либо SDK.

import { readFileSync } from "node:fs";
import { log } from "./logger.js";

const TELEGRAM_LIMIT = 4096;
const CHUNK_SAFE_LIMIT = 4000; // запас ~96 символов на префикс "(i/N)\n" + заголовки тегов

/**
 * Режет HTML-строку на части, каждая ≤ max символов.
 * DELIVER-02: не рвём HTML посередине тега. Приоритеты разрыва:
 *   1. Двойной перенос (\n\n) — граница секций, идеальный разрыв.
 *   2. Одиночный перенос (\n) — граница строки/буллета.
 *
 * Если в окне нет ни \n\n, ни \n — бросаем Error (буллет шире лимита).
 * Это инвариант: каждый буллет — одна строка.
 *
 * Если строка ≤ max — возвращаем [html].
 */
export function chunkHtml(html: string, max: number = CHUNK_SAFE_LIMIT): string[] {
  if (html.length <= max) return [html];

  const parts: string[] = [];
  let remaining = html;

  while (remaining.length > max) {
    // Ищем лучший разрыв в пределах [0, max].
    const window = remaining.slice(0, max);

    let cutAt = window.lastIndexOf("\n\n");          // Приоритет 1
    if (cutAt < 0) cutAt = window.lastIndexOf("\n"); // Приоритет 2
    if (cutAt < 0) {
      throw new Error(
        `chunkHtml: bullet exceeds CHUNK_SAFE_LIMIT (max=${max}); offending fragment length=${window.length}, starts: ${window.slice(0, 80)}...`
      );
    }

    parts.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

/**
 * Отправляет html в приватный канал через Bot API sendMessage.
 * DELIVER-01: parse_mode HTML, disable_web_page_preview true.
 * DELIVER-03: если частей > 1, каждая префиксуется "(i/N)\n".
 * DELIVER-04: res.ok === false → throw Error с HTTP-статусом и телом.
 */
export async function sendToChannel(html: string): Promise<void> {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHANNEL_ID;
  if (!token) throw new Error("TG_BOT_TOKEN не задан.");
  if (!chatId) throw new Error("TG_CHANNEL_ID не задан.");

  const parts = chunkHtml(html, CHUNK_SAFE_LIMIT);
  log.info(
    `[deliver] sendToChannel: chatId=${chatId} html=${html.length}ch parts=${parts.length}`
  );
  for (let i = 0; i < parts.length; i++) {
    const text = parts.length > 1 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i];

    // Лимит Telegram — 4096; с запасом 4000 + префикс 10 символов нам хватит.
    if (text.length > TELEGRAM_LIMIT) {
      throw new Error(
        `Telegram message part ${i + 1} exceeds ${TELEGRAM_LIMIT} chars: ${text.length}`
      );
    }

    const body = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    const startedAt = Date.now();
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // DELIVER-04: HTTP-статус + тело ответа.
      const responseBody = await res.text();
      log.error(
        `[deliver] sendMessage FAILED part ${i + 1}/${parts.length}: HTTP ${res.status} ${responseBody.slice(0, 300)}`
      );
      throw new Error(`Telegram sendMessage failed: ${res.status} ${responseBody}`);
    }
    log.info(
      `[deliver] part ${i + 1}/${parts.length} sent (${text.length}ch in ${Date.now() - startedAt}ms)`
    );
  }
}

/**
 * H5X-03: отправить HTML-файл дашборда как document attachment в канал дайджеста.
 * Тот же бот (TG_BOT_TOKEN) и тот же чат (TG_CHANNEL_ID), что и `sendToChannel`,
 * чтобы дашборд приходил сразу после HTML-сообщений дайджеста.
 *
 * Контракт ошибок:
 *   - Если TG_BOT_TOKEN или TG_CHANNEL_ID не заданы — log.warn + return (soft skip,
 *     дашборд — nice-to-have; ср. `src/alert.ts:23-32`).
 *   - Если HTTP-вызов упал — throw Error со статусом и телом, чтобы caller
 *     (src/run.ts:tick()) словил → sendAlert(stage="dashboard"), а не молча проглотил.
 *
 * Multipart-паттерн (FormData + Blob) скопирован с `src/backup.ts:tgSendDocument`,
 * но НЕ импортируем оттуда — это локальная функция backup'а; дублируем сознательно,
 * чтобы deliver.ts оставался самодостаточным.
 */
export async function sendDashboardDocument(
  filePath: string,
  fileName: string
): Promise<void> {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHANNEL_ID;
  if (!token || !chatId) {
    log.warn(
      "[deliver] sendDashboardDocument: TG_BOT_TOKEN или TG_CHANNEL_ID не задан — dashboard skipped"
    );
    return;
  }

  const buf = readFileSync(filePath);
  const blob = new Blob([buf as unknown as ArrayBuffer], { type: "text/html" });
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", blob, fileName);
  form.append("disable_notification", "true");

  const startedAt = Date.now();
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const responseBody = await res.text();
    log.error(
      `[deliver] sendDashboardDocument FAILED: HTTP ${res.status} ${responseBody.slice(0, 300)}`
    );
    throw new Error(`Telegram sendDocument failed: ${res.status} ${responseBody}`);
  }
  log.info(
    `[deliver] dashboard sent: ${fileName} (${buf.length}b in ${Date.now() - startedAt}ms)`
  );
}
