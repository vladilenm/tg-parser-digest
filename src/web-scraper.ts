// src/web-scraper.ts — web-scraping pipeline для Phase 3 (v4.0).
// Параллельный аналог src/pipeline.ts: вместо GramJS читает websites.json и делает fetch+cheerio.
// Тот же two-pass DeepSeek pipeline через summarize(), отдельная доставка через sendToChannel.
// Архивы пишутся в data/raw/YYYY-MM-DD-web.json и data/output/YYYY-MM-DD-web.md.

import { readFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";
import type { Post, WebRunSummary } from "./types.js";
import { WebsitesFileSchema, type WebsiteEntry } from "./schema.js";
import { summarize } from "./summarize.js";
import { sendToChannel } from "./deliver.js";
import { writeRawWeb, writeOutputWeb } from "./archive.js";
import { sendAlert } from "./alert.js";
import { log } from "./logger.js";
// NOTE: HTML-escape helper НЕ импортируется в Task 1 — он добавится в Task 2 при добавлении buildWebHeader.

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
// На любой fail (network, abort, non-2xx) → throw, ловится Promise.allSettled в runWebPipeline.
// =============================================================================
export async function fetchSite(url: string, timeoutMs?: number): Promise<string> {
  const ms = timeoutMs ?? Number(process.env.WEB_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS);
  const userAgent = process.env.WEB_USER_AGENT ?? DEFAULT_USER_AGENT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "user-agent": userAgent, "accept": "text/html,*/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
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

// (продолжение — runWebPipeline + buildWebHeader + composeWebDigest в Task 2)
