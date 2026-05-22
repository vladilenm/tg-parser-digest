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

const DEFAULT_VOLUMES_TOP_N = 10;

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
  let sumOfRefineriesT = 0;
  // File-репортируемые totals из col B «Объем тыс.тн.» (dedup по дате).
  const fileTotalsByDate = new Map<string, number>();
  for (const r of rows) {
    sumOfRefineriesT += r.volumeT;
    if (r.dayTotalT !== undefined && !fileTotalsByDate.has(r.date)) {
      fileTotalsByDate.set(r.date, r.dayTotalT);
    }
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
  // Если файл сам репортирует totals по col B — используем их (это то, что
  // оператор видит в xlsx и ожидает увидеть в дайджесте — fix «сумма не бьётся»).
  // Fallback к сумме per-refinery если col B пустой.
  const fileTotalT = [...fileTotalsByDate.values()].reduce((a, b) => a + b, 0);
  const totalT = fileTotalT > 0 ? fileTotalT : sumOfRefineriesT;
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
  // Биржевые движения цен сортируем В ТОЙ ЖЕ ОЧЕРЁДНОСТИ, что и Top-N volumes
  // (по volume rank, не по |Δ|) — требование заказчика 2026-05-22 «давайте
  // сделаем для топ-10 в той же очерёдности». НПЗ вне Top-N идут после, тоже
  // отсортированы по volume rank всех данных. FCA и Битум прайс — по |Δ| desc.
  const volumeRank = new Map<string, number>();
  volumes.byRefinery.forEach((v, i) => volumeRank.set(v.refineryCanonical, i));
  const sortByVolumeRank = (a: PriceMovement, b: PriceMovement): number => {
    const ra = volumeRank.get(a.refineryCanonical) ?? Number.MAX_SAFE_INTEGER;
    const rb = volumeRank.get(b.refineryCanonical) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.refineryCanonical < b.refineryCanonical ? -1 : 1;
  };
  const sortByDeltaDesc = (a: PriceMovement, b: PriceMovement): number => {
    const da = Math.abs(a.deltaAbs);
    const db = Math.abs(b.deltaAbs);
    if (db !== da) return db - da;
    return a.refineryCanonical < b.refineryCanonical ? -1 : 1;
  };
  const birzhaMovs = movementsFromBirzhaPrices(
    parsed.birzha_prices,
    "birzha_prices"
  );
  birzhaMovs.sort(sortByVolumeRank);
  const fcaMovs = movementsFromFca(parsed.fca_sellers, "fca_sellers");
  fcaMovs.sort(sortByDeltaDesc);
  const bpnMovs = movementsFromBitumPrice(
    parsed.bitum_price_new,
    "bitum_price_new"
  );
  bpnMovs.sort(sortByDeltaDesc);
  const movements: PriceMovement[] = [...birzhaMovs, ...fcaMovs, ...bpnMovs];
  const cc = crossCheck(parsed, options.thresholdPct);
  const ccd = crossCheckDelta(parsed);
  const available: Record<BitumType, boolean> = {
    birzha_volumes: parsed.birzha_volumes !== null,
    birzha_prices: parsed.birzha_prices !== null,
    fca_sellers: parsed.fca_sellers !== null,
    bitum_price_new: parsed.bitum_price_new !== null,
  };
  // FCA-specific date range — для channel header «Цены прайс (FCA) — DD месяц».
  let fcaDateRange: { from: string; to: string } | undefined;
  if (parsed.fca_sellers && parsed.fca_sellers.length > 0) {
    const fcaDates = parsed.fca_sellers.map((r) => r.date).sort();
    fcaDateRange = {
      from: fcaDates[0],
      to: fcaDates[fcaDates.length - 1],
    };
  }
  return {
    period,
    fcaDateRange,
    volumes,
    movements,
    crossCheck: cc,
    crossCheckDelta: ccd,
    available,
    thresholdPct: options.thresholdPct,
  };
}
