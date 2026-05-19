// src/upload/parser.ts — превращает xlsx-buffer в унифицированный массив ParsedRow.
// Поддерживает три layout'а: birzha_prices (длинный wide), birzha_volumes (wide
// без столбца «итого»), fca (transposed: refinery по строкам, даты — по столбцам).
//
// ВАЖНО (по факту из docs/examples/):
//   - birzha_prices:  A1=маркер, row 3 = headers, row 4+ = данные.
//   - birzha_volumes: A1=маркер, row 3 = headers (B="Объем итого" пропускаем,
//                     C+ = НПЗ), row 4+ = данные.
//   - fca:            A1=маркер, row 3 = headers (A="Пункт отгрузки", B="Регион",
//                     C+ = даты), row 4+ = данные.
// PLAN.md упоминал row 2 для volumes/fca — это была ошибка плана, реальные файлы
// имеют header на row 3 (rule 1 fix).
//
// ExcelJS возвращает Date-cells как настоящие JS Date, числа — как number.
// Empty-cells = "" (пустая строка). На случай файлов с сырым Excel-serial
// предоставляется excelSerialToDate.

import ExcelJS from "exceljs";
import type { ParsedRow, RefineryEntry, UploadType } from "./types.js";
import { normalizeRefinery } from "./refineries.js";

/**
 * Excel 1900-system serial → UTC Date.
 * Эпоха = 1899-12-30 (учёт бага Excel «1900 — leap year»).
 * Пример: 46142 → 2026-04-30 UTC.
 */
export function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function cellToDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return excelSerialToDate(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function cellToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // exceljs sometimes returns { result: <number> } for formula cells; not handled here.
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  // Formula cells: { result: number, formula: string }
  if (
    value &&
    typeof value === "object" &&
    "result" in value &&
    typeof (value as { result: unknown }).result === "number"
  ) {
    return (value as { result: number }).result;
  }
  return null;
}

function cellToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "richText" in value) {
    const rt = (value as { richText: { text: string }[] }).richText;
    return rt.map((p) => p.text).join("");
  }
  return value == null ? "" : String(value);
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS wants ArrayBuffer-ish. Buffer is fine in Node — types accept it.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

function getWorksheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("[parser] workbook has no worksheets");
  return ws;
}

/**
 * Прочесть xlsx-buffer и вернуть унифицированные строки.
 * dict передаётся аргументом (нет module-singleton'а), но если null/undefined —
 * пробуем подгрузить через loadRefineries (для удобства production-call'а из bot.ts).
 */
export async function parseWorkbook(
  buffer: Buffer,
  type: UploadType,
  dict: RefineryEntry[]
): Promise<ParsedRow[]> {
  const wb = await loadWorkbook(buffer);
  const ws = getWorksheet(wb);
  if (type === "birzha_prices") return parseBirzhaPrices(ws, dict);
  if (type === "birzha_volumes") return parseBirzhaVolumes(ws, dict);
  if (type === "fca") return parseFca(ws, dict);
  throw new Error(`[parser] unsupported type: ${String(type)}`);
}

function parseBirzhaPrices(
  ws: ExcelJS.Worksheet,
  dict: RefineryEntry[]
): ParsedRow[] {
  const headerRow = ws.getRow(3);
  const headers: string[] = [];
  const colCount = ws.columnCount;
  for (let c = 2; c <= colCount; c++) {
    headers[c] = cellToString(headerRow.getCell(c).value).trim();
  }
  const rows: ParsedRow[] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const date = cellToDate(row.getCell(1).value);
    if (!date) continue;
    for (let c = 2; c <= colCount; c++) {
      const refineryRaw = headers[c];
      if (!refineryRaw) continue;
      const price = cellToNumber(row.getCell(c).value);
      if (price == null) continue;
      rows.push({
        type: "birzha_prices",
        refineryRaw,
        refineryCanonical: normalizeRefinery(refineryRaw, dict),
        date,
        priceRub: price,
      });
    }
  }
  return rows;
}

function parseBirzhaVolumes(
  ws: ExcelJS.Worksheet,
  dict: RefineryEntry[]
): ParsedRow[] {
  const headerRow = ws.getRow(3);
  const headers: string[] = [];
  const colCount = ws.columnCount;
  // Column B (index 2) — «Объем итого, тыс.тн.» — SKIP (compute ourselves).
  // Start from column C (index 3).
  for (let c = 3; c <= colCount; c++) {
    headers[c] = cellToString(headerRow.getCell(c).value).trim();
  }
  const rows: ParsedRow[] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const date = cellToDate(row.getCell(1).value);
    if (!date) continue;
    for (let c = 3; c <= colCount; c++) {
      const refineryRaw = headers[c];
      if (!refineryRaw) continue;
      const volume = cellToNumber(row.getCell(c).value);
      if (volume == null) continue;
      rows.push({
        type: "birzha_volumes",
        refineryRaw,
        refineryCanonical: normalizeRefinery(refineryRaw, dict),
        date,
        volumeT: volume,
      });
    }
  }
  return rows;
}

function parseFca(
  ws: ExcelJS.Worksheet,
  dict: RefineryEntry[]
): ParsedRow[] {
  // Headers row 3: A="Пункт отгрузки", B="Регион", C+ = даты (Date cells).
  const headerRow = ws.getRow(3);
  const colCount = ws.columnCount;
  const dates: (Date | null)[] = [];
  for (let c = 3; c <= colCount; c++) {
    dates[c] = cellToDate(headerRow.getCell(c).value);
  }
  const rows: ParsedRow[] = [];
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
      rows.push({
        type: "fca",
        refineryRaw: point,
        refineryCanonical: canonical,
        date,
        priceRub: price,
        pointOfShipment: point,
        region: region || undefined,
      });
    }
  }
  return rows;
}
