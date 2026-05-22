// src/bitum/parsers/birzha-volumes.ts — парсер «Биржа суточная по NPZ».
// Парсит ОРИГИНАЛЬНЫЙ файл (docs/examples/birzha — суточная по НПЗ.xlsx).
// Структура (verified 2026-05-22 на оригинале):
//   row 1 = шапка: A="Период", B="Объем тыс.тн." (TOTAL — пропустить),
//                  C..N = НПЗ с префиксом «Объем, тыс. тонн: <НПЗ>»
//   row 2..N = данные: A = дата, B = total per row (пропустить), C..N = объём per НПЗ в тыс.т
// тыс.т → т множитель: volumeT = cellValue * 1000.

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

const HEADER_ROW = 1;
const FIRST_DATA_COL = 3; // C — col B = «Объем тыс.тн.» (total) пропускаем
const LAST_DATA_COL = 20; // T (защитный потолок)
const VOLUME_PREFIX = /^Объем,\s*тыс\.\s*тонн\s*:\s*/i;

const RowSchema = z.object({
  date: z.string().min(8),
  refineryCanonical: z.string(),
  refineryRaw: z.string(),
  volumeT: z.number().nonnegative(),
  dayTotalT: z.number().nonnegative().optional(),
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
    // Read header row 1 — refinery names с префиксом «Объем, тыс. тонн: ».
    const headerRow = sheet.getRow(HEADER_ROW);
    const refineryByCol: Record<number, string> = {};
    for (let c = FIRST_DATA_COL; c <= LAST_DATA_COL; c++) {
      const text = cellString(headerRow.getCell(c));
      if (!text) continue;
      const stripped = text.replace(VOLUME_PREFIX, "").trim();
      if (stripped) refineryByCol[c] = stripped;
    }
    // Iterate data rows row 2..rowCount.
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
      // Col B = «Объем тыс.тн.» — файл-репортируемый total за день (тыс.т → т).
      const dayTotalKt = cellNumber(dataRow.getCell(2));
      const dayTotalT =
        dayTotalKt !== null ? dayTotalKt * 1000 : undefined;
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
          dayTotalT,
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
    cellRange = `C${HEADER_ROW + 1}:T${lastDataRow}`;
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
