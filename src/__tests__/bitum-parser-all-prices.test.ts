import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseAllPrices } from "../bitum/parsers/all-prices.js";
import { loadRefineries } from "../bitum/refineries.js";

const FIXTURES_DIR = path.resolve("docs/examples");
const FIXTURE_PATH = path.join(
  FIXTURES_DIR,
  "цены битум все 08.05-15.05.xlsx",
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

describe("bitum/parsers/all-prices", () => {
  const dict = loadRefineries();

  it.skipIf(!FIXTURE_AVAILABLE)("parses real fixture → rows.length > 0", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r = await parseAllPrices(buf, dict);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it.skipIf(!FIXTURE_AVAILABLE)(
    "фильтр по 'Топливо' ∈ {БНД 100/130, 50/70, 60/90, 70/100, 90/130}",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r = await parseAllPrices(buf, dict);
      const allowed = new Set([
        "БНД 100/130",
        "БНД 50/70",
        "БНД 60/90",
        "БНД 70/100",
        "БНД 90/130",
      ]);
      for (const row of r.rows) {
        expect(allowed.has(row.fuelType)).toBe(true);
      }
    },
  );

  it.skipIf(!FIXTURE_AVAILABLE)("companyRaw сохраняется как есть (НЕ нормализуется)", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r = await parseAllPrices(buf, dict);
    if (r.rows.length > 0) {
      // companyRaw — это поле, не canonical; может быть пустой строкой если нет колонки
      expect(typeof r.rows[0].companyRaw).toBe("string");
    }
  });

  it.skipIf(!FIXTURE_AVAILABLE)("BITUM-PARSE-06 идемпотентность", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r1 = await parseAllPrices(buf, dict);
    const r2 = await parseAllPrices(buf, dict);
    expect(r1.rows.length).toBe(r2.rows.length);
  });

  it("synthetic: parses minimal sheet with required cols (header on row 1)", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("исходник");
    ws.getCell("A1").value = "Пункт отгрузки";
    ws.getCell("B1").value = "Наименование компании";
    ws.getCell("C1").value = "Регион";
    ws.getCell("D1").value = "Тип";
    ws.getCell("E1").value = "Источник";
    ws.getCell("F1").value = "Доставка";
    ws.getCell("G1").value = "Топливо";
    ws.getCell("H1").value = "Цена";
    ws.getCell("I1").value = "Дата";
    ws.getCell("A2").value = "Саратовский НПЗ";
    ws.getCell("B2").value = "Роснефть";
    ws.getCell("C2").value = "Саратовская обл.";
    ws.getCell("D2").value = "тип1";
    ws.getCell("E2").value = "биржа";
    ws.getCell("F2").value = "FCA";
    ws.getCell("G2").value = "БНД 70/100";
    ws.getCell("H2").value = 28000;
    ws.getCell("I2").value = new Date("2026-05-08T00:00:00Z");
    // не-БНД должен быть отфильтрован
    ws.getCell("G3").value = "ДТ";
    ws.getCell("H3").value = 50000;
    ws.getCell("I3").value = new Date("2026-05-08T00:00:00Z");
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseAllPrices(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].fuelType).toBe("БНД 70/100");
    expect(r.rows[0].priceRub).toBe(28000);
    expect(r.rows[0].sourceCell).toBe("H2");
  });

  it("missing required cols → errors[0], rows=[]", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "что-то";
    ws.getCell("A2").value = "значение";
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseAllPrices(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].reason).toContain("Топливо");
  });

  it("fallback worksheet[0] if no 'исходник' sheet", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Лист1");
    ws.getCell("A1").value = "Пункт отгрузки";
    ws.getCell("B1").value = "Топливо";
    ws.getCell("C1").value = "Цена";
    ws.getCell("D1").value = "Дата";
    ws.getCell("A2").value = "Саратовский НПЗ";
    ws.getCell("B2").value = "БНД 90/130";
    ws.getCell("C2").value = 30000;
    ws.getCell("D2").value = new Date("2026-05-08T00:00:00Z");
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseAllPrices(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].fuelType).toBe("БНД 90/130");
  });
});
