// src/bitum/parsers/birzha-prices.ts — парсер «Биржа цены NPZ».
// Парсит ОРИГИНАЛЬНЫЙ файл (docs/examples/birzha — цены НПЗ.xlsx).
// Структура (verified 2026-05-22):
//   row 1 = шапка: A="Период", B..M = «БНД-<НПЗ>»
//   row 2..N = данные: A = дата, B..M = цена в тыс.руб/т
// priceRub = cellValue * 1000 (тыс.руб/т → руб/т).

import { z } from "zod";
import {
  BITUM_MAX_ROWS,
  loadFirstSheet,
  excelDateToIso,
  cellNumber,
  cellString,
  stripBndPrefix,
} from "./shared.js";
import type { RefineriesDict } from "../refineries.js";
import { normalizeRefinery } from "../refineries.js";
import type {
  ParsedPriceRow,
  ParserError,
  ParserResult,
} from "../types.js";

const HEADER_ROW = 1;
const FIRST_DATA_COL = 2; // B
const LAST_DATA_COL = 20; // T (защитный потолок)

const RowSchema = z.object({
  date: z.string().min(8),
  refineryCanonical: z.string(),
  refineryRaw: z.string(),
  priceRub: z.number().nonnegative(),
});

export async function parseBirzhaPrices(
  buffer: Buffer,
  dict: RefineriesDict
): Promise<ParserResult<ParsedPriceRow>> {
  const rows: ParsedPriceRow[] = [];
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
        errors: [
          { rowNum: 0, reason: `too many rows (>${BITUM_MAX_ROWS})` },
        ],
        meta: {
          fileType: "birzha_prices",
          sheetName,
          cellRange: "",
          rowsCount: 0,
        },
      };
    }
    const headerRow = sheet.getRow(HEADER_ROW);
    const refineryByCol: Record<number, string> = {};
    for (let c = FIRST_DATA_COL; c <= LAST_DATA_COL; c++) {
      const text = cellString(headerRow.getCell(c));
      if (text) refineryByCol[c] = stripBndPrefix(text);
    }
    let lastDataRow = HEADER_ROW;
    for (let r = HEADER_ROW + 1; r <= rowCount; r++) {
      const dataRow = sheet.getRow(r);
      const dateCell = dataRow.getCell(1);
      const dateIso = excelDateToIso(dateCell.value);
      if (!dateIso) {
        let hasAnyData = false;
        for (let c = FIRST_DATA_COL; c <= LAST_DATA_COL; c++) {
          if (cellNumber(dataRow.getCell(c)) !== null) {
            hasAnyData = true;
            break;
          }
        }
        if (hasAnyData) {
          errors.push({ rowNum: r, reason: "missing or invalid date in col A" });
        }
        continue;
      }
      lastDataRow = r;
      for (const colStr of Object.keys(refineryByCol)) {
        const c = Number(colStr);
        const refineryRaw = refineryByCol[c];
        const price = cellNumber(dataRow.getCell(c));
        if (price === null || price === 0) continue; // empty / formula пустая
        const norm = normalizeRefinery(refineryRaw, dict);
        const candidate: ParsedPriceRow = {
          date: dateIso,
          refineryCanonical: norm.canonical,
          refineryRaw,
          priceRub: price * 1000, // тыс.руб/т → руб/т
        };
        const parsed = RowSchema.safeParse(candidate);
        if (!parsed.success) {
          errors.push({
            rowNum: r,
            reason: `validation failed (col=${c}): ${parsed.error.message.slice(0, 100)}`,
          });
          continue;
        }
        rows.push(parsed.data);
      }
    }
    cellRange = `B${HEADER_ROW + 1}:T${lastDataRow}`; // B2:T<lastDataRow>, оригинал HEADER_ROW=1
  } catch (err) {
    errors.push({ rowNum: 0, reason: (err as Error).message });
  }
  return {
    rows,
    errors,
    meta: {
      fileType: "birzha_prices",
      sheetName,
      cellRange,
      rowsCount: rows.length,
    },
  };
}
