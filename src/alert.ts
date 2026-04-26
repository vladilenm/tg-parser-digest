// src/alert.ts — alert-bot для технических ошибок pipeline (ALERT-01).
// Отдельный Bot Token (BOT_TOKEN_ALERTS) — НЕ загрязняем канал Заказчика.
// Шлёт в личку владельца (ALERTS_CHAT_ID).
// Threat T-01-02: payload не сериализует process.env, только переданные поля.

import { log } from "./logger.js";

export interface AlertPayload {
  stage: string;          // "pipeline" / "tick" / "summarize" — где упало
  message: string;        // err.message
  runId: string;          // crypto.randomUUID().slice(0,8)
  stack?: string;         // err.stack (опционально, обрезается до 1500 chars)
}

/**
 * ALERT-01..02: шлёт alert в личку владельца.
 * D-13: await (не fire-and-forget) — чтобы 60-секундное окно гарантировалось.
 * D-15: на alert-fail → console.error без retry; не throw наверх (иначе пропадёт оригинальная ошибка).
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  const token = process.env.BOT_TOKEN_ALERTS;
  const chatId = process.env.ALERTS_CHAT_ID;
  if (!token || !chatId) {
    // Не считаем критичной ошибкой — оператор мог ещё не настроить.
    log.error(
      `[alert] BOT_TOKEN_ALERTS или ALERTS_CHAT_ID не задан — alert не отправлен. payload=${JSON.stringify({
        stage: payload.stage,
        message: payload.message,
        runId: payload.runId,
      })}`
    );
    return;
  }

  // Plain-text формат: безопаснее HTML (никакой инъекции из stack/message).
  const stackTail = payload.stack ? payload.stack.slice(0, 1500) : "(no stack)";
  const text = [
    `🚨 [tg-parser-demo] pipeline failure`,
    `stage: ${payload.stage}`,
    `runId: ${payload.runId}`,
    `error: ${payload.message}`,
    ``,
    `stack:`,
    stackTail,
  ].join("\n");

  // Telegram message limit 4096 chars — режем с запасом.
  const safeText = text.slice(0, 4000);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: safeText,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.error(`[alert] Telegram sendMessage failed: ${res.status} ${body.slice(0, 300)}`);
      return;
    }
    log.info(`[alert] sent (stage=${payload.stage} runId=${payload.runId})`);
  } catch (err) {
    // D-15: не throw, только console.error — оператор увидит в pm2 logs --err.
    log.error(`[alert] network error: ${(err as Error).message}`);
  }
}
