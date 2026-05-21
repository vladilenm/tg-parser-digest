import { describe, expect, it } from "vitest";
import { renderBitumReport } from "../bitum/reporter.js";
import { loadRefineries } from "../upload/refineries.js";

describe("bitum/reporter — fixed holding order (per checker B3)", () => {
  const dict = loadRefineries();

  it("HTML sections appear in fixed order: Роснефть → Газпромнефть → ЛУКОЙЛ → Прочие", () => {
    const today = new Date("2026-05-08T00:00:00Z");
    const lastWeek = new Date("2026-05-01T00:00:00Z");
    const mkRow = (refineryCanonical: string, priceRub: number, date: Date) => ({
      date,
      refineryCanonical,
      refineryRaw: refineryCanonical,
      priceRub,
      sourceCell: "B4",
    });
    const payload = {
      prices: [
        mkRow("Саратовский НПЗ", 28000, lastWeek),
        mkRow("Саратовский НПЗ", 29000, today),
        mkRow("Газпромнефть-Омский НПЗ", 30000, lastWeek),
        mkRow("Газпромнефть-Омский НПЗ", 31000, today),
        mkRow("Волгограднефтепереработка", 27000, lastWeek),
        mkRow("Волгограднефтепереработка", 27500, today),
        mkRow("НПЗ Таиф-НК", 30000, lastWeek),
        mkRow("НПЗ Таиф-НК", 30500, today),
      ],
      files: { birzhaPricesFile: "birzha_prices.xlsx" },
    };
    const r = renderBitumReport(payload as any, { dict });
    // Ищем индекс CYRA "### <name>" чтобы избежать ложного срабатывания на словах в тексте.
    const idxRos = r.html.indexOf("### Роснефть");
    const idxGpn = r.html.indexOf("### Газпромнефть");
    const idxLuk = r.html.indexOf("### ЛУКОЙЛ");
    const idxOth = r.html.indexOf("### Прочие и независимые");
    expect(idxRos).toBeGreaterThanOrEqual(0);
    expect(idxGpn).toBeGreaterThanOrEqual(0);
    expect(idxLuk).toBeGreaterThanOrEqual(0);
    expect(idxOth).toBeGreaterThanOrEqual(0);
    expect(idxRos).toBeLessThan(idxGpn);
    expect(idxGpn).toBeLessThan(idxLuk);
    expect(idxLuk).toBeLessThan(idxOth);
  });
});
