// src/__tests__/upload-renderer.test.ts — vitest для renderMarkdown + chunkMarkdown.

import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../upload/renderer.js";
import type { AnalysisResult, RefineryDelta } from "../upload/types.js";

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

describe("renderMarkdown — small AnalysisResult", () => {
  const result: AnalysisResult = {
    periodStart: D("2026-04-30T00:00:00Z"),
    periodEnd: D("2026-05-08T00:00:00Z"),
    weekFolder: "2026-W19",
    runAt: D("2026-05-19T18:00:00Z"),
    deltas: [
      makeDelta("Газпромнефть-Омский НПЗ", 31800, 33500),
      makeDelta("Ангарская НХК", 33750, 33500),
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

  it("includes section header *Цены*", () => {
    const parts = renderMarkdown(result);
    expect(parts.join("")).toMatch(/Цены/);
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
  const result: AnalysisResult = {
    periodStart: D("2026-04-30T00:00:00Z"),
    periodEnd: D("2026-05-08T00:00:00Z"),
    weekFolder: "2026-W19",
    runAt: D("2026-05-19T18:00:00Z"),
    deltas: [makeDelta("Омский НПЗ", 31800, 33500)],
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
    };
    const parts = renderMarkdown(result);
    expect(parts[0].startsWith("(1/")).toBe(true);
    expect(parts[parts.length - 1].startsWith(`(${parts.length}/${parts.length})`)).toBe(true);
  });
});
