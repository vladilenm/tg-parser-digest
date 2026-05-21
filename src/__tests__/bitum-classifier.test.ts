import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { classifyFile } from "../bitum/classifier.js";

const FIXTURES_DIR = path.resolve("docs/examples");
const FIXTURES_AVAILABLE = existsSync(FIXTURES_DIR);

async function bufferFromSheet(
  build: (ws: ExcelJS.Worksheet) => void,
  sheetName = "Sheet1",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  build(ws);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

describe("bitum/classifier", () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "bitum-classifier-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("A1 prefix match только → confidence 0.7 (birzha_prices)", async () => {
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Цена битум на бирже, руб./тонн";
    });
    const r = await classifyFile(buf);
    expect(r.type).toBe("birzha_prices");
    expect(r.confidence).toBe(0.7);
  });

  it("A1 + B3 match → confidence 1.0 (fca_sellers с регион header)", async () => {
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Битум цены продавцов FCA, руб./тонн";
      ws.getCell("A3").value = "Пункт отгрузки";
      ws.getCell("B3").value = "Регион";
    });
    const r = await classifyFile(buf);
    expect(r.type).toBe("fca_sellers");
    expect(r.confidence).toBe(1.0);
  });

  it("bitum_price_new: A1='Дата' + sheetName='Chart data' → confidence 0.85", async () => {
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Дата";
    }, "Chart data");
    const r = await classifyFile(buf);
    expect(r.type).toBe("bitum_price_new");
    expect(r.confidence).toBe(0.85);
  });

  it("Нет matches → { type: unknown, confidence: 0 }", async () => {
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Какой-то посторонний xlsx";
    });
    const r = await classifyFile(buf);
    expect(r.type).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("BITUM-CLS-04: classifyFile принимает только buffer (1 arg)", () => {
    expect(classifyFile.length).toBe(1);
  });

  it("meta содержит a1/a3/b3/sheetName из worksheet", async () => {
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Цена битум на бирже, руб./тонн";
      ws.getCell("A3").value = "header3";
      ws.getCell("B3").value = "header b3";
    }, "Лист1");
    const r = await classifyFile(buf);
    expect(r.meta.a1).toContain("цена битум");
    expect(r.meta.a3).toBe("header3");
    expect(r.meta.b3).toBe("header b3");
    expect(r.meta.sheetName).toBe("лист1");
  });

  it("workbook без worksheets → { unknown, 0, {} }", async () => {
    const wb = new ExcelJS.Workbook();
    const ab = await wb.xlsx.writeBuffer();
    const r = await classifyFile(Buffer.from(ab));
    expect(r.type).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("all_prices: sheetName='исходник' с РАНДОМНЫМ A1 → confidence 0.7 (sheetName-only fallback per B2)", async () => {
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Какой-то random A1";
    }, "исходник");
    const r = await classifyFile(buf);
    expect(r.type).toBe("all_prices");
    expect(r.confidence).toBe(0.7);
  });

  it("all_prices: sheetName='исходник' + правильный A1 → confidence 0.85", async () => {
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Цены битум все, руб/тонн";
    }, "исходник");
    const r = await classifyFile(buf);
    expect(r.type).toBe("all_prices");
    expect(r.confidence).toBe(0.85);
  });

  it.skipIf(!FIXTURES_AVAILABLE)(
    "Real fixture: docs/examples/birzha — цены НПЗ_rev.xlsx → birzha_prices с confidence ≥ 0.7",
    async () => {
      const buf = readFileSync(
        path.join(FIXTURES_DIR, "birzha — цены НПЗ_rev.xlsx"),
      );
      const r = await classifyFile(buf);
      expect(r.type).toBe("birzha_prices");
      expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    },
  );

  it.skipIf(!FIXTURES_AVAILABLE)(
    "Real fixture: docs/examples/BITUM — таблица продавцы_rev.xlsx → fca_sellers",
    async () => {
      const buf = readFileSync(
        path.join(FIXTURES_DIR, "BITUM — таблица продавцы_rev.xlsx"),
      );
      const r = await classifyFile(buf);
      expect(r.type).toBe("fca_sellers");
      expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    },
  );

  it("Learned signature merged with built-ins: matching learned → returns learned type", async () => {
    mkdirSync(path.join(tmpDir, "bitum"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "bitum", "signatures-learned.json"),
      JSON.stringify([
        {
          type: "fca_sellers",
          a1: "custom marker xyz",
          learnedAt: "2026-05-21T00:00:00Z",
        },
      ]),
      "utf8",
    );
    const buf = await bufferFromSheet((ws) => {
      ws.getCell("A1").value = "Custom marker xyz blah";
    });
    const r = await classifyFile(buf);
    expect(r.type).toBe("fca_sellers");
    expect(r.confidence).toBe(0.7);
  });
});
