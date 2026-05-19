// src/__tests__/upload-renderer.test.ts — vitest для renderMarkdown + chunkMarkdown.

import { describe, it, expect } from "vitest";
import { renderMarkdown, chunkMarkdown } from "../upload/renderer.js";
import type {
  AnalysisResult,
  CompanyGroup,
  RefineryDelta,
} from "../upload/types.js";

const D = (iso: string): Date => new Date(iso);

function makeDelta(
  canonical: string,
  first: number,
  last: number,
  source: "birzha" | "fca" = "birzha"
): RefineryDelta {
  const firstDate = D("2026-04-30T00:00:00Z");
  const lastDate = D("2026-05-08T00:00:00Z");
  return {
    canonical,
    firstDate,
    firstPrice: first,
    lastDate,
    lastPrice: last,
    deltaAbs: last - first,
    deltaPct: first === 0 ? 0 : ((last - first) / first) * 100,
    source,
  };
}

function makeCompanyGroup(
  company: string,
  deltas: RefineryDelta[]
): CompanyGroup {
  const sumDeltaAbs = deltas.reduce((s, d) => s + Math.abs(d.deltaAbs), 0);
  return { company, deltas, sumDeltaAbs };
}

describe("renderMarkdown — small AnalysisResult", () => {
  const deltas = [
    makeDelta("Газпромнефть-Омский НПЗ", 31800, 33500),
    makeDelta("Ангарская НХК", 33750, 33500),
  ];
  const result: AnalysisResult = {
    periodStart: D("2026-04-30T00:00:00Z"),
    periodEnd: D("2026-05-08T00:00:00Z"),
    weekFolder: "2026-W19",
    runAt: D("2026-05-19T18:00:00Z"),
    deltas,
    byCompany: [
      makeCompanyGroup("Газпромнефть", [deltas[0]]),
      makeCompanyGroup("Роснефть", [deltas[1]]),
    ],
  };

  it("returns a single part for small input", () => {
    const parts = renderMarkdown(result);
    expect(parts).toHaveLength(1);
  });

  it("includes header with period and weekFolder", () => {
    const parts = renderMarkdown(result);
    const text = parts.join("");
    expect(text).toContain("Битум");
    expect(text).toContain("2026-04-30");
    expect(text).toContain("2026-05-08");
    expect(text).toContain("2026-W19");
  });

  it("includes section header about *Цены*", () => {
    const parts = renderMarkdown(result);
    expect(parts.join("")).toMatch(/Цены/);
  });

  it("renders company group headers in order (Σ|Δ| desc)", () => {
    const text = renderMarkdown(result).join("");
    // Газпромнефть has Δ=+1700 → 1700; Роснефть has Δ=−250 → 250 → ГПН первой.
    const gpnIdx = text.indexOf("Газпромнефть");
    const rosneftIdx = text.indexOf("Роснефть");
    expect(gpnIdx).toBeGreaterThanOrEqual(0);
    expect(rosneftIdx).toBeGreaterThanOrEqual(0);
    expect(gpnIdx).toBeLessThan(rosneftIdx);
  });

  it("includes each refinery with signed Δ and pct", () => {
    const text = renderMarkdown(result).join("");
    expect(text).toContain("Газпромнефть-Омский НПЗ");
    expect(text).toContain("Ангарская НХК");
    // +1700 ₽ delta for Omsk
    expect(text).toMatch(/\+1[\s ]?700/);
    // -250 ₽ delta for Angarsk (signed minus)
    expect(text).toMatch(/[−-]\s?250/);
  });

  it("tags source [birzha] / [fca]", () => {
    const text = renderMarkdown(result).join("");
    expect(text).toContain("[birzha]");
  });

  it("omits volumes section when result.volumes is undefined", () => {
    const text = renderMarkdown(result).join("");
    expect(text).not.toMatch(/Объёмы/);
  });
});

describe("renderMarkdown — with volumes", () => {
  const d = makeDelta("Омский НПЗ", 31800, 33500);
  const result: AnalysisResult = {
    periodStart: D("2026-04-30T00:00:00Z"),
    periodEnd: D("2026-05-08T00:00:00Z"),
    weekFolder: "2026-W19",
    runAt: D("2026-05-19T18:00:00Z"),
    deltas: [d],
    byCompany: [makeCompanyGroup("Газпромнефть", [d])],
    volumes: {
      totalT: 15.5,
      perRefinery: [
        { canonical: "Омский НПЗ", totalT: 10.2 },
        { canonical: "Ангарская НХК", totalT: 5.3 },
      ],
    },
  };

  it("includes *Объёмы* section with total + entries", () => {
    const text = renderMarkdown(result).join("");
    expect(text).toMatch(/Объёмы/);
    expect(text).toMatch(/Итого/);
    expect(text).toContain("Омский НПЗ");
  });
});

describe("renderMarkdown — chunking", () => {
  it("splits into multiple parts when output exceeds 4000 chars", () => {
    const deltas: RefineryDelta[] = [];
    for (let i = 0; i < 200; i++) {
      deltas.push(
        makeDelta(`Тестовый НПЗ номер ${String(i).padStart(3, "0")}`, 30000, 30000 + i * 13)
      );
    }
    const result: AnalysisResult = {
      periodStart: D("2026-04-30T00:00:00Z"),
      periodEnd: D("2026-05-08T00:00:00Z"),
      weekFolder: "2026-W19",
      runAt: D("2026-05-19T18:00:00Z"),
      deltas,
      byCompany: [makeCompanyGroup("независимые", deltas)],
    };
    const parts = renderMarkdown(result);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4000);
    }
  });

  it("prefixes parts with (i/N) when N>1", () => {
    const deltas: RefineryDelta[] = [];
    for (let i = 0; i < 200; i++) {
      deltas.push(makeDelta(`НПЗ-${i}`, 30000, 30000 + i));
    }
    const result: AnalysisResult = {
      periodStart: D("2026-04-30T00:00:00Z"),
      periodEnd: D("2026-05-08T00:00:00Z"),
      weekFolder: "2026-W19",
      runAt: D("2026-05-19T18:00:00Z"),
      deltas,
      byCompany: [makeCompanyGroup("независимые", deltas)],
    };
    const parts = renderMarkdown(result);
    expect(parts[0].startsWith("(1/")).toBe(true);
    expect(parts[parts.length - 1].startsWith(`(${parts.length}/${parts.length})`)).toBe(true);
  });
});

describe("chunkMarkdown (exported helper for llm.ts)", () => {
  it("returns input as single part when ≤ max", () => {
    expect(chunkMarkdown("hello world", 100)).toEqual(["hello world"]);
  });

  it("splits on \\n\\n boundary when possible", () => {
    const text = "первая часть тут\n\nвторая часть здесь\n\nтретья наконец";
    const parts = chunkMarkdown(text, 30);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(30);
  });

  it("falls back to single \\n when no paragraph break in window", () => {
    const text = "строка-один-длинная\nстрока-два-длинная\nстрока-три";
    const parts = chunkMarkdown(text, 25);
    expect(parts.length).toBeGreaterThan(1);
  });

  it("throws when a single line exceeds max", () => {
    expect(() => chunkMarkdown("a".repeat(100), 50)).toThrow();
  });
});
