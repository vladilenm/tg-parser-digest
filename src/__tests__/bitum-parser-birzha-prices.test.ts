import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseBirzhaPrices } from "../bitum/parsers/birzha-prices.js";
import { loadRefineries } from "../upload/refineries.js";

const FIXTURES_DIR = path.resolve("docs/examples");
const FIXTURE_PATH = path.join(FIXTURES_DIR, "birzha — цены НПЗ.xlsx");
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

describe("bitum/parsers/birzha-prices", () => {
  const dict = loadRefineries();

  it.skipIf(!FIXTURE_AVAILABLE)(
    "parses real fixture without errors, returns >0 rows",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r = await parseBirzhaPrices(buf, dict);
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.errors).toHaveLength(0);
    },
  );

  it.skipIf(!FIXTURE_AVAILABLE)(
    "priceRub значения корректны: >10000 руб/т после ×1000 multiplier",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r = await parseBirzhaPrices(buf, dict);
      const avg =
        r.rows.reduce((s, x) => s + x.priceRub, 0) / r.rows.length;
      expect(avg).toBeGreaterThan(10000);
      expect(avg).toBeLessThan(200000);
    },
  );

  it.skipIf(!FIXTURE_AVAILABLE)(
    "header 'БНД-Саратовский НПЗ' нормализуется (БНД- prefix stripped)",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r = await parseBirzhaPrices(buf, dict);
      const noBnd = r.rows.filter((x) => x.refineryRaw.startsWith("БНД-"));
      expect(noBnd).toHaveLength(0);
    },
  );

  it.skipIf(!FIXTURE_AVAILABLE)(
    "BITUM-PARSE-06 идемпотентность: parse(buf) дважды → identical results",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r1 = await parseBirzhaPrices(buf, dict);
      const r2 = await parseBirzhaPrices(buf, dict);
      expect(r1.rows.length).toBe(r2.rows.length);
      if (r1.rows.length > 0) {
        expect(r1.rows[0]).toEqual(r2.rows[0]);
      }
    },
  );

  it("empty workbook → errors[0], rows=[]", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseBirzhaPrices(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].reason).toContain("no worksheets");
  });

  it("synthetic: parses single row with sourceCell address", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Цена битум на бирже, руб./тонн";
    ws.getCell("B3").value = "БНД-Саратовский НПЗ";
    ws.getCell("A4").value = new Date("2026-05-08T00:00:00Z");
    ws.getCell("B4").value = 28; // 28 тыс.руб/т → 28000 руб
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseBirzhaPrices(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].priceRub).toBe(28000);
    expect(r.rows[0].refineryRaw).toBe("Саратовский НПЗ");
    expect(r.rows[0].sourceCell).toBe("B4");
  });
});
