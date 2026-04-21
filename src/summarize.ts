// src/summarize.ts — DeepSeek-суммаризация + серверная проверка дословности keyQuote + HTML-рендер.

import OpenAI from "openai";
import type { Post, DigestJson, DigestItem, DigestSection } from "./types.js";

// ============================================================================
// SYSTEM_PROMPT — §8 spec-app.md. Экстрактивность обязательна; keyQuote ДОЛЖЕН быть
// дословной подстрокой text. Серверная проверка (D-01) — финальный барьер, а не этот промпт.
// ============================================================================
const SYSTEM_PROMPT = [
  "Ты — экстрактивный редактор русскоязычной ленты. На вход получаешь JSON { posts: [...] },",
  "где posts[i] = { channelUsername, postedAt, text, url }.",
  "",
  "Жёсткие правила:",
  "1) Пиши ТОЛЬКО по фактам из text. Никаких домыслов, чисел или имён, отсутствующих в исходнике.",
  "2) keyQuote каждой записи ДОЛЖЕН быть дословной подстрокой text (для верификации).",
  "3) summary — 1–2 предложения на русском, до 250 символов.",
  "4) Отбирай не более 15 самых содержательных постов в сумме по всем каналам.",
  "5) Группировку по темам придумай сам — 3–6 групп, короткие заголовки.",
  "6) Возвращай строго JSON без markdown и комментариев:",
  "{",
  '  "generatedAt": "ISO8601",',
  '  "sections": [',
  "    {",
  '      "title": "Короткий заголовок темы",',
  '      "items": [',
  '        { "summary": "...", "keyQuote": "...", "url": "https://t.me/...", "channel": "username" }',
  "      ]",
  "    }",
  "  ]",
  "}",
].join("\n");

// ============================================================================
// Экранирование HTML. D-13 + SUM-04: <, >, & экранируются; кавычки не трогаем
// (Telegram HTML их не интерпретирует). url обрабатывается отдельно через new URL().
// ============================================================================
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================================
// Форматирование даты для шапки (D-09). Русская локаль, короткий формат.
// Пример: "21 апр. 2026 г."
// ============================================================================
function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

// ============================================================================
// Валидация структуры JSON-ответа (SUM-03): ручной typeof/Array.isArray, без zod.
// Бросает Error при структурных нарушениях (тогда src/run.ts упадёт с exit 1).
// ============================================================================
function validate(x: unknown): asserts x is DigestJson {
  if (typeof x !== "object" || x === null) {
    throw new Error("DeepSeek response: not an object");
  }
  const obj = x as Record<string, unknown>;
  if (typeof obj.generatedAt !== "string") {
    throw new Error("DeepSeek response: generatedAt must be string");
  }
  if (!Array.isArray(obj.sections)) {
    throw new Error("DeepSeek response: sections must be array");
  }
  for (const section of obj.sections) {
    if (typeof section !== "object" || section === null) {
      throw new Error("DeepSeek response: section must be object");
    }
    const s = section as Record<string, unknown>;
    if (typeof s.title !== "string" || !s.title) {
      throw new Error("DeepSeek response: section.title must be non-empty string");
    }
    if (!Array.isArray(s.items)) {
      throw new Error("DeepSeek response: section.items must be array");
    }
    for (const item of s.items) {
      if (typeof item !== "object" || item === null) {
        throw new Error("DeepSeek response: item must be object");
      }
      const it = item as Record<string, unknown>;
      for (const field of ["summary", "keyQuote", "url", "channel"] as const) {
        if (typeof it[field] !== "string" || !it[field]) {
          throw new Error(`DeepSeek response: item.${field} must be non-empty string`);
        }
      }
    }
  }
}

