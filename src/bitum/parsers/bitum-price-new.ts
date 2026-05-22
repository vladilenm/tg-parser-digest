// src/bitum/parsers/bitum-price-new.ts — парсер «Битум прайс» (sводная таблица).
// algoritm.md §4 + базовый файл verified 2026-05-22 (нет _rev для этого типа):
//   Sheet "Chart data", rowCount=36, columnCount=9
//   A1..I1 headers:
//     A "Дата", B "Пункт отгрузки", C "Компания", D "Вид базиса", E "Вид цен",
//     F "БНД - Цена недели", G "БНД - Изменение", H "ПБВ - Цена недели", I "ПБВ - Изменение"
//   row 2..N — данные (даты + НПЗ + компания + БНД-цена + БНД-изменение)
// Цены приходят как СТРОКИ ("31250"); изменения — "не изм." / "▲ (+2000)" / "▼ (-500)".
// Pure pass-through company (D-CLAUDE.md): берём company прямо из C-колонки.

import { z } from "zod";
import {
  BITUM_MAX_ROWS,
  loadFirstSheet,
  excelDateToIso,
  cellString,
} from "./shared.js";
import type { RefineriesDict } from "../refineries.js";
import { normalizeRefinery } from "../refineries.js";
import type {
  ParsedBitumPriceNewRow,
  ParserError,
  ParserResult,
} from "../types.js";

// Default — нужно подтверждение оператора на execute-phase: координаты verified
// 2026-05-22 на базовом файле (без _rev для этого типа).
const HEADER_ROW = 1;
const COL_DATE = 1; // A
const COL_REFINERY = 2; // B (Пункт отгрузки)
const COL_COMPANY = 3; // C
const COL_PRICE_BND = 6; // F (БНД - Цена недели)
const COL_DELTA_BND = 7; // G (БНД - Изменение)

const RowSchema = z.object({
  date: z.string().min(8),
  refineryCanonical: z.string(),
  refineryRaw: z.string(),
  company: z.string(),
  priceRub: z.number().nonnegative(),
  deltaWeek: z.number(),
});

/**
 * Parse "не изм." / "▲ (+2000)" / "▼ (-500)" / "+1500" / "-500" / "2000" → number.
 * "не изм." / пусто → 0.
 */
function parseDelta(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  if (/не\s*изм/i.test(s)) return 0;
  // Strip ▲ ▼ + ( ) and spaces.
  const cleaned = s
    .replace(/[▲▼()]/g, "")
    .replace(/[\s ]+/g, "")
    .replace(",", ".");
  const m = /(-?\+?\d+(?:\.\d+)?)/.exec(cleaned);
  if (!m) return 0;
  const n = Number(m[1].replace("+", ""));
  if (!Number.isFinite(n)) return 0;
  // Sign: если в raw встретился ▼ или явный - → negative, иначе positive по умолчанию.
  if (/▼/.test(s) || /-/.test(cleaned.replace(/^\+/, ""))) {
    return -Math.abs(n);
  }
  return n;
}

/**
 * Parse price string "31250" / "31,250" (RU thousands separator) / "31250.5" / 31250 → number.
 * Логика: запятая = тысячный разделитель если за ней идёт 3 цифры подряд И нет десятичной точки;
 * иначе запятая = десятичный разделитель (RU локаль).
 */
function parsePrice(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // Уберём пробелы (включая non-breaking) — это всегда thousands separator.
  let cleaned = s.replace(/[\s  ]/g, "");
  // Если запятая+3 цифры и нет точки → thousands separator → drop запятую.
  // Иначе запятая → десятичная точка.
  if (/,\d{3}(?:\D|$)/.test(cleaned) && !cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else {
    cleaned = cleaned.replace(",", ".");
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function parseBitumPriceNew(
  buffer: Buffer,
  dict: RefineriesDict
): Promise<ParserResult<ParsedBitumPriceNewRow>> {
  const rows: ParsedBitumPriceNewRow[] = [];
  const errors: ParserError[] = [];
  let sheetName = "";
  let cellRange = "";
  try {
    const { sheet, sheetName: name } = await loadFirstSheet(buffer);
    sheetName = name;
    const rowCount = sheet.rowCount;
    if (rowCount > BITUM_MAX_ROWS) {
      return {
        rows: [],
        errors: [{ rowNum: 0, reason: `too many rows (>${BITUM_MAX_ROWS})` }],
        meta: {
          fileType: "bitum_price_new",
          sheetName,
          cellRange: "",
          rowsCount: 0,
        },
      };
    }
    let lastDataRow = HEADER_ROW;
    for (let r = HEADER_ROW + 1; r <= rowCount; r++) {
      const dataRow = sheet.getRow(r);
      const refineryRaw = cellString(dataRow.getCell(COL_REFINERY));
      if (!refineryRaw) continue;
      const dateIso = excelDateToIso(dataRow.getCell(COL_DATE).value);
      if (!dateIso) {
        errors.push({ rowNum: r, reason: "missing/invalid date (col A)" });
        continue;
      }
      const company = cellString(dataRow.getCell(COL_COMPANY));
      const priceStr = cellString(dataRow.getCell(COL_PRICE_BND));
      const price = parsePrice(priceStr);
      if (price === null) {
        // Возможно row только про ПБВ (БНД отсутствует) — пропускаем без ошибки.
        continue;
      }
      const deltaStr = cellString(dataRow.getCell(COL_DELTA_BND));
      const delta = parseDelta(deltaStr);
      const norm = normalizeRefinery(refineryRaw, dict);
      const candidate: ParsedBitumPriceNewRow = {
        date: dateIso,
        refineryCanonical: norm.canonical,
        refineryRaw,
        company,
        priceRub: price,
        deltaWeek: delta,
      };
      const parsed = RowSchema.safeParse(candidate);
      if (!parsed.success) {
        errors.push({
          rowNum: r,
          reason: `validation failed: ${parsed.error.message.slice(0, 100)}`,
        });
        continue;
      }
      rows.push(parsed.data);
      lastDataRow = r;
    }
    cellRange = `A${HEADER_ROW + 1}:I${lastDataRow}`;
  } catch (err) {
    errors.push({ rowNum: 0, reason: (err as Error).message });
  }
  return {
    rows,
    errors,
    meta: {
      fileType: "bitum_price_new",
      sheetName,
      cellRange,
      rowsCount: rows.length,
    },
  };
}
