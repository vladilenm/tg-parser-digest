// src/bitum/parsers/shared.ts — общие helpers для битум-парсеров.
// T-04-02: BITUM_MAX_ROWS env cap (default 2000) для защиты от zip-bomb / гигантских xlsx.
// Default — нужно подтверждение оператора на execute-phase:
//   - тыс.т → т:  value * 1000  (birzha_volumes)
//   - тыс.руб/т → руб/т:  value * 1000  (birzha_prices)
//   - БНД-префикс цен: idempotent strip `refineryRaw.replace(/^БНД-/, "")`
//   - BITUM_MAX_ROWS env default = 2000 (DoS cap для T-04-02)

import ExcelJS from "exceljs";

export const BITUM_MAX_ROWS = Number(
  process.env.BITUM_MAX_ROWS ?? 2000
);

/**
 * Загрузить первый лист из xlsx-буфера. Throws при невалидном xlsx.
 */
export async function loadFirstSheet(
  buffer: Buffer
): Promise<{ sheet: ExcelJS.Worksheet; sheetName: string }> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS читает ArrayBuffer; конвертация Buffer → ArrayBuffer.
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  await wb.xlsx.load(ab as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) {
    throw new Error("[parser] no worksheets in xlsx");
  }
  return { sheet, sheetName: sheet.name };
}

/**
 * Преобразует cell.value (Excel serial number / Date / string) в ISO YYYY-MM-DD.
 * Возвращает null если не удалось распарсить.
 */
export function excelDateToIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  // ExcelJS отдаёт Date object для date-formatted cells.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  // Excel serial number (число дней с 1899-12-30 для Excel).
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel: 1 = 1900-01-01, но с багом 1900 leap year — используем 1899-12-30 base.
    const base = Date.UTC(1899, 11, 30);
    const ms = base + value * 86400000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    // ISO-like "YYYY-MM-DD" or "DD.MM.YYYY" or "DD.MM.YY"
    const s = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
    if (ru) {
      let year = Number(ru[3]);
      if (year < 100) year += 2000;
      return `${year}-${String(ru[2]).padStart(2, "0")}-${String(ru[1]).padStart(2, "0")}`;
    }
    // Try Date.parse fallback
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  // Object with .result (formula evaluated):
  if (value && typeof value === "object") {
    const v = value as { result?: unknown };
    if ("result" in v) return excelDateToIso(v.result);
  }
  return null;
}

/**
 * Возвращает числовое значение ячейки (через cell.value либо cell.result для формул).
 * Null если не число / пусто.
 */
export function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") {
    const o = v as { result?: unknown };
    if ("result" in o && typeof o.result === "number" && Number.isFinite(o.result)) {
      return o.result;
    }
  }
  return null;
}

/**
 * Строковое представление cell.value (с trim). Пустые/null → "".
 */
export function cellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: unknown };
    if ("text" in o && typeof o.text === "string") return o.text.trim();
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>)
        .map((r) => r.text ?? "")
        .join("")
        .trim();
    }
    if ("result" in o) {
      if (typeof o.result === "string") return o.result.trim();
      if (typeof o.result === "number") return String(o.result);
    }
  }
  return String(v).trim();
}

/**
 * Strip "БНД-" prefix idempotently (для имён НПЗ в birzha_prices).
 */
export function stripBndPrefix(raw: string): string {
  return raw.replace(/^БНД-?\s*/i, "").trim();
}
