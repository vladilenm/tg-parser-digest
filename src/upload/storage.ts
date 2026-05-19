// src/upload/storage.ts — файловая прослойка для xlsx-загрузок.
// Все upload'ы складываются в ${DATA_DIR}/uploads/<ISO-week>/<type>.xlsx.
// Атомарная запись (writeFile + rename) — паттерн из src/channels-store.ts:57-63.

import {
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { paths } from "../paths.js";
import type { UploadType } from "./types.js";

/** Regex для матчинга ISO-week-папки формата YYYY-Www (padded). */
const ISO_WEEK_FOLDER_RE = /^\d{4}-W\d{2}$/;

/**
 * ISO 8601 week (Thursday-rule), формат "YYYY-Www".
 * Алгоритм: сдвигаемся на ближайший четверг → год этого четверга = ISO year;
 * номер недели = round((thursday - firstThursdayOfYear) / 7) + 1.
 */
export function isoWeekFolder(d: Date): string {
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0, Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // nearest Thursday
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 86400000)
    );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Папка недели: ${DATA_DIR}/uploads/<YYYY-Www>. */
export function weekDir(week: string): string {
  return path.join(paths.dataDir, "uploads", week);
}

/**
 * Атомарно сохранить xlsx-buffer как <weekDir>/<type>.xlsx.
 * Создаёт промежуточные директории. Возвращает финальный путь.
 */
export async function saveUpload(
  buf: Buffer,
  type: UploadType,
  week: string
): Promise<string> {
  const dir = weekDir(week);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${type}.xlsx`);
  const tmp = finalPath + ".tmp";
  writeFileSync(tmp, buf);
  renameSync(tmp, finalPath);
  return finalPath;
}

export interface WeekStatus {
  hasPrices: boolean;
  hasVolumes: boolean;
  hasFca: boolean;
  lastRunAt: Date | null;
}

/**
 * Возвращает флаги наличия каждого типа xlsx в папке недели + lastRunAt
 * из .last-run.json (null если файл отсутствует или malformed).
 */
export function listWeek(week: string): WeekStatus {
  const dir = weekDir(week);
  const status: WeekStatus = {
    hasPrices: existsSync(path.join(dir, "birzha_prices.xlsx")),
    hasVolumes: existsSync(path.join(dir, "birzha_volumes.xlsx")),
    hasFca: existsSync(path.join(dir, "fca.xlsx")),
    lastRunAt: null,
  };
  const lr = path.join(dir, ".last-run.json");
  if (existsSync(lr)) {
    try {
      const obj = JSON.parse(readFileSync(lr, "utf8")) as {
        runAt?: string;
      };
      if (obj.runAt) {
        const d = new Date(obj.runAt);
        if (!Number.isNaN(d.getTime())) status.lastRunAt = d;
      }
    } catch {
      // Malformed JSON — silently treat as no timestamp.
    }
  }
  return status;
}

/**
 * Сканирует `${DATA_DIR}/uploads/` и возвращает имя последней (lex-max) папки
 * формата `YYYY-Www`, в которой лежит хотя бы один `.xlsx` файл.
 *
 * Используется `/summarize` и `/upload_status` для разрешения «недели данных»:
 * `handleDocument` сохраняет в неделю latest-даты файла (например, 2026-W19), а
 * MSK-неделя «сейчас» может быть уже другой (2026-W21). Чтобы read-путь нашёл
 * данные, ищем самую свежую неделю на диске и возвращаем её. Fallback на
 * `currentMskWeek()` остаётся на стороне вызова при `null`.
 *
 * Правила фильтрации:
 * - имя папки строго `YYYY-Www` (e.g. "2026-W19"), padded — для lex-сортировки;
 * - содержимое: ≥1 `.xlsx` файл; `.last-run.json` / `.DS_Store` / прочее не
 *   считаются данными;
 * - если `uploads/` отсутствует / пустая / нет ни одной валидной недели → `null`.
 */
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
    const hasXlsx = files.some((f) => f.endsWith(".xlsx"));
    if (hasXlsx) candidates.push(name);
  }
  if (candidates.length === 0) return null;
  // Lex-max работает корректно: формат `YYYY-Www` padded двузначной неделей.
  candidates.sort();
  return candidates[candidates.length - 1];
}

/**
 * Атомарно записать .last-run.json с timestamp прогона анализа.
 */
export function writeLastRun(week: string, runAt: Date): void {
  const dir = weekDir(week);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, ".last-run.json");
  const tmp = finalPath + ".tmp";
  writeFileSync(tmp, JSON.stringify({ runAt: runAt.toISOString() }), "utf8");
  renameSync(tmp, finalPath);
}
