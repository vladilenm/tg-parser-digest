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
import { hashText } from "./dedup.js";

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
  "  (2) упомянутые компании из {rosneft,lukoil,gazpromneft} — только те, что явно названы в тексте.",
  "",
  "Категории:",
  "  bunker     — бункерное/судовое топливо: бункер, мазут, судовое топливо, FO, Fuel oil, бункеровка, морские порты",
  "  oil        — смазочные материалы и масла: смазки, lubricants, моторное масло, базовые масла, индустриальные масла",
  "  kerosene   — авиатопливо: керосин, авиакеросин, JET, jet fuel, SAF",
  "  petrochem  — нефтехимия: полимеры, нефтехимический синтез, этилен, пропилен",
  "  bitumen    — битум и дорожно-строительные нефтепродукты: битум, ПБВ, асфальт, битумные вяжущие, bitumen",
  "",
  "Правила:",
  "1) Назначай категорию только когда пост явно и однозначно относится к ней.",
  "2) Если пост не попадает ни в одну категорию — category: null.",
  "3) mentions[] — только компании из {rosneft,lukoil,gazpromneft}, явно упомянутые в тексте. Может быть пустым.",
  "3a) Литерал 'gazpromneft' назначай, если в тексте явно упомянуты любые из форм:",
  "    'Газпромнефть' (слитно), 'Газпром нефть' (через пробел — официальное название),",
  "    'Газпром-нефть' (через дефис), 'ГПН' (аббревиатура).",
  "3b) НЕ помечай 'gazpromneft', если в тексте только 'Газпром' БЕЗ 'нефть' — это",
  "    материнская газовая компания, она нам не нужна.",
  "4) Каждый пост — ровно одна запись в results (url совпадает с входным).",
  "",
  "Верни строгий JSON без markdown:",
  '{"classifications":[{"url":"...","category":"bunker","mentions":["rosneft"]},{"url":"...","category":null,"mentions":[]}]}',
].join("\n");

