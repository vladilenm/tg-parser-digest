// src/bitum/signatures.ts — built-in таблица сигнатур для classifyFile (BITUM-CLS-02).
// Каждая сигнатура содержит ожидаемые тексты A1 / A3 / B3 (case-insensitive prefix-match)
// + опциональный sheetName. ВАЖНО: это НЕ regex — точное сравнение prefix через
// String.startsWith после .trim().toLowerCase(). Учиться сложным паттернам — задача
// learned-signatures.json (CLS-03), built-in охватывает только формат от Заказчика.

import type { KnownBitumType } from "./types.js";

/**
 * Одна built-in сигнатура. Все поля кроме `type` опциональны:
 *   - a1: префикс A1 первого листа (must match для confidence ≥ 0.7)
 *   - a3: префикс A3 (must match для bump confidence 0.7 → 1.0)
 *   - b3: префикс B3 (опциональный дополнительный матч)
 *   - sheetName: ожидаемое имя листа (case-insensitive substring) — опционально,
 *               для all_prices ("исходник") и bitum_price_new ("свод")
 *
 * Confidence model (см. classifier.ts):
 *   - A1 + A3 prefix-match → 1.0
 *   - Только A1 prefix-match → 0.7
 *   - Только A3 или B3 prefix-match → 0.4
 *   - Ничего → 0.0 (type="unknown")
 */
export interface Signature {
  type: KnownBitumType;
  a1?: string; // lowercase prefix
  a3?: string; // lowercase prefix
  b3?: string; // lowercase prefix
  sheetName?: string; // lowercase substring
}

/**
 * Built-in signature table — first 3 entries match src/upload/detect.ts MARKERS
 * (legacy v4.0 backward-compat); next 2 — new for v5.0.
 *
 * Источники A1-заголовков:
 *   - birzha_prices: docs/bitum/algoritm.md §2.2 «Цена битум на бирже, руб./тонн»
 *   - birzha_volumes: §1.2 «Объем битум на бирже, тыс. тонн»
 *   - fca_sellers: §3.9 «Битум цены продавцов FCA, руб./тонн»
 *   - all_prices: §5.14 «Цены на битум все, руб/тонн»
 *   - bitum_price_new: §4 файл новый, A1 может быть пустым (snapshot формат) →
 *     fallback на A3/B3 = "БНД" / "ПБВ" заголовки колонок. Для этого типа
 *     confidence model: A1 пустой → проверяем A3/B3 на "бнд"/"пбв" → 0.7.
 *
 * IMPORTANT: НЕ менять порядок entries — classifier.ts итерирует в этом порядке,
 * первый матч с максимальной confidence побеждает.
 */
export const BUILT_IN_SIGNATURES: Signature[] = [
  { type: "birzha_prices", a1: "цена битум на бирже", a3: "" },
  { type: "birzha_volumes", a1: "объем битум на бирже", a3: "" },
  {
    type: "fca_sellers",
    a1: "битум цены продавцов fca",
    a3: "пункт отгрузки",
    b3: "регион",
  },
  { type: "all_prices", a1: "цены битум все", sheetName: "исходник" },
  { type: "bitum_price_new", a1: "дата", sheetName: "chart data" },
];
