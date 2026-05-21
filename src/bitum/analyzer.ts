// src/bitum/analyzer.ts — Δ-аналитика + groupBy с ФИКСИРОВАННЫМ порядком холдингов
// (Роснефть→Газпромнефть→ЛУКОЙЛ→Прочие — НЕ по Σ|Δ| desc как legacy analyzer).
// + cross-check (REPORT-08) с warnings.

import { getCompany } from "./refineries.js";
import type {
  ParsedRowBirzhaVolume,
  RefineryEntry,
} from "./types.js";

export interface BitumDelta {
  canonical: string;
  firstDate: Date;
  firstPrice: number;
  lastDate: Date;
  lastPrice: number;
  deltaAbs: number;
  deltaPct: number;
  source: "birzha" | "fca";
  // per checker W4: Excel A1-address forwarded from ParsedRow.sourceCell
  firstCell?: string;
  lastCell?: string;
}

export interface BitumCompanyGroup {
  company: "Роснефть" | "Газпромнефть" | "ЛУКОЙЛ" | "Прочие";
  deltas: BitumDelta[];
  sumDeltaAbs: number;
}

export interface BitumVolumeTotals {
  totalT: number;
  perRefinery: { canonical: string; totalT: number; company: string }[];
}

export interface CrossCheckWarning {
  canonical: string;
  source1: string;
  source2: string;
  price1: number;
  price2: number;
  diffPct: number;
  date: Date;
}

/**
 * Считает Δ first→last per canonical для одного источника (birzha или fca).
 */
export function deltasFor<
  T extends {
    date: Date;
    refineryCanonical: string;
    priceRub: number;
    sourceCell?: string;
  },
>(rows: T[], source: "birzha" | "fca"): BitumDelta[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const arr = groups.get(r.refineryCanonical) ?? [];
    arr.push(r);
    groups.set(r.refineryCanonical, arr);
  }
  const out: BitumDelta[] = [];
  for (const [canonical, list] of groups) {
    let first = list[0];
    let last = list[0];
    for (const row of list) {
      if (row.date.getTime() < first.date.getTime()) first = row;
      if (row.date.getTime() > last.date.getTime()) last = row;
    }
    const deltaAbs = last.priceRub - first.priceRub;
    const deltaPct =
      first.priceRub === 0 ? 0 : (deltaAbs / first.priceRub) * 100;
    out.push({
      canonical,
      firstDate: first.date,
      firstPrice: first.priceRub,
      lastDate: last.date,
      lastPrice: last.priceRub,
      deltaAbs,
      deltaPct,
      source,
      firstCell: first.sourceCell,
      lastCell: last.sourceCell,
    });
  }
  return out;
}

export function volumeTotals(
  rows: ParsedRowBirzhaVolume[],
  dict: RefineryEntry[],
): BitumVolumeTotals {
  let totalT = 0;
  const perCanonical = new Map<string, number>();
  for (const r of rows) {
    totalT += r.volumeT;
    perCanonical.set(
      r.refineryCanonical,
      (perCanonical.get(r.refineryCanonical) ?? 0) + r.volumeT,
    );
  }
  const perRefinery = [...perCanonical.entries()]
    .map(([canonical, total]) => ({
      canonical,
      totalT: total,
      company: getCompany(canonical, dict),
    }))
    .sort((a, b) => b.totalT - a.totalT);
  return { totalT, perRefinery };
}

/**
 * BITUM-REPORT-03..06: фиксированный порядок Роснефть → Газпромнефть → ЛУКОЙЛ → Прочие.
 * Татнефть и независимые попадают в "Прочие" (Reporter обрабатывает Татнефть
 * отдельной строкой внутри «Прочие и независимые» блока — см. algoritm.md §6).
 * Пустые группы тоже возвращаются (с deltas: []) — reporter может вывести
 * «Цены остались на уровне» для REPORT-05.
 */
export function byCompanyFixedOrder(
  deltas: BitumDelta[],
  dict: RefineryEntry[],
): BitumCompanyGroup[] {
  const groups: Record<BitumCompanyGroup["company"], BitumDelta[]> = {
    Роснефть: [],
    Газпромнефть: [],
    ЛУКОЙЛ: [],
    Прочие: [],
  };
  for (const d of deltas) {
    const company = getCompany(d.canonical, dict);
    if (
      company === "Роснефть" ||
      company === "Газпромнефть" ||
      company === "ЛУКОЙЛ"
    ) {
      groups[company].push(d);
    } else {
      // Татнефть + независимые → Прочие
      groups["Прочие"].push(d);
    }
  }
  return (["Роснефть", "Газпромнефть", "ЛУКОЙЛ", "Прочие"] as const).map(
    (company) => ({
      company,
      deltas: groups[company],
      sumDeltaAbs: groups[company].reduce(
        (s, x) => s + Math.abs(x.deltaAbs),
        0,
      ),
    }),
  );
}

/**
 * BITUM-REPORT-08: сравнить цены из bitum_price_new (snapshot) и all_prices
 * с FCA-ценами; при расхождении > threshold (default 0.01 = 1%) → warning.
 */
export function crossCheck(
  pricesByCanonical: {
    canonical: string;
    price: number;
    date: Date;
    source: string;
  }[],
  fcaByCanonical: {
    canonical: string;
    price: number;
    date: Date;
    source: string;
  }[],
  threshold = parseFloat(process.env.BITUM_CROSS_CHECK_THRESHOLD ?? "0.01"),
): CrossCheckWarning[] {
  const warnings: CrossCheckWarning[] = [];
  for (const p of pricesByCanonical) {
    const matches = fcaByCanonical.filter((f) => f.canonical === p.canonical);
    if (matches.length === 0) continue;
    matches.sort(
      (a, b) =>
        Math.abs(a.date.getTime() - p.date.getTime()) -
        Math.abs(b.date.getTime() - p.date.getTime()),
    );
    const f = matches[0];
    if (f.price === 0) continue;
    const diffPct = Math.abs(p.price - f.price) / f.price;
    if (diffPct > threshold) {
      warnings.push({
        canonical: p.canonical,
        source1: p.source,
        source2: f.source,
        price1: p.price,
        price2: f.price,
        diffPct: diffPct * 100,
        date: p.date,
      });
    }
  }
  return warnings;
}