// ============================================================================
// buildSummarizeCategoryPrompt — Pass 2: экстрактивный редактор для одной
// категории. System prompt строится динамически на каждый прогон.
//
// applyDateFilter — включает фильтр по дате (правила 14–18) с зашитым в
// инструкцию `today` MSK и окном [windowStart … today]. Используется ТОЛЬКО
// в web-pipeline, где text — это index-страница со смесью свежих и архивных
// новостей. TG-pipeline не передаёт `applyDateFilter: true` — там окно
// фильтруется ПЕРЕД summarize через `fetchLast24h` по timestamp от
// Telegram API; включать тут date-фильтр опасно — правило 16 (year mismatch)
// ошибочно срезало бы посты с историческими отсылками типа
// «в 2022 году компания запустила...».
// ============================================================================
function buildSummarizeCategoryPrompt(opts: {
  today: string;
  freshnessDays: number;
  applyDateFilter: boolean;
}): string {
  const { today, freshnessDays, applyDateFilter } = opts;

  // windowStart нужен только для applyDateFilter; считаем условно.
  // Арифметика через UTC midnight — нужны календарные дни без DST/TZ-сдвигов.
  let windowStart = "";
  if (applyDateFilter) {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - freshnessDays);
    windowStart = t.toISOString().slice(0, 10);
  }

  const header: string[] = ["Ты — экстрактивный редактор нефтегазовой ленты."];
  if (applyDateFilter) {
    header.push(
      `Сегодняшняя дата (Europe/Moscow): ${today}.`,
      `Окно свежести новостей: последние ${freshnessDays} дн. — диапазон [${windowStart} … ${today}] включительно.`,
      "Любая новость с явной датой ВНЕ этого окна — устаревшая. НЕ извлекай её."
    );
  }

  const dateBlock: string[] = [];
  if (applyDateFilter) {
    dateBlock.push(
      "",
      "ФИЛЬТР ПО ДАТЕ (жёсткий — старые новости отбрасывай молча):",
      `14) Окно свежести зашито выше: [${windowStart} … ${today}]. ${freshnessDays} дн.`,
      "    На daily-прогоне это ровно «вчера + сегодня». Всё, что вне окна — старое.",
      "15) Если рядом с новостью в text явно указана дата в ЛЮБОМ формате —",
      "    «6 мая 2026», «6.05.2026», «06.05.2026», «6 May 2026», «May 6, 2026»,",
      "    «2026-05-06», «вчера», «сегодня», «на прошлой неделе», «3 дня назад» —",
      "    оцени её относительно сегодняшней даты выше. Если дата ВНЕ окна — НЕ",
      "    извлекай новость.",
      "16) Если у новости указан только год, и он отличается от текущего года —",
      `    отбрось как устаревшую (текущий год = ${today.slice(0, 4)}).`,
      "17) Если даты у новости НЕТ вообще — допускай (не все сайты их проставляют).",
      "    НЕ выдумывай дату, если её нет в text.",
      "18) Не путай «дата публикации» с «датой будущего события» внутри текста",
      "    (например, упоминание «партнёр Russialoppet 2026» в архивной новости",
      "    2022-го года — это пост 2022-го, не 2026-го; отбрось по правилу 15/16)."
    );
  }

  return [
    ...header,
    "",
    "На вход получаешь JSON {category, posts:[{url,channelUsername,text}]}.",
    "",
    "Твоя задача: извлечь из text значимые отраслевые новости в виде items со summary",
    "(1–2 предложения, до 250 символов на русском) и keyQuote (ДОСЛОВНОЙ подстрокой text",
    "для серверной верификации).",
    "",
    "Базовые правила:",
    "1) Пиши ТОЛЬКО по фактам из text. Никаких домыслов.",
    "2) keyQuote ДОЛЖЕН быть дословной подстрокой text (проверяется сервером).",
    "3) summary — 1–2 предложения, до 250 символов.",
    "4) mentions[] — список компаний {rosneft,lukoil,gazpromneft} из text. Может быть пустым.",
    "5) url и channel берёшь из входного поста.",
    "",
    "ОБЪЕДИНЕНИЕ ПОВТОРОВ ВНУТРИ ОДНОГО url:",
    "6) Если внутри ОДНОГО поста (одинаковый url) несколько новостей описывают один",
    "   паттерн с вариациями (конкурс дистрибьютора в нескольких регионах; акция 4+1",
    "   на нескольких парах продуктов; партнёрство с несколькими спортивными",
    "   мероприятиями; запуск нескольких SKU одной линейки) — это ОДИН item, не N.",
    "   В summary опиши паттерн и общее количество/перечисление, keyQuote возьми",
    "   из любой одной из этих новостей.",
    '   Пример: "Объявлены конкурсы на статус дистрибьютора смазочных материалов',
    '   «Роснефть» в Ивановской, Владимирской и Омской областях."',
    "",
    "ОБЪЕДИНЕНИЕ ПОВТОРОВ МЕЖДУ url:",
    "7) Если несколько постов с РАЗНЫМИ url освещают одно и то же событие — объедини",
    "   их в один item, выбрав наиболее полный источник и keyQuote из него.",
    "",
    "ФИЛЬТР МАРКЕТИНГА (НЕ извлекай как item):",
    "8) Спонсорство и партнёрство в неотраслевых мероприятиях (спорт, культура,",
    "   благотворительность, фестивали, марафоны, авто-фестивали).",
    "9) Технические улучшения сайта (запуск чат-бота / ИИ-агента, обновление личного",
    "   кабинета, новый раздел сайта).",
    "10) Рекламные акции, промокоды, скидки, программы лояльности (4+1, бонусы и т.п.).",
    "11) Контент-маркетинговые материалы: blog-посты вида «эксперты обсудили...»,",
    "    «развеяли мифы», обзоры, интервью без новостного повода.",
    "12) Новости о наградах/победах в нерейтинговых конкурсах, корпоративные мероприятия.",
    "    Цель — отраслевая повестка нефтегаза (производство, инвестиции, поставки,",
    "    запуски новых SKU, регуляторика, рынок), а НЕ PR-лента сайта.",
    "",
    "ЛИМИТ items:",
    "13) Не более 3 items на один входной url. Если в посте >3 действительно разных",
    "    значимых отраслевых новостей — выбирай самые важные (промышленный запуск,",
    "    инвестиции, новые продукты, отраслевые события). Маркетинг (правила 8–12)",
    "    в этот лимит не попадает — он отбрасывается ПЕРЕД отбором.",
    ...dateBlock,
    "",
    "Верни строгий JSON без markdown:",
    '{"items":[{"summary":"...","keyQuote":"...","url":"...","channel":"...","mentions":["lukoil"]}]}',
  ].join("\n");
}

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
// Inline-маркер [РОСНЕФТЬ] / [ЛУКОЙЛ] / [ГПН] перед summary, если у item непустой mentions[]
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
  gazpromneft: "ГПН",
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
// chunkArray — pure helper: разбивает массив на чанки фиксированного размера.
// Экспортирован для юнит-тестов; используется в classifyPosts для разбиения
// posts перед параллельной классификацией (избегаем client timeout 120s
// при больших прогонах — 220+ постов).
// ============================================================================
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0 || !Number.isFinite(size)) {
    throw new Error(`chunkArray: size must be a positive finite number, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ============================================================================
// classifyPosts — Pass 1. Классификация всех постов по категориям и mentions.
// При posts.length <= chunkSize — один LLM-вызов (single path, без overhead).
// При posts.length >  chunkSize — разбиваем на чанки CLASSIFY_CHUNK_SIZE
// (default 40) и классифицируем параллельно через Promise.allSettled.
// Антифрагильно: упавший чанк (после внутреннего retry) → log.warn, остальные
// результаты используются; посты упавшего чанка получают silent-drop в
// существующей bucketing-логике (текущее корректное поведение).
// ============================================================================
async function classifyPosts(
  client: OpenAI,
  posts: Post[],
  model: string
): Promise<ClassificationEntry[]> {
  log.info(`[summarize] pass1: classifying ${posts.length} posts`);

  // Размер чанка: env CLASSIFY_CHUNK_SIZE с защитой от NaN/<=0/undefined.
  const rawChunkSize = process.env.CLASSIFY_CHUNK_SIZE;
  const parsedChunkSize = rawChunkSize ? parseInt(rawChunkSize, 10) : NaN;
  const chunkSize =
    Number.isFinite(parsedChunkSize) && parsedChunkSize > 0 ? parsedChunkSize : 40;

  // Внутренняя функция: один LLM-вызов на один чанк постов.
  // Сохраняем существующий retry (parsed → schema check → один retry → throw).
  const classifyChunk = async (
    chunkPosts: Post[],
    chunkIdx: number,
    totalChunks: number
  ): Promise<ClassificationEntry[]> => {
    log.info(
      `[summarize] pass1: chunk ${chunkIdx + 1}/${totalChunks} (${chunkPosts.length} posts)`
    );
    const userMsg = JSON.stringify({
      posts: chunkPosts.map((p) => ({ url: p.url, text: p.text })),
    });

    const callLLM = async (): Promise<unknown> => {
      const startedAt = Date.now();
      const completion = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      });
      log.info(
        `[summarize] pass1: chunk ${chunkIdx + 1}/${totalChunks} response in ${Date.now() - startedAt}ms`
      );
      const raw = completion.choices[0]?.message?.content ?? "{}";
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `pass1 chunk ${chunkIdx + 1}/${totalChunks} invalid JSON: ${(err as Error).message}`
        );
      }
    };

    let parsedResp = await callLLM();
    let result = ClassificationResponseSchema.safeParse(parsedResp);
    if (!result.success) {
      console.warn(
        `[summarize] pass1 chunk ${chunkIdx + 1}/${totalChunks} schema fail: ${JSON.stringify(result.error.issues).slice(0, 300)} — retry`
      );
      parsedResp = await callLLM();
      result = ClassificationResponseSchema.safeParse(parsedResp);
      if (!result.success) {
        throw new Error(
          `pass1 chunk ${chunkIdx + 1}/${totalChunks} schema mismatch after retry: ` +
            JSON.stringify(result.error.issues).slice(0, 500)
        );
      }
    }
    return result.data.classifications as ClassificationEntry[];
  };

  // ---------------------------------------------------------------------------
  // Single path для маленьких прогонов: без Promise.allSettled overhead.
  // ---------------------------------------------------------------------------
  let classifications: ClassificationEntry[];
  if (posts.length <= chunkSize) {
    classifications = await classifyChunk(posts, 0, 1);
  } else {
    // -------------------------------------------------------------------------
    // Multi-chunk path: параллельная классификация через Promise.allSettled.
    // Антифрагильно: упавший чанк → log.warn, посты этого чанка получат
    // silent-drop в bucketing-логике (текущее корректное поведение).
    // -------------------------------------------------------------------------
    const chunks = chunkArray(posts, chunkSize);
    log.info(
      `[summarize] pass1: splitting into ${chunks.length} chunks of ~${chunkSize} posts (parallel)`
    );
    const settled = await Promise.allSettled(
      chunks.map((chunk, i) => classifyChunk(chunk, i, chunks.length))
    );
    classifications = [];
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]!;
      if (r.status === "fulfilled") {
        classifications.push(...r.value);
        succeeded++;
      } else {
        log.warn(
          `[summarize] pass1: chunk ${i + 1}/${chunks.length} FAILED — ${(r.reason as Error).message} (skipping ${chunks[i]!.length} posts)`
        );
        failed++;
      }
    }
    log.info(
      `[summarize] pass1: chunks ${succeeded}/${chunks.length} succeeded, ${failed} failed`
    );
  }

  const categoryBuckets = new Set(classifications.map((c) => c.category).filter(Boolean));
  const mentionOrphans = classifications.filter(
    (c) => c.category === null && c.mentions.length > 0
  ).length;
  const relevant = classifications.filter(
    (c) => c.category !== null || c.mentions.length > 0
  ).length;
  log.info(
    `[summarize] pass1: ${relevant} relevant posts across ${categoryBuckets.size + (mentionOrphans > 0 ? 1 : 0)} buckets`
  );

  return classifications;
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
  model: string,
  options?: { applyDateFilter?: boolean }
): Promise<CategoryItem[]> {
  log.info(`[summarize] pass2: ${category} — ${posts.length} posts`);
  // applyDateFilter включается ТОЛЬКО для web-pipeline. TG-pipeline не передаёт
  // — там окно «24h» уже отфильтровано через fetchLast24h по timestamp от
  // Telegram API; date-фильтр в промпте ошибочно срезал бы посты с
  // историческими отсылками вроде «в 2022 году компания запустила...».
  const applyDateFilter = options?.applyDateFilter ?? false;
  // Окно свежести зашиваем прямо в system prompt (модель так стабильнее держит
  // правило). MSK дата из того же Intl.DateTimeFormat("en-CA",
  // timeZone="Europe/Moscow"), что и в archive.ts — паритет дат файла и
  // контента (см. WR-05). Default = 2 дн. («вчера + сегодня») для daily-прогона
  // в 20:15 MSK; переопределяется env SUMMARY_FRESHNESS_DAYS.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const rawFreshness = process.env.SUMMARY_FRESHNESS_DAYS;
  const parsedFreshness = rawFreshness ? parseInt(rawFreshness, 10) : NaN;
  const freshnessDays =
    Number.isFinite(parsedFreshness) && parsedFreshness > 0 ? parsedFreshness : 2;
  const systemPrompt = buildSummarizeCategoryPrompt({ today, freshnessDays, applyDateFilter });
  const userMsg = JSON.stringify({
    category,
    posts: posts.map((p) => ({ url: p.url, channelUsername: p.channelUsername, text: p.text })),
  });

  const callLLM = async (): Promise<unknown> => {
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
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
export interface SummarizeOptions {
  channelStats?: ChannelStats;
  /**
   * Cross-run dedup на уровне items: если передан, items с
   * `hashText(keyQuote)` уже в этом Set отбрасываются ПОСЛЕ verifyExtractiveness
   * и ДО renderHtml. `freshKeyQuoteHashes` в return содержит хеши доставленных
   * (новых) items — caller обязан вызвать `commitHashCache` после успешной
   * доставки. Используется web-pipeline; TG-pipeline не передаёт (там дедуп
   * на уровне постов через `dedupAgainstCache` ДО summarize).
   */
  dedupCache?: Set<string>;
  /**
   * Включать ли в Pass 2 system prompt'е блок «ФИЛЬТР ПО ДАТЕ» (правила 14–18)
   * с зашитым `today` MSK и окном [today − N … today]. Используется ТОЛЬКО
   * web-pipeline. TG-pipeline НЕ передаёт — там окно «24h» уже отфильтровано
   * через fetchLast24h по timestamp от Telegram API. Применять date-фильтр
   * к TG-постам опасно: правило 16 (year mismatch) ошибочно срезало бы посты
   * с историческими отсылками вроде «в 2022 году компания запустила...».
   */
  applyDateFilter?: boolean;
}

export async function summarize(
  posts: Post[],
  options?: SummarizeOptions
): Promise<{
  html: string;
  postsDropped: number;
  itemsCount: number;
  freshKeyQuoteHashes: string[];
}> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY не задан.");
  }
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

  const startedAt = Date.now();
  const totalChars = posts.reduce((s, p) => s + p.text.length, 0);
  log.info(
    `[summarize] start: posts=${posts.length} totalChars=${totalChars} model=${model} baseURL=${baseURL}`
  );

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
  const applyDateFilter = options?.applyDateFilter ?? false;
  const settled = await Promise.allSettled(
    nonEmptyBuckets.map(([category, bucketPosts]) =>
      summarizeCategory(client, category, bucketPosts, model, { applyDateFilter })
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
  // Optional cross-run dedup на уровне items (web-pipeline). Хеш считается на
  // нормализованном keyQuote (тот же hashText, что в TG-dedup'е), shared cache
  // в data/hash-cache.json. Caller commit'ит freshKeyQuoteHashes ПОСЛЕ доставки.
  // ---------------------------------------------------------------------------
  const dedupCache = options?.dedupCache;
  const freshKeyQuoteHashes: string[] = [];
  let dedupedDigest = verifiedDigest;
  if (dedupCache) {
    let dedupHits = 0;
    const filterDup = (items: DigestItem[]): DigestItem[] => {
      const out: DigestItem[] = [];
      for (const item of items) {
        const h = hashText(item.keyQuote);
        if (dedupCache.has(h)) {
          dedupHits++;
          continue;
        }
        // Внутри текущего прогона тоже исключаем повторы, чтобы один и тот же
        // keyQuote не попал в дайджест дважды (одна новость на двух сайтах).
        if (freshKeyQuoteHashes.includes(h)) {
          dedupHits++;
          continue;
        }
        freshKeyQuoteHashes.push(h);
        out.push(item);
      }
      return out;
    };
    dedupedDigest = {
      generatedAt: verifiedDigest.generatedAt,
      bunker:    filterDup(verifiedDigest.bunker),
      oil:       filterDup(verifiedDigest.oil),
      kerosene:  filterDup(verifiedDigest.kerosene),
      petrochem: filterDup(verifiedDigest.petrochem),
      bitumen:   filterDup(verifiedDigest.bitumen),
      mentions:  filterDup(verifiedDigest.mentions),
    };
    log.info(
      `[summarize] dedup: ${dedupHits} items dropped by keyQuote hash-cache (${freshKeyQuoteHashes.length} fresh)`
    );
  }

  // ---------------------------------------------------------------------------
  // Render HTML and return
  // ---------------------------------------------------------------------------
  const html = renderHtml(dedupedDigest, posts);

  // WR-04: structured signal вместо grep по `• ` в HTML.
  // itemsCount = всего items по 5 категориям + mentions, ПОСЛЕ verifyExtractiveness и optional dedup.
  // web-scraper использует это для решения send / silent (D-14).
  const itemsCount =
    dedupedDigest.bunker.length +
    dedupedDigest.oil.length +
    dedupedDigest.kerosene.length +
    dedupedDigest.petrochem.length +
    dedupedDigest.bitumen.length +
    dedupedDigest.mentions.length;

  log.info(
    `[summarize] done: posts=${posts.length} → items=${itemsCount} dropped=${droppedCount} html=${html.length}ch in ${Date.now() - startedAt}ms`
  );
  return { html, postsDropped: droppedCount, itemsCount, freshKeyQuoteHashes };
}
