// src/bitum/parsers/fca-sellers.ts — парсер «Битум таблица продавцы» (FCA).
// algoritm.md §3 + rev.xlsx структура (verified 2026-05-22):
//   Sheet "Chart data", rowCount=26, columnCount=5
//   A1: "Битум цены продавцов FCA, руб./тонн"
//   A3..E3: "Пункт отгрузки", "Регион", <date prev>, <date curr>, "Δ"
//   A4..A26: refinery / seller, B — region, C — prev price, D — curr price, E — delta formula
// Date: используем D3 (end of period) для всех строк.
// pointOfShipment в rev-формате СОВПАДАЕТ с A-колонкой (нет отдельной колонки) —
// используем A как и refinery, и pointOfShipment (упрощение rev).

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

// Default — нужно подтверждение оператора на execute-phase: координаты верифицированы
// на rev-формате 2026-05-22 (см. dump в /tmp/dump-fca.mjs):
const HEADER_ROW = 3;
const COL_REFINERY = 1; // A
const COL_REGION = 2; // B
const COL_PRICE_PREV = 3; // C
const COL_PRICE_CURR = 4; // D
const COL_DELTA = 5; // E
const DATE_CELL_ROW = 3;
const DATE_CELL_COL = 4; // D3 — дата конца периода

const RowSchema = z.object({
  date: z.string().min(8),
  refineryCanonical: z.string(),
  refineryRaw: z.string(),
  region: z.string(),
  pointOfShipment: z.string(),
  priceRub: z.number().nonnegative(),
  deltaWeek: z.number(),
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
    // Extract end-of-period date from D3.
    const dateIso =
      excelDateToIso(sheet.getRow(DATE_CELL_ROW).getCell(DATE_CELL_COL).value) ??
      new Date().toISOString().slice(0, 10);
    let lastDataRow = HEADER_ROW;
    for (let r = HEADER_ROW + 1; r <= rowCount; r++) {
      const dataRow = sheet.getRow(r);
      const refineryRaw = cellString(dataRow.getCell(COL_REFINERY));
      if (!refineryRaw) continue;
      const region = cellString(dataRow.getCell(COL_REGION));
      const priceCurr = cellNumber(dataRow.getCell(COL_PRICE_CURR));
      const pricePrev = cellNumber(dataRow.getCell(COL_PRICE_PREV));
      if (priceCurr === null) {
        errors.push({ rowNum: r, reason: "missing current price (col D)" });
        continue;
      }
      let delta = cellNumber(dataRow.getCell(COL_DELTA));
      if (delta === null && pricePrev !== null) {
        delta = priceCurr - pricePrev;
      }
      if (delta === null) delta = 0;
      const norm = normalizeRefinery(refineryRaw, dict);
      const candidate: ParsedFcaRow = {
        date: dateIso,
        refineryCanonical: norm.canonical,
        refineryRaw,
        region,
        pointOfShipment: refineryRaw, // rev-формат: pointOfShipment == refinery (A-колонка)
        priceRub: priceCurr,
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
    cellRange = `A${HEADER_ROW + 1}:E${lastDataRow}`;
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
