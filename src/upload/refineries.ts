// src/upload/refineries.ts — словарь канонических НПЗ + нормализация имён.
// Чистая логика: normalizeRefinery принимает словарь аргументом, без module-singleton'ов.

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
 *   1. ${DATA_DIR}/refineries.json — runtime-копия (если уже скопирован seed)
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
      throw new Error(
        `[refineries] ${p}: missing 'refineries' array`
      );
    }
    return parsed.refineries;
  }
  throw new Error(
    `[refineries] refineries.json not found in any of: ${candidates.join(", ")}`
  );
}

/**
 * Приводит сырое имя НПЗ к каноническому через словарь.
 * Сравнение case-insensitive, обрезает leading/trailing whitespace.
 * Если совпадение не найдено — возвращает trim(raw) (passthrough).
 * Если raw пустой/whitespace-only — возвращает raw без изменений (чтобы парсер мог его отфильтровать).
 *
 * IMPORTANT: pure-функция, dict передаётся аргументом — никаких module-level singleton'ов.
 */
export function normalizeRefinery(
  raw: string,
  dict: RefineryEntry[]
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

/**
 * Возвращает company-холдинг для канонического имени НПЗ.
 * Сравнение по точному совпадению canonical (case-insensitive).
 * Если canonical не найден в словаре — возвращает "независимые" (безопасный fallback,
 * чтобы analyzer.byCompany мог сгруппировать всё без NPE).
 *
 * Используется analyzer для byCompany и llm.ts для narrative.
 */
export function getCompany(
  canonical: string,
  dict: RefineryEntry[]
): string {
  const needle = canonical.trim().toLowerCase();
  for (const e of dict) {
    if (e.canonical.toLowerCase() === needle) return e.company;
  }
  return "независимые";
}
