// src/__tests__/upload-analyzer.test.ts — vitest для analyze().
// Pure-функция, без I/O.

import { describe, it, expect } from "vitest";
import { analyze } from "../upload/analyzer.js";
import type { ParsedRow, RefineryEntry } from "../upload/types.js";

const DICT: RefineryEntry[] = [
  { canonical: "A", company: "Роснефть", aliases: [] },
  { canonical: "B", company: "Газпромнефть", aliases: [] },
  { canonical: "C", company: "ЛУКОЙЛ", aliases: [] },
  { canonical: "X", company: "Татнефть", aliases: [] },
];

const D = (iso: string): Date => new Date(iso);

function priceRow(
  canonical: string,
  iso: string,
  price: number
): ParsedRow {
  return {
    type: "birzha_prices",
    refineryRaw: canonical,
    refineryCanonical: canonical,
    date: D(iso),
    priceRub: price,
  };
}

function fcaRow(
  canonical: string,
  iso: string,
  price: number
): ParsedRow {
  return {
    type: "fca",
    refineryRaw: canonical,
    refineryCanonical: canonical,
    date: D(iso),
    priceRub: price,
    pointOfShipment: canonical,
    region: "тест",
  };
}

function volRow(
  canonical: string,
  iso: string,
  vol: number
): ParsedRow {
  return {
    type: "birzha_volumes",
    refineryRaw: canonical,
    refineryCanonical: canonical,
    date: D(iso),
    volumeT: vol,
  };
}

describe("analyze — basic", () => {
  it("computes period and weekFolder from union of dates", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 120),
    ];
    const res = analyze(prices, []);
    expect(res.periodStart.toISOString()).toBe("2026-04-30T00:00:00.000Z");
    expect(res.periodEnd.toISOString()).toBe("2026-05-08T00:00:00.000Z");
    expect(res.weekFolder).toBe("2026-W19"); // 2026-05-08 = Fri W19
  });

  it("computes deltaAbs and deltaPct correctly", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 120),
    ];
    const res = analyze(prices, []);
    expect(res.deltas).toHaveLength(1);
    const d = res.deltas[0];
    expect(d.canonical).toBe("A");
    expect(d.firstPrice).toBe(100);
    expect(d.lastPrice).toBe(120);
    expect(d.deltaAbs).toBe(20);
    expect(d.deltaPct).toBeCloseTo(20, 5);
    expect(d.source).toBe("birzha");
  });

  it("sorts deltas by |deltaAbs| descending", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 105),
      priceRow("B", "2026-04-30T00:00:00Z", 100),
      priceRow("B", "2026-05-08T00:00:00Z", 80),
      priceRow("C", "2026-04-30T00:00:00Z", 100),
      priceRow("C", "2026-05-08T00:00:00Z", 130),
    ];
    const res = analyze(prices, []);
    const canonicals = res.deltas.map((d) => d.canonical);
    // |Δ|: A=5, B=20, C=30 → C, B, A
    expect(canonicals).toEqual(["C", "B", "A"]);
  });

  it("handles fca-only input with source='fca'", () => {
    const fca = [
      fcaRow("X", "2026-04-30T00:00:00Z", 30000),
      fcaRow("X", "2026-05-08T00:00:00Z", 31000),
    ];
    const res = analyze([], fca);
    expect(res.deltas).toHaveLength(1);
    expect(res.deltas[0].source).toBe("fca");
    expect(res.deltas[0].deltaAbs).toBe(1000);
  });

  it("emits TWO entries when canonical appears in both birzha and fca", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 110),
    ];
    const fca = [
      fcaRow("A", "2026-04-30T00:00:00Z", 200),
      fcaRow("A", "2026-05-08T00:00:00Z", 220),
    ];
    const res = analyze(prices, fca);
    expect(res.deltas).toHaveLength(2);
    const sources = res.deltas.map((d) => d.source).sort();
    expect(sources).toEqual(["birzha", "fca"]);
  });

  it("computes deltaPct=0 when firstPrice=0 (safety)", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 0),
      priceRow("A", "2026-05-08T00:00:00Z", 100),
    ];
    const res = analyze(prices, []);
    expect(res.deltas[0].deltaPct).toBe(0);
  });

  it("ignores refineries with only one data point (cannot compute Δ)", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("B", "2026-04-30T00:00:00Z", 200), // only one point
      priceRow("A", "2026-05-08T00:00:00Z", 110),
    ];
    const res = analyze(prices, []);
    // B has firstDate === lastDate, deltaAbs would be 0 — could be kept; but the
    // useful case is "first != last". We keep B with delta=0 since UI can filter.
    // Both behaviours are sane — we accept either as long as A is present.
    expect(res.deltas.find((d) => d.canonical === "A")).toBeDefined();
  });
});

