import { describe, expect, it } from "vitest";
import type {
  BitumType,
  KnownBitumType,
  ClassifyResult,
  ParserResult,
  LearnedSignature,
} from "../bitum/types.js";

describe("bitum/types", () => {
  it("BitumType union has 6 values (CLS-01)", () => {
    const values: BitumType[] = [
      "birzha_prices",
      "birzha_volumes",
      "fca_sellers",
      "all_prices",
      "bitum_price_new",
      "unknown",
    ];
    expect(values).toHaveLength(6);
  });

  it("KnownBitumType excludes 'unknown'", () => {
    const known: KnownBitumType[] = [
      "birzha_prices",
      "birzha_volumes",
      "fca_sellers",
      "all_prices",
      "bitum_price_new",
    ];
    expect(known).toHaveLength(5);
  });

  it("ClassifyResult has type+confidence+meta", () => {
    const r: ClassifyResult = {
      type: "birzha_prices",
      confidence: 1.0,
      meta: { a1: "..." },
    };
    expect(r.confidence).toBe(1.0);
  });

  it("ParsedRow types have sourceCell field (per checker W4 — REPORT-07 cell-trace)", async () => {
    const sampleBp: import("../bitum/types.js").ParsedRowBirzhaPrice = {
      date: new Date(),
      refineryCanonical: "Саратовский НПЗ",
      refineryRaw: "Саратовский НПЗ",
      priceRub: 28000,
      sourceCell: "F12",
    };
    expect(sampleBp.sourceCell).toBe("F12");
  });

  it("ParserResult always has rows[] and errors[]", () => {
    const p: ParserResult<{ x: number }> = {
      rows: [{ x: 1 }],
      errors: [{ rowNum: 5, reason: "bad" }],
    };
    expect(p.rows).toHaveLength(1);
    expect(p.errors[0].rowNum).toBe(5);
  });

  it("LearnedSignature type field excludes 'unknown' (CLS-03)", () => {
    const s: LearnedSignature = {
      type: "fca_sellers",
      a1: "test",
      learnedAt: new Date().toISOString(),
    };
    expect(s.type).not.toBe("unknown");
  });
});
