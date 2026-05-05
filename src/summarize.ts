// src/summarize.ts — DeepSeek-суммаризация + серверная проверка дословности keyQuote + HTML-рендер.
// v4.0: two-pass architecture (260504-ew9)
//   Pass 1 — classifyPosts: 1 LLM call, classifies all posts into categories + mentions buckets
//   Pass 2 — summarizeCategory: up to 6 parallel LLM calls, one per non-empty bucket
// External API: summarize(posts, channelStats?) — unchanged, pipeline.ts needs no changes.

import OpenAI from "openai";
import type { Post, DigestJson, DigestItem, Category, Mention } from "./types.js";
import {
  ClassificationResponseSchema,
  CategoryItemsResponseSchema,
} from "./schema.js";
import { log } from "./logger.js";

// ============================================================================
// ChannelStats — опциональная статистика для шапки (будет использована позже)
// ============================================================================
export interface ChannelStats {
  total: number;
  succeeded: number;
  skipped: number;
}

// ============================================================================
// CLASSIFY_SYSTEM_PROMPT — Pass 1: классификация постов по категориям и упоминаниям.
// Один вызов LLM на весь набор постов.
// ============================================================================
const CLASSIFY_SYSTEM_PROMPT = [
  "Ты — классификатор постов нефтегазовой ленты.",
  "На вход получаешь JSON {posts:[{url,text}]}.",
  "Для каждого поста определи:",
  "  (1) категорию из {bunker,oil,kerosene,petrochem,bitumen} или null если не подходит ни одна;",
  "  (2) упомянутые компании из {rosneft,lukoil,gazprom} — только те, что явно названы в тексте.",
  "",
  "Категории:",
  "  bunker     — судовое топливо, мазут, бункеровка, морские порты",
  "  oil        — масла моторные/индустриальные, смазочные материалы",
  "  kerosene   — авиакеросин, jet fuel, авиатопливо",
  "  petrochem  — нефтехимия (этилен, пропилен, полимеры)",
  "  bitumen    — битум, дорожно-строительные нефтепродукты",
  "",
  "Правила:",
  "1) Назначай категорию только когда пост явно и однозначно относится к ней.",
  "2) Если пост не попадает ни в одну категорию — category: null.",
  "3) mentions[] — только компании из {rosneft,lukoil,gazprom}, явно упомянутые в тексте. Может быть пустым.",
  "4) Каждый пост — ровно одна запись в results (url совпадает с входным).",
  "",
  "Верни строгий JSON без markdown:",
  '{"classifications":[{"url":"...","category":"bunker","mentions":["rosneft"]},{"url":"...","category":null,"mentions":[]}]}',
].join("\n");

