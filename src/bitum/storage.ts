// src/bitum/storage.ts — ISO-week storage для битум-pipeline (D-19, D-20).
// Per-week mutex + atomic .tmp + rename (паттерн channels-store.ts).
// T-04-03: path-traversal mitigation — type только из BITUM_TYPES.
// T-04-05: per-week mutex сериализует saveXlsx + resetWeek.

import {
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { paths } from "../paths.js";
import { log } from "../logger.js";
import { BITUM_TYPES, type BitumType, type WeekStatus } from "./types.js";

// =============================================================================
// ISO 8601 week (Thursday-rule).
// =============================================================================

/**
 * Возвращает `YYYY-Www` по ISO 8601 Thursday-rule.
 * Example: 2026-05-12 (вт) → "2026-W20".
 */
export function isoWeekFolder(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // Set to nearest Thursday: current date + 4 - current day number
  // (where Sunday = 7 to match ISO).
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Возвращает абсолютный путь к каталогу недели.
 */
export function weekDir(week: string): string {
  return path.join(paths.dataDir, "uploads", week);
}

// =============================================================================
// Per-week mutex.
// =============================================================================

const locks = new Map<string, Promise<void>>();

/**
 * Сериализация операций по ключу week. Паттерн channels-store.ts:withLock,
 * но per-key для изоляции concurrent uploads разных недель.
 */
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
// Save xlsx + reset week.
// =============================================================================

/**
 * Сохранить xlsx-файл для типа `type` в неделю `week`. Атомарная запись через
 * `.tmp + rename`, под per-week mutex. Silent overwrite (D-07).
 *
 * T-04-03: type только из BITUM_TYPES literal union (path-traversal mitigation).
 *
 * Default (нужно подтверждение оператора на execute-phase):
 *  - silent overwrite + log.info при дубликате типа
 */
export function saveXlsx(
  week: string,
  type: BitumType,
  buffer: Buffer
): Promise<void> {
  // T-04-03: assert before path.join.
  if (!BITUM_TYPES.includes(type)) {
    throw new Error(`[bitum-storage] invalid type: ${String(type)}`);
  }
  return withWeekLock(week, async () => {
    const dir = weekDir(week);
    mkdirSync(dir, { recursive: true });
    const finalPath = path.join(dir, `${type}.xlsx`);
    let prevSize: number | null = null;
    if (existsSync(finalPath)) {
      try {
        prevSize = statSync(finalPath).size;
      } catch {
        prevSize = null;
      }
    }
    const tmpPath = finalPath + ".tmp";
    writeFileSync(tmpPath, buffer);
    renameSync(tmpPath, finalPath);
    if (prevSize !== null) {
      log.info(
        `[bitum-storage] overwrite: week=${week} type=${type} prevSize=${prevSize} newSize=${buffer.length}`
      );
    } else {
      log.info(
        `[bitum-storage] saved: week=${week} type=${type} size=${buffer.length}`
      );
    }
  });
}

/**
 * Удалить каталог недели целиком. Возвращает список удалённых basename'ов.
 * Под per-week mutex (T-04-05).
 */
export function resetWeek(
  week: string
): Promise<{ deletedFiles: string[] }> {
  return withWeekLock(week, async () => {
    const dir = weekDir(week);
    if (!existsSync(dir)) return { deletedFiles: [] };
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      entries = [];
    }
    rmSync(dir, { recursive: true, force: true });
    log.info(
      `[bitum-storage] reset: week=${week} deleted=${entries.length}`
    );
    return { deletedFiles: entries };
  });
}

// =============================================================================
// Week status.
// =============================================================================

/**
 * Чек-лист недели: какие из 4 типов xlsx присутствуют, сколько ручных чисел.
 * lastUpdatedAt — самый поздний mtime из присутствующих файлов; null если пусто.
 */
export async function getWeekStatus(week: string): Promise<WeekStatus> {
  const dir = weekDir(week);
  const present: Record<BitumType, boolean> = {
    birzha_volumes: false,
    birzha_prices: false,
    fca_sellers: false,
    bitum_price_new: false,
  };
  let lastUpdatedAt: string | null = null;
  if (existsSync(dir)) {
    for (const type of BITUM_TYPES) {
      const filePath = path.join(dir, `${type}.xlsx`);
      if (existsSync(filePath)) {
        present[type] = true;
        try {
          const m = statSync(filePath).mtime.toISOString();
          if (!lastUpdatedAt || m > lastUpdatedAt) lastUpdatedAt = m;
        } catch {
          // ignore — статус "present" остаётся
        }
      }
    }
  }
  // Manual numbers count (defensive, read без mutex'а).
  let manualNumbersCount = 0;
  const manualPath = path.join(dir, "manual-numbers.json");
  if (existsSync(manualPath)) {
    try {
      const raw = readFileSync(manualPath, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) manualNumbersCount = arr.length;
      // mtime тоже считаем "обновлением"
      const m = statSync(manualPath).mtime.toISOString();
      if (!lastUpdatedAt || m > lastUpdatedAt) lastUpdatedAt = m;
    } catch {
      manualNumbersCount = 0;
    }
  }
  return { week, present, manualNumbersCount, lastUpdatedAt };
}

/**
 * Возвращает максимальную (lexically = chronologically для ISO-week) неделю,
 * у которой есть хотя бы один из 4 битум-xlsx файлов. Null если ничего нет.
 */
export function findLatestWeekWithUploads(): string | null {
  const root = path.join(paths.dataDir, "uploads");
  if (!existsSync(root)) return null;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  const weekRegex = /^\d{4}-W\d{2}$/;
  const candidates = entries
    .filter((e) => weekRegex.test(e))
    .sort()
    .reverse();
  for (const w of candidates) {
    const dir = path.join(root, w);
    for (const type of BITUM_TYPES) {
      if (existsSync(path.join(dir, `${type}.xlsx`))) {
        return w;
      }
    }
  }
  return null;
}
