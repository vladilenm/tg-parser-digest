// src/__tests__/upload-llm.test.ts — vitest для buildLlmNarrative + encodeAnalysisForLlm.
// Mock OpenAI client инжектится через opts.client — никаких реальных DeepSeek-вызовов.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type OpenAI from "openai";
import {
  buildLlmNarrative,
  encodeAnalysisForLlm,
} from "../upload/llm.js";
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
  const dGpn = makeDelta("Газпромнефть-Омский НПЗ", 31800, 33500);
  const dRos = makeDelta("Ангарская НХК", 33750, 33500);
  return {
    periodStart: D("2026-04-30T00:00:00Z"),
    periodEnd: D("2026-05-08T00:00:00Z"),
    weekFolder: "2026-W19",
    runAt: D("2026-05-19T18:00:00Z"),
    deltas: [dGpn, dRos],
    byCompany: [
      makeGroup("Газпромнефть", [dGpn]),
      makeGroup("Роснефть", [dRos]),
    ],
    ...overrides,
  };
}

// =============================================================================
// encodeAnalysisForLlm — pure-функция, не требует mock'а.
// =============================================================================
describe("encodeAnalysisForLlm", () => {
  it("encodes period as YYYY-MM-DD strings", () => {
    const json = encodeAnalysisForLlm(makeResult());
    const obj = JSON.parse(json);
    expect(obj.period.start).toBe("2026-04-30");
    expect(obj.period.end).toBe("2026-05-08");
  });

  it("includes byCompany with deltas array", () => {
    const json = encodeAnalysisForLlm(makeResult());
    const obj = JSON.parse(json);
    expect(Array.isArray(obj.byCompany)).toBe(true);
    expect(obj.byCompany).toHaveLength(2);
    expect(obj.byCompany[0].company).toBe("Газпромнефть");
    expect(obj.byCompany[0].deltas[0].canonical).toBe("Газпромнефть-Омский НПЗ");
    expect(obj.byCompany[0].deltas[0].deltaAbs).toBe(1700);
  });

  it("rounds floats to 2 decimals", () => {
    const result = makeResult({
      deltas: [makeDelta("X", 100, 100.5678)],
      byCompany: [makeGroup("X-co", [makeDelta("X", 100, 100.5678)])],
    });
    const obj = JSON.parse(encodeAnalysisForLlm(result));
    expect(obj.byCompany[0].deltas[0].lastPrice).toBe(100.57);
  });

  it("omits volumes when result.volumes is undefined", () => {
    const json = encodeAnalysisForLlm(makeResult());
    const obj = JSON.parse(json);
    expect(obj.volumes).toBeUndefined();
  });

  it("includes volumes when present", () => {
    const result = makeResult({
      volumes: {
        totalT: 15.5,
        perRefinery: [
          { canonical: "X", totalT: 10.2 },
          { canonical: "Y", totalT: 5.3 },
        ],
      },
    });
    const obj = JSON.parse(encodeAnalysisForLlm(result));
    expect(obj.volumes.totalT).toBe(15.5);
    expect(obj.volumes.perRefinery).toHaveLength(2);
  });
});

// =============================================================================
// buildLlmNarrative — mock OpenAI client.
// =============================================================================
describe("buildLlmNarrative", () => {
  function mockClient(content: string): OpenAI {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    });
    return {
      chat: { completions: { create } },
    } as unknown as OpenAI;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a single-part array when DeepSeek response is short", async () => {
    const client = mockClient(
      "*Сводка*\n\nЗа период с 30 апреля по 8 мая лидирует Газпромнефть."
    );
    const parts = await buildLlmNarrative(makeResult(), { client });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("Газпромнефть");
  });

  it("calls OpenAI with system + user messages and temperature 0", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    await buildLlmNarrative(makeResult(), { client });
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0][0];
    expect(args.temperature).toBe(0);
    expect(args.messages).toHaveLength(2);
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[1].role).toBe("user");
    // payload must be valid JSON of AnalysisResult
    const userPayload = JSON.parse(args.messages[1].content);
    expect(userPayload.byCompany).toBeDefined();
  });

  it("does NOT set response_format: json_object (we want markdown narrative)", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    await buildLlmNarrative(makeResult(), { client });
    const args = create.mock.calls[0][0];
    expect(args.response_format).toBeUndefined();
  });

  it("throws when DeepSeek returns empty content", async () => {
    const client = mockClient("");
    await expect(buildLlmNarrative(makeResult(), { client })).rejects.toThrow(
      /пустой ответ/
    );
  });

  it("throws when DeepSeek client.chat.completions.create rejects", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Connection reset"));
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    await expect(buildLlmNarrative(makeResult(), { client })).rejects.toThrow(
      /Connection reset/
    );
  });

  it("chunks long responses into multiple ≤4000-char parts with (i/N) prefix", async () => {
    // Generate ~10000 chars of markdown paragraphs.
    const para = "Газпромнефть продолжает доминировать. ".repeat(20);
    const big = Array.from({ length: 20 }, () => para).join("\n\n");
    const client = mockClient(big);
    const parts = await buildLlmNarrative(makeResult(), { client });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4000);
    }
    expect(parts[0].startsWith("(1/")).toBe(true);
    expect(
      parts[parts.length - 1].startsWith(`(${parts.length}/${parts.length})`)
    ).toBe(true);
  });

  it("uses model from opts when provided", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    await buildLlmNarrative(makeResult(), { client, model: "deepseek-reasoner" });
    expect(create.mock.calls[0][0].model).toBe("deepseek-reasoner");
  });

  it("falls back to env DEEPSEEK_MODEL when model not provided", async () => {
    const prev = process.env.DEEPSEEK_MODEL;
    process.env.DEEPSEEK_MODEL = "deepseek-custom-1";
    try {
      const create = vi.fn().mockResolvedValue({
        choices: [{ message: { content: "ok" } }],
      });
      const client = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      await buildLlmNarrative(makeResult(), { client });
      expect(create.mock.calls[0][0].model).toBe("deepseek-custom-1");
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = prev;
    }
  });

  it("throws when no client passed and DEEPSEEK_API_KEY not set", async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      await expect(buildLlmNarrative(makeResult())).rejects.toThrow(
        /DEEPSEEK_API_KEY/
      );
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });
});
