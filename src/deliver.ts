// src/deliver.ts — доставка HTML-дайджеста в приватный Telegram-канал через Bot API.
// Использует встроенный fetch (Node 20.6+), без каких-либо SDK.

const TELEGRAM_LIMIT = 4096;
const CHUNK_SAFE_LIMIT = 4000; // запас ~96 символов на префикс "(i/N)\n" + заголовки тегов

/**
 * Режет HTML-строку на части, каждая ≤ max символов.
 * DELIVER-02: не рвём HTML посередине тега. Приоритеты разрыва:
 *   1. Двойной перенос (\n\n) — граница секций, идеальный разрыв.
 *   2. Одиночный перенос (\n) — граница строки/буллета.
 *   3. Пробел — как последний fallback, но только ВНЕ открытого тега.
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

    // Приоритет 1: последний \n\n в окне.
    let cutAt = window.lastIndexOf("\n\n");
    if (cutAt < Math.floor(max * 0.5)) {
      // Приоритет 2: последний \n.
      const singleLf = window.lastIndexOf("\n");
      if (singleLf > cutAt) cutAt = singleLf;
    }
    if (cutAt < Math.floor(max * 0.5)) {
      // Приоритет 3: последний пробел, но ДО первого незакрытого "<".
      // Простая эвристика — ищем последний пробел, чтобы не разрезать "<a href".
      const lastSpace = window.lastIndexOf(" ");
      if (lastSpace > cutAt) cutAt = lastSpace;
    }
    if (cutAt <= 0) {
      // Не нашли хорошего разрыва — режем по max (крайний случай, не должен возникать
      // на нашей HTML-структуре, где всё разделено \n\n между секциями).
      cutAt = max;
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
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // DELIVER-04: HTTP-статус + тело ответа.
      const responseBody = await res.text();
      throw new Error(`Telegram sendMessage failed: ${res.status} ${responseBody}`);
    }
  }
}