// ============================================================================
// SUMMARIZE_CATEGORY_PROMPT — Pass 2: экстрактивный редактор для одной категории.
// Один вызов LLM на один непустой бакет.
// ============================================================================
const SUMMARIZE_CATEGORY_PROMPT = [
  "Ты — экстрактивный редактор нефтегазовой ленты.",
  "На вход получаешь JSON {category, posts:[{url,channelUsername,text}]}.",
  "",
  "Твоя задача: для каждого поста написать summary (1–2 предложения, до 250 символов на русском)",
  "и извлечь keyQuote — ДОСЛОВНУЮ подстроку из text (для серверной верификации).",
  "",
  "Если несколько постов освещают одно и то же событие — объедини их в один item,",
  "выбрав наиболее полный источник и keyQuote из него.",
  "",
  "Правила:",
  "1) Пиши ТОЛЬКО по фактам из text. Никаких домыслов.",
  "2) keyQuote ДОЛЖЕН быть дословной подстрокой text (проверяется сервером).",
  "3) summary — 1–2 предложения, до 250 символов.",
  "4) mentions[] — список компаний {rosneft,lukoil,gazprom} из text. Может быть пустым.",
  "5) url и channel берёшь из входного поста.",
  "6) Включай ВСЕ релевантные посты — без ограничения на количество items.",
  "",
  "Верни строгий JSON без markdown:",
  '{"items":[{"summary":"...","keyQuote":"...","url":"...","channel":"...","mentions":["lukoil"]}]}',
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
// Серверная проверка keyQuote (Core Value v3.0) + маппинг item→post по url.
// Возвращает новый DigestJson только с валидными items + счётчик отброшенных.
// Побочный эффект: console.warn на каждое нарушение.
// STRUCT-03: droppedCount будет учтён в RunSummary.postsDropped.
// ============================================================================
export function verifyExtractiveness(
  digest: DigestJson,
  posts: Post[]
): { digest: DigestJson; droppedCount: number } {
  const byUrl = new Map<string, Post>();
  for (const p of posts) byUrl.set(p.url, p);
  let droppedCount = 0;

  const filterArr = (items: DigestItem[]): DigestItem[] => {
    const out: DigestItem[] = [];
    for (const item of items) {
      const post = byUrl.get(item.url);
      if (!post) {
        droppedCount++;
        console.warn(
          `[summarize] skip (url not in source): channel=${item.channel} url=${item.url}`
        );
        continue;
      }
      const needle = item.keyQuote.trim();
      if (!post.text.includes(needle)) {
        droppedCount++;
        const snippet = post.text.slice(0, 60).replace(/\n/g, " ");
        console.warn(
          `[summarize] skip (keyQuote not in source): channel=${post.channelUsername} messageId=${post.messageId} keyQuote="${needle}" textSnippet="${snippet}"`
        );
        continue;
      }
      out.push(item);
    }
    return out;
  };

  return {
    digest: {
      generatedAt: digest.generatedAt,
      bunker:    filterArr(digest.bunker),
      oil:       filterArr(digest.oil),
      kerosene:  filterArr(digest.kerosene),
      petrochem: filterArr(digest.petrochem),
      bitumen:   filterArr(digest.bitumen),
      mentions:  filterArr(digest.mentions),
    },
    droppedCount,
  };
}

// ============================================================================
// RENDER-01..02: 5 фиксированных секций emoji+<b> + блок «Упоминания компаний» (orphans).
// Порядок секций — D-03 (фиксированный, не сортируем по count).
// Пустая секция: <i>— нет упоминаний за сутки</i> (D-02).
// Каждый item содержит deep-link <a href="https://t.me/<channel>/<msgId>">@channel</a> (RENDER-02).
// Inline-маркер [РОСНЕФТЬ] / [ЛУКОЙЛ] / [ГАЗПРОМ] перед summary, если у item непустой mentions[]
// (D-04 + specifics). Пробел между маркерами и summary, без точек.
// ============================================================================

const SECTION_HEADERS: Array<{ key: keyof Pick<DigestJson, "bunker"|"oil"|"kerosene"|"petrochem"|"bitumen"|"mentions">; header: string }> = [
  { key: "bunker",    header: "🚢 Бункер" },
  { key: "oil",       header: "🛢 Масла" },
  { key: "kerosene",  header: "✈️ Керосин" },
  { key: "petrochem", header: "⚗️ Нефтехимия" },
  { key: "bitumen",   header: "🛣 Битум" },
  { key: "mentions",  header: "🏢 Упоминания компаний" },
];

const MENTION_LABEL: Record<Mention, string> = {
  rosneft: "РОСНЕФТЬ",
  lukoil: "ЛУКОЙЛ",
  gazprom: "ГАЗПРОМ",
};

function renderItem(item: DigestItem): string | null {
  // RENDER-02: валидация url через new URL(), невалидный — пропускаем
  let safeUrl: string;
  try {
    safeUrl = new URL(item.url).toString();
  } catch {
    console.warn(`[summarize] skip (bad url): ${item.url}`);
    return null;
  }

  // D-04 + specifics: inline-маркеры для непустого mentions, в фиксированном порядке.
  // Несколько компаний → подряд через пробел: <b>[РОСНЕФТЬ] [ЛУКОЙЛ]</b>.
  let prefix = "";
  if (item.mentions.length > 0) {
    const labels = item.mentions.map((m) => `[${MENTION_LABEL[m]}]`).join(" ");
    prefix = `<b>${labels}</b> `;
  }

  // D-05: формат буллета.
  return `• ${prefix}${escapeHtml(item.summary)} — <i>«${escapeHtml(item.keyQuote)}»</i> — <a href="${safeUrl}">@${escapeHtml(item.channel)}</a>`;
}

export function renderHtml(digest: DigestJson, posts: Post[]): string {
  const date = formatDateRu(digest.generatedAt);
  const n = posts.length;
  const k = new Set(posts.map((p) => p.channelUsername)).size;

  const header =
    `<b>Нефтегаз — ${escapeHtml(date)}</b>\n` +
    `<i>${n} постов из ${k} каналов за 24ч</i>\n\n`;

  const sectionsHtml: string[] = [];
  for (const { key, header: sectionHeader } of SECTION_HEADERS) {
    const items = digest[key];
    const lines: string[] = [`<b>${sectionHeader}</b>`];
    if (items.length === 0) {
      // D-02: явная пометка пустой секции.
      lines.push(`<i>— нет упоминаний за сутки</i>`);
    } else {
      for (const item of items) {
        const rendered = renderItem(item);
        if (rendered !== null) lines.push(rendered);
      }
    }
    sectionsHtml.push(lines.join("\n"));
  }

  // Между секциями — \n\n (пустая строка, граница для chunkHtml).
  return header + sectionsHtml.join("\n\n");
}

// ============================================================================
// groupByBucket — pure helper: distributes posts into category/mentions buckets
// based on a classification array (e.g. from a classify LLM pass or tests).
// Posts with category=null and non-empty mentions → "mentions" bucket.
// Posts with category=null and empty mentions → silently excluded.
// ============================================================================
export type ClassificationEntry = {
  url: string;
  category: Category | null;
  mentions: Mention[];
};

export function groupByBucket(
  classifications: ClassificationEntry[],
  posts: Post[]
): Map<string, Post[]> {
  const CATEGORIES = ["bunker", "oil", "kerosene", "petrochem", "bitumen"] as const;
  const buckets = new Map<string, Post[]>();
  for (const cat of CATEGORIES) buckets.set(cat, []);
  buckets.set("mentions", []);

  const classMap = new Map<string, ClassificationEntry>();
  for (const c of classifications) classMap.set(c.url, c);

  for (const post of posts) {
    const cls = classMap.get(post.url);
    if (!cls) continue;
    if (cls.category !== null) {
      buckets.get(cls.category)!.push(post);
    } else if (cls.mentions.length > 0) {
      buckets.get("mentions")!.push(post);
    }
    // else: irrelevant — silently excluded
  }

  return buckets;
}

// ============================================================================
// classifyPosts — Pass 1. Один LLM-вызов → классификация всех постов.
// Возвращает массив {url, category, mentions} для каждого поста.
// ============================================================================
async function classifyPosts(
  client: OpenAI,
  posts: Post[],
  model: string
): Promise<ClassificationEntry[]> {
  log.info(`[summarize] pass1: classifying ${posts.length} posts`);
  const userMsg = JSON.stringify({ posts: posts.map((p) => ({ url: p.url, text: p.text })) });

  const callLLM = async (): Promise<unknown> => {
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    });
    log.info(`[summarize] pass1: response in ${Date.now() - startedAt}ms`);
    const raw = completion.choices[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`pass1 invalid JSON: ${(err as Error).message}`);
    }
  };

  let parsed = await callLLM();
  let result = ClassificationResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      `[summarize] pass1 schema fail: ${JSON.stringify(result.error.issues).slice(0, 300)} — retry`
    );
    parsed = await callLLM();
    result = ClassificationResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        "pass1 schema mismatch after retry: " + JSON.stringify(result.error.issues).slice(0, 500)
      );
    }
  }

  const { classifications } = result.data;
  const categoryBuckets = new Set(classifications.map((c) => c.category).filter(Boolean));
  const mentionOrphans = classifications.filter((c) => c.category === null && c.mentions.length > 0).length;
  const relevant = classifications.filter((c) => c.category !== null || c.mentions.length > 0).length;
  log.info(
    `[summarize] pass1: ${relevant} relevant posts across ${categoryBuckets.size + (mentionOrphans > 0 ? 1 : 0)} buckets`
  );

  return classifications as ClassificationEntry[];
}

