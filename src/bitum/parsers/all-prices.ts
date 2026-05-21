// src/bitum/parsers/all-prices.ts — BITUM-PARSE-04.
// Стратегия (claude's discretion #2): парсим вкладку «исходник» (raw, до pivot),
// затем code-side агрегация по холдингам через getCompany (НЕ парсером).
// Если вкладки «исходник» нет — fallback на worksheets[0].
//
// Колонки исходника (algoritm.md §5):
//   A: Пункт отгрузки | B: Наименование компании | C: Регион | D: Тип |
//   E: Источник | F: Доставка | G: Топливо | H: Цена | I: Дата
// Фильтр: Топливо ∈ {БНД 100/130, БНД 50/70, БНД 60/90, БНД 70/100, БНД 90/130}

import { z } from "zod";
import type ExcelJS from "exceljs";
import type {
  ParsedRowAllPrices,
  ParserResult,
  RefineryEntry,
} from "../types.js";
import {
  cellAddress,
  cellToDate,
  cellToNumber,
  cellToString,
  findSheet,
  loadWorkbook,
} from "./shared.js";

const BND_FUEL_TYPES = new Set([
  "БНД 100/130",
  "БНД 50/70",
  "БНД 60/90",
  "БНД 70/100",
  "БНД 90/130",
]);

const ROW_SCHEMA = z.object({
  date: z.date(),
  pointOfShipment: z.string().min(1),
  companyRaw: z.string(),
  region: z.string(),
  fuelType: z.string().min(1),
  sourceTag: z.string(),
  deliveryMode: z.string(),
  fuel: z.string(),
  priceRub: z.number().positive().finite(),
  sourceCell: z.string().regex(/^[A-Z]+\d+$/),
});

interface ColumnMap {
  pointOfShipment: number;
  companyRaw: number;
  region: number;
  fuelTypeOrTip: number;
  sourceTag: number;
  deliveryMode: number;
  fuel: number;
  priceRub: number;
  date: number;
}

/**
 * Найти индексы колонок по headerRow (case-insensitive substring).
 * Возвращает null если обязательные колонки (Топливо, Цена, Дата) не найдены.
 */
function findColumns(
  headerRow: ExcelJS.Row,
  colCount: number,
): ColumnMap | null {
  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    headers[c] = cellToString(headerRow.getCell(c).value)
      .trim()
      .toLowerCase();
  }
  const findCol = (substrings: string[]): number => {
    for (let c = 1; c <= colCount; c++) {
      const h = headers[c];
      if (substrings.some((s) => h.includes(s))) return c;
    }
    return -1;
  };
  const fuel = findCol(["топливо"]);
  const price = findCol(["цена"]);
  const date = findCol(["дата"]);
  if (fuel < 0 || price < 0 || date < 0) return null;
  return {
    pointOfShipment: findCol(["пункт отгрузки", "пункт"]),
    companyRaw: findCol(["наименование компании", "компании", "компания"]),
    region: findCol(["регион"]),
    fuelTypeOrTip: findCol(["тип"]),
    sourceTag: findCol(["источник"]),
    deliveryMode: findCol(["доставка"]),
    fuel: fuel,
    priceRub: price,
    date: date,
  };
}

export async function parseAllPrices(
  buffer: Buffer,
  // dict reserved для будущей нормализации pointOfShipment
  _dict: RefineryEntry[],
): Promise<ParserResult<ParsedRowAllPrices>> {
  const result: ParserResult<ParsedRowAllPrices> = { rows: [], errors: [] };
  const wb = await loadWorkbook(buffer);
  // Strategy: prefer "исходник", fallback to worksheets[0]
  let ws = findSheet(wb, "исходник");
  if (!ws) ws = wb.worksheets[0];
  if (!ws) {
    result.errors.push({ rowNum: 0, reason: "workbook has no worksheets" });
    return result;
  }

  // BITUM-PARSE-04: header может быть на row 1, 2 или 3 — определяем динамически
  let headerRow: ExcelJS.Row;
  let headerRowNum = 0;
  let cols: ColumnMap | null = null;
  for (const r of [1, 2, 3]) {
    headerRow = ws.getRow(r);
    cols = findColumns(headerRow, ws.columnCount);
    if (cols) {
      headerRowNum = r;
      break;
    }
  }
  if (!cols || headerRowNum === 0) {
    result.errors.push({
      rowNum: 0,
      reason: "no «Топливо»/«Цена»/«Дата» columns in row 1-3",
    });
    return result;
  }

  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const fuelType = cellToString(row.getCell(cols.fuel).value).trim();
    // BITUM-PARSE-04: фильтр по разрешённым БНД
    if (!BND_FUEL_TYPES.has(fuelType)) continue;
    const date = cellToDate(row.getCell(cols.date).value);
    if (!date) continue;
    const priceRub = cellToNumber(row.getCell(cols.priceRub).value);
    if (priceRub == null) continue;
    const candidate: ParsedRowAllPrices = {
      date,
      pointOfShipment: cellToString(
        row.getCell(cols.pointOfShipment).value,
      ).trim(),
      companyRaw:
        cols.companyRaw > 0
          ? cellToString(row.getCell(cols.companyRaw).value).trim()
          : "",
      region:
        cols.region > 0
          ? cellToString(row.getCell(cols.region).value).trim()
          : "",
      fuelType,
      sourceTag:
        cols.sourceTag > 0
          ? cellToString(row.getCell(cols.sourceTag).value).trim()
          : "",
      deliveryMode:
        cols.deliveryMode > 0
          ? cellToString(row.getCell(cols.deliveryMode).value).trim()
          : "",
      fuel:
        cols.fuelTypeOrTip > 0
          ? cellToString(row.getCell(cols.fuelTypeOrTip).value).trim()
          : "",
      priceRub,
      sourceCell: cellAddress(cols.priceRub, r),
    };
    const parsed = ROW_SCHEMA.safeParse(candidate);
    if (parsed.success) {
      result.rows.push(parsed.data);
    } else {
      result.errors.push({
        rowNum: r,
        reason: parsed.error.message.slice(0, 200),
      });
    }
  }
  return result;
}
