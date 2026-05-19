// src/__tests__/upload-refineries.test.ts — vitest для normalizeRefinery.
// Pure-функция, словарь передаётся аргументом — никаких module-singletons.

import { describe, it, expect } from "vitest";
import { normalizeRefinery, loadRefineries } from "../upload/refineries.js";
import type { RefineryEntry } from "../upload/types.js";

const dict: RefineryEntry[] = [
  {
    canonical: "Газпромнефть-Омский НПЗ",
    aliases: ["Омский НПЗ", "ОНПЗ"],
  },
  { canonical: "Уфимская группа НПЗ", aliases: [] },
  { canonical: "Ново-Уфимский НПЗ", aliases: [] },
];

describe("normalizeRefinery", () => {
  it("matches by canonical (case-insensitive)", () => {
    expect(normalizeRefinery("Газпромнефть-Омский НПЗ", dict)).toBe(
      "Газпромнефть-Омский НПЗ"
    );
    expect(normalizeRefinery("газпромнефть-омский нпз", dict)).toBe(
      "Газпромнефть-Омский НПЗ"
    );
  });

  it("matches by alias (case-insensitive)", () => {
    expect(normalizeRefinery("Омский НПЗ", dict)).toBe(
      "Газпромнефть-Омский НПЗ"
    );
    expect(normalizeRefinery("ОНПЗ", dict)).toBe("Газпромнефть-Омский НПЗ");
    expect(normalizeRefinery("онпз", dict)).toBe("Газпромнефть-Омский НПЗ");
  });

  it("trims whitespace before lookup", () => {
    expect(normalizeRefinery("  Омский НПЗ  ", dict)).toBe(
      "Газпромнефть-Омский НПЗ"
    );
    // Volumes file имеет leading-whitespace в заголовках — нормализатор должен с этим справиться.
    expect(normalizeRefinery(" Ангарская НХК", dict)).toBe(" Ангарская НХК".trim());
  });

  it("passes through unknown names (trimmed)", () => {
    expect(normalizeRefinery("Неизвестный НПЗ", dict)).toBe("Неизвестный НПЗ");
    expect(normalizeRefinery("  Неизвестный НПЗ  ", dict)).toBe(
      "Неизвестный НПЗ"
    );
  });

  it("returns input verbatim for empty/whitespace-only", () => {
    expect(normalizeRefinery("", dict)).toBe("");
    expect(normalizeRefinery("   ", dict)).toBe("   ");
  });

  it("keeps Уфимская группа НПЗ separate from Ново-Уфимский НПЗ", () => {
    expect(normalizeRefinery("Уфимская группа НПЗ", dict)).toBe(
      "Уфимская группа НПЗ"
    );
    expect(normalizeRefinery("Ново-Уфимский НПЗ", dict)).toBe(
      "Ново-Уфимский НПЗ"
    );
    // Никаких алиасов между ними — даже частичное совпадение «Уфимский» не должно объединять.
  });
});

describe("loadRefineries", () => {
  it("returns ≥15 canonical entries from data/refineries.json", () => {
    const list = loadRefineries();
    expect(list.length).toBeGreaterThanOrEqual(15);
    const names = new Set(list.map((e) => e.canonical));
    expect(names.has("Уфимская группа НПЗ")).toBe(true);
    expect(names.has("Ново-Уфимский НПЗ")).toBe(true);
  });
});
