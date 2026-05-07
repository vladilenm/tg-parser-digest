// src/rss.ts — RSS / Atom фид-парсер для web-pipeline.
// Per-site опциональная альтернатива HTML-flow: если в websites.json у записи
// задано поле `rss`, web-scraper.ts вызывает fetchRssAsPosts() вместо
// fetchSite + extractText. Преимущества:
//   1) точный pubDate → code-side date-фильтр (вместо soft prompt-rule);
//   2) каждый item — отдельный Post с уникальным detail-URL → естественный
//      dedup в Pass 2 + точнее keyQuote-cache;
//   3) нет index-page noise (navigation/footer/sidebar) — text чище.
//
// SSRF safety: используется fetchSite() из web-scraper.ts (manual redirect +
// isSafePublicUrl revalidation на каждом hop, см. CR-01/WR-07). Поле
// `rss` в WebsiteEntrySchema проходит тот же refine что и `url`.

import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import type { Post } from "./types.js";
import type { WebsiteEntry } from "./schema.js";
import { fetchSite } from "./web-scraper.js";
import { log } from "./logger.js";

// Default окно 24h — паритет с TG (FETCH_WINDOW_HOURS=24). Override через
// env WEB_RSS_WINDOW_HOURS (положительное число).
const DEFAULT_RSS_WINDOW_HOURS = 24;

// Hard cap на text одного RSS-item, симметрично TEXT_CAP_CHARS из web-scraper.
// На практике title+description редко > 2000 chars; cap страхует от feed'ов с
// полным <content:encoded>, которое весит десятки KB и съело бы LLM-окно.
const RSS_ITEM_TEXT_CAP = 4000;

// =============================================================================
// XMLParser tuned для RSS 2.0 + Atom 1.0:
//   - ignoreAttributes:false — чтобы прочитать <link href=".."> в Atom.
//   - parseTagValue:true     — приводит "2026-05-07" к Date через Date.parse в
//                              нашем коде (parser отдаёт string, мы парсим сами).
//   - cdataPropName:"#cdata" — некоторые RSS заворачивают description/title в
//                              <![CDATA[...]]>; мы поднимаем содержимое явно.
//   - trimValues:true        — выравнивает whitespace.
//   - alwaysCreateTextNode:false — не оборачивает простые ноды в {"#text":..}.
//   - removeNSPrefix:true    — Atom часто имеет xmlns prefix; для парсинга
//                              достаточно tag-name'а без префикса.
// =============================================================================
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  trimValues: true,
  removeNSPrefix: true,
});

interface NormalizedItem {
  title: string;
  description: string;
  link: string;
  pubDate: Date;
}

// =============================================================================
// extractCdataOrText — поле в parsed XML может быть:
//   - string ("Заголовок")
//   - { "#cdata": "Заголовок" } (если был CDATA)
//   - { "#text": "..." } (редко при alwaysCreateTextNode)
//   - undefined / null (если тэга не было)
// Возвращает trimmed string ("" если нет данных).
// =============================================================================
function extractCdataOrText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["#cdata"] === "string") return (obj["#cdata"] as string).trim();
    if (typeof obj["#text"] === "string") return (obj["#text"] as string).trim();
  }
  return "";
}

// =============================================================================
// extractLink — RSS 2.0 имеет <link>https://...</link> (текстовый),
// Atom — <link href="https://..." rel="alternate" />. Для Atom возвращаем
// href от первого rel="alternate" (или просто первого href).
// =============================================================================
function extractLink(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (Array.isArray(node)) {
    // Atom: list of <link> tags. Берём rel="alternate" первый.
    for (const el of node) {
      if (el && typeof el === "object") {
        const obj = el as Record<string, unknown>;
        const rel = obj["@_rel"];
        const href = obj["@_href"];
        if (typeof href === "string" && (rel == null || rel === "alternate")) {
          return href.trim();
        }
      }
    }
    // Fallback: первый href какой угодно.
    for (const el of node) {
      if (el && typeof el === "object") {
        const obj = el as Record<string, unknown>;
        if (typeof obj["@_href"] === "string") return (obj["@_href"] as string).trim();
      }
    }
    return "";
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["@_href"] === "string") return (obj["@_href"] as string).trim();
    if (typeof obj["#text"] === "string") return (obj["#text"] as string).trim();
  }
  return "";
}

// =============================================================================
// parseRssDate — RSS 2.0 формат "Wed, 07 May 2026 09:00:00 +0300", Atom —
// ISO 8601 "2026-05-07T09:00:00+03:00". Date.parse() умеет оба. Возвращает
// валидный Date или null.
// =============================================================================
function parseRssDate(raw: string): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (isNaN(t)) return null;
  const d = new Date(t);
  // Защита от очевидно невалидных дат (1970-01-01 эпоха-zero, 9999 год).
  if (d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) return null;
  return d;
}

