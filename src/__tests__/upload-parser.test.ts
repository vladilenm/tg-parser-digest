// src/__tests__/upload-parser.test.ts — vitest для parseWorkbook.
// Строит in-memory workbook'и через ExcelJS, проверяет три layout'а.
//
// NOTE: ExcelJS row.values с массивом-аргументом использует sparse convention:
//   - values[0] игнорируется, values[1] = col 1, values[2] = col 2, и т.д.
// Чтобы избежать путаницы, используем явный getCell(col).value = X.

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  parseWorkbook,
  excelSerialToDate,
} from "../upload/parser.js";
import type { RefineryEntry } from "../upload/types.js";

const DICT: RefineryEntry[] = [
  {
    canonical: "Газпромнефть-Омский НПЗ",
    company: "Газпромнефть",
    aliases: ["Омский НПЗ"],
  },
  { canonical: "Ангарская НХК", company: "Роснефть", aliases: [] },
  {
    canonical: "Волгограднефтепереработка",
    company: "ЛУКОЙЛ",
    aliases: [],
  },
];

async function bufferOf(wb: ExcelJS.Workbook): Promise<Buffer> {
  const bytes = await wb.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

function setRow(ws: ExcelJS.Worksheet, rowIdx: number, vals: unknown[]): void {
  const row = ws.getRow(rowIdx);
  for (let i = 0; i < vals.length; i++) {
    // col index is 1-based; vals[i] → col i+1.
    row.getCell(i + 1).value = vals[i] as ExcelJS.CellValue;
  }
}

describe("excelSerialToDate", () => {
  it("converts Excel serial 46142 to 2026-04-30 UTC", () => {
    const d = excelSerialToDate(46142);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(3); // April (0-indexed)
    expect(d.getUTCDate()).toBe(30);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it("round-trips known Excel epoch (serial 2 → 1900-01-01)", () => {
    // Due to 1900 leap-year bug, Excel epoch is 1899-12-30.
    // serial 1 → 1899-12-31, serial 2 → 1900-01-01.
    const d = excelSerialToDate(2);
    expect(d.toISOString().slice(0, 10)).toBe("1900-01-01");
  });
});

describe("parseWorkbook birzha_prices", () => {
  async function makeWb(): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Цена битум на бирже, руб./тонн";
    setRow(ws, 3, ["Период", "Омский НПЗ", "Ангарская НХК"]);
    setRow(ws, 4, [new Date(Date.UTC(2026, 3, 30)), 31800, 33750]);
    setRow(ws, 5, [new Date(Date.UTC(2026, 4, 4)), "", 33500]);
    return wb;
  }

  it("produces ParsedRow per non-empty (date, refinery, price)", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "birzha_prices", DICT);
    // 3 non-empty cells: r4c2, r4c3, r5c3
    expect(rows.length).toBe(3);
  });

  it("normalises refinery name via dict (alias Омский НПЗ → canonical)", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "birzha_prices", DICT);
    const omsk = rows.find((r) => r.refineryRaw === "Омский НПЗ");
    expect(omsk?.refineryCanonical).toBe("Газпромнефть-Омский НПЗ");
  });

  it("populates priceRub and date, leaves volume undefined", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "birzha_prices", DICT);
    for (const r of rows) {
      expect(typeof r.priceRub).toBe("number");
      expect(r.volumeT).toBeUndefined();
      expect(r.date).toBeInstanceOf(Date);
      expect(r.type).toBe("birzha_prices");
    }
  });
});

describe("parseWorkbook birzha_volumes", () => {
  async function makeWb(): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Объем битум на бирже, тыс. тонн";
    // Row 3: A=Период, B=Объем итого, C+ = refineries.
    // NOTE: real files have leading whitespace in C+ headers; we mirror that.
    setRow(ws, 3, [
      "Период",
      "Объем итого, тыс.тн.",
      " Ангарская НХК",
      " Омский НПЗ",
    ]);
    setRow(ws, 4, [new Date(Date.UTC(2026, 3, 30)), 4.15, 1.298, 0.27]);
    return wb;
  }

  it("ignores column B (Объем итого) — we compute totals ourselves", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "birzha_volumes", DICT);
    // 2 cells (C, D) for 1 row → 2 rows. Column B excluded.
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.refineryCanonical).not.toMatch(/итого/i);
    }
  });

  it("trims leading whitespace in refinery names and normalises", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "birzha_volumes", DICT);
    const omsk = rows.find((r) => r.refineryRaw.trim() === "Омский НПЗ");
    expect(omsk?.refineryCanonical).toBe("Газпромнефть-Омский НПЗ");
  });

  it("populates volumeT, leaves priceRub undefined", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "birzha_volumes", DICT);
    for (const r of rows) {
      expect(typeof r.volumeT).toBe("number");
      expect(r.priceRub).toBeUndefined();
      expect(r.type).toBe("birzha_volumes");
    }
  });
});

describe("parseWorkbook fca (transposed)", () => {
  async function makeWb(): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Битум цены продавцов FCA, руб./тонн";
    // Row 3: A=Пункт отгрузки, B=Регион, C+ = dates
    setRow(ws, 3, [
      "Пункт отгрузки",
      "Регион",
      new Date(Date.UTC(2026, 3, 30)),
      new Date(Date.UTC(2026, 4, 8)),
    ]);
    // Row 4: Волгограднефтепереработка | Волгоградская область | 30500 | 30800
    setRow(ws, 4, [
      "Волгограднефтепереработка",
      "Волгоградская область",
      30500,
      30800,
    ]);
    // Row 5: Омский НПЗ | Омская | "" | 31000  — alias resolution + empty cell
    setRow(ws, 5, ["Омский НПЗ", "Омская область", "", 31000]);
    return wb;
  }

  it("produces one row per (date, point, price) ignoring empty prices", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "fca", DICT);
    // 3 cells with prices (r4c3, r4c4, r5c4) — r5c3 empty.
    expect(rows.length).toBe(3);
  });

  it("attaches pointOfShipment, region; normalises refinery from pointOfShipment", async () => {
    const buf = await bufferOf(await makeWb());
    const rows = await parseWorkbook(buf, "fca", DICT);
    const omsk = rows.find((r) => r.refineryRaw === "Омский НПЗ");
    expect(omsk?.refineryCanonical).toBe("Газпромнефть-Омский НПЗ");
    expect(omsk?.pointOfShipment).toBe("Омский НПЗ");
    expect(omsk?.region).toBe("Омская область");
    expect(omsk?.type).toBe("fca");
  });
});

describe("parseWorkbook robustness", () => {
  it("tolerates trailing empty rows in birzha_prices", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell("A1").value = "Цена битум на бирже";
    setRow(ws, 3, ["Период", "Ангарская НХК"]);
    setRow(ws, 4, [new Date(Date.UTC(2026, 3, 30)), 33750]);
    // Rows 5, 6, 7 — empty.
    const buf = await bufferOf(wb);
    const rows = await parseWorkbook(buf, "birzha_prices", DICT);
    expect(rows.length).toBe(1);
  });
});
