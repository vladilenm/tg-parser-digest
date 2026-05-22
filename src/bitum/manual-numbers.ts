// src/bitum/manual-numbers.ts — ручные числа для /bitum_add (D-14..D-17).
// Storage: ${weekDir(week)}/manual-numbers.json — плоский массив ManualNumber[] (D-15 default).
// T-04-04: in-process mutex per-week + atomic .tmp + rename.
// T-04-06 sanitize: strip control chars + length cap 200 char (escape — в reporter.ts).

import {
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { weekDir } from "./storage.js";
import type { ManualNumber } from "./types.js";

// =============================================================================
// Per-week mutex (локальная Map — модули независимы от storage.ts).
// =============================================================================

const locks = new Map<string, Promise<void>>();

function withWeekLock<T>(week: string, op: () => Promise<T>): Promise<T> {
  const prev = locks.get(week) ?? Promise.resolve();
  const result = prev.then(op, op);
  locks.set(
    week,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

// =============================================================================
// Sanitize (T-04-06 — control chars + length cap).
// =============================================================================

const MAX_FIELD_LEN = 200;

function sanitize(s: string): string {
  // Strip ASCII control chars (0x00-0x1F, 0x7F) — НЕ удаляем HTML-теги (это
  // задача escapeHtml в reporter.ts).
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F]+/g, "").trim().slice(0, MAX_FIELD_LEN);
}

// =============================================================================
// Path helper.
// =============================================================================

function manualNumbersPath(week: string): string {
  return path.join(weekDir(week), "manual-numbers.json");
}

// =============================================================================
// Public API.
// =============================================================================

/**
 * Добавить пару label+value в manual-numbers.json. Append-only, sanitize применяется
 * перед записью. Возвращает добавленный ManualNumber (с ISO addedAt).
 */
export function addManualNumber(
  week: string,
  label: string,
  value: string
): Promise<ManualNumber> {
  return withWeekLock(week, async () => {
    const cleanLabel = sanitize(label);
    const cleanValue = sanitize(value);
    const entry: ManualNumber = {
      label: cleanLabel,
      value: cleanValue,
      addedAt: new Date().toISOString(),
    };
    const dir = weekDir(week);
    mkdirSync(dir, { recursive: true });
    const filePath = manualNumbersPath(week);
    let existing: ManualNumber[] = [];
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) existing = parsed;
      } catch {
        existing = [];
      }
    }
    const next = [...existing, entry];
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    renameSync(tmp, filePath);
    return entry;
  });
}

/**
 * Прочитать все ручные числа недели. Defensive: отсутствие/невалидный JSON → [].
 * БЕЗ mutex'а (read-only).
 */
export async function listManualNumbers(
  week: string
): Promise<ManualNumber[]> {
  const filePath = manualNumbersPath(week);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

/**
 * Удалить manual-numbers.json целиком (D-17 — /bitum_reset обнуляет xlsx + ручные числа).
 * Под mutex.
 */
export function clearManualNumbers(week: string): Promise<void> {
  return withWeekLock(week, async () => {
    const filePath = manualNumbersPath(week);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // file gone between exists and unlink — ok
      }
    }
  });
}
