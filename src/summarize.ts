// src/summarize.ts — DeepSeek-суммаризация + серверная проверка дословности keyQuote + HTML-рендер.

import OpenAI from "openai";
import type { Post, DigestJson, DigestItem, Category, Mention } from "./types.js";
import { DigestJsonSchema } from "./schema.js";

// ============================================================================
// SYSTEM_PROMPT v3.0 — STRUCT-01..03. Экстрактивность обязательна; keyQuote ДОЛЖЕН быть
// дословной подстрокой text. Серверная проверка — финальный барьер, а не этот промпт.
// 5 фиксированных категорий + блок mentions (orphans only, D-04).
// ============================================================================
const SYSTEM_PROMPT = [
  "Ты — экстрактивный редактор русскоязычной ленты по нефтегазу/нефтехимии РФ.",
  "На вход получаешь JSON { posts: [...] }, где posts[i] = { channelUsername, postedAt, text, url }.",
  "",
  "Твоя задача — вернуть СТРОГИЙ JSON по 5 фиксированным категориям + блок mentions.",
  "",
  "Категории (ровно эти 5 ключей):",
  "  - bunker     — судовое топливо, мазут, бункеровка, морские порты",
  "  - oil        — масла моторные/индустриальные, смазочные материалы",
  "  - kerosene   — авиакеросин, jet fuel, авиатопливо",
  "  - petrochem  — нефтехимия (этилен, пропилен, полимеры, нефтехимические продукты)",
  "  - bitumen    — битум, дорожно-строительные нефтепродукты",
  "",
  "Компании-маркеры (ровно эти 3 значения):",
  "  - rosneft, lukoil, gazprom",
  "",
  "Жёсткие правила:",
  "1) Пиши ТОЛЬКО по фактам из text. Никаких домыслов, чисел или имён, отсутствующих в исходнике.",
  "2) keyQuote каждой записи ДОЛЖЕН быть дословной подстрокой text (для серверной верификации).",
  "3) summary — 1–2 предложения на русском, до 250 символов.",
  "4) Каждый item имеет mentions: [...] — список упомянутых в text компаний из {rosneft,lukoil,gazprom}, может быть пустым.",
  "5) Если пост попадает в одну из 5 категорий — клади его в соответствующий массив (bunker/oil/kerosene/petrochem/bitumen) с category равной этому ключу. Mentions заполняй параллельно.",
  "6) Если пост НЕ попадает ни в одну из 5 категорий, но содержит хотя бы одну из 3 компаний — клади его в массив mentions с category=null и непустым mentions[]. Это «orphan-mention».",
  "7) Если пост НЕ попадает в категорию И не упоминает ни одной из 3 компаний — отбрасывай (не возвращай нигде).",
  "8) Один пост попадает РОВНО в один массив (либо в категорию, либо в orphan-mention), не в оба.",
  "9) Отбирай не более 15 самых содержательных постов в сумме по всем массивам.",
  "10) Возвращай строго JSON без markdown и комментариев следующего вида:",
  "{",
  '  "generatedAt": "ISO8601",',
  '  "bunker":    [ { "category":"bunker",    "summary":"...", "keyQuote":"...", "url":"...", "channel":"...", "mentions":["rosneft"] } ],',
  '  "oil":       [],',
  '  "kerosene":  [],',
  '  "petrochem": [],',
  '  "bitumen":   [],',
  '  "mentions":  [ { "category":null, "summary":"...", "keyQuote":"...", "url":"...", "channel":"...", "mentions":["lukoil"] } ]',
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
