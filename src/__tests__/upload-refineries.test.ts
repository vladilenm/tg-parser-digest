// src/__tests__/upload-refineries.test.ts — vitest для normalizeRefinery.
// Pure-функция, словарь передаётся аргументом — никаких module-singletons.

import { describe, it, expect } from "vitest";
import {
  normalizeRefinery,
  loadRefineries,
  getCompany,
} from "../upload/refineries.js";
import type { RefineryEntry } from "../upload/types.js";

const dict: RefineryEntry[] = [
  {
    canonical: "Газпромнефть-Омский НПЗ",
    company: "Газпромнефть",
    aliases: ["Омский НПЗ", "ОНПЗ"],
  },
  { canonical: "Уфимская группа НПЗ", company: "Роснефть", aliases: [] },
  { canonical: "Ново-Уфимский НПЗ", company: "Роснефть", aliases: [] },
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

  it("every entry has a non-empty company field", () => {
    const list = loadRefineries();
    for (const e of list) {
      expect(typeof e.company).toBe("string");
      expect(e.company.length).toBeGreaterThan(0);
    }
  });

  it("uses one of the 5 canonical company values", () => {
    const allowed = new Set([
      "Роснефть",
      "Газпромнефть",
      "ЛУКОЙЛ",
      "Татнефть",
      "независимые",
    ]);
    const list = loadRefineries();
    for (const e of list) {
      expect(allowed.has(e.company)).toBe(true);
    }
  });
});

describe("getCompany", () => {
  it("returns the company for a known canonical name", () => {
    expect(getCompany("Газпромнефть-Омский НПЗ", dict)).toBe("Газпромнефть");
    expect(getCompany("Уфимская группа НПЗ", dict)).toBe("Роснефть");
  });

  it("is case-insensitive on canonical lookup", () => {
    expect(getCompany("газпромнефть-омский нпз", dict)).toBe("Газпромнефть");
  });

  it("trims input", () => {
    expect(getCompany("  Газпромнефть-Омский НПЗ  ", dict)).toBe(
      "Газпромнефть"
    );
  });

  it("falls back to 'независимые' for unknown canonicals", () => {
    expect(getCompany("Неизвестный НПЗ XYZ", dict)).toBe("независимые");
  });

  it("works against the real loaded refineries.json", () => {
    const list = loadRefineries();
    expect(getCompany("Газпромнефть-Омский НПЗ", list)).toBe("Газпромнефть");
    expect(getCompany("Волгограднефтепереработка", list)).toBe("ЛУКОЙЛ");
    expect(getCompany("Сальский битумный терминал", list)).toBe("независимые");
  });
});
