// src/bitum/parsers/birzha-volumes.ts — парсер «Биржа суточная по NPZ».
// algoritm.md §1 + rev.xlsx структура: row 3 — refinery names (C..N), row 4..N — даты в A + объёмы.
// T-04-02: BITUM_MAX_ROWS cap.
// Default — нужно подтверждение оператора на execute-phase:
//   - тыс.т → т множитель: volumeT = cellValue * 1000

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
  ParsedVolumeRow,
  ParserError,
  ParserResult,
} from "../types.js";

// Default — нужно подтверждение оператора на execute-phase (точные координаты по
// rev-формату 2026-05-22): row 3 = refinery names, row 4..N = data, col A = date,
// cols B..N = volumes (rev.xlsx нормализован под 12 НПЗ).
const HEADER_ROW = 3;
const FIRST_DATA_COL = 2; // B
const LAST_DATA_COL = 20; // T (защитный потолок; rev уже урезан до N)

const RowSchema = z.object({
  date: z.string().min(8),
  refineryCanonical: z.string(),
  refineryRaw: z.string(),
  volumeT: z.number().nonnegative(),
});

export async function parseBirzhaVolumes(
  buffer: Buffer,
  dict: RefineriesDict
): Promise<ParserResult<ParsedVolumeRow>> {
  const rows: ParsedVolumeRow[] = [];
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
          {
            rowNum: 0,
            reason: `too many rows (>${BITUM_MAX_ROWS})`,
          },
        ],
        meta: {
          fileType: "birzha_volumes",
          sheetName,
          cellRange: "",
          rowsCount: 0,
        },
      };
    }
    // Read header row 3 — refinery names.
    const headerRow = sheet.getRow(HEADER_ROW);
    const refineryByCol: Record<number, string> = {};
    for (let c = FIRST_DATA_COL; c <= LAST_DATA_COL; c++) {
      const text = cellString(headerRow.getCell(c));
      if (text) refineryByCol[c] = text;
    }
    // Iterate data rows row 4..rowCount.
    let lastDataRow = HEADER_ROW;
    for (let r = HEADER_ROW + 1; r <= rowCount; r++) {
      const dataRow = sheet.getRow(r);
      const dateCell = dataRow.getCell(1); // col A
      const dateIso = excelDateToIso(dateCell.value);
      if (!dateIso) {
        // Skip empty rows silently; non-empty cells that look like data but no
        // date → push error.
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
        const vol = cellNumber(dataRow.getCell(c));
        if (vol === null) continue; // empty cell — пропуск
        const norm = normalizeRefinery(refineryRaw, dict);
        const candidate: ParsedVolumeRow = {
          date: dateIso,
          refineryCanonical: norm.canonical,
          refineryRaw,
          volumeT: vol * 1000, // тыс.т → т
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
    cellRange = `B${HEADER_ROW + 1}:T${lastDataRow}`;
  } catch (err) {
    errors.push({ rowNum: 0, reason: (err as Error).message });
  }
  return {
    rows,
    errors,
    meta: {
      fileType: "birzha_volumes",
      sheetName,
      cellRange,
      rowsCount: rows.length,
    },
  };
}
