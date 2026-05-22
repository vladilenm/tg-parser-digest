// src/bitum/parsers/fca-sellers.ts — парсер «Битум таблица продавцы» (FCA).
// Парсит ОРИГИНАЛЬНЫЙ файл (docs/examples/BITUM — таблица продавцы.xlsx).
// Структура (verified 2026-05-22):
//   row 1 = шапка: A="Дата", B="Регион", C="Пункт отгрузки", D="БНД"
//   row 2..N = данные: A=дата (per-row), B=регион, C=НПЗ/продавец, D=цена в руб/т
// В источнике НЕТ колонок prev/Δ. Парсер возвращает плоский snapshot per row.
// Дельта считается на уровне analyzer'a: группировка по pointOfShipment,
// ≥2 даты → priceFrom = первая, priceTo = последняя, deltaWeek = разница;
// единичные продавцы пропускаются (см. analyzer.ts movementsFromFca).

import { z } from "zod";
import {
  BITUM_MAX_ROWS,
  loadFirstSheet,
  excelDateToIso,
  cellNumber,
  cellString,
} from "./shared.js";
import type { RefineriesDict } from "../refineries.js";
import { normalizeRefinery } from "../refineries.js";
import type {
  ParsedFcaRow,
  ParserError,
  ParserResult,
} from "../types.js";

const HEADER_ROW = 1;
const COL_DATE = 1; // A
const COL_REGION = 2; // B
const COL_REFINERY = 3; // C (Пункт отгрузки)
const COL_PRICE = 4; // D (БНД, руб/т)

const RowSchema = z.object({
  date: z.string().min(8),
  refineryCanonical: z.string(),
  refineryRaw: z.string(),
  region: z.string(),
  pointOfShipment: z.string(),
  priceRub: z.number().nonnegative(),
  deltaWeek: z.number(), // 0 в источнике; реальная Δ считается в analyzer
});

export async function parseFcaSellers(
  buffer: Buffer,
  dict: RefineriesDict
): Promise<ParserResult<ParsedFcaRow>> {
  const rows: ParsedFcaRow[] = [];
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
          fileType: "fca_sellers",
          sheetName,
          cellRange: "",
          rowsCount: 0,
        },
      };
    }
    let lastDataRow = HEADER_ROW;
    for (let r = HEADER_ROW + 1; r <= rowCount; r++) {
      const dataRow = sheet.getRow(r);
      const dateIso = excelDateToIso(dataRow.getCell(COL_DATE).value);
      if (!dateIso) {
        // Пустые строки пропускаем тихо; строки с данными без даты → error.
        const hasAnyData =
          cellString(dataRow.getCell(COL_REFINERY)) !== "" ||
          cellNumber(dataRow.getCell(COL_PRICE)) !== null;
        if (hasAnyData) {
          errors.push({ rowNum: r, reason: "missing/invalid date in col A" });
        }
        continue;
      }
      const refineryRaw = cellString(dataRow.getCell(COL_REFINERY));
      if (!refineryRaw) continue;
      const region = cellString(dataRow.getCell(COL_REGION));
      const price = cellNumber(dataRow.getCell(COL_PRICE));
      if (price === null) {
        errors.push({ rowNum: r, reason: "missing price (col D)" });
        continue;
      }
      const norm = normalizeRefinery(refineryRaw, dict);
      const candidate: ParsedFcaRow = {
        date: dateIso,
        refineryCanonical: norm.canonical,
        refineryRaw,
        region,
        pointOfShipment: refineryRaw,
        priceRub: price,
        deltaWeek: 0, // считается на уровне analyzer'a из группировки по pointOfShipment
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
    cellRange = `A${HEADER_ROW + 1}:D${lastDataRow}`;
  } catch (err) {
    errors.push({ rowNum: 0, reason: (err as Error).message });
  }
  return {
    rows,
    errors,
    meta: {
      fileType: "fca_sellers",
      sheetName,
      cellRange,
      rowsCount: rows.length,
    },
  };
}
