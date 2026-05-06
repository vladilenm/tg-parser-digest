// src/web-scraper.ts — web-scraping pipeline для Phase 3 (v4.0).
// Параллельный аналог src/pipeline.ts: вместо GramJS читает websites.json и делает fetch+cheerio.
// Тот же two-pass DeepSeek pipeline через summarize(), отдельная доставка через sendToChannel.
// Архивы пишутся в data/raw/YYYY-MM-DD-web.json и data/output/YYYY-MM-DD-web.md.

import { readFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";
import type { Post, WebRunSummary } from "./types.js";
import { WebsitesFileSchema, isSafePublicUrl, type WebsiteEntry } from "./schema.js";
import { summarize, escapeHtml } from "./summarize.js";
import { sendToChannel } from "./deliver.js";
import { writeRawWeb, writeOutputWeb } from "./archive.js";
import { sendAlert } from "./alert.js";
import { log } from "./logger.js";

// D-23: путь захардкожен как константа, не из env.
export const WEBSITES_PATH = "./websites.json";

// D-04: hard cap на размер cleaned text перед отдачей в LLM.
const TEXT_CAP_CHARS = 8000;
// D-05: minimum для валидного сайта — на нормализованном тексте до cap'а.
const MIN_TEXT_CHARS = 200;
// D-16: timeout fetch (env override опционально).
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
// D-17: Chrome/120 UA для обхода bot-blockers на отраслевых сайтах.
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// =============================================================================
// loadWebsites — D-22, D-23: читать ./websites.json и Zod-валидировать.
// На invalid JSON / Zod fail → throw (ловится в runWebPipeline / tick()).
// =============================================================================
export function loadWebsites(): WebsiteEntry[] {
  if (!existsSync(WEBSITES_PATH)) {
    throw new Error(`[web-scraper] websites.json not found at ${WEBSITES_PATH}`);
  }
  const raw = readFileSync(WEBSITES_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[web-scraper] failed to parse ${WEBSITES_PATH}: ${(err as Error).message}`);
  }
  const validated = WebsitesFileSchema.parse(parsed);
  return validated.websites;
}

// =============================================================================
// fetchSite — D-15..D-18: native fetch с AbortController timeout, Chrome/120 UA, без retry.
// CR-01 / WR-07: redirect: "manual" + явная revalidation Location через isSafePublicUrl,
// чтобы публичный URL не мог open-redirect'ом увести fetch в private-network (SSRF).
// Ограничение: до 5 hop'ов, чтобы прерывать redirect-loop'ы и не висеть до timeout'а.
// На любой fail (network, abort, non-2xx, unsafe redirect) → throw, ловится
// Promise.allSettled в runWebPipeline.
// =============================================================================
const MAX_REDIRECT_HOPS = 5;

export async function fetchSite(url: string, timeoutMs?: number): Promise<string> {
  const ms = timeoutMs ?? Number(process.env.WEB_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS);
  const userAgent = process.env.WEB_USER_AGENT ?? DEFAULT_USER_AGENT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    let currentUrl = url;
    if (!isSafePublicUrl(currentUrl)) {
      throw new Error(`unsafe url (private/loopback/non-http): ${currentUrl}`);
    }
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await fetch(currentUrl, {
        method: "GET",
        headers: { "user-agent": userAgent, "accept": "text/html,*/*" },
        signal: controller.signal,
        redirect: "manual",
      });
      // 3xx → ручная revalidation Location.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(`HTTP ${res.status} without Location header`);
        }
        // Resolve relative redirects against currentUrl (как делает браузер).
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isSafePublicUrl(nextUrl)) {
          throw new Error(`unsafe redirect blocked: ${currentUrl} -> ${nextUrl}`);
        }
        if (hop === MAX_REDIRECT_HOPS) {
          throw new Error(`too many redirects (${MAX_REDIRECT_HOPS + 1}) starting from ${url}`);
        }
        currentUrl = nextUrl;
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    }
    // Недостижимо: цикл либо return'ит, либо throw'ит.
    throw new Error(`fetchSite: redirect loop exit without response (${url})`);
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// extractText — D-01, D-02, D-04: cheerio cleanup → cascade-select → .text() → normalize → cap.
// Cascade selectors (по порядку, берём первый непустой): [role=main] → article → main →
// .post-content → .entry-content → body.
// =============================================================================
export function extractText(html: string): string {
  const $ = cheerio.load(html);
  // D-02: cleanup ДО select. Удаляем меню/футеры/JS-мусор.
  $("script, style, noscript, nav, header, footer, aside, iframe").remove();

  // D-01: cascade-селектор.
  const selectors = ['[role="main"]', "article", "main", ".post-content", ".entry-content", "body"];
  let raw = "";
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const t = el.text();
    if (t && t.trim().length > 0) {
      raw = t;
      break;
    }
  }

  // Normalize: collapse all whitespace to single spaces.
  const normalized = raw.replace(/\s+/g, " ").trim();

  // D-04: hard cap 8000 chars.
  if (normalized.length > TEXT_CAP_CHARS) {
    log.info(
      `[web-scraper] text capped from ${normalized.length} to ${TEXT_CAP_CHARS} chars`
    );
    return normalized.slice(0, TEXT_CAP_CHARS);
  }
  return normalized;
}

// =============================================================================
// siteToPost — D-03, D-05: один сайт = один Post; null если text.length < 200.
// channelUsername: name (если задан) или hostname без префикса www.
// messageId: 0 (нет cross-run dedup для web в Phase 3, WEB-06 deferred).
// =============================================================================
export function siteToPost(site: WebsiteEntry, text: string): Post | null {
  if (text.length < MIN_TEXT_CHARS) {
    log.warn(
      `[web-scraper] ${site.url}: text too short (${text.length} < ${MIN_TEXT_CHARS} chars) — skipping`
    );
    return null;
  }
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
  return {
    channelUsername,
    messageId: 0,
    postedAt: new Date().toISOString(),
    text,
    url: site.url,
  };
}

// =============================================================================
// formatDateRu — D-10: тот же формат «6 мая 2026 г.» что в TG-сводке.
// Дублируем (не импортируем) — formatDateRu в summarize.ts private (line 90).
// Вынос в общий helper отложен — tiny-копия проще, чем модулировать ради 8 строк.
// =============================================================================
function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

// =============================================================================
// buildWebHeader — D-10, D-11: web-специфичные заголовок и субзаголовок.
// header: <b>🌐 Веб-источники — {date}</b>
// subheader: <i>X сайтов из Y обработано</i>
// =============================================================================
function buildWebHeader(succeeded: number, total: number): string {
  const date = formatDateRu(new Date().toISOString());
  return (
    `<b>🌐 Веб-источники — ${escapeHtml(date)}</b>\n` +
    `<i>${succeeded} сайтов из ${total} обработано</i>\n\n`
  );
}

// =============================================================================
// buildPlaceholderHtml — D-13: technical-fail placeholder.
// Шлём в канал даже при 0 валидных сайтах, чтобы Заказчик видел «прогон был».
// 5 пустых секций + блок mentions, симметрично пустой TG-сводке.
// =============================================================================
function buildPlaceholderHtml(total: number): string {
  const header = buildWebHeader(0, total);
  const sections = [
    "<b>🚢 Бункер</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>🛢 Масла</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>✈️ Керосин</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>⚗️ Нефтехимия</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>🛣 Битум</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>🏢 Упоминания компаний</b>\n<i>— нет упоминаний за сутки</i>",
  ];
  return header + sections.join("\n\n");
}

// =============================================================================
// composeWebDigest — D-12: вставить web-заголовок (D-10/D-11) в начало body
// от summarize().html, заменив TG-заголовок «Нефтегаз — {date}» который рендерит renderHtml().
// summarize() возвращает полный HTML с шапкой; нам нужен body без неё, плюс свой web-header.
// Стратегия: split по первому `\n\n` (граница header→body в renderHtml), отбрасываем первую часть.
//
// EXPORTED (не private) — чтобы Plan 04 unit-тестами зафиксировал контракт:
//   (1) результат начинается с web-header,
//   (2) body секций сохраняется,
//   (3) TG-заголовок «Нефтегаз —» НЕ присутствует.
// Если будущий рефактор summarize.renderHtml изменит структуру — тест поломается заметно
// (а не silent breakage в проде).
// =============================================================================
export function composeWebDigest(summarizedHtml: string, succeeded: number, total: number): string {
  // renderHtml формат (summarize.ts:199-226): "<b>...</b>\n<i>...</i>\n\n<b>🚢 Бункер</b>..." — отделяем body после первого `\n\n`.
  const sep = "\n\n";
  const idx = summarizedHtml.indexOf(sep);
  const body = idx >= 0 ? summarizedHtml.slice(idx + sep.length) : summarizedHtml;
  return buildWebHeader(succeeded, total) + body;
}

// =============================================================================
// runWebPipeline — D-06: точка входа для tick(). Возвращает WebRunSummary.
// Контракт: НЕ throw на per-site fail (Promise.allSettled), throw только на катастрофу
// (broken websites.json, summarize() crash). tick() обернёт в try/catch (см. Plan 03).
// =============================================================================
export async function runWebPipeline(runId: string): Promise<WebRunSummary> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: string[] = [];

  const websites = loadWebsites();
  log.info(`[web-scraper] runId=${runId} websites=${websites.length}`);

  // D-15: параллельный fetch через Promise.allSettled — изолирует одиночные падения.
  const results = await Promise.allSettled(
    websites.map(async (site) => {
      const html = await fetchSite(site.url);
      const text = extractText(html);
      return { site, text };
    })
  );

  const posts: Post[] = [];
  let websitesSkipped = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const site = websites[i]!;
    if (r.status === "rejected") {
      // D-18: no retry — log + skip + counter.
      const msg = (r.reason as Error)?.message ?? String(r.reason);
      log.warn(`[web-scraper] ${site.url}: ${msg}`);
      errors.push(`${site.url}: ${msg}`);
      websitesSkipped++;
      continue;
    }
    const post = siteToPost(site, r.value.text);
    if (post === null) {
      // D-05: text too short — already logged inside siteToPost.
      websitesSkipped++;
      continue;
    }
    posts.push(post);
  }

  const websitesSucceeded = posts.length;
  log.info(
    `[web-scraper] runId=${runId} succeeded=${websitesSucceeded} skipped=${websitesSkipped}`
  );

  // D-20 step 1: пишем raw СРАЗУ, ДО summarize/dedup/LLM (инвариант «сырое сохранено»).
  writeRawWeb(posts, runId);

  let digestDelivered = false;
  let itemsDropped = 0;

  // D-13 (technical fail): все сайты пропустились — placeholder + alert.
  if (websitesSucceeded === 0 && websites.length > 0) {
    const placeholder = buildPlaceholderHtml(websites.length);
    log.warn(
      `[web-scraper] runId=${runId} all ${websites.length} sites skipped or failed — sending placeholder`
    );
    await sendToChannel(placeholder);
    writeOutputWeb(placeholder, runId);
    digestDelivered = true;
    // Параллельный alert оператору в личку.
    try {
      await sendAlert({
        stage: "web",
        message: `all ${websites.length} sites skipped or failed`,
        runId,
      });
    } catch (alertErr) {
      log.error("[web-scraper] alert send failed", alertErr);
    }
  } else if (websitesSucceeded > 0) {
    // D-19: summarize() переиспользуется как есть, verifyExtractiveness внутри.
    const { html, postsDropped } = await summarize(posts);
    itemsDropped = postsDropped;

    // D-14 (content miss): LLM ничего не нашёл — silence в канале.
    // summarize() возвращает HTML с пустыми секциями всегда; нам нужно отличить
    // «есть items» от «все пустые». Проверяем наличие `• ` в html (буллет item'а).
    const hasAnyItem = html.includes("• ");
    if (!hasAnyItem) {
      log.info(
        `[web-scraper] runId=${runId} no relevant content — silence in channel (D-14)`
      );
    } else {
      const finalHtml = composeWebDigest(html, websitesSucceeded, websites.length);
      await sendToChannel(finalHtml);
      writeOutputWeb(finalHtml, runId);
      digestDelivered = true;
      log.info(`[web-scraper] runId=${runId} web-digest delivered`);
    }
  } else {
    // websites.length === 0 — schema gate (.min(1)) этого не допускает, но для безопасности.
    log.info(`[web-scraper] runId=${runId} no websites configured — skipping`);
  }

  const finishedAt = new Date().toISOString();
  return {
    runId,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    websitesTotal: websites.length,
    websitesSucceeded,
    websitesSkipped,
    itemsCollected: websitesSucceeded,
    itemsDropped,
    digestDelivered,
    errors,
  };
}
