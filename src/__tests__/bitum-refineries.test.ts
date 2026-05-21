import { describe, expect, it } from "vitest";
import {
  loadRefineries,
  normalizeRefinery,
  getCompany,
} from "../bitum/refineries.js";

describe("data/refineries.json — BITUM-REFINERY-01 coverage", () => {
  const dict = loadRefineries();

  it("contains РН-Битум with company=Роснефть", () => {
    expect(getCompany("РН-Битум", dict)).toBe("Роснефть");
  });

  it("contains НК Роснефть with company=Роснефть", () => {
    expect(getCompany("НК Роснефть", dict)).toBe("Роснефть");
  });

  it("contains Газпромнефть-Битумные материалы with company=Газпромнефть", () => {
    expect(getCompany("Газпромнефть-Битумные материалы", dict)).toBe(
      "Газпромнефть",
    );
  });

  it("alias 'АО АНПЗ ВНК' normalizes to Ачинский НПЗ ВНК (Роснефть)", () => {
    const canonical = normalizeRefinery("АО АНПЗ ВНК", dict);
    expect(canonical).toBe("Ачинский НПЗ ВНК");
    expect(getCompany(canonical, dict)).toBe("Роснефть");
  });

  it("alias 'ГАЗПРОМНЕФТЬ-ОНПЗ' normalizes to Газпромнефть-Омский НПЗ", () => {
    const canonical = normalizeRefinery("ГАЗПРОМНЕФТЬ-ОНПЗ", dict);
    expect(canonical).toBe("Газпромнефть-Омский НПЗ");
    expect(getCompany(canonical, dict)).toBe("Газпромнефть");
  });

  it("Татнефть group: НПЗ Таиф-НК", () => {
    expect(getCompany("НПЗ Таиф-НК", dict)).toBe("Татнефть");
  });

  it("unknown refinery → fallback 'независимые'", () => {
    expect(getCompany("Какой-то новый НПЗ", dict)).toBe("независимые");
  });

  it("BITUM-REFINERY-02: getCompany детерминистичен", () => {
    expect(getCompany("Саратовский НПЗ", dict)).toBe("Роснефть");
    expect(getCompany("Саратовский НПЗ", dict)).toBe("Роснефть");
  });

  it("dictionary имеет ≥ 28 entries (расширен v5.0)", () => {
    expect(dict.length).toBeGreaterThanOrEqual(28);
  });

  it("каждый refinery имеет company из {Роснефть, Газпромнефть, ЛУКОЙЛ, Татнефть, независимые}", () => {
    const allowed = new Set([
      "Роснефть",
      "Газпромнефть",
      "ЛУКОЙЛ",
      "Татнефть",
      "независимые",
    ]);
    for (const r of dict) {
      expect(allowed.has(r.company)).toBe(true);
    }
  });
});
