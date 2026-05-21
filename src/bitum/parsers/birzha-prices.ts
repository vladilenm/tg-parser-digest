// src/bitum/parsers/birzha-prices.ts — BITUM-PARSE-01.
// Layout: A1=маркер, row 3 = headers с префиксом "БНД-" (нормализуем replace),
// row 4+ = данные. Колонка A = Date, колонки B..T = price (умножаем на 1000:
// тыс.руб/т → руб/т согласно algoritm.md §2.7).

import { z } from "zod";
import { normalizeRefinery } from "../../upload/refineries.js";
// ^^ В waves 1-5 импортим из src/upload — wave 6 миграция перенесёт.
import type {
  ParsedRowBirzhaPrice,
  ParserResult,
  RefineryEntry,
} from "../types.js";
import {
  cellAddress,
  cellToDate,
  cellToNumber,
  cellToString,
  loadWorkbook,
} from "./shared.js";

const ROW_SCHEMA = z.object({
  date: z.date(),
  refineryCanonical: z.string().min(1),
  refineryRaw: z.string().min(1),
  priceRub: z.number().positive().finite(),
  sourceCell: z.string().regex(/^[A-Z]+\d+$/),
});

/**
 * BITUM-PARSE-01: парсит birzha_prices xlsx → long-table.
 * - Заголовки в row 3 (B..end), prefix "БНД-" удаляется (algoritm.md §2.4)
 * - Цены умножаются на 1000 (algoritm.md §2.7 — тыс.руб/т → руб/т)
 * - Невалидная строка с rowNum + reason → errors[], парсер продолжает
 * - Идемпотентный: тот же buffer → тот же result
 */
export async function parseBirzhaPrices(
  buffer: Buffer,
  dict: RefineryEntry[],
): Promise<ParserResult<ParsedRowBirzhaPrice>> {
  const result: ParserResult<ParsedRowBirzhaPrice> = {
    rows: [],
    errors: [],
  };
  const wb = await loadWorkbook(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    result.errors.push({ rowNum: 0, reason: "workbook has no worksheets" });
    return result;
  }

  const headerRow = ws.getRow(3);
  const headers: string[] = [];
  const colCount = ws.columnCount;
  for (let c = 2; c <= colCount; c++) {
    const raw = cellToString(headerRow.getCell(c).value).trim();
    // BITUM-PARSE-01: replace "БНД-" prefix (case-insensitive)
    headers[c] = raw.replace(/^БНД-/i, "").trim();
  }

  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const date = cellToDate(row.getCell(1).value);
    if (!date) continue;
    for (let c = 2; c <= colCount; c++) {
      const refineryRaw = headers[c];
      if (!refineryRaw) continue;
      const rawPrice = cellToNumber(row.getCell(c).value);
      if (rawPrice == null) continue;
      // BITUM-PARSE-01: умножаем на 1000 (тыс.руб → руб)
      const priceRub = rawPrice * 1000;
      const candidate: ParsedRowBirzhaPrice = {
        date,
        refineryRaw,
        refineryCanonical: normalizeRefinery(refineryRaw, dict),
        priceRub,
        sourceCell: cellAddress(c, r),
      };
      const parsed = ROW_SCHEMA.safeParse(candidate);
      if (parsed.success) {
        result.rows.push(parsed.data);
      } else {
        result.errors.push({
          rowNum: r,
          reason: `col=${c} ${parsed.error.message.slice(0, 200)}`,
        });
      }
    }
  }
  return result;
}
