import { describe, expect, it } from "vitest";
import { renderBitumReport, chunkBitumHtml } from "../bitum/reporter.js";
import { loadRefineries } from "../bitum/refineries.js";

const dict = loadRefineries();
const today = new Date("2026-05-08T00:00:00Z");
const lastWeek = new Date("2026-05-01T00:00:00Z");

const mkPriceRow = (canonical: string, price: number, date: Date, cell = "B4") => ({
  date,
  refineryCanonical: canonical,
  refineryRaw: canonical,
  priceRub: price,
  sourceCell: cell,
});

const mkVolumeRow = (canonical: string, vol: number, date: Date, cell = "C4") => ({
  date,
  refineryCanonical: canonical,
  refineryRaw: canonical,
  volumeT: vol,
  sourceCell: cell,
});

describe("bitum/reporter", () => {
  it("full payload — все секции algoritm.md §6 в html", () => {
    const payload = {
      prices: [
        mkPriceRow("Саратовский НПЗ", 28000, lastWeek, "B4"),
        mkPriceRow("Саратовский НПЗ", 29000, today, "F4"),
      ],
      volumes: [
        mkVolumeRow("Саратовский НПЗ", 5000, today, "C4"),
      ],
      fca: [],
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
      files: {
        birzhaPricesFile: "birzha_prices.xlsx",
        birzhaVolumesFile: "birzha_volumes.xlsx",
        bitumPriceNewFile: "bitum_price_new.xlsx",
      },
    };
    const r = renderBitumReport(payload as any, { dict });
    expect(r.html).toContain("Период:");
    expect(r.html).toContain("средняя цена");
    expect(r.html).toContain("Объёмы биржевых торгов");
    expect(r.html).toContain("Роснефть");
    expect(r.html).toContain("Газпромнефть");
    expect(r.html).toContain("ЛУКОЙЛ");
    expect(r.html).toContain("Прочие");
    expect(r.html).toContain("Источники:");
  });

  it("partial render: только prices → warning блок + (нет данных) для missing", () => {
    const payload = {
      prices: [mkPriceRow("Саратовский НПЗ", 28000, today)],
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    expect(r.html).toContain("Доступно");
    expect(r.html).toContain("/5 типов");
    expect(r.html).toContain("нет данных");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("ЛУКОЙЛ без movements → 'Цены остались без изменений'", () => {
    // Только Роснефть и Газпромнефть в payload — ЛУКОЙЛ группа пустая
    const payload = {
      prices: [
        mkPriceRow("Саратовский НПЗ", 28000, lastWeek),
        mkPriceRow("Саратовский НПЗ", 29000, today),
      ],
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    // ЛУКОЙЛ должен быть с "Цены остались без изменений"
    const lukoilIdx = r.html.indexOf("ЛУКОЙЛ");
    const nextSection = r.html.indexOf("Прочие");
    const lukoilBlock = r.html.slice(lukoilIdx, nextSection);
    expect(lukoilBlock).toContain("Цены остались без изменений");
  });

  it("cross-check warning when bitumSnapshot ↔ fca diverge > threshold", () => {
    const payload = {
      fca: [
        {
          date: today,
          refineryCanonical: "БНД snapshot",
          region: "",
          pointOfShipment: "БНД snapshot",
          priceRub: 50000,
          source: "fca" as const,
          sourceCell: "C4",
        },
      ],
      bitumSnapshot: {
        date: today,
        bnd: {
          price: 28000,
          deltaAbs: 0,
          deltaPct: 0,
          priceCell: "F4",
          deltaCell: "G4",
        },
        pbv: {
          price: 30000,
          deltaAbs: 0,
          deltaPct: 0,
          priceCell: "F5",
          deltaCell: "G5",
        },
      },
      files: {},
    };
    const r = renderBitumReport(payload as any, {
      dict,
      crossCheckThreshold: 0.01,
    });
    expect(r.html).toContain("Цены расходятся");
    expect(r.warnings.some((w) => w.includes("Cross-check"))).toBe(true);
  });

  it("HTML whitelist: no <h1>/<h2>/<h3>/<hr>/<br>/<p>/<div>/<span>", () => {
    const payload = {
      prices: [
        mkPriceRow("Саратовский НПЗ", 28000, lastWeek),
        mkPriceRow("Саратовский НПЗ", 29000, today),
      ],
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    expect(r.html).not.toMatch(/<h[1-6]>/i);
    expect(r.html).not.toMatch(/<hr>/i);
    expect(r.html).not.toMatch(/<br>/i);
    expect(r.html).not.toMatch(/<p>/i);
    expect(r.html).not.toMatch(/<div>/i);
    expect(r.html).not.toMatch(/<span>/i);
  });

  it("chunkBitumHtml: < 4000 → 1 part; > 4000 → N parts with prefix", () => {
    const short = "<b>short</b>";
    expect(chunkBitumHtml(short)).toEqual([short]);

    const big = Array.from({ length: 500 }, () => "<b>line</b>").join("\n\n");
    const parts = chunkBitumHtml(big);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4000);
    }
    expect(parts[0]).toMatch(/^\(1\/\d+\)\n/);
  });

  it("Sources footer is wrapped in <code> tag", () => {
    const payload = {
      prices: [
        mkPriceRow("Саратовский НПЗ", 28000, lastWeek),
        mkPriceRow("Саратовский НПЗ", 29000, today),
      ],
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    expect(r.html).toContain("<code>");
    expect(r.html).toContain("Источники:");
  });

  it("env BITUM_VOLUMES_TOP_N respected", () => {
    const prev = process.env.BITUM_VOLUMES_TOP_N;
    process.env.BITUM_VOLUMES_TOP_N = "2";
    const payload = {
      volumes: [
        mkVolumeRow("A", 5000, today, "C4"),
        mkVolumeRow("B", 4000, today, "C5"),
        mkVolumeRow("C", 3000, today, "C6"),
        mkVolumeRow("D", 2000, today, "C7"),
      ],
      files: {},
    };
    const r = renderBitumReport(payload as any, { dict });
    const volBlockStart = r.html.indexOf("Объёмы биржевых");
    const nextHeader = r.html.indexOf("###", volBlockStart + 1);
    const volBlock = r.html.slice(
      volBlockStart,
      nextHeader > 0 ? nextHeader : r.html.length,
    );
    // Только 2 НПЗ должны быть выведены
    const bullets = (volBlock.match(/\n- /g) ?? []).length;
    expect(bullets).toBe(2);
    if (prev === undefined) delete process.env.BITUM_VOLUMES_TOP_N;
    else process.env.BITUM_VOLUMES_TOP_N = prev;
  });
});
