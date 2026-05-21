import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseBitumPriceNew } from "../bitum/parsers/bitum-price-new.js";

const FIXTURES_DIR = path.resolve("docs/examples");
const FIXTURE_PATH = path.join(
  FIXTURES_DIR,
  "bitum_price — Сводная таблица_new.xlsx",
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

interface RowSpec {
  date: Date;
  refinery: string;
  bndPrice?: number;
  bndChange?: number | string;
  pbvPrice?: number;
  pbvChange?: number | string;
}

async function buildWideSheet(rows: RowSpec[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Chart data");
  ws.getCell("A1").value = "Дата";
  ws.getCell("B1").value = "Пункт отгрузки";
  ws.getCell("C1").value = "Компания";
  ws.getCell("D1").value = "Вид базиса";
  ws.getCell("E1").value = "Вид цен";
  ws.getCell("F1").value = "БНД - Цена недели";
  ws.getCell("G1").value = "БНД - Изменение";
  ws.getCell("H1").value = "ПБВ - Цена недели";
  ws.getCell("I1").value = "ПБВ - Изменение";
  for (let i = 0; i < rows.length; i++) {
    const r = i + 2;
    const row = rows[i];
    ws.getCell(`A${r}`).value = row.date;
    ws.getCell(`B${r}`).value = row.refinery;
    ws.getCell(`F${r}`).value = row.bndPrice ?? null;
    ws.getCell(`G${r}`).value = row.bndChange ?? "не изм.";
    ws.getCell(`H${r}`).value = row.pbvPrice ?? null;
    ws.getCell(`I${r}`).value = row.pbvChange ?? "не изм.";
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

describe("bitum/parsers/bitum-price-new (wide-table snapshot)", () => {
  it.skipIf(!FIXTURE_AVAILABLE)(
    "parses real fixture → 1 snapshot with positive averaged БНД+ПБВ prices",
    async () => {
      const buf = readFileSync(FIXTURE_PATH);
      const r = await parseBitumPriceNew(buf);
      expect(r.errors).toHaveLength(0);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].bnd.price).toBeGreaterThan(0);
      expect(r.rows[0].pbv.price).toBeGreaterThan(0);
    },
  );

  it("synthetic: 3 НПЗ × БНД/ПБВ → averaged snapshot", async () => {
    const date = new Date("2026-05-15T00:00:00Z");
    const buf = await buildWideSheet([
      { date, refinery: "АБЗ Хохольский", bndPrice: 31250, pbvPrice: 41000 },
      { date, refinery: "Ангарская НХК", bndPrice: 33000 },
      { date, refinery: "Армбитум", pbvPrice: 38500 },
    ]);
    const r = await parseBitumPriceNew(buf);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].bnd.price).toBe(Math.round((31250 + 33000) / 2));
    expect(r.rows[0].pbv.price).toBe(Math.round((41000 + 38500) / 2));
    expect(r.rows[0].bnd.priceCell).toBe("F2");
    expect(r.rows[0].pbv.priceCell).toBe("H2");
  });

  it("missing БНД/ПБВ price columns → error", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Дата";
    ws.getCell("B1").value = "Other";
    const ab = await wb.xlsx.writeBuffer();
    const r = await parseBitumPriceNew(Buffer.from(ab));
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].reason).toContain("БНД/ПБВ");
  });

  it("no rows with valid БНД price → error", async () => {
    const date = new Date("2026-05-15");
    const buf = await buildWideSheet([
      { date, refinery: "X", pbvPrice: 40000 },
    ]);
    const r = await parseBitumPriceNew(buf);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].reason).toContain("БНД");
  });

  it("idempotence: parse(buf) twice → identical snapshot", async () => {
    const date = new Date("2026-05-15");
    const buf = await buildWideSheet([
      { date, refinery: "A", bndPrice: 28336, bndChange: 851, pbvPrice: 30500 },
      { date, refinery: "B", bndPrice: 30000, pbvPrice: 32000 },
    ]);
    const r1 = await parseBitumPriceNew(buf);
    const r2 = await parseBitumPriceNew(buf);
    expect(r1.rows[0]).toEqual(r2.rows[0]);
  });

  it("deltaAbs is averaged across numeric changes (text counts as 0)", async () => {
    const date = new Date("2026-05-15");
    const buf = await buildWideSheet([
      { date, refinery: "A", bndPrice: 30000, bndChange: 1000, pbvPrice: 40000, pbvChange: -500 },
      { date, refinery: "B", bndPrice: 30000, bndChange: "не изм.", pbvPrice: 40000 },
    ]);
    const r = await parseBitumPriceNew(buf);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0].bnd.deltaAbs).toBe(Math.round((1000 + 0) / 2));
    expect(r.rows[0].pbv.deltaAbs).toBe(Math.round((-500 + 0) / 2));
  });
});
