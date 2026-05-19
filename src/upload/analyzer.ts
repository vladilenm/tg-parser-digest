// src/upload/analyzer.ts — чистая Δ-математика над ParsedRow[].
// Никакого I/O. Входы: prices/fca/volumes; выход: AnalysisResult.

import type {
  AnalysisResult,
  CompanyGroup,
  ParsedRow,
  RefineryDelta,
  RefineryEntry,
  VolumeTotals,
} from "./types.js";
import { isoWeekFolder } from "./storage.js";
import { getCompany } from "./refineries.js";

/**
 * Группирует строки по canonical, выбирает first/last по дате, считает Δ.
 * source — тип набора (birzha | fca). Возвращает массив дельт для одного источника.
 */
function deltasFor(
  rows: ParsedRow[],
  source: "birzha" | "fca"
): RefineryDelta[] {
  const groups = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    if (r.priceRub == null) continue;
    const arr = groups.get(r.refineryCanonical) ?? [];
    arr.push(r);
    groups.set(r.refineryCanonical, arr);
  }
  const out: RefineryDelta[] = [];
  for (const [canonical, list] of groups) {
    if (list.length === 0) continue;
    // first = earliest date, last = latest date.
    let first = list[0];
    let last = list[0];
    for (const row of list) {
      if (row.date.getTime() < first.date.getTime()) first = row;
      if (row.date.getTime() > last.date.getTime()) last = row;
    }
    const firstPrice = first.priceRub!;
    const lastPrice = last.priceRub!;
    const deltaAbs = lastPrice - firstPrice;
    const deltaPct = firstPrice === 0 ? 0 : (deltaAbs / firstPrice) * 100;
    out.push({
      canonical,
      firstDate: first.date,
      firstPrice,
      lastDate: last.date,
      lastPrice,
      deltaAbs,
      deltaPct,
      source,
    });
  }
  return out;
}

function volumeTotals(rows: ParsedRow[]): VolumeTotals {
  let totalT = 0;
  const perCanonical = new Map<string, number>();
  for (const r of rows) {
    if (r.volumeT == null) continue;
    totalT += r.volumeT;
    perCanonical.set(
      r.refineryCanonical,
      (perCanonical.get(r.refineryCanonical) ?? 0) + r.volumeT
    );
  }
  const perRefinery = [...perCanonical.entries()]
    .map(([canonical, total]) => ({ canonical, totalT: total }))
    .sort((a, b) => b.totalT - a.totalT);
  return { totalT, perRefinery };
}

function periodOf(rows: ParsedRow[]): { min: Date | null; max: Date | null } {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const r of rows) {
    if (!min || r.date.getTime() < min.getTime()) min = r.date;
    if (!max || r.date.getTime() > max.getTime()) max = r.date;
  }
  return { min, max };
}

/**
 * Группирует дельты по company-холдингу.
 * Если dict пуст/не передан — все дельты попадают в один корзинный "независимые"-bucket
 * (через fallback getCompany). Возвращает массив, отсортированный по сумме |Δ| desc.
 */
function groupDeltasByCompany(
  deltas: RefineryDelta[],
  dict: RefineryEntry[]
): CompanyGroup[] {
  const byCompany = new Map<string, RefineryDelta[]>();
  for (const d of deltas) {
    const company = getCompany(d.canonical, dict);
    const arr = byCompany.get(company) ?? [];
    arr.push(d);
    byCompany.set(company, arr);
  }
  const groups: CompanyGroup[] = [];
  for (const [company, list] of byCompany) {
    const sumDeltaAbs = list.reduce((s, x) => s + Math.abs(x.deltaAbs), 0);
    groups.push({ company, deltas: list, sumDeltaAbs });
  }
  groups.sort((a, b) => b.sumDeltaAbs - a.sumDeltaAbs);
  return groups;
}

/**
 * Главная entry-point. prices/fca/volumes — массивы ParsedRow.
 * Если все три пусты → throw (нечего анализировать).
 *
 * dict — словарь refineries для группировки по company. Опционален: если не передан,
 * все дельты попадут в bucket "независимые" (fallback getCompany). Production-вызов из
 * bot.ts всегда передаёт loadRefineries().
 */
export function analyze(
  prices: ParsedRow[],
  fca: ParsedRow[],
  volumes: ParsedRow[] = [],
  dict: RefineryEntry[] = []
): AnalysisResult {
  const all = [...prices, ...fca, ...volumes];
  const { min, max } = periodOf(all);
  if (!min || !max) {
    throw new Error("[analyzer] no rows to analyze");
  }
  const birzhaDeltas = deltasFor(prices, "birzha");
  const fcaDeltas = deltasFor(fca, "fca");
  const deltas = [...birzhaDeltas, ...fcaDeltas].sort(
    (a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs)
  );
  const byCompany = groupDeltasByCompany(deltas, dict);
  const result: AnalysisResult = {
    periodStart: min,
    periodEnd: max,
    weekFolder: isoWeekFolder(max),
    runAt: new Date(),
    deltas,
    byCompany,
  };
  if (volumes.length > 0) {
    result.volumes = volumeTotals(volumes);
  }
  return result;
}
