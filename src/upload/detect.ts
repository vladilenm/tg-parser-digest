// src/upload/detect.ts — определение типа xlsx по A1-маркеру.
// Случай нечувствителен к регистру, ведущим/хвостовым пробелам.

import type ExcelJS from "exceljs";
import type { UploadType } from "./types.js";

interface Marker {
  prefix: string;
  type: UploadType;
}

const MARKERS: Marker[] = [
  { prefix: "цена битум на бирже", type: "birzha_prices" },
  { prefix: "объем битум на бирже", type: "birzha_volumes" },
  { prefix: "битум цены продавцов fca", type: "fca" },
];

/**
 * Возвращает UploadType если A1 первого листа начинается с одного из известных
 * префиксов (case-insensitive, trim). null — если лист пуст, A1 пуст или маркер
 * не распознан.
 */
export function detectUploadType(wb: ExcelJS.Workbook): UploadType | null {
  const ws = wb.worksheets[0];
  if (!ws) return null;
  const raw = ws.getCell("A1").value;
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  for (const m of MARKERS) {
    if (text.startsWith(m.prefix)) return m.type;
  }
  return null;
}
