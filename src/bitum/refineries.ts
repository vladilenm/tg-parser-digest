// src/bitum/refineries.ts — словарь канонических НПЗ + нормализация имён.
// Перенесено из src/upload/refineries.ts (wave 6 migration). API сохраняется 1:1.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { paths } from "../paths.js";
import type { RefineryEntry } from "./types.js";

interface RefineriesFile {
  version: number;
  refineries: RefineryEntry[];
}

/**
 * Возвращает список канонических НПЗ из data/refineries.json.
 * Поиск в порядке:
 *   1. ${DATA_DIR}/refineries.json — runtime-копия
 *   2. ./data/refineries.json (repo root) — fallback на seed
 * Если оба отсутствуют — throw.
 */
export function loadRefineries(): RefineryEntry[] {
  const candidates = [
    path.join(paths.dataDir, "refineries.json"),
    path.resolve("./data/refineries.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as RefineriesFile;
    if (!Array.isArray(parsed.refineries)) {
      throw new Error(`[refineries] ${p}: missing 'refineries' array`);
    }
    return parsed.refineries;
  }
  throw new Error(
    `[refineries] refineries.json not found in any of: ${candidates.join(", ")}`,
  );
}

/**
 * Pure-функция: dict передаётся аргументом, без module-level singleton'ов.
 */
export function normalizeRefinery(
  raw: string,
  dict: RefineryEntry[],
): string {
  const needle = raw.trim().toLowerCase();
  if (!needle) return raw;
  for (const e of dict) {
    if (e.canonical.toLowerCase() === needle) return e.canonical;
    for (const a of e.aliases) {
      if (a.toLowerCase() === needle) return e.canonical;
    }
  }
  return raw.trim();
}

export function getCompany(
  canonical: string,
  dict: RefineryEntry[],
): string {
  const needle = canonical.trim().toLowerCase();
  for (const e of dict) {
    if (e.canonical.toLowerCase() === needle) return e.company;
  }
  return "независимые";
}
