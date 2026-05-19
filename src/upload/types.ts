// src/upload/types.ts — shared types for the xlsx upload pipeline.
// Plan quick-260519-l11. Contracts: detect.ts / parser.ts / refineries.ts /
// storage.ts / analyzer.ts / renderer.ts — все импортят отсюда.

export type UploadType = "birzha_prices" | "birzha_volumes" | "fca";

/**
 * Canonical refinery + список алиасов из data/refineries.json.
 * Алиасы и canonical сравниваются case-insensitive trim — см. normalizeRefinery.
 */
export interface RefineryEntry {
  canonical: string;
  aliases: string[];
}

/**
 * Унифицированный «длинный» формат строк, в который приводятся все три типа xlsx.
 * - birzha_prices: priceRub задан, volumeT/pointOfShipment/region — undefined.
 * - birzha_volumes: volumeT задан, priceRub/pointOfShipment/region — undefined.
 * - fca: priceRub + pointOfShipment + region; refineryCanonical нормализован из pointOfShipment.
 *
 * date — всегда UTC; для дат, пришедших в Excel-serial виде, конвертация через excelSerialToDate.
 */
export interface ParsedRow {
  type: UploadType;
  refineryCanonical: string;
  refineryRaw: string;
  date: Date;
  priceRub?: number;
  volumeT?: number;
  pointOfShipment?: string;
  region?: string;
}

/**
 * Per-canonical Δ цены first→last за период.
 * deltaPct: если firstPrice === 0 → 0 (safety).
 * source: "birzha" если из birzha_prices, "fca" если из fca. Если канонический НПЗ есть
 * в обоих наборах — analyzer выдаёт ДВЕ записи (одну на источник).
 */
export interface RefineryDelta {
  canonical: string;
  firstDate: Date;
  firstPrice: number;
  lastDate: Date;
  lastPrice: number;
  deltaAbs: number;
  deltaPct: number;
  source: "birzha" | "fca";
}

/**
 * Агрегаты по объёмам из birzha_volumes.
 * perRefinery отсортирован по totalT desc.
 */
export interface VolumeTotals {
  totalT: number;
  perRefinery: { canonical: string; totalT: number }[];
}

export interface AnalysisResult {
  periodStart: Date;
  periodEnd: Date;
  weekFolder: string;
  runAt: Date;
  deltas: RefineryDelta[];
  volumes?: VolumeTotals;
}
