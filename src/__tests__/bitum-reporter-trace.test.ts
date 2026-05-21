import { describe, expect, it } from "vitest";
import { renderBitumReport } from "../bitum/reporter.js";
import { loadRefineries } from "../upload/refineries.js";

const dict = loadRefineries();
const today = new Date("2026-05-08T00:00:00Z");
const lastWeek = new Date("2026-05-01T00:00:00Z");

describe("bitum/reporter — cell-trace (REPORT-07)", () => {
  it("trace.length > 0 for any non-empty payload", () => {
    const payload = {
      prices: [
        {
          date: lastWeek,
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          priceRub: 28000,
          sourceCell: "B4",
        },
        {
          date: today,
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          priceRub: 29000,
          sourceCell: "F4",
        },
      ],
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    expect(r.trace.length).toBeGreaterThan(0);
  });

  it("each trace.cell matches Excel A1 regex (single cell or range)", () => {
    const payload = {
      prices: [
        {
          date: lastWeek,
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          priceRub: 28000,
          sourceCell: "B4",
        },
        {
          date: today,
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          priceRub: 29000,
          sourceCell: "F4",
        },
      ],
      volumes: [
        {
          date: today,
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          volumeT: 5000,
          sourceCell: "C4",
        },
      ],
      bitumSnapshot: {
        date: today,
        bnd: {
          price: 28336,
          deltaAbs: 851,
          deltaPct: 3.1,
          priceCell: "F4",
          deltaCell: "G4",
        },
        pbv: {
          price: 30500,
          deltaAbs: 0,
          deltaPct: 0,
          priceCell: "F5",
          deltaCell: "G5",
        },
      },
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    for (const t of r.trace) {
      // single cell "F12" OR range "B4..T18"
      expect(t.cell).toMatch(/^[A-Z]+\d+(\.\.[A-Z]+\d+)?$/);
      expect(t.file).toBeTruthy();
      expect(t.sheet).toBeTruthy();
      expect(t.semantic).toBeTruthy();
    }
  });

  it("snapshot price+delta values appear in trace", () => {
    const payload = {
      bitumSnapshot: {
        date: today,
        bnd: {
          price: 28336,
          deltaAbs: 851,
          deltaPct: 3.1,
          priceCell: "F4",
          deltaCell: "G4",
        },
        pbv: {
          price: 30500,
          deltaAbs: -250,
          deltaPct: -0.8,
          priceCell: "F5",
          deltaCell: "G5",
        },
      },
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    const values = r.trace.map((t) => t.value);
    expect(values).toContain(28336);
    expect(values).toContain(851);
    expect(values).toContain(30500);
    expect(values).toContain(-250);
  });

  it("trace.file matches files.* from payload", () => {
    const payload = {
      bitumSnapshot: {
        date: today,
        bnd: {
          price: 28336,
          deltaAbs: 851,
          deltaPct: 3.1,
          priceCell: "F4",
          deltaCell: "G4",
        },
        pbv: {
          price: 30500,
          deltaAbs: 0,
          deltaPct: 0,
          priceCell: "F5",
          deltaCell: "G5",
        },
      },
      files: {
        bitumPriceNewFile: "bitum_price_new.xlsx",
      },
    };
    const r = renderBitumReport(payload as any, { dict });
    expect(r.trace.every((t) => t.file === "bitum_price_new.xlsx")).toBe(true);
  });
});
