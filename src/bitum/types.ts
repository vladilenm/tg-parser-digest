// src/bitum/types.ts — Все типы битум-pipeline v5.1 (simplified).
// FIXED contracts — не менять без обновления 04-01-PLAN.md.

export type BitumType =
  | "birzha_volumes" // «Биржа суточная по NPZ»
  | "birzha_prices" // «Биржа цены NPZ»
  | "fca_sellers" // «Битум таблица продавцы»
  | "bitum_price_new"; // «Битум прайс»

export const BITUM_TYPES: readonly BitumType[] = [
  "birzha_volumes",
  "birzha_prices",
  "fca_sellers",
  "bitum_price_new",
] as const;

// Литералы для inline-keyboard (видны Заказчику) — D-05.
export const BITUM_BUTTON_LABELS: Record<BitumType, string> = {
  birzha_volumes: "Биржа суточная по NPZ",
  birzha_prices: "Биржа цены NPZ",
  fca_sellers: "Битум таблица продавцы",
  bitum_price_new: "Битум прайс",
};

export interface ParserError {
  rowNum: number; // 1-based; 0 = header / file-level error
  reason: string;
}

export interface ParserResult<T> {
  rows: T[];
  errors: ParserError[];
  // Метаданные для cell-trace footer (D-12 §7).
  meta: {
    fileType: BitumType;
    sheetName: string;
    cellRange: string; // e.g. "B4:T18"
    rowsCount: number;
  };
}

export interface ParsedVolumeRow {
  date: string; // ISO YYYY-MM-DD
  refineryCanonical: string;
  refineryRaw: string;
  volumeT: number; // тонны (исходное * 1000)
}

export interface ParsedPriceRow {
  date: string;
  refineryCanonical: string;
  refineryRaw: string;
  priceRub: number; // ₽/тонн (исходное * 1000)
}

export interface ParsedFcaRow {
  date: string; // последняя дата периода (D1 из rev-формата)
  refineryCanonical: string;
  refineryRaw: string;
  region: string;
  pointOfShipment: string;
  priceRub: number;
  deltaWeek: number; // E-D (формула из rev), может быть 0
}

export interface ParsedBitumPriceNewRow {
  date: string;
  refineryCanonical: string;
  refineryRaw: string;
  company: string; // прямо из xlsx-колонки, не lookup
  priceRub: number; // F-колонка
  deltaWeek: number; // G-колонка
}

export type ParsedByType = {
  birzha_volumes: ParsedVolumeRow[] | null;
  birzha_prices: ParsedPriceRow[] | null;
  fca_sellers: ParsedFcaRow[] | null;
  bitum_price_new: ParsedBitumPriceNewRow[] | null;
};

export interface WeekStatus {
  week: string; // "2026-W19"
  present: Record<BitumType, boolean>;
  manualNumbersCount: number;
  lastUpdatedAt: string | null; // ISO; null если папка пуста
}

export interface ManualNumber {
  label: string;
  value: string;
  addedAt: string; // ISO
}

export interface PriceMovement {
  refineryCanonical: string;
  refineryRaw: string;
  priceFrom: number | null;
  priceTo: number;
  deltaAbs: number;
  deltaPct: number | null;
  source: "birzha" | "fca" | "bitum_price_new";
  // Cell-trace для каждого числа (D-12 §7).
  trace: { fileType: BitumType; sheet: string; cell: string }[];
}

export interface CrossCheckIssue {
  refineryCanonical: string;
  bitumPriceValue: number;
  otherSource: "birzha" | "fca";
  otherValue: number;
  deltaPct: number; // абсолютный % расхождения
}

// Расхождение между нашей вычисленной Δ (last-first из birzha_prices)
// и declared Δ из сводной (bitum_price_new.deltaWeek).
export interface CrossCheckDeltaIssue {
  refineryCanonical: string;
  ourDelta: number; // birzha_prices: priceLast - priceFirst
  declaredDelta: number; // bitum_price_new.deltaWeek
  diff: number; // ourDelta - declaredDelta
  ourPriceFrom: number;
  ourPriceTo: number;
  declaredPriceTo: number;
}

export interface VolumeAggregate {
  refineryCanonical: string;
  refineryRaw: string;
  sumT: number;
}

export interface AnalysisResult {
  period: { from: string; to: string }; // ISO даты
  volumes: { totalT: number; byRefinery: VolumeAggregate[] };
  movements: PriceMovement[]; // плоский список, sorted by |deltaAbs| desc (D-11 default)
  crossCheck: CrossCheckIssue[];
  crossCheckDelta: CrossCheckDeltaIssue[]; // наша Δ vs declared Δ
  available: Record<BitumType, boolean>;
  thresholdPct: number; // из ENV BITUM_CROSS_CHECK_THRESHOLD
}

export interface ReportTrace {
  // Один элемент per file — компактная версия D-12 §7 default.
  fileType: BitumType;
  sheet: string;
  cellRange: string;
  numbersCount: number;
}

export interface ReportResult {
  html: string; // готов к sendHtml + chunkHtml
  trace: ReportTrace[]; // дублируется в footer html, но и вне html для тестов
}
