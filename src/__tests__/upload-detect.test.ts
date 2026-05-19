// src/__tests__/upload-detect.test.ts — vitest для detectUploadType.
// Строит in-memory workbook'и через ExcelJS, проверяет распознавание A1-маркеров.

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { detectUploadType } from "../upload/detect.js";

function wbWithA1(text: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = text;
  return wb;
}

describe("detectUploadType", () => {
  it("recognises birzha_prices marker", () => {
    expect(detectUploadType(wbWithA1("Цена битум на бирже, руб./тонн"))).toBe(
      "birzha_prices"
    );
  });

  it("recognises birzha_volumes marker", () => {
    expect(
      detectUploadType(wbWithA1("Объем битум на бирже, тыс. тонн"))
    ).toBe("birzha_volumes");
  });

  it("recognises fca marker", () => {
    expect(
      detectUploadType(wbWithA1("Битум цены продавцов FCA, руб./тонн"))
    ).toBe("fca");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(
      detectUploadType(wbWithA1("  цена битум НА бирже  "))
    ).toBe("birzha_prices");
  });

  it("returns null for unknown marker", () => {
    expect(detectUploadType(wbWithA1("Цены на битум все, руб/тонн"))).toBe(
      null
    );
  });

  it("returns null for empty A1", () => {
    expect(detectUploadType(wbWithA1(""))).toBe(null);
  });

  it("returns null for workbook without sheets", () => {
    const wb = new ExcelJS.Workbook();
    expect(detectUploadType(wb)).toBe(null);
  });
});
