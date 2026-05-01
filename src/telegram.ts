// src/telegram.ts — GramJS user-client с anti-ban identity + fetchLast24h.
// Идентичность клиента (D-06, D-07): захардкожена здесь, НЕ в .env и НЕ в channels.yaml.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { FloodWaitError } from "telegram/errors/index.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import type { Post } from "./types.js";

// D-06: правдоподобная идентичность Telegram Desktop на Windows 11, RU.
const CLIENT_IDENTITY = {
  deviceModel: "Desktop",
  systemVersion: "Windows 11",
  appVersion: "5.3.0 x64",
  langCode: "ru",
  systemLangCode: "ru",
} as const;

/** Пауза в миллисекундах. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Случайное целое в [min, max] включительно. */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Создаёт GramJS TelegramClient с persistent StringSession из TG_SESSION.
 * D-07: CLIENT_IDENTITY захардкожена в этом файле.
 * D-08: GramJS connection options — дефолты (не переопределяем).
 */
export function createClient(): TelegramClient {
  const apiId = Number(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;
  const sessionString = process.env.TG_SESSION;

  if (!Number.isFinite(apiId) || apiId <= 0) {
    throw new Error("TG_API_ID не задан или невалиден (ожидается положительное число).");
  }
  if (!apiHash) {
    throw new Error("TG_API_HASH не задан.");
  }
  if (!sessionString) {
    throw new Error("TG_SESSION не задан. Запусти `npm run login` и скопируй StringSession в .env.");
  }

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, apiId, apiHash, {
    ...CLIENT_IDENTITY,
  });
  // Глушим внутренний логгер GramJS — он гонит TIMEOUT-ошибки фонового
  // update-loop в console.error после disconnect. Мы используем только
  // iterMessages, updates нам не нужны; свои события логируем сами.
  client.setLogLevel(LogLevel.NONE);
  return client;
}

/**
 * Читает последние windowHours часов канала username.
 * FETCH-02: sinceUnix = now - windowHours*3600; итерация останавливается при msg.date < sinceUnix.
 * FETCH-03: возвращает { channelUsername, messageId, postedAt, text, url }.
 * FETCH-04: FloodWaitError — sleep(err.seconds*1000+2000) + один retry; второй подряд — пробросить.
 * FETCH-05: ChannelPrivateError / UsernameNotOccupiedError / UsernameInvalidError — warn + [].
 */
export async function fetchLast24h(
  client: TelegramClient,
  username: string,
  opts: { limit: number; windowHours: number }
): Promise<Post[]> {
  const { limit, windowHours } = opts;
  const sinceUnix = Math.floor(Date.now() / 1000) - windowHours * 3600;

  const tryFetch = async (): Promise<Post[]> => {
    const results: Post[] = [];
    // iterMessages возвращает новейшие сверху (reverse: false).
    const iter = client.iterMessages(username, {
      limit,
      offsetDate: 0,
      reverse: false,
    });
    for await (const msg of iter) {
      // Тип msg — Api.Message. Поля: id (number), date (unix seconds), message (string).
      const date = typeof (msg as unknown as { date?: number }).date === "number"
        ? (msg as unknown as { date: number }).date
        : 0;
      if (!date) continue;
      if (date < sinceUnix) break; // FETCH-02: остановка за окном

      const rawText = (msg as unknown as { message?: string }).message;
      const text = typeof rawText === "string" ? rawText : "";
      if (!text) continue; // Скипаем репост-только-медиа (Claude's Discretion в CONTEXT.md)

      const rawId = (msg as unknown as { id?: number | bigint }).id;
      const messageId = typeof rawId === "number" ? rawId : Number(rawId);
      const url = `https://t.me/${username}/${messageId}`;
      results.push({
        channelUsername: username,
        messageId,
        postedAt: new Date(date * 1000).toISOString(),
        text,
        url,
      });
    }
    return results;
  };

  // RELI-03: два независимых счётчика — FloodWait retry и reconnect attempts.
  // Счётчики НЕ суммируются и НЕ взаимоблокируются: один FloodWait + три reconnect = 4 итерации loop.
  let floodRetried = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 3;
  const RECONNECT_BACKOFF = [1000, 2000, 4000];

  const isNetworkError = (err: unknown): boolean => {
    const msg = (err as Error)?.message ?? String(err);
    return (
      msg.includes("Not connected") ||
      msg.includes("Disconnect") ||
      msg.includes("TIMEOUT") ||
      msg.includes("no data received") ||
      (client as unknown as { connected?: boolean }).connected === false
    );
  };

  // Внешний loop: одна попытка + до 1 FloodWait retry + до 3 reconnect retry (независимо).
  while (true) {
    try {
      return await tryFetch();
    } catch (err: unknown) {
      const name =
        (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? "";
      const errorMessage = (err as Error)?.message ?? String(err);

      // FETCH-05: частные ошибки канала — warn + пустой массив (не ретраим).
      if (
        name === "ChannelPrivateError" ||
        name === "UsernameNotOccupiedError" ||
        name === "UsernameInvalidError" ||
        errorMessage.includes("CHANNEL_PRIVATE") ||
        errorMessage.includes("USERNAME_NOT_OCCUPIED") ||
        errorMessage.includes("USERNAME_INVALID")
      ) {
        console.warn(`[telegram] channel skipped: ${username} — ${name || errorMessage}`);
        return [];
      }

      // FETCH-04: FloodWait — один retry (независимый от reconnect, RELI-03).
      // Ветка использует ТОЛЬКО floodRetried;
      // второй счётчик (сетевой) не читается и не инкрементируется здесь.
      if (err instanceof FloodWaitError || name === "FloodWaitError") {
        const seconds = (err as unknown as { seconds?: number }).seconds ?? 30;
        // ANTIBAN: hard-cap. Длинный FloodWait (>5 мин) — сигнал что Telegram уже сердится;
        // лучше пропустить канал и поднять алерт, чем спать 10+ минут и продолжать.
        if (seconds > 300) {
          console.error(
            `[telegram] FloodWait too long on ${username} (${seconds}s) — aborting without retry.`
          );
          throw err;
        }
        if (floodRetried) {
          console.error(`[telegram] second FloodWait on ${username}, aborting (${seconds}s).`);
          throw err;
        }
        console.warn(
          `[telegram] FloodWait on ${username}: sleeping ${seconds}s + 2s, then retry.`
        );
        await sleep(seconds * 1000 + 2000);
        floodRetried = true;
        continue;
      }

      // RELI-01: сетевая ошибка — до 3 попыток exp backoff 1000/2000/4000мс.
      // Ветка использует ТОЛЬКО reconnectAttempts;
      // другой счётчик (FloodWait-retry) не читается и не инкрементируется здесь.
      if (isNetworkError(err)) {
        if (reconnectAttempts >= MAX_RECONNECT) {
          throw new Error(
            `${username}: network disconnect after ${MAX_RECONNECT} attempts (${errorMessage})`
          );
        }
        const delay = RECONNECT_BACKOFF[reconnectAttempts] ?? 4000;
        console.warn(
          `[telegram] reconnect attempt ${reconnectAttempts + 1}/${MAX_RECONNECT} for ${username}, waiting ${delay}ms`
        );
        await sleep(delay);
        try {
          await client.connect();
        } catch {
          // Игнорируем ошибку connect — следующая итерация снова попробует tryFetch.
        }
        reconnectAttempts++;
        continue;
      }

      // Прочие ошибки — пробрасываем (pipeline поймает в per-channel try/catch).
      throw err;
    }
  }
}
