// src/bitum/storage.ts — file storage layer для битум-pipeline v5.0.
// Расширяет src/upload/storage.ts: 5 типов (вместо 3) + WeekStatusV5 + resetWeek (TG-04).
// Wave 6 удалит src/upload/storage.ts.

import {
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { paths } from "../paths.js";
import type { KnownBitumType, WeekStatusV5 } from "./types.js";

const ISO_WEEK_FOLDER_RE = /^\d{4}-W\d{2}$/;

export function isoWeekFolder(d: Date): string {
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 86400000),
    );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function weekDir(week: string): string {
  return path.join(paths.dataDir, "uploads", week);
}

export async function saveUpload(
  buf: Buffer,
  type: KnownBitumType,
  week: string,
): Promise<string> {
  const dir = weekDir(week);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${type}.xlsx`);
  const tmp = finalPath + ".tmp";
  writeFileSync(tmp, buf);
  renameSync(tmp, finalPath);
  return finalPath;
}

/**
 * BITUM-TG-01: расширенный status checker для 5 типов.
 * MIGRATE-03: hasFcaSellers поддерживает legacy fca.xlsx как fallback.
 */
export function listWeekV5(week: string): WeekStatusV5 {
  const dir = weekDir(week);
  const status: WeekStatusV5 = {
    week,
    hasBirzhaPrices: existsSync(path.join(dir, "birzha_prices.xlsx")),
    hasBirzhaVolumes: existsSync(path.join(dir, "birzha_volumes.xlsx")),
    hasFcaSellers:
      existsSync(path.join(dir, "fca_sellers.xlsx")) ||
      existsSync(path.join(dir, "fca.xlsx")),
    hasAllPrices: existsSync(path.join(dir, "all_prices.xlsx")),
    hasBitumPriceNew: existsSync(path.join(dir, "bitum_price_new.xlsx")),
    lastRunAt: null,
    allPresent: false,
    presentCount: 0,
  };
  const lr = path.join(dir, ".last-run.json");
  if (existsSync(lr)) {
    try {
      const obj = JSON.parse(readFileSync(lr, "utf8")) as { runAt?: string };
      if (obj.runAt) {
        status.lastRunAt = obj.runAt;
      }
    } catch {
      /* malformed → null */
    }
  }
  status.presentCount = [
    status.hasBirzhaPrices,
    status.hasBirzhaVolumes,
    status.hasFcaSellers,
    status.hasAllPrices,
    status.hasBitumPriceNew,
  ].filter(Boolean).length;
  status.allPresent = status.presentCount === 5;
  return status;
}

export function findLatestWeekWithUploads(): string | null {
  const uploadsRoot = path.join(paths.dataDir, "uploads");
  if (!existsSync(uploadsRoot)) return null;
  let entries: string[];
  try {
    entries = readdirSync(uploadsRoot);
  } catch {
    return null;
  }
  const candidates: string[] = [];
  for (const name of entries) {
    if (!ISO_WEEK_FOLDER_RE.test(name)) continue;
    const dir = path.join(uploadsRoot, name);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    if (files.some((f) => f.endsWith(".xlsx"))) candidates.push(name);
  }
  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

export function writeLastRun(week: string, runAt: Date): void {
  const dir = weekDir(week);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, ".last-run.json");
  const tmp = finalPath + ".tmp";
  writeFileSync(tmp, JSON.stringify({ runAt: runAt.toISOString() }), "utf8");
  renameSync(tmp, finalPath);
}

/**
 * BITUM-TG-04: удаляет xlsx + .last-run.json в weekDir.
 * Возвращает list of deleted file basenames (для ответа оператору).
 * Не удаляет саму папку (idempotent — repeated reset на empty dir безопасен).
 */
export function resetWeek(week: string): string[] {
  const dir = weekDir(week);
  if (!existsSync(dir)) return [];
  const deleted: string[] = [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  for (const f of files) {
    // Удаляем только xlsx + .last-run.json (НЕ .gitkeep, не subdirs)
    if (f.endsWith(".xlsx") || f === ".last-run.json") {
      try {
        unlinkSync(path.join(dir, f));
        deleted.push(f);
      } catch {
        /* ignore */
      }
    }
  }
  return deleted;
}