// =============================================================================
// stripHtml — RSS <description> часто содержит HTML-теги: <p>, <br>, <a>,
// inline-стили. Убираем теги, схлопываем whitespace, decode основные entities.
// =============================================================================
function stripHtml(s: string): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// normalizeItems — детектит RSS 2.0 vs Atom и возвращает плоский список
// NormalizedItem'ов. Любой малформированный item тихо отбрасывается с warn'ом.
// =============================================================================
export function normalizeFeedItems(parsed: unknown): NormalizedItem[] {
  if (!parsed || typeof parsed !== "object") return [];

  // RSS 2.0: { rss: { channel: { item: [...] | item } } }
  // Atom 1.0: { feed: { entry: [...] | entry } }
  const root = parsed as Record<string, unknown>;
  let rawItems: unknown[] = [];
  let detectedFormat: "rss" | "atom" | null = null;

  const rss = root["rss"];
  if (rss && typeof rss === "object") {
    const ch = (rss as Record<string, unknown>)["channel"];
    if (ch && typeof ch === "object") {
      const it = (ch as Record<string, unknown>)["item"];
      if (Array.isArray(it)) rawItems = it;
      else if (it != null) rawItems = [it];
      detectedFormat = "rss";
    }
  } else {
    const feed = root["feed"];
    if (feed && typeof feed === "object") {
      const en = (feed as Record<string, unknown>)["entry"];
      if (Array.isArray(en)) rawItems = en;
      else if (en != null) rawItems = [en];
      detectedFormat = "atom";
    }
  }

  if (detectedFormat == null) {
    log.warn(`[rss] unknown feed format — neither <rss><channel><item> nor <feed><entry> found`);
    return [];
  }

  const out: NormalizedItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;

    // RSS: title, description, link, pubDate.
    // Atom: title, summary (или content), link[], published (или updated).
    const title = extractCdataOrText(it["title"]);
    const description =
      extractCdataOrText(it["description"]) ||
      extractCdataOrText(it["summary"]) ||
      extractCdataOrText(it["content"]) ||
      extractCdataOrText(it["encoded"]); // <content:encoded> после removeNSPrefix → "encoded"
    const link = extractLink(it["link"]);
    const dateRaw =
      extractCdataOrText(it["pubDate"]) ||
      extractCdataOrText(it["published"]) ||
      extractCdataOrText(it["updated"]) ||
      extractCdataOrText(it["date"]); // dc:date → "date" после removeNSPrefix

    const pubDate = parseRssDate(dateRaw);
    if (!title) continue;
    if (!link) continue;
    if (!pubDate) {
      // Без даты не можем фильтровать — отбрасываем; на index'е будет
      // неотличимо от «нет в окне».
      continue;
    }

    out.push({
      title,
      description: stripHtml(description),
      link,
      pubDate,
    });
  }

  return out;
}

// =============================================================================
// linkToMessageId — стабильный non-zero числовой id из URL детальной страницы.
// Не используется для Telegram-deep-links (web Post.url ведёт на сайт, не на
// t.me), но даёт consistency с TG-постами и пригодится если in-run dedup
// по (channel, msgId) когда-либо включат для web. Берём первые 6 байт SHA-1
// как unsigned int (≤ 2^48, безопасно для JS Number).
// =============================================================================
function linkToMessageId(link: string): number {
  const h = createHash("sha1").update(link).digest();
  return h.readUIntBE(0, 6);
}

// =============================================================================
// fetchRssAsPosts — главная экспорт-функция модуля.
// Контракт:
//   - throw на любую catastrophic error (HTTP fail, broken XML), как fetchSite.
//   - возвращает [] (без throw), если feed валиден, но 0 items в окне свежести.
//   - text каждого Post = "title\n\ndescription" (вариант A; см. обсуждение).
//   - postedAt = pubDate.toISOString() (UTC).
//   - url = link (детальная страница).
//   - channelUsername = site.name (или hostname без www).
//   - messageId = stable hash(link).
// =============================================================================
export async function fetchRssAsPosts(site: WebsiteEntry): Promise<Post[]> {
  if (!site.rss) {
    throw new Error(`[rss] fetchRssAsPosts called without site.rss for ${site.url}`);
  }

  const rawWindow = process.env.WEB_RSS_WINDOW_HOURS;
  const parsedWindow = rawWindow ? parseInt(rawWindow, 10) : NaN;
  const windowHours =
    Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : DEFAULT_RSS_WINDOW_HOURS;
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  log.info(`[rss] fetch start: ${site.rss} (window=${windowHours}h, cutoff=${cutoff.toISOString()})`);

  // Reuse fetchSite — SSRF-safe, manual redirect, 10s timeout.
  const xml = await fetchSite(site.rss);
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch (err) {
    throw new Error(`[rss] XML parse failed for ${site.rss}: ${(err as Error).message}`);
  }

  const items = normalizeFeedItems(parsed);
  if (items.length === 0) {
    log.warn(`[rss] ${site.rss}: 0 valid items after normalize (broken feed or empty)`);
    return [];
  }

  const fresh = items.filter((it) => it.pubDate >= cutoff);
  const filtered = items.length - fresh.length;
  log.info(
    `[rss] ${site.rss}: total=${items.length} fresh=${fresh.length} filtered=${filtered} (older than ${windowHours}h)`
  );

  if (fresh.length === 0) return [];

  // Channel username — name (если задан) или hostname без www, симметрично
  // siteToPost в web-scraper.ts (D-03).
  let channelUsername: string;
  if (site.name) {
    channelUsername = site.name;
  } else {
    try {
      channelUsername = new URL(site.url).hostname.replace(/^www\./, "");
    } catch {
      channelUsername = site.url;
    }
  }

  const posts: Post[] = [];
  for (const it of fresh) {
    let text = it.description ? `${it.title}\n\n${it.description}` : it.title;
    if (text.length > RSS_ITEM_TEXT_CAP) {
      text = text.slice(0, RSS_ITEM_TEXT_CAP);
    }
    posts.push({
      channelUsername,
      messageId: linkToMessageId(it.link),
      postedAt: it.pubDate.toISOString(),
      text,
      url: it.link,
    });
  }
  return posts;
}
