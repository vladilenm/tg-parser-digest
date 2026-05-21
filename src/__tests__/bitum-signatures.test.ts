import { describe, expect, it } from "vitest";
import { BUILT_IN_SIGNATURES } from "../bitum/signatures.js";

describe("bitum/signatures", () => {
  it("BUILT_IN_SIGNATURES has 5 entries (one per KnownBitumType)", () => {
    expect(BUILT_IN_SIGNATURES).toHaveLength(5);
  });

  it("each signature has unique type", () => {
    const types = BUILT_IN_SIGNATURES.map((s) => s.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  it("first 3 entries match legacy src/upload/detect.ts MARKERS (backward-compat)", () => {
    expect(BUILT_IN_SIGNATURES[0]).toMatchObject({
      type: "birzha_prices",
      a1: "цена битум на бирже",
    });
    expect(BUILT_IN_SIGNATURES[1]).toMatchObject({
      type: "birzha_volumes",
      a1: "объем битум на бирже",
    });
    expect(BUILT_IN_SIGNATURES[2]).toMatchObject({
      type: "fca_sellers",
      a1: "битум цены продавцов fca",
    });
  });

  it("all_prices uses sheetName='исходник' per algoritm.md §5.14-5.15", () => {
    const s = BUILT_IN_SIGNATURES.find((x) => x.type === "all_prices")!;
    expect(s.sheetName).toBe("исходник");
  });

  it("bitum_price_new matches by A1='дата' + sheetName='chart data' (snapshot format)", () => {
    const s = BUILT_IN_SIGNATURES.find((x) => x.type === "bitum_price_new")!;
    expect(s.a1).toBe("дата");
    expect(s.sheetName).toBe("chart data");
  });

  it("a1/a3/b3 all lowercase (classifier compares lowercased)", () => {
    for (const s of BUILT_IN_SIGNATURES) {
      if (s.a1) expect(s.a1).toBe(s.a1.toLowerCase());
      if (s.a3) expect(s.a3).toBe(s.a3.toLowerCase());
      if (s.b3) expect(s.b3).toBe(s.b3.toLowerCase());
    }
  });
});
