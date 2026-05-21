// src/bitum/parsers/fca-sellers.ts — BITUM-PARSE-03.
// Layout: A1=маркер, row 3 headers (A="Пункт отгрузки", B="Регион", C..T = даты),
// row 4+ = данные. priceRub = cell value (в руб/т, без множителей).

import { z } from "zod";
import { normalizeRefinery } from "../../upload/refineries.js";
import type {
  ParsedRowFca,
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
  region: z.string(),
  pointOfShipment: z.string().min(1),
  priceRub: z.number().positive().finite(),
  source: z.literal("fca"),
  sourceCell: z.string().regex(/^[A-Z]+\d+$/),
});

export async function parseFcaSellers(
  buffer: Buffer,
  dict: RefineryEntry[],
): Promise<ParserResult<ParsedRowFca>> {
  const result: ParserResult<ParsedRowFca> = { rows: [], errors: [] };
  const wb = await loadWorkbook(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    result.errors.push({ rowNum: 0, reason: "workbook has no worksheets" });
    return result;
  }

  const headerRow = ws.getRow(3);
  const colCount = ws.columnCount;
  const dates: (Date | null)[] = [];
  for (let c = 3; c <= colCount; c++) {
    dates[c] = cellToDate(headerRow.getCell(c).value);
  }

  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const point = cellToString(row.getCell(1).value).trim();
    if (!point) continue;
    const region = cellToString(row.getCell(2).value).trim();
    const canonical = normalizeRefinery(point, dict);
    for (let c = 3; c <= colCount; c++) {
      const date = dates[c];
      if (!date) continue;
      const price = cellToNumber(row.getCell(c).value);
      if (price == null) continue;
      const candidate: ParsedRowFca = {
        date,
        refineryCanonical: canonical,
        region: region,
        pointOfShipment: point,
        priceRub: price,
        source: "fca",
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
