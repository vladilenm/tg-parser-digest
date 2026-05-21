import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  deltasFor,
  volumeTotals,
  byCompanyFixedOrder,
  crossCheck,
} from "../bitum/analyzer.js";
import { loadRefineries } from "../upload/refineries.js";

const dict = loadRefineries();

describe("bitum/analyzer", () => {
  describe("deltasFor", () => {
    it("computes Δ first→last per canonical", () => {
      const rows = [
        {
          date: new Date("2026-05-01"),
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          priceRub: 27000,
          sourceCell: "B4",
        },
        {
          date: new Date("2026-05-08"),
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          priceRub: 28000,
          sourceCell: "F4",
        },
      ];
      const out = deltasFor(rows, "birzha");
      expect(out).toHaveLength(1);
      expect(out[0].deltaAbs).toBe(1000);
      expect(out[0].source).toBe("birzha");
      expect(out[0].firstCell).toBe("B4");
      expect(out[0].lastCell).toBe("F4");
    });

    it("zero first price → deltaPct=0 (safety)", () => {
      const rows = [
        {
          date: new Date("2026-05-01"),
          refineryCanonical: "X",
          priceRub: 1,
          sourceCell: "B4",
        },
      ];
      const out = deltasFor(rows, "fca");
      expect(out[0].deltaPct).toBe(0);
    });
  });

  describe("volumeTotals", () => {
    it("sums by canonical, sorts desc, attaches company", () => {
      const rows = [
        {
          date: new Date("2026-05-01"),
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          volumeT: 1000,
          sourceCell: "C4",
        },
        {
          date: new Date("2026-05-08"),
          refineryCanonical: "Саратовский НПЗ",
          refineryRaw: "Саратовский НПЗ",
          volumeT: 2000,
          sourceCell: "G4",
        },
        {
          date: new Date("2026-05-08"),
          refineryCanonical: "МПК КРЗ",
          refineryRaw: "МПК КРЗ",
          volumeT: 500,
          sourceCell: "G5",
        },
      ];
      const totals = volumeTotals(rows, dict);
      expect(totals.totalT).toBe(3500);
      expect(totals.perRefinery[0].canonical).toBe("Саратовский НПЗ");
      expect(totals.perRefinery[0].totalT).toBe(3000);
      expect(totals.perRefinery[0].company).toBe("Роснефть");
      expect(totals.perRefinery[1].canonical).toBe("МПК КРЗ");
      expect(totals.perRefinery[1].company).toBe("независимые");
    });
  });

  describe("byCompanyFixedOrder", () => {
    const mkDelta = (canonical: string, deltaAbs: number) => ({
      canonical,
      firstDate: new Date("2026-05-01"),
      firstPrice: 25000,
      lastDate: new Date("2026-05-08"),
      lastPrice: 25000 + deltaAbs,
      deltaAbs,
      deltaPct: 0,
      source: "birzha" as const,
    });

    it("returns groups in fixed order [Роснефть, Газпромнефть, ЛУКОЙЛ, Прочие]", () => {
      const out = byCompanyFixedOrder(
        [
          mkDelta("Саратовский НПЗ", 1000), // Роснефть
          mkDelta("Газпромнефть-Омский НПЗ", 50), // Газпромнефть
          mkDelta("Волгограднефтепереработка", 100), // ЛУКОЙЛ
          mkDelta("НПЗ Таиф-НК", 200), // Татнефть → Прочие
        ],
        dict,
      );
      expect(out).toHaveLength(4);
      expect(out[0].company).toBe("Роснефть");
      expect(out[1].company).toBe("Газпромнефть");
      expect(out[2].company).toBe("ЛУКОЙЛ");
      expect(out[3].company).toBe("Прочие");
    });

    it("Татнефть и независимые попадают в 'Прочие'", () => {
      const out = byCompanyFixedOrder(
        [mkDelta("НПЗ Таиф-НК", 100), mkDelta("МПК КРЗ", 50)],
        dict,
      );
      const proch = out.find((g) => g.company === "Прочие")!;
      expect(proch.deltas).toHaveLength(2);
    });

    it("empty groups returned with deltas:[] и sumDeltaAbs:0", () => {
      const out = byCompanyFixedOrder([mkDelta("Саратовский НПЗ", 1000)], dict);
      const lukoil = out.find((g) => g.company === "ЛУКОЙЛ")!;
      expect(lukoil.deltas).toHaveLength(0);
      expect(lukoil.sumDeltaAbs).toBe(0);
    });

    it("sumDeltaAbs uses Math.abs (negative deltas counted)", () => {
      const out = byCompanyFixedOrder(
        [mkDelta("Саратовский НПЗ", 1000), mkDelta("Сызранский НПЗ", -500)],
        dict,
      );
      const rosn = out.find((g) => g.company === "Роснефть")!;
      expect(rosn.sumDeltaAbs).toBe(1500);
    });
  });

  describe("crossCheck", () => {
    const today = new Date("2026-05-08");
    it("no warning when diff <= threshold", () => {
      const out = crossCheck(
        [
          {
            canonical: "Саратовский НПЗ",
            price: 28000,
            date: today,
            source: "bitum_price_new",
          },
        ],
        [
          {
            canonical: "Саратовский НПЗ",
            price: 28100,
            date: today,
            source: "fca_sellers",
          },
        ],
        0.01,
      );
      // diff 100/28100 ~ 0.36% < 1% → no warning
      expect(out).toHaveLength(0);
    });

    it("warning when diff > threshold", () => {
      const out = crossCheck(
        [
          {
            canonical: "Саратовский НПЗ",
            price: 28000,
            date: today,
            source: "bitum_price_new",
          },
        ],
        [
          {
            canonical: "Саратовский НПЗ",
            price: 30000,
            date: today,
            source: "fca_sellers",
          },
        ],
        0.01,
      );
      // diff 2000/30000 ~ 6.7% > 1% → warning
      expect(out).toHaveLength(1);
      expect(out[0].source1).toBe("bitum_price_new");
      expect(out[0].source2).toBe("fca_sellers");
    });

    it("default threshold from env BITUM_CROSS_CHECK_THRESHOLD", () => {
      const prev = process.env.BITUM_CROSS_CHECK_THRESHOLD;
      process.env.BITUM_CROSS_CHECK_THRESHOLD = "0.05";
      const out = crossCheck(
        [
          {
            canonical: "Саратовский НПЗ",
            price: 28000,
            date: today,
            source: "all_prices",
          },
        ],
        [
          {
            canonical: "Саратовский НПЗ",
            price: 29000,
            date: today,
            source: "fca_sellers",
          },
        ],
      );
      // 1000/29000 ~ 3.4%, threshold 5% → no warning
      expect(out).toHaveLength(0);
      if (prev === undefined) delete process.env.BITUM_CROSS_CHECK_THRESHOLD;
      else process.env.BITUM_CROSS_CHECK_THRESHOLD = prev;
    });

    it("no canonical match → skip", () => {
      const out = crossCheck(
        [
          {
            canonical: "X",
            price: 28000,
            date: today,
            source: "bitum_price_new",
          },
        ],
        [
          {
            canonical: "Y",
            price: 30000,
            date: today,
            source: "fca_sellers",
          },
        ],
      );
      expect(out).toHaveLength(0);
    });
  });
});
