// src/bitum/classifier.ts — главный classifier xlsx → BitumType.
// BITUM-CLS-01: возвращает { type, confidence, meta } через buffer-only (BITUM-CLS-04).
// Confidence model (stepped, claude's discretion #3):
//   - A1 + A3 prefix-match (или a1 + b3 если b3 указан в signature) → 1.0
//   - Только A1 prefix-match → 0.7
//   - Только A3 или B3 prefix-match (без A1) → 0.4
//   - Ничего не совпало → type="unknown", confidence=0
// При confidence < 1 OR type=unknown — bot.ts шлёт inline-keyboard learning (D-14).

import ExcelJS from "exceljs";
import type { BitumType, ClassifyResult, KnownBitumType } from "./types.js";
import { BUILT_IN_SIGNATURES, type Signature } from "./signatures.js";
import { loadLearned } from "./learned-signatures.js";

/**
 * Прочитать cell как trimmed lowercase string. richText/number/empty → "".
 * Симметрично src/upload/parser.ts:cellToString но всегда lowercase.
 */
function cellLower(ws: ExcelJS.Worksheet, address: string): string {
  const v = ws.getCell(address).value;
  if (typeof v === "string") return v.trim().toLowerCase();
  if (typeof v === "number") return String(v).toLowerCase();
  if (v && typeof v === "object" && "richText" in v) {
    const rt = (v as { richText: { text: string }[] }).richText;
    return rt.map((p) => p.text).join("").trim().toLowerCase();
  }
  return "";
}

/**
 * Один матч-проход по одной сигнатуре. Возвращает confidence 0..1.
 * - 1.0 = A1 + (A3 || B3) match
 * - 0.7 = только A1 match
 * - 0.4 = только A3 или B3 (без A1) match
 * - 0 = ничего, либо несовпадение sheetName (если sheetName указан, он required)
 *
 * Ветка с sheetName (per checker B2 fix):
 *   - sheetMatch + a1Match + a3Match → 1.0 (всё совпало)
 *   - sheetMatch + (a1Match || a3Match || b3Match) → 0.85 (sheetName + один маркер)
 *   - sheetMatch только → 0.7
 */
function scoreSignature(
  sig: Signature,
  a1: string,
  a3: string,
  b3: string,
  sheetName: string,
): number {
  // Если sheetName в signature указан — он обязателен (substring match).
  if (sig.sheetName && !sheetName.includes(sig.sheetName)) return 0;

  // ВАЖНО: a3="" (пустая строка) в signature не должен матчиться через startsWith
  // (любая строка начинается с ""). Считаем match только если в signature pattern непустой.
  const a1Match = !!(sig.a1 && sig.a1.length > 0 && a1.startsWith(sig.a1));
  const a3Match = !!(sig.a3 && sig.a3.length > 0 && a3.startsWith(sig.a3));
  const b3Match = !!(sig.b3 && sig.b3.length > 0 && b3.startsWith(sig.b3));

  // Ветка с sheetName: signature имеет sheetName и он совпал.
  if (sig.sheetName) {
    if (a1Match && a3Match) return 1.0;
    if (a1Match || a3Match || b3Match) return 0.85;
    return 0.7;
  }

  // Ветка без sheetName: signature не имеет sheetName-constraint.
  if (a1Match && (a3Match || b3Match)) return 1.0;
  if (a1Match) return 0.7;
  if (a3Match || b3Match) return 0.4;
  return 0;
}

/**
 * BITUM-CLS-01/CLS-02/CLS-04: главный classifier xlsx → ClassifyResult.
 * Доверие имени файла = 0 (CLS-04) — fileName в API НЕ принимается. Если bot.ts
 * хочет логировать оригинальное имя — передаёт его в meta.originalFileName ПОСЛЕ
 * вызова classifyFile (через spread `{ ...result, meta: { ...result.meta, originalFileName }}`).
 *
 * Алгоритм:
 *   1. Загрузить workbook через ExcelJS
 *   2. Прочитать A1, A3, B3 первого листа + sheetName
 *   3. Merged signatures: [...BUILT_IN_SIGNATURES, ...loadLearned()]
 *   4. Для каждой signature scoreSignature() → best match wins
 *   5. Если best.confidence === 0 → { type: "unknown", confidence: 0, meta }
 */
export async function classifyFile(
  buffer: Buffer,
): Promise<ClassifyResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const ws = wb.worksheets[0];
  if (!ws) {
    return { type: "unknown", confidence: 0, meta: {} };
  }

  const a1 = cellLower(ws, "A1");
  const a3 = cellLower(ws, "A3");
  const b3 = cellLower(ws, "B3");
  const sheetName = (ws.name ?? "").trim().toLowerCase();

  // Также собираем имена ВСЕХ листов (для all_prices с "исходник" вкладкой и др.):
  const allSheetNames = wb.worksheets
    .map((s) => (s.name ?? "").trim().toLowerCase())
    .join(" ");

  const meta = {
    a1: a1 || undefined,
    a3: a3 || undefined,
    b3: b3 || undefined,
    sheetName: sheetName || undefined,
  };

  const merged: { sig: Signature; from: "built-in" | "learned" }[] = [
    ...BUILT_IN_SIGNATURES.map((sig) => ({ sig, from: "built-in" as const })),
    ...loadLearned().map((ls) => ({
      sig: {
        type: ls.type as KnownBitumType,
        a1: ls.a1?.toLowerCase(),
        a3: ls.a3?.toLowerCase(),
        b3: ls.b3?.toLowerCase(),
        sheetName: ls.sheetName?.toLowerCase(),
      } as Signature,
      from: "learned" as const,
    })),
  ];

  let best: { type: BitumType; confidence: number } = {
    type: "unknown",
    confidence: 0,
  };
  for (const { sig } of merged) {
    const score = scoreSignature(sig, a1, a3, b3, allSheetNames);
    if (score > best.confidence) {
      best = { type: sig.type, confidence: score };
    }
  }

  return { type: best.type, confidence: best.confidence, meta };
}
