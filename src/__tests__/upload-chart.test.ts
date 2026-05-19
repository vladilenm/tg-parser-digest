// src/__tests__/upload-chart.test.ts — vitest для chart.ts (quick-260519-ojk).
// Mock fetchImpl — никаких реальных вызовов quickchart.io.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildChartConfig,
  fetchQuickChartUrl,
  generateChartUrl,
} from "../upload/chart.js";
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
  return {
    canonical,
    firstDate: D("2026-04-30T00:00:00Z"),
    firstPrice: first,
    lastDate: D("2026-05-08T00:00:00Z"),
    lastPrice: last,
    deltaAbs: last - first,
    deltaPct: first === 0 ? 0 : ((last - first) / first) * 100,
    source,
  };
}

function makeGroup(company: string, deltas: RefineryDelta[]): CompanyGroup {
  const sumDeltaAbs = deltas.reduce((s, d) => s + Math.abs(d.deltaAbs), 0);
  return { company, deltas, sumDeltaAbs };
}

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  // 5 уникальных НПЗ — достаточно для MIN_BARS=3.
  const d1 = makeDelta("Газпромнефть-Омский НПЗ", 31800, 33500);
  const d2 = makeDelta("Ангарская НХК", 33750, 33500);
  const d3 = makeDelta("Рязанский НПЗ", 30000, 30500);
  const d4 = makeDelta("Куйбышевский НПЗ", 29000, 28500);
  const d5 = makeDelta("Уфа-НПЗ", 31000, 31200);
  return {
    periodStart: D("2026-04-30T00:00:00Z"),
    periodEnd: D("2026-05-08T00:00:00Z"),
    weekFolder: "2026-W19",
    runAt: D("2026-05-19T18:00:00Z"),
    deltas: [d1, d2, d3, d4, d5],
    byCompany: [
      makeGroup("Газпромнефть", [d1]),
      makeGroup("Роснефть", [d2, d3, d4]),
      makeGroup("независимые", [d5]),
    ],
    ...overrides,
  };
}

// =============================================================================
// buildChartConfig — pure builder, без сетевых вызовов.
// =============================================================================
describe("buildChartConfig", () => {
  it("creates a bar dataset with per-bar colors by sign of deltaAbs", () => {
    const cfg = buildChartConfig(makeResult());
    const data = cfg.data as { labels: string[]; datasets: Record<string, unknown>[] };
    expect(Array.isArray(data.datasets)).toBe(true);
    const bar = data.datasets[0];
    expect(bar.type).toBe("bar");
    const colors = bar.backgroundColor as string[];
    expect(Array.isArray(colors)).toBe(true);
    expect(colors.length).toBe(data.labels.length);
    // d2 (Ангарская) — deltaAbs = -250 → red
    // d1 (Омский)    — deltaAbs = +1700 → emerald
    // Так как сортировка идёт по |Δ| desc, первая бара = Омский (+1700, emerald).
    expect(colors[0]).toMatch(/emerald|16, 185, 129/);
  });

  it("truncates labels longer than 14 chars with ellipsis", () => {
    const longName = "ОчЕнь-Длинное-Имя-НПЗ-Россия";
    const result = makeResult({
      deltas: [
        makeDelta(longName, 100, 200),
        makeDelta("Б", 100, 150),
        makeDelta("В", 100, 110),
      ],
    });
    const cfg = buildChartConfig(result);
    const data = cfg.data as { labels: string[] };
    const long = data.labels.find((l) => l.startsWith("О"));
    expect(long).toBeDefined();
    expect(long!.length).toBeLessThanOrEqual(14);
    expect(long!.endsWith("…")).toBe(true);
  });

  it("limits to top-10 by |deltaAbs|", () => {
    const many: RefineryDelta[] = [];
    for (let i = 0; i < 15; i++) {
      many.push(makeDelta(`НПЗ-${i}`, 1000, 1000 + (i + 1) * 100));
    }
    const result = makeResult({ deltas: many });
    const cfg = buildChartConfig(result);
    const data = cfg.data as { labels: string[] };
    expect(data.labels.length).toBe(10);
    // Top по |Δ| — последние i (i+1)*100. Самый большой = НПЗ-14.
    expect(data.labels[0]).toContain("НПЗ-14");
  });

  it("does NOT add line dataset when volumes is undefined", () => {
    const cfg = buildChartConfig(makeResult());
    const data = cfg.data as { datasets: { type: string }[] };
    expect(data.datasets).toHaveLength(1);
    expect(data.datasets[0].type).toBe("bar");
  });

  it("adds line dataset with yAxisID 'y1' when volumes present", () => {
    const result = makeResult({
      volumes: {
        totalT: 100,
        perRefinery: [
          { canonical: "Газпромнефть-Омский НПЗ", totalT: 50 },
          { canonical: "Ангарская НХК", totalT: 30 },
          { canonical: "Рязанский НПЗ", totalT: 20 },
        ],
      },
    });
    const cfg = buildChartConfig(result);
    const data = cfg.data as { datasets: { type: string; yAxisID: string }[] };
    expect(data.datasets.length).toBe(2);
    const line = data.datasets.find((d) => d.type === "line");
    expect(line).toBeDefined();
    expect(line!.yAxisID).toBe("y1");
    // scales.y1 должен быть в options.
    const opts = cfg.options as { scales: Record<string, unknown> };
    expect(opts.scales.y1).toBeDefined();
  });

  it("includes title with formatted period DD.MM.YYYY – DD.MM.YYYY", () => {
    const cfg = buildChartConfig(makeResult());
    const opts = cfg.options as {
      plugins: { title: { text: string } };
    };
    expect(opts.plugins.title.text).toMatch(/30\.04\.2026/);
    expect(opts.plugins.title.text).toMatch(/08\.05\.2026/);
  });

  it("deduplicates same canonical from multiple sources, keeps best |Δ|", () => {
    const result = makeResult({
      deltas: [
        makeDelta("X", 100, 200, "birzha"), // |Δ| = 100
        makeDelta("X", 100, 350, "fca"),    // |Δ| = 250 — побеждает
        makeDelta("Y", 100, 120, "birzha"),
        makeDelta("Z", 100, 130, "birzha"),
      ],
    });
    const cfg = buildChartConfig(result);
    const data = cfg.data as { labels: string[]; datasets: Record<string, unknown>[] };
    expect(data.labels.filter((l) => l === "X").length).toBe(1);
    const barData = (data.datasets[0].data as number[]);
    // X побеждает с deltaAbs=250
    const xIdx = data.labels.indexOf("X");
    expect(barData[xIdx]).toBe(250);
  });
});