// ============================================================================
// summarizeCategory — Pass 2. Один LLM-вызов → items для одного бакета.
// Антифрагильный: на двойной fail → log.warn + пустой массив (не throw).
// ============================================================================
type CategoryItem = {
  summary: string;
  keyQuote: string;
  url: string;
  channel: string;
  mentions: Mention[];
};

async function summarizeCategory(
  client: OpenAI,
  category: string,
  posts: Post[],
  model: string
): Promise<CategoryItem[]> {
  log.info(`[summarize] pass2: ${category} — ${posts.length} posts`);
  const userMsg = JSON.stringify({
    category,
    posts: posts.map((p) => ({ url: p.url, channelUsername: p.channelUsername, text: p.text })),
  });

  const callLLM = async (): Promise<unknown> => {
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUMMARIZE_CATEGORY_PROMPT },
        { role: "user", content: userMsg },
      ],
    });
    log.info(`[summarize] pass2: ${category} response in ${Date.now() - startedAt}ms`);
    const raw = completion.choices[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`pass2 ${category} invalid JSON: ${(err as Error).message}`);
    }
  };

  let parsed = await callLLM();
  let result = CategoryItemsResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      `[summarize] pass2: ${category} schema fail — retry`
    );
    parsed = await callLLM();
    result = CategoryItemsResponseSchema.safeParse(parsed);
    if (!result.success) {
      log.warn(`[summarize] pass2: ${category} FAILED after retry — skipping`);
      return [];
    }
  }

  const items = result.data.items as CategoryItem[];
  log.info(`[summarize] pass2: ${category} — ${posts.length} posts → ${items.length} items`);
  return items;
}