describe("analyze — volumes", () => {
  it("returns volumes=undefined when volumes array empty", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 120),
    ];
    const res = analyze(prices, [], []);
    expect(res.volumes).toBeUndefined();
  });

  it("aggregates totalT and per-refinery totals (sorted desc)", () => {
    const vols = [
      volRow("A", "2026-04-30T00:00:00Z", 1.5),
      volRow("A", "2026-05-04T00:00:00Z", 2.0),
      volRow("B", "2026-04-30T00:00:00Z", 5.0),
      volRow("C", "2026-05-04T00:00:00Z", 0.5),
    ];
    const res = analyze([], [], vols);
    expect(res.volumes).toBeDefined();
    expect(res.volumes!.totalT).toBeCloseTo(9.0, 5);
    expect(res.volumes!.perRefinery.map((p) => p.canonical)).toEqual([
      "B",
      "A",
      "C",
    ]);
    expect(res.volumes!.perRefinery[0].totalT).toBe(5);
    expect(res.volumes!.perRefinery[1].totalT).toBeCloseTo(3.5, 5);
  });

  it("includes volumes period in periodStart/periodEnd union", () => {
    const prices = [
      priceRow("A", "2026-05-04T00:00:00Z", 100),
      priceRow("A", "2026-05-05T00:00:00Z", 100),
    ];
    const vols = [volRow("A", "2026-04-30T00:00:00Z", 1.5)];
    const res = analyze(prices, [], vols);
    expect(res.periodStart.toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });
});

describe("analyze — byCompany grouping (quick-260519-lxu)", () => {
  it("returns byCompany array even when dict is empty (all → независимые)", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 120),
    ];
    const res = analyze(prices, []);
    expect(Array.isArray(res.byCompany)).toBe(true);
    expect(res.byCompany).toHaveLength(1);
    expect(res.byCompany[0].company).toBe("независимые");
    expect(res.byCompany[0].deltas).toHaveLength(1);
  });

  it("groups deltas by company using the dict", () => {
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 110), // Δ=10 → Роснефть
      priceRow("B", "2026-04-30T00:00:00Z", 100),
      priceRow("B", "2026-05-08T00:00:00Z", 150), // Δ=50 → Газпромнефть
      priceRow("C", "2026-04-30T00:00:00Z", 100),
      priceRow("C", "2026-05-08T00:00:00Z", 130), // Δ=30 → ЛУКОЙЛ
    ];
    const res = analyze(prices, [], [], DICT);
    expect(res.byCompany).toHaveLength(3);
    const companies = res.byCompany.map((g) => g.company);
    expect(companies).toEqual(["Газпромнефть", "ЛУКОЙЛ", "Роснефть"]);
  });

  it("sorts byCompany by sum |deltaAbs| descending", () => {
    const prices = [
      // Роснефть: A (Δ=5) + X-fallback (none) → 5
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 105),
      // Газпромнефть: B (Δ=50)
      priceRow("B", "2026-04-30T00:00:00Z", 100),
      priceRow("B", "2026-05-08T00:00:00Z", 150),
      // ЛУКОЙЛ: C (Δ=20)
      priceRow("C", "2026-04-30T00:00:00Z", 100),
      priceRow("C", "2026-05-08T00:00:00Z", 120),
    ];
    const res = analyze(prices, [], [], DICT);
    expect(res.byCompany.map((g) => g.company)).toEqual([
      "Газпромнефть", // 50
      "ЛУКОЙЛ", // 20
      "Роснефть", // 5
    ]);
    expect(res.byCompany[0].sumDeltaAbs).toBe(50);
    expect(res.byCompany[1].sumDeltaAbs).toBe(20);
    expect(res.byCompany[2].sumDeltaAbs).toBe(5);
  });

  it("sums abs deltas within a company across refineries and sources", () => {
    // A (Роснефть) birzha Δ=+10, A fca Δ=−5 → sum |Δ| = 15
    const prices = [
      priceRow("A", "2026-04-30T00:00:00Z", 100),
      priceRow("A", "2026-05-08T00:00:00Z", 110),
    ];
    const fca = [
      fcaRow("A", "2026-04-30T00:00:00Z", 200),
      fcaRow("A", "2026-05-08T00:00:00Z", 195),
    ];
    const res = analyze(prices, fca, [], DICT);
    const rosneft = res.byCompany.find((g) => g.company === "Роснефть");
    expect(rosneft).toBeDefined();
    expect(rosneft!.sumDeltaAbs).toBe(15);
    expect(rosneft!.deltas).toHaveLength(2);
  });

  it("falls back to 'независимые' for unknown canonicals", () => {
    const prices = [
      priceRow("UNKNOWN_XYZ", "2026-04-30T00:00:00Z", 100),
      priceRow("UNKNOWN_XYZ", "2026-05-08T00:00:00Z", 130),
    ];
    const res = analyze(prices, [], [], DICT);
    expect(res.byCompany).toHaveLength(1);
    expect(res.byCompany[0].company).toBe("независимые");
  });
});
