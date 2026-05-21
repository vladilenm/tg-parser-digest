// src/bitum/parsers/birzha-volumes.ts — BITUM-PARSE-02.
// Layout: A1=маркер, row 3 = headers, B=skip (Объем итого), C..T = НПЗ с
// префиксом "Объем, тыс. тонн: ". Цена в тыс.т → ×1000 (algoritm.md §1).

import { z } from "zod";
import { normalizeRefinery } from "../refineries.js";
import type {
  ParsedRowBirzhaVolume,
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
  volumeT: z.number().nonnegative().finite(),
  sourceCell: z.string().regex(/^[A-Z]+\d+$/),
});

const HEADER_PREFIX_RE = /^Объем,\s*тыс\.?\s*тонн:\s*/i;

export async function parseBirzhaVolumes(
  buffer: Buffer,
  dict: RefineryEntry[],
): Promise<ParserResult<ParsedRowBirzhaVolume>> {
  const result: ParserResult<ParsedRowBirzhaVolume> = {
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
  // Column B (index 2) — «Объем итого, тыс.тн.» — SKIP, начинаем с C (index 3)
  for (let c = 3; c <= colCount; c++) {
    const raw = cellToString(headerRow.getCell(c).value).trim();
    headers[c] = raw.replace(HEADER_PREFIX_RE, "").trim();
  }

  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const date = cellToDate(row.getCell(1).value);
    if (!date) continue;
    for (let c = 3; c <= colCount; c++) {
      const refineryRaw = headers[c];
      if (!refineryRaw) continue;
      const rawVolume = cellToNumber(row.getCell(c).value);
      if (rawVolume == null) continue;
      // BITUM-PARSE-02: ×1000 — тыс.т → т
      const volumeT = rawVolume * 1000;
      const candidate: ParsedRowBirzhaVolume = {
        date,
        refineryRaw,
        refineryCanonical: normalizeRefinery(refineryRaw, dict),
        volumeT,
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
