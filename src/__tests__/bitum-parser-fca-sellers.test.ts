import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseFcaSellers } from "../bitum/parsers/fca-sellers.js";
import { loadRefineries } from "../bitum/refineries.js";

const FIXTURES_DIR = path.resolve("docs/examples");
const FIXTURE_PATH = path.join(FIXTURES_DIR, "BITUM — таблица продавцы.xlsx");
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

describe("bitum/parsers/fca-sellers", () => {
  const dict = loadRefineries();

  it.skipIf(!FIXTURE_AVAILABLE)("parses real fixture без errors", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r = await parseFcaSellers(buf, dict);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.errors).toHaveLength(0);
  });

  it.skipIf(!FIXTURE_AVAILABLE)('source === "fca" для всех rows', async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r = await parseFcaSellers(buf, dict);
    for (const row of r.rows) {
      expect(row.source).toBe("fca");
    }
  });

  it.skipIf(!FIXTURE_AVAILABLE)(
    "BITUM-PARSE-06 идемпотентность",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r1 = await parseFcaSellers(buf, dict);
      const r2 = await parseFcaSellers(buf, dict);
      expect(r1.rows.length).toBe(r2.rows.length);
    },
  );

  it("synthetic: single row с point+region+priceRub>0", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Битум цены продавцов FCA, руб./тонн";
    ws.getCell("A3").value = "Пункт отгрузки";
    ws.getCell("B3").value = "Регион";
    ws.getCell("C3").value = new Date("2026-05-08T00:00:00Z");
    ws.getCell("A4").value = "Саратовский НПЗ";
    ws.getCell("B4").value = "Саратовская область";
    ws.getCell("C4").value = 28000;
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseFcaSellers(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].source).toBe("fca");
    expect(r.rows[0].pointOfShipment).toBe("Саратовский НПЗ");
    expect(r.rows[0].region).toBe("Саратовская область");
    expect(r.rows[0].priceRub).toBe(28000);
    expect(r.rows[0].refineryCanonical).toBe("Саратовский НПЗ");
    expect(r.rows[0].sourceCell).toBe("C4");
  });

  it("empty workbook → errors[0]", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseFcaSellers(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
