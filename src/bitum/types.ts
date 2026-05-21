// src/bitum/types.ts — все типы для битум-pipeline (milestone v5.0).
// Расширяет src/upload/types.ts с 3 → 6 типов файлов + structured snapshot для
// bitum_price_new + cell-trace для REPORT-07 + LearnedSignature для CLS-03.

/**
 * BITUM-CLS-01: 6 типов файлов битум-pipeline. Первые 3 = legacy UploadType
 * v4.0 (переименованы: "fca" → "fca_sellers"), 2 новых + "unknown" sentinel.
 */
export type BitumType =
  | "birzha_prices"
  | "birzha_volumes"
  | "fca_sellers"
  | "all_prices"
  | "bitum_price_new"
  | "unknown";

/**
 * Известные типы (для appendLearned, saveUpload — не принимают unknown).
 */
export type KnownBitumType = Exclude<BitumType, "unknown">;

/**
 * BITUM-REFINERY-01/02: словарь канонических НПЗ + холдинг.
 * Идентичен src/upload/types.ts:RefineryEntry — backward-compat.
 */
export interface RefineryEntry {
  canonical: string;
  company: string; // "Роснефть" | "Газпромнефть" | "ЛУКОЙЛ" | "Татнефть" | "независимые"
  aliases: string[];
}

/**
 * BITUM-CLS-01/02/04: результат classifyFile(buffer). meta содержит обнаруженные
 * A1/A3/B3 + имя листа + (опционально) оригинальное имя файла из bot.ts для логов.
 * confidence ∈ [0, 1]: 1.0 = exact A1+A3 match, 0.7 = только A1 match, 0.4 = partial,
 * < 0.7 → bot.ts шлёт inline-keyboard learning UX (D-14). type="unknown" только при
 * confidence=0 (никакая built-in или learned signature не сработала).
 */
export interface ClassifyResult {
  type: BitumType;
  confidence: number;
  meta: {
    sheetName?: string;
    a1?: string;
    a3?: string;
    b3?: string;
    originalFileName?: string;
  };
}

// ============================================================================
// Per-type ParsedRow shapes (БНД- normalized, ×1000 multipliers applied).
// ============================================================================

export interface ParsedRowBirzhaPrice {
  date: Date;
  refineryCanonical: string;
  refineryRaw: string;
  priceRub: number; // ×1000 multiplier applied (см. BITUM-PARSE-01)
  sourceCell: string; // Excel A1-address для REPORT-07 cell-trace (per checker W4), e.g. "F12"
}

export interface ParsedRowBirzhaVolume {
  date: Date;
  refineryCanonical: string;
  refineryRaw: string;
  volumeT: number; // ×1000 multiplier applied (тыс.т → т, см. BITUM-PARSE-02)
  sourceCell: string; // Excel A1-address для REPORT-07 cell-trace (per checker W4)
}

export interface ParsedRowFca {
  date: Date;
  refineryCanonical: string;
  region: string;
  pointOfShipment: string;
  priceRub: number;
  source: "fca";
  sourceCell: string; // Excel A1-address для REPORT-07 cell-trace (per checker W4)
}

export interface ParsedRowAllPrices {
  date: Date;
  pointOfShipment: string;
  companyRaw: string; // "Наименование компании" из исходника, БЕЗ нормализации
  region: string;
  fuelType: string; // "БНД 70/100", "БНД 90/130" и т.п.
  sourceTag: string; // "биржа" | "мониторинг" | "прайс"
  deliveryMode: string;
  fuel: string;
  priceRub: number;
  sourceCell: string; // Excel A1-address для REPORT-07 cell-trace (per checker W4), e.g. "H42"
}

/**
 * BITUM-PARSE-05: snapshot на дату из bitum_price_new.xlsx (одна точка).
 * bnd = БНД, pbv = ПБВ. deltaAbs в ₽/т, deltaPct в %.
 */
export interface ParsedBitumPriceNewSnapshot {
  date: Date;
  bnd: {
    price: number;
    deltaAbs: number;
    deltaPct: number;
    priceCell: string;
    deltaCell: string;
  };
  pbv: {
    price: number;
    deltaAbs: number;
    deltaPct: number;
    priceCell: string;
    deltaCell: string;
  };
  // priceCell/deltaCell — Excel A1-address для REPORT-07 cell-trace (per checker W4), e.g. "F4" / "G4"
}

/**
 * BITUM-PARSE-06: универсальный результат парсера. errors[] — невалидные строки
 * (с rowNum + reason), парсер НЕ падает, продолжает остальные строки.
 */
export interface ParserResult<T> {
  rows: T[];
  errors: { rowNum: number; reason: string }[];
}

// ============================================================================
// Report types (reporter.ts).
// ============================================================================

/**
 * BITUM-REPORT-07: cell-trace для каждого числа в отчёте. file = базовое имя
 * xlsx ("birzha_prices.xlsx"), sheet = "исходник" / "свод" / "Лист1", cell =
 * "B4" / "F15", semantic = human-label («Саратовский НПЗ 2026-05-08», «БНД snapshot price»).
 */
export interface NumberTrace {
  value: number;
  file: string;
  sheet: string;
  cell: string;
  semantic: string;
}

/**
 * Reporter.renderBitumReport return. html = готовый Telegram HTML (chunkBitumHtml
 * нарежет на ≤4000); trace = массив NumberTrace для footer + unit-тестов;
 * warnings = массив строк (cross-check warnings из REPORT-08, partial-render warnings из D-10).
 */
export interface ReportResult {
  html: string;
  trace: NumberTrace[];
  warnings: string[];
}

// ============================================================================
// Storage types (storage.ts).
// ============================================================================

/**
 * BITUM-TG-01: расширенный WeekStatus для 5 типов (legacy WeekStatus имел 3).
 * lastRunAt — ISO string или null. allPresent — convenience: true если все 5 ✅.
 */
export interface WeekStatusV5 {
  week: string; // ISO "YYYY-Www"
  hasBirzhaPrices: boolean;
  hasBirzhaVolumes: boolean;
  hasFcaSellers: boolean;
  hasAllPrices: boolean;
  hasBitumPriceNew: boolean;
  lastRunAt: string | null;
  allPresent: boolean;
  presentCount: number;
}

// ============================================================================
// Classifier learning types (learned-signatures.ts).
// ============================================================================

/**
 * BITUM-CLS-03/D-14: одна запись append-only файла signatures-learned.json.
 * a1/a3/b3 — точные строки cells (НЕ regex, exact match case-insensitive),
 * sheetName опционален (некоторые файлы имеют дефолтный "Лист1"), learnedAt — ISO8601.
 * Тип НЕ может быть "unknown" — оператор должен выбрать конкретный тип.
 */
export interface LearnedSignature {
  type: KnownBitumType;
  a1?: string;
  a3?: string;
  b3?: string;
  sheetName?: string;
  learnedAt: string;
}
