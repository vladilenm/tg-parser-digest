// src/bitum/refineries.ts — словарь канонических НПЗ + lookup.
// BITUM-REFINERY-01/02: dict-аргументом, pure-функции, без module-level state.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "../paths.js";

// =============================================================================
// Schema.
// =============================================================================

const RefineryEntrySchema = z.object({
  canonical: z.string().min(1),
  company: z.string().min(1),
  aliases: z.array(z.string()),
});

const RefineriesDictSchema = z.object({
  version: z.number(),
  refineries: z.array(RefineryEntrySchema),
});

export type RefineryEntry = z.infer<typeof RefineryEntrySchema>;
export type RefineriesDict = z.infer<typeof RefineriesDictSchema>;

// =============================================================================
// Loader.
// =============================================================================

/**
 * Загружает refineries.json. Сначала из paths.dataDir, fallback на seed-каталог.
 * Zod-валидация. Throws если файл не найден / невалиден.
 */
export function loadRefineriesDict(): RefineriesDict {
  const candidates = [
    path.join(paths.dataDir, "refineries.json"),
    path.join(paths.dataDir, "config", "refineries.json"),
    path.resolve("./data/refineries.json"),
    path.resolve("./refineries.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      return RefineriesDictSchema.parse(parsed);
    }
  }
  throw new Error(
    `[refineries] dict not found in candidates: ${candidates.join(", ")}`
  );
}

// =============================================================================
// Lookup (pure, dict-аргументом).
// =============================================================================

/**
 * Нормализует имя НПЗ через словарь. Case-insensitive lookup по canonical+aliases.
 * Не найдено → возвращает trimmed raw + matched: false (НЕ throw, парсер продолжает).
 */
export function normalizeRefinery(
  raw: string,
  dict: RefineriesDict
): { canonical: string; matched: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { canonical: "", matched: false };
  const lc = trimmed.toLowerCase();
  for (const e of dict.refineries) {
    if (e.canonical.toLowerCase() === lc) {
      return { canonical: e.canonical, matched: true };
    }
    for (const a of e.aliases) {
      if (a.toLowerCase() === lc) {
        return { canonical: e.canonical, matched: true };
      }
    }
  }
  return { canonical: trimmed, matched: false };
}

/**
 * Возвращает company для canonical имени. Неизвестный canonical → "независимые".
 */
export function getCompany(canonical: string, dict: RefineriesDict): string {
  for (const e of dict.refineries) {
    if (e.canonical === canonical) return e.company;
  }
  return "независимые";
}