// =============================================================================
// fetchQuickChartUrl — POST к quickchart.io, mock fetch.
// =============================================================================
describe("fetchQuickChartUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts JSON to /chart/create and returns url on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ success: true, url: "https://quickchart.io/chart/render/abc123" }),
    }) as unknown as typeof fetch;
    const cfg = buildChartConfig(makeResult());
    const url = await fetchQuickChartUrl(cfg, fetchImpl);
    expect(url).toBe("https://quickchart.io/chart/render/abc123");
    // verify request shape
    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain("quickchart.io/chart/create");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chart).toBeDefined();
    expect(body.backgroundColor).toBe("white");
    expect(body.format).toBe("png");
    expect(body.width).toBeGreaterThan(0);
    expect(body.height).toBeGreaterThan(0);
  });

  it("throws on HTTP !ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const cfg = buildChartConfig(makeResult());
    await expect(fetchQuickChartUrl(cfg, fetchImpl)).rejects.toThrow(/HTTP 500/);
  });

  it("throws when response.success is false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ success: false }),
    }) as unknown as typeof fetch;
    const cfg = buildChartConfig(makeResult());
    await expect(fetchQuickChartUrl(cfg, fetchImpl)).rejects.toThrow(/success=false/);
  });

  it("throws when fetch rejects (network error)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    const cfg = buildChartConfig(makeResult());
    await expect(fetchQuickChartUrl(cfg, fetchImpl)).rejects.toThrow(/ECONNRESET/);
  });
});

// =============================================================================
// generateChartUrl — public entry, не throw'ает.
// =============================================================================
describe("generateChartUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns URL on happy path (≥3 НПЗ, quickchart ok)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ success: true, url: "https://quickchart.io/chart/render/xyz" }),
    }) as unknown as typeof fetch;
    const url = await generateChartUrl(makeResult(), { fetchImpl });
    expect(url).toBe("https://quickchart.io/chart/render/xyz");
  });

  it("returns null when fewer than 3 unique НПЗ with deltas", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = makeResult({
      deltas: [makeDelta("A", 100, 200), makeDelta("B", 100, 150)],
    });
    const url = await generateChartUrl(result, { fetchImpl });
    expect(url).toBeNull();
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("returns null when deltas is empty", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = makeResult({ deltas: [] });
    const url = await generateChartUrl(result, { fetchImpl });
    expect(url).toBeNull();
  });

  it("returns null on quickchart HTTP error (does NOT throw)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const url = await generateChartUrl(makeResult(), { fetchImpl });
    expect(url).toBeNull();
  });

  it("returns null on quickchart success=false (does NOT throw)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ success: false, url: null }),
    }) as unknown as typeof fetch;
    const url = await generateChartUrl(makeResult(), { fetchImpl });
    expect(url).toBeNull();
  });

  it("returns null on network error (does NOT throw)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ETIMEDOUT")) as unknown as typeof fetch;
    const url = await generateChartUrl(makeResult(), { fetchImpl });
    expect(url).toBeNull();
  });

  it("counts unique canonicals (birzha + fca for same НПЗ = 1 unique)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    // Только 2 уникальных НПЗ, но 4 дельты (двойник от двух источников).
    const result = makeResult({
      deltas: [
        makeDelta("X", 100, 200, "birzha"),
        makeDelta("X", 100, 250, "fca"),
        makeDelta("Y", 100, 150, "birzha"),
        makeDelta("Y", 100, 180, "fca"),
      ],
    });
    const url = await generateChartUrl(result, { fetchImpl });
    expect(url).toBeNull();
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