// ============================================================================
// Серверная проверка keyQuote (D-01..D-05) + маппинг item→post по url (D-03).
// Возвращает новый DigestJson только с валидными items; удаляет пустые секции.
// Побочный эффект: console.warn на каждое нарушение (D-04, D-05).
// ============================================================================
function verifyExtractiveness(digest: DigestJson, posts: Post[]): DigestJson {
  // D-03: Map<url, Post>. Ключ — url поста, полученный в src/telegram.ts.
  const byUrl = new Map<string, Post>();
  for (const p of posts) byUrl.set(p.url, p);

  const cleanedSections: DigestSection[] = [];
  for (const section of digest.sections) {
    const validItems: DigestItem[] = [];
    for (const item of section.items) {
      const post = byUrl.get(item.url);
      if (!post) {
        // D-03: url не совпал ни с одним собранным постом — skip.
        console.warn(
          `[summarize] skip (url not in source): channel=${item.channel} url=${item.url} keyQuote="${item.keyQuote.slice(0, 60)}"`
        );
        continue;
      }
      // D-02: sourceText.includes(keyQuote.trim()) — строго + trim по краям.
      const needle = item.keyQuote.trim();
      if (!post.text.includes(needle)) {
        // D-04: skip + warn с channel, messageId, keyQuote, 60-char сниппет text.
        const snippet = post.text.slice(0, 60).replace(/\n/g, " ");
        console.warn(
          `[summarize] skip (keyQuote not in source): channel=${post.channelUsername} messageId=${post.messageId} keyQuote="${needle}" textSnippet="${snippet}"`
        );
        continue;
      }
      validItems.push({
        summary: item.summary,
        keyQuote: item.keyQuote,
        url: item.url,
        channel: item.channel,
      });
    }
    if (validItems.length > 0) {
      cleanedSections.push({ title: section.title, items: validItems });
    }
  }
  return {
    generatedAt: digest.generatedAt,
    sections: cleanedSections,
  };
}

// ============================================================================
// Рендер HTML (D-09..D-13, SUM-04). Чистая конкатенация строк, без шаблонизаторов.
// D-09: шапка `<b>Нефтегаз — {date}</b>\n<i>{N} постов из {K} каналов за 24ч</i>\n\n`.
//   N = общее число собранных постов (posts.length — плана).
//   K = число каналов с ≥1 собранным постом.
// D-10: заголовок темы = `<b>{title}</b>` (без emoji, без нумерации).
// D-11: буллет = `• {summary} — <i>«{keyQuote}»</i> — <a href="{url}">@{channel}</a>`.
// D-12: разделитель секций — одна пустая строка (\n\n).
// D-13: escapeHtml для summary/keyQuote/channel; url валидируется через new URL().
// ============================================================================
export function renderHtml(digest: DigestJson, posts: Post[]): string {
  const date = formatDateRu(digest.generatedAt);
  const n = posts.length;
  const k = new Set(posts.map((p) => p.channelUsername)).size;

  const header =
    `<b>Нефтегаз — ${escapeHtml(date)}</b>\n` +
    `<i>${n} постов из ${k} каналов за 24ч</i>\n\n`;

  const sectionsHtml: string[] = [];
  for (const section of digest.sections) {
    const lines: string[] = [];
    lines.push(`<b>${escapeHtml(section.title)}</b>`);
    for (const item of section.items) {
      // D-13: валидация url через new URL(). Невалидный — пропускаем.
      let safeUrl: string;
      try {
        safeUrl = new URL(item.url).toString();
      } catch {
        console.warn(`[summarize] skip (bad url): ${item.url}`);
        continue;
      }
      // D-11: точный формат буллета.
      lines.push(
        `• ${escapeHtml(item.summary)} — <i>«${escapeHtml(item.keyQuote)}»</i> — <a href="${safeUrl}">@${escapeHtml(item.channel)}</a>`
      );
    }
    sectionsHtml.push(lines.join("\n"));
  }

  // D-12: между секциями — \n\n (пустая строка).
  return header + sectionsHtml.join("\n\n");
}

// ============================================================================
// summarize(posts) — главная функция модуля (SUM-01, SUM-02, SUM-03, SUM-04).
// ============================================================================
export async function summarize(posts: Post[]): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY не задан.");
  }
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  const client = new OpenAI({ apiKey, baseURL });

  // SUM-01: один батч-запрос, response_format: json_object.
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ posts }) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  // SUM-03: парсинг + ручная валидация; ошибка → пробрасываем наверх (src/run.ts сделает exit 1).
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[summarize] DeepSeek вернул невалидный JSON. Raw (first 500 chars):");
    console.error(raw.slice(0, 500));
    throw new Error(`Invalid JSON from DeepSeek: ${(err as Error).message}`);
  }
  validate(parsed);

  // D-01..D-05: серверная верификация дословности keyQuote.
  const verified = verifyExtractiveness(parsed, posts);

  // Если после верификации не осталось ни одной записи — дайджест пустой,
  // но рендерим шапку (оператор увидит "N постов из K каналов за 24ч",
  // но ни одной темы). Это валидный сценарий (LLM всё прогнал, всё отсеялось).
  return renderHtml(verified, posts);
}
