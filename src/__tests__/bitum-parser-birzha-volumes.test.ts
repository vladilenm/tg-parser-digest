import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseBirzhaVolumes } from "../bitum/parsers/birzha-volumes.js";
import { loadRefineries } from "../bitum/refineries.js";

const FIXTURES_DIR = path.resolve("docs/examples");
const FIXTURE_PATH = path.join(FIXTURES_DIR, "birzha — суточная по НПЗ.xlsx");
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

describe("bitum/parsers/birzha-volumes", () => {
  const dict = loadRefineries();

  it.skipIf(!FIXTURE_AVAILABLE)("parses real fixture without errors", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r = await parseBirzhaVolumes(buf, dict);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.errors).toHaveLength(0);
  });

  it.skipIf(!FIXTURE_AVAILABLE)("volumeT в тоннах (×1000 от тыс.т)", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r = await parseBirzhaVolumes(buf, dict);
    const maxV = Math.max(...r.rows.map((x) => x.volumeT));
    // Реальные объёмы: 0.1-10 тыс.т → 100-10000 т после ×1000
    expect(maxV).toBeGreaterThan(100);
  });

  it.skipIf(!FIXTURE_AVAILABLE)(
    "column B 'Объем итого' пропускается (не в rows)",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r = await parseBirzhaVolumes(buf, dict);
      const totalsRows = r.rows.filter((x) =>
        x.refineryRaw.toLowerCase().includes("итого"),
      );
      expect(totalsRows).toHaveLength(0);
    },
  );

  it.skipIf(!FIXTURE_AVAILABLE)("BITUM-PARSE-06 идемпотентность", async () => {
    const buf = readFileSync(FIXTURE_PATH);
    const r1 = await parseBirzhaVolumes(buf, dict);
    const r2 = await parseBirzhaVolumes(buf, dict);
    expect(r1.rows.length).toBe(r2.rows.length);
  });

  it("synthetic: B column 'Объем итого' skipped, C+ extracted with x1000", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Объем битум на бирже, тыс. тонн";
    ws.getCell("B3").value = "Объем итого, тыс.тн.";
    ws.getCell("C3").value = "Объем, тыс. тонн: Саратовский НПЗ";
    ws.getCell("A4").value = new Date("2026-05-08T00:00:00Z");
    ws.getCell("B4").value = 999; // итого - игнор
    ws.getCell("C4").value = 1.5; // 1.5 тыс.т → 1500
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseBirzhaVolumes(Buffer.from(ab), dict);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].volumeT).toBe(1500);
    expect(r.rows[0].refineryRaw).toBe("Саратовский НПЗ");
    expect(r.rows[0].sourceCell).toBe("C4");
  });
});
