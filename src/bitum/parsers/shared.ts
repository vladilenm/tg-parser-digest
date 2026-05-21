// src/bitum/parsers/shared.ts — переиспользуемые cell-helpers + Workbook loader.
// Источник: src/upload/parser.ts (v4.0). Все 5 битум-парсеров (wave 2) импортят отсюда.
// Wave 6 удалит src/upload/parser.ts, эти helpers останутся здесь.

import ExcelJS from "exceljs";

/**
 * Excel 1900-system serial → UTC Date.
 * Эпоха = 1899-12-30 (учёт бага Excel «1900 — leap year»).
 * Пример: 46142 → 2026-04-30 UTC.
 */
export function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

export function cellToDate(value: unknown): Date | null {
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
  // Formula cell with date result
  if (value && typeof value === "object" && "result" in value) {
    const inner = (value as { result: unknown }).result;
    if (inner instanceof Date) return inner;
    if (typeof inner === "number" && Number.isFinite(inner) && inner > 0) {
      return excelSerialToDate(inner);
    }
  }
  return null;
}

export function cellToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
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

export function cellToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "richText" in value) {
    const rt = (value as { richText: { text: string }[] }).richText;
    return rt.map((p) => p.text).join("");
  }
  if (value && typeof value === "object" && "result" in value) {
    const inner = (value as { result: unknown }).result;
    if (typeof inner === "string") return inner;
    if (typeof inner === "number") return String(inner);
  }
  return value == null ? "" : String(value);
}

export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

/**
 * Найти worksheet по имени (case-insensitive substring). Возвращает первый match
 * или undefined. Используется парсером all_prices для поиска вкладки "исходник".
 */
export function findSheet(
  wb: ExcelJS.Workbook,
  nameSubstring: string,
): ExcelJS.Worksheet | undefined {
  const needle = nameSubstring.toLowerCase();
  return wb.worksheets.find((ws) =>
    (ws.name ?? "").toLowerCase().includes(needle),
  );
}

/**
 * Конвертирует 1-based column index → буквы Excel A1-нотации (1→A, 26→Z, 27→AA).
 * Используется парсерами (per checker W4) для заполнения ParsedRow.sourceCell
 * валидными Excel-адресами (вместо placeholder'ов "?" / "F?" / "B4..T").
 */
export function colLetter(c: number): string {
  let s = "";
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

/**
 * Helper для формирования Excel A1-address из (column, row).
 * Пример: cellAddress(6, 12) → "F12".
 */
export function cellAddress(col: number, row: number): string {
  return `${colLetter(col)}${row}`;
}