// ============================================================================
// summarize(posts, channelStats?) — главная функция модуля v4.0 (260504-ew9).
// Возвращает {html, postsDropped} — postsDropped попадёт в RunSummary.
// Сигнатура совместима с v3.0 — pipeline.ts не требует изменений.
//
// Архитектура:
//   Pass 1: classifyPosts(posts) → classifications
//   Bucketing: группировка постов по категории / mentions / отброшенные
//   Pass 2: Promise.allSettled — summarizeCategory() для каждого непустого бакета
//   Assembly: инжектируем category в каждый item, собираем DigestJson
//   verifyExtractiveness → renderHtml → {html, postsDropped}
// ============================================================================
export async function summarize(
  posts: Post[],
  _channelStats?: ChannelStats
): Promise<{ html: string; postsDropped: number }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY не задан.");
  }
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  // Shared client — connection pooling across all LLM calls
  const client = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 1 });

  // ---------------------------------------------------------------------------
  // Pass 1: classify all posts in one LLM call
  // ---------------------------------------------------------------------------
  const classifications = await classifyPosts(client, posts, model);

  // Build URL → classification map for O(1) lookup
  const classMap = new Map<string, (typeof classifications)[number]>();
  for (const c of classifications) classMap.set(c.url, c);

  // ---------------------------------------------------------------------------
  // Bucketing: category → Post[], "mentions" → Post[] (orphans)
  // ---------------------------------------------------------------------------
  const CATEGORIES = ["bunker", "oil", "kerosene", "petrochem", "bitumen"] as const;
  const buckets = new Map<string, Post[]>();
  for (const cat of CATEGORIES) buckets.set(cat, []);
  buckets.set("mentions", []);

  for (const post of posts) {
    const cls = classMap.get(post.url);
    if (!cls) continue;
    if (cls.category !== null) {
      buckets.get(cls.category)!.push(post);
    } else if (cls.mentions.length > 0) {
      buckets.get("mentions")!.push(post);
    }
    // else: irrelevant — silently dropped
  }

  const bucketSizes = Object.fromEntries(
    [...buckets.entries()].map(([k, v]) => [k, v.length])
  );
  log.info(`[summarize] classification: ${JSON.stringify(bucketSizes)}`);

  // Non-empty buckets only
  const nonEmptyBuckets = [...buckets.entries()].filter(([, posts]) => posts.length > 0);

  // ---------------------------------------------------------------------------
  // Pass 2: parallel summarization — one LLM call per non-empty bucket
  // ---------------------------------------------------------------------------
  const settled = await Promise.allSettled(
    nonEmptyBuckets.map(([category, bucketPosts]) =>
      summarizeCategory(client, category, bucketPosts, model)
    )
  );

  // ---------------------------------------------------------------------------
  // Assembly: inject category field, collect into DigestJson arrays
  // ---------------------------------------------------------------------------
  const categoryArrays: Record<string, DigestItem[]> = {
    bunker: [], oil: [], kerosene: [], petrochem: [], bitumen: [], mentions: [],
  };

  for (let i = 0; i < nonEmptyBuckets.length; i++) {
    const [bucketKey] = nonEmptyBuckets[i]!;
    const result = settled[i]!;

    if (result.status === "rejected") {
      console.warn(`[summarize] pass2: ${bucketKey} FAILED — ${(result.reason as Error).message}`);
      // antifragile: treat as empty
      continue;
    }

    const items = result.value;
    // Inject category: category buckets get the bucket key; "mentions" bucket gets null
    const categoryValue: Category | null = bucketKey === "mentions" ? null : (bucketKey as Category);
    for (const item of items) {
      categoryArrays[bucketKey]!.push({
        category: categoryValue,
        summary: item.summary,
        keyQuote: item.keyQuote,
        url: item.url,
        channel: item.channel,
        mentions: item.mentions,
      });
    }
  }

  const digest: DigestJson = {
    generatedAt: new Date().toISOString(),
    bunker:    categoryArrays["bunker"]!,
    oil:       categoryArrays["oil"]!,
    kerosene:  categoryArrays["kerosene"]!,
    petrochem: categoryArrays["petrochem"]!,
    bitumen:   categoryArrays["bitumen"]!,
    mentions:  categoryArrays["mentions"]!,
  };

  // ---------------------------------------------------------------------------
  // Core Value: server-side verification of keyQuote verbatim match
  // ---------------------------------------------------------------------------
  const { digest: verifiedDigest, droppedCount } = verifyExtractiveness(digest, posts);

  // ---------------------------------------------------------------------------
  // Render HTML and return
  // ---------------------------------------------------------------------------
  const html = renderHtml(verifiedDigest, posts);
  return { html, postsDropped: droppedCount };
}
