// src/bitum/analyzer.ts — programmatic анализ парсенных данных.
// Pure-функция, dict-аргументом, options-аргументом (D-CLAUDE.md).
// D-11: плоский список movements (без группировки по холдингам).
// D-18: cross-check bitum_price_new (источник истины) vs birzha_prices + fca_sellers.
// Default — нужно подтверждение оператора на execute-phase:
//   - sort movements by |deltaAbs| desc, tiebreak refineryCanonical ASC
//   - cross-check threshold default 1.0% (env BITUM_CROSS_CHECK_THRESHOLD, читается в caller)
//   - volumesTopN default 7

import type { RefineriesDict } from "./refineries.js";
import type {
  AnalysisResult,
  BitumType,
  CrossCheckDeltaIssue,
  CrossCheckIssue,
  ParsedByType,
  ParsedFcaRow,
  ParsedPriceRow,
  ParsedVolumeRow,
  PriceMovement,
  VolumeAggregate,
} from "./types.js";

export interface AnalyzeOptions {
  thresholdPct: number;
  volumesTopN?: number;
}

const DEFAULT_VOLUMES_TOP_N = 7;

function computePeriod(parsed: ParsedByType): { from: string; to: string } {
  const dates: string[] = [];
  if (parsed.birzha_volumes) {
    for (const r of parsed.birzha_volumes) dates.push(r.date);
  }
  if (parsed.birzha_prices) {
    for (const r of parsed.birzha_prices) dates.push(r.date);
  }
  if (parsed.fca_sellers) {
    for (const r of parsed.fca_sellers) dates.push(r.date);
  }
  if (parsed.bitum_price_new) {
    for (const r of parsed.bitum_price_new) dates.push(r.date);
  }
  if (dates.length === 0) return { from: "", to: "" };
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

function aggregateVolumes(
  rows: ParsedVolumeRow[] | null,
  topN: number
): { totalT: number; byRefinery: VolumeAggregate[] } {
  if (!rows || rows.length === 0) return { totalT: 0, byRefinery: [] };
  const acc = new Map<string, VolumeAggregate>();
  let totalT = 0;
  for (const r of rows) {
    totalT += r.volumeT;
    const key = r.refineryCanonical;
    const cur = acc.get(key);
    if (cur) {
      cur.sumT += r.volumeT;
    } else {
      acc.set(key, {
        refineryCanonical: r.refineryCanonical,
        refineryRaw: r.refineryRaw,
        sumT: r.volumeT,
      });
    }
  }
  const byRefinery = [...acc.values()]
    .sort((a, b) => b.sumT - a.sumT)
    .slice(0, topN);
  return { totalT, byRefinery };
}

/**
 * Из birzha_prices строит movements: first vs last date per refinery.
 */
function movementsFromBirzhaPrices(
  rows: ParsedPriceRow[] | null,
  sheetName: string
): PriceMovement[] {
  if (!rows || rows.length === 0) return [];
  const byRef = new Map<string, ParsedPriceRow[]>();
  for (const r of rows) {
    const arr = byRef.get(r.refineryCanonical);
    if (arr) arr.push(r);
    else byRef.set(r.refineryCanonical, [r]);
  }
  const out: PriceMovement[] = [];
  for (const [, arr] of byRef) {
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const first = arr[0];
    const last = arr[arr.length - 1];
    const priceFrom = first.priceRub;
    const priceTo = last.priceRub;
    const deltaAbs = priceTo - priceFrom;
    if (deltaAbs === 0) continue;
    const deltaPct = priceFrom > 0 ? (deltaAbs / priceFrom) * 100 : null;
    out.push({
      refineryCanonical: last.refineryCanonical,
      refineryRaw: last.refineryRaw,
      priceFrom,
      priceTo,
      deltaAbs,
      deltaPct,
      source: "birzha",
      trace: [
        {
          fileType: "birzha_prices",
          sheet: sheetName,
          cell: `${first.date}→${last.date}`,
        },
      ],
    });
  }
  return out;
}

/**
 * Из fca_sellers строит movements группировкой по pointOfShipment:
 *   - ≥2 даты → priceFrom = первая, priceTo = последняя, Δ = priceTo - priceFrom
 *   - singletons → skip (продавец только в одной дате)
 *   - Δ == 0 → skip (цена не изменилась)
 * (источник не содержит Δ-колонки, всё считаем сами).
 */
function movementsFromFca(
  rows: ParsedFcaRow[] | null,
  sheetName: string
): PriceMovement[] {
  if (!rows || rows.length === 0) return [];
  const byPoint = new Map<string, ParsedFcaRow[]>();
  for (const r of rows) {
    const key = r.pointOfShipment;
    const arr = byPoint.get(key);
    if (arr) arr.push(r);
    else byPoint.set(key, [r]);
  }
  const out: PriceMovement[] = [];
  for (const [, arr] of byPoint) {
    if (arr.length < 2) continue; // singleton — продавец встречается один раз
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const first = arr[0];
    const last = arr[arr.length - 1];
    const deltaAbs = last.priceRub - first.priceRub;
    if (deltaAbs === 0) continue;
    const deltaPct = first.priceRub > 0 ? (deltaAbs / first.priceRub) * 100 : null;
    out.push({
      refineryCanonical: last.refineryCanonical,
      refineryRaw: last.refineryRaw,
      priceFrom: first.priceRub,
      priceTo: last.priceRub,
      deltaAbs,
      deltaPct,
      source: "fca",
      trace: [
        {
          fileType: "fca_sellers",
          sheet: sheetName,
          cell: `${first.date}→${last.date}`,
        },
      ],
    });
  }
  return out;
}

/**
 * Из bitum_price_new строит movements: deltaWeek != 0.
 */
function movementsFromBitumPrice(
  rows: ParsedByType["bitum_price_new"],
  sheetName: string
): PriceMovement[] {
  if (!rows || rows.length === 0) return [];
  const out: PriceMovement[] = [];
  for (const r of rows) {
    if (r.deltaWeek === 0) continue;
    const priceFrom = r.priceRub - r.deltaWeek;
    const priceTo = r.priceRub;
    const deltaPct = priceFrom > 0 ? (r.deltaWeek / priceFrom) * 100 : null;
    out.push({
      refineryCanonical: r.refineryCanonical,
      refineryRaw: r.refineryRaw,
      priceFrom,
      priceTo,
      deltaAbs: r.deltaWeek,
      deltaPct,
      source: "bitum_price_new",
      trace: [
        { fileType: "bitum_price_new", sheet: sheetName, cell: r.date },
      ],
    });
  }
  return out;
}

/**
 * Cross-check bitum_price_new (источник истины) vs birzha_prices (последняя цена) и
 * fca_sellers (последняя priceRub). Issue если |delta|/reference * 100 > thresholdPct.
 */
function crossCheck(
  parsed: ParsedByType,
  thresholdPct: number
): CrossCheckIssue[] {
  const out: CrossCheckIssue[] = [];
  if (!parsed.bitum_price_new) return out;
  // Last birzha price per refinery (by date).
  const lastBirzha = new Map<string, number>();
  if (parsed.birzha_prices) {
    const byRef = new Map<string, ParsedPriceRow[]>();
    for (const r of parsed.birzha_prices) {
      const arr = byRef.get(r.refineryCanonical);
      if (arr) arr.push(r);
      else byRef.set(r.refineryCanonical, [r]);
    }
    for (const [k, arr] of byRef) {
      arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      lastBirzha.set(k, arr[arr.length - 1].priceRub);
    }
  }
  // Last FCA price per refinery.
  const lastFca = new Map<string, number>();
  if (parsed.fca_sellers) {
    for (const r of parsed.fca_sellers) {
      // Один FCA-снимок на неделю; перезаписываем (последнее → актуально).
      lastFca.set(r.refineryCanonical, r.priceRub);
    }
  }
  for (const r of parsed.bitum_price_new) {
    const bp = r.priceRub;
    const lb = lastBirzha.get(r.refineryCanonical);
    if (lb !== undefined && lb > 0) {
      const pct = Math.abs((bp - lb) / lb) * 100;
      if (pct > thresholdPct) {
        out.push({
          refineryCanonical: r.refineryCanonical,
          bitumPriceValue: bp,
          otherSource: "birzha",
          otherValue: lb,
          deltaPct: pct,
        });
      }
    }
    const lf = lastFca.get(r.refineryCanonical);
    if (lf !== undefined && lf > 0) {
      const pct = Math.abs((bp - lf) / lf) * 100;
      if (pct > thresholdPct) {
        out.push({
          refineryCanonical: r.refineryCanonical,
          bitumPriceValue: bp,
          otherSource: "fca",
          otherValue: lf,
          deltaPct: pct,
        });
      }
    }
  }
  return out;
}

/**
 * Сравнение НАШЕЙ Δ (last-first из birzha_prices) и DECLARED Δ (deltaWeek из
 * bitum_price_new) по тому же refineryCanonical. Возвращает все пары где обе
 * стороны есть — без threshold (для отдельной advisory-секции в дайджесте).
 */
function crossCheckDelta(parsed: ParsedByType): CrossCheckDeltaIssue[] {
  const out: CrossCheckDeltaIssue[] = [];
  if (!parsed.birzha_prices || !parsed.bitum_price_new) return out;
  // Наша Δ из birzha_prices: priceLast - priceFirst per refineryCanonical.
  const ourByRef = new Map<
    string,
    { priceFrom: number; priceTo: number; delta: number }
  >();
  const groupBP = new Map<string, ParsedPriceRow[]>();
  for (const r of parsed.birzha_prices) {
    const arr = groupBP.get(r.refineryCanonical);
    if (arr) arr.push(r);
    else groupBP.set(r.refineryCanonical, [r]);
  }
  for (const [k, arr] of groupBP) {
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const f = arr[0].priceRub;
    const t = arr[arr.length - 1].priceRub;
    ourByRef.set(k, { priceFrom: f, priceTo: t, delta: t - f });
  }
  // Declared Δ из bitum_price_new — может быть несколько строк per НПЗ (разные компании);
  // суммировать дельты нельзя, возьмём первую non-zero, иначе первую.
  const declaredByRef = new Map<string, { priceTo: number; delta: number }>();
  for (const r of parsed.bitum_price_new) {
    const cur = declaredByRef.get(r.refineryCanonical);
    if (!cur || (cur.delta === 0 && r.deltaWeek !== 0)) {
      declaredByRef.set(r.refineryCanonical, {
        priceTo: r.priceRub,
        delta: r.deltaWeek,
      });
    }
  }
  for (const [k, ours] of ourByRef) {
    const declared = declaredByRef.get(k);
    if (!declared) continue;
    out.push({
      refineryCanonical: k,
      ourDelta: ours.delta,
      declaredDelta: declared.delta,
      diff: ours.delta - declared.delta,
      ourPriceFrom: ours.priceFrom,
      ourPriceTo: ours.priceTo,
      declaredPriceTo: declared.priceTo,
    });
  }
  // Sort by |diff| desc для удобства просмотра.
  out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return out;
}

export function analyzeBitum(
  parsed: ParsedByType,
  _dict: RefineriesDict,
  options: AnalyzeOptions
): AnalysisResult {
  const period = computePeriod(parsed);
  const topN = options.volumesTopN ?? DEFAULT_VOLUMES_TOP_N;
  const volumes = aggregateVolumes(parsed.birzha_volumes, topN);
  // Movements (плоский список из 3 источников).
  const movements: PriceMovement[] = [
    ...movementsFromBirzhaPrices(parsed.birzha_prices, "birzha_prices"),
    ...movementsFromFca(parsed.fca_sellers, "fca_sellers"),
    ...movementsFromBitumPrice(parsed.bitum_price_new, "bitum_price_new"),
  ];
  // Sort: |deltaAbs| desc, tiebreak refineryCanonical ASC.
  movements.sort((a, b) => {
    const da = Math.abs(a.deltaAbs);
    const db = Math.abs(b.deltaAbs);
    if (db !== da) return db - da;
    return a.refineryCanonical < b.refineryCanonical ? -1 : 1;
  });
  const cc = crossCheck(parsed, options.thresholdPct);
  const ccd = crossCheckDelta(parsed);
  const available: Record<BitumType, boolean> = {
    birzha_volumes: parsed.birzha_volumes !== null,
    birzha_prices: parsed.birzha_prices !== null,
    fca_sellers: parsed.fca_sellers !== null,
    bitum_price_new: parsed.bitum_price_new !== null,
  };
  return {
    period,
    volumes,
    movements,
    crossCheck: cc,
    crossCheckDelta: ccd,
    available,
    thresholdPct: options.thresholdPct,
  };
}
