// src/web-posts-cache.ts — quick-260508-juw: same-day raw-posts cache for web pipeline.
//
// Why: each web-pipeline run successfully scrapes only ~17–19 of 33 sources, and the failing
// set varies between runs. Without a cache, info that appeared at 17:00 disappears at 18:00.
// This module persists every fresh post seen on the same MSK day to disk, so future runs
// the same day see the union of everything ever scraped.
//
// Layer boundary: this is RAW-post dedup keyed by sha256(url+"\n"+text). The existing
// data/hash-cache.json (delivered keyQuotes) is a separate, downstream layer — it remains
// untouched and continues to filter already-shipped items so the digest grows incrementally.
//
// File: data/web-posts-${MSK-date}.json — daily rotating, atomic-written via .tmp+rename
// (mirrors src/dedup.ts atomicWriteJson + src/archive.ts atomicWriteText pattern).
//
// No new runtime deps — only node:crypto, node:fs, node:path.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Post } from "./types.js";
import { log } from "./logger.js";
import { paths } from "./paths.js";

// =============================================================================
// Types
// =============================================================================

/** One entry as persisted on disk. `hash` is the composite-dedup key (sha256 hex of url+"\n"+text). */
export interface CachedWebPost {
  url: string;
  text: string;
  channelUsername: string;
  ts: string; // ISO 8601 — when this post FIRST entered the cache
  hash: string; // composite hash — denormalized for fast equality checks
}

interface CacheFile {
  version: number;
  msk_date: string;
  posts: CachedWebPost[];
}

const CURRENT_VERSION = 1;

// =============================================================================
// compositeHash — sha256 of url+"\n"+text. NOT routed through dedup.hashText
// (that one strips punctuation/lowercases/caps to 200ch — would alias different
// URLs and lose long-text differentiation). This is content-addressed equality,
// not "near-duplicate" matching.
// =============================================================================
export function compositeHash(url: string, text: string): string {
  return createHash("sha256").update(url + "\n" + text, "utf8").digest("hex");
}

// =============================================================================
// todayMsk — YYYY-MM-DD in Europe/Moscow (matches archive.ts/logger.ts/summarize.ts).
// Duplicated for now — defer extraction to a shared helper until ≥5 call sites
// (currently 4: archive.ts, logger via run.ts indirection, summarize.ts, here).
// =============================================================================
export function todayMsk(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// =============================================================================
// File path helper
// =============================================================================
function cachePath(mskDate: string): string {
  return paths.webPostsCache(mskDate);
}

// =============================================================================
// loadDailyWebPostsCache — returns [] silently if missing (normal first-run-of-day),
// log.warn + [] on corrupt/wrong-shape (never crashes the pipeline).
// =============================================================================
export function loadDailyWebPostsCache(mskDate: string): CachedWebPost[] {
  const path = cachePath(mskDate);
  if (!existsSync(path)) {
    return [];
  }
  let parsed: unknown;
  try {
    const raw = readFileSync(path, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(
      `[web-posts-cache] ${path}: parse error — ${(err as Error).message}, starting empty`
    );
    return [];
  }
  if (!parsed || typeof parsed !== "object") {
    log.warn(`[web-posts-cache] ${path}: not an object, starting empty`);
    return [];
  }
  const file = parsed as Partial<CacheFile>;
  if (file.version !== CURRENT_VERSION) {
    log.warn(
      `[web-posts-cache] ${path}: unsupported version=${file.version} (expected ${CURRENT_VERSION}), starting empty`
    );
    return [];
  }
  if (!Array.isArray(file.posts)) {
    log.warn(`[web-posts-cache] ${path}: posts is not an array, starting empty`);
    return [];
  }

  // Per-entry validation. Skip malformed entries with one aggregated warn.
  const valid: CachedWebPost[] = [];
  let skipped = 0;
  for (const entry of file.posts) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as CachedWebPost).url === "string" &&
      typeof (entry as CachedWebPost).text === "string" &&
      typeof (entry as CachedWebPost).channelUsername === "string" &&
      typeof (entry as CachedWebPost).ts === "string" &&
      typeof (entry as CachedWebPost).hash === "string"
    ) {
      valid.push(entry as CachedWebPost);
    } else {
      skipped++;
    }
  }
  if (skipped > 0) {
    log.warn(
      `[web-posts-cache] ${path}: skipped ${skipped} malformed entries, kept ${valid.length}`
    );
  }
  return valid;
}

// =============================================================================
// mergeWebPostsByCompositeHash — pure function. Existing entry on collision
// is preserved (its older `ts` is the answer to "when did this post first
// appear today?"). Fresh duplicates are dropped.
// =============================================================================
export function mergeWebPostsByCompositeHash(
  existing: CachedWebPost[],
  freshPosts: Post[]
): CachedWebPost[] {
  const map = new Map<string, CachedWebPost>();
  for (const e of existing) {
    map.set(e.hash, e);
  }
  const now = new Date().toISOString();
  for (const p of freshPosts) {
    const h = compositeHash(p.url, p.text);
    if (map.has(h)) continue; // preserve existing.ts (first-seen)
    map.set(h, {
      url: p.url,
      text: p.text,
      channelUsername: p.channelUsername,
      ts: now,
      hash: h,
    });
  }
  return Array.from(map.values());
}

// =============================================================================
// saveDailyWebPostsCache — atomic write via .tmp + renameSync (mirrors dedup.ts).
// =============================================================================
function atomicWriteJson(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

export function saveDailyWebPostsCache(mskDate: string, posts: CachedWebPost[]): void {
  const path = cachePath(mskDate);
  const file: CacheFile = {
    version: CURRENT_VERSION,
    msk_date: mskDate,
    posts,
  };
  atomicWriteJson(path, file);
  log.info(`[web-posts-cache] saved ${posts.length} posts to ${path}`);
}
