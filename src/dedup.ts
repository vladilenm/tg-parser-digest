// src/dedup.ts — кросс-прогонная дедупа через SHA-256 hash-cache.
// DEDUP-01: нормализация text → SHA-256 → ключ дедупа.
// DEDUP-02: hash-cache.json rolling 14 дней, атомарная запись через .tmp + rename.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Post } from "./types.js";
import { log } from "./logger.js";
import { paths } from "./paths.js";

const TTL_DAYS = Number(process.env.HASH_CACHE_TTL_DAYS ?? 14);
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

interface HashEntry {
  hash: string;
  ts: string; // ISO 8601 — момент попадания в cache
}

interface HashCacheFile {
  entries: HashEntry[];
}

/** DEDUP-01: lowercase, удаление эмодзи (Extended_Pictographic), удаление пунктуации, обрезка до 200 chars. */
export function normalize(text: string): string {
  let n = text.toLowerCase();
  // Убираем эмодзи (Unicode property Extended_Pictographic, требует Node 20+).
  n = n.replace(/\p{Extended_Pictographic}/gu, "");
  // Убираем пунктуацию (Unicode property Punctuation).
  n = n.replace(/\p{P}/gu, "");
  // Сжимаем whitespace.
  n = n.replace(/\s+/g, " ").trim();
  // Первые 200 символов.
  return n.slice(0, 200);
}

/** DEDUP-01: SHA-256 hex от нормализованного текста. */
export function hashText(text: string): string {
  return createHash("sha256").update(normalize(text), "utf8").digest("hex");
}

/** DEDUP-02: атомарная запись через .tmp + rename. */
function atomicWriteJson(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

/**
 * DEDUP-02: загружаем hash-cache.json, фильтруем записи старше TTL_DAYS.
 * Если файла нет или повреждён — возвращаем пустой Set + log.warn.
 */
export function loadHashCache(): Set<string> {
  if (!existsSync(paths.hashCache)) {
    return new Set();
  }
  try {
    const raw = readFileSync(paths.hashCache, "utf8");
    const parsed = JSON.parse(raw) as HashCacheFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      log.warn(`[dedup] hash-cache: невалидная структура, начинаем заново`);
      return new Set();
    }
    const cutoff = Date.now() - TTL_MS;
    const fresh = parsed.entries.filter((e) => {
      const t = new Date(e.ts).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
    return new Set(fresh.map((e) => e.hash));
  } catch (err) {
    log.warn(`[dedup] hash-cache: parse error — ${(err as Error).message}, начинаем заново`);
    return new Set();
  }
}

/**
 * DEDUP-02: сохраняем hash-cache на диск; объединяем существующий fresh-set с новыми хешами.
 * Атомарная запись через .tmp + rename.
 */
export function saveHashCache(existing: Set<string>, newHashes: string[]): void {
  const now = new Date().toISOString();
  // existing — уже отфильтрован на load, в нём только свежие за TTL_DAYS.
  // Им присваивать "сейчас" не имеет смысла — нужен исходный ts.
  // Поэтому при save мы перезагружаем raw-файл, фильтруем как в load (по ts), и добавляем новые.
  let preserved: HashEntry[] = [];
  if (existsSync(paths.hashCache)) {
    try {
      const raw = readFileSync(paths.hashCache, "utf8");
      const parsed = JSON.parse(raw) as HashCacheFile;
      if (parsed && Array.isArray(parsed.entries)) {
        const cutoff = Date.now() - TTL_MS;
        preserved = parsed.entries.filter((e) => {
          const t = new Date(e.ts).getTime();
          return Number.isFinite(t) && t >= cutoff;
        });
      }
    } catch {
      // Игнорируем — preserved останется пустым.
    }
  }
  const additions: HashEntry[] = newHashes.map((h) => ({ hash: h, ts: now }));
  const merged: HashCacheFile = { entries: [...preserved, ...additions] };
  atomicWriteJson(paths.hashCache, merged);
}

/**
 * DEDUP-01: фильтрует posts — оставляет те, чей hash отсутствует в cache.
 * Возвращает { fresh, hits } — fresh идут дальше в LLM, hits — счётчик дедупов.
 */
export function dedupAgainstCache(
  posts: Post[],
  runId: string
): { fresh: Post[]; hits: number; freshHashes: string[] } {
  const cache = loadHashCache();
  const fresh: Post[] = [];
  const freshHashes: string[] = [];
  let hits = 0;
  for (const p of posts) {
    const h = hashText(p.text);
    if (cache.has(h)) {
      hits++;
      continue;
    }
    fresh.push(p);
    freshHashes.push(h);
  }
  log.info(`[dedup] runId=${runId} cache=${cache.size} fresh=${fresh.length} hits=${hits}`);
  return { fresh, hits, freshHashes };
}

/**
 * Вызывается ПОСЛЕ успешной доставки (D-09: hash-cache «съедает» только реально доставленные).
 */
export function commitHashCache(freshHashes: string[], runId: string): void {
  const existing = loadHashCache();
  saveHashCache(existing, freshHashes);
  log.info(`[dedup] runId=${runId} commit hash-cache: +${freshHashes.length} entries`);
}
