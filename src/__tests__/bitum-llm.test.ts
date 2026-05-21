import { describe, expect, it, vi, beforeEach } from "vitest";
import type OpenAI from "openai";
import {
  BITUM_NARRATIVE_SYSTEM_PROMPT,
  buildBitumNarrative,
  encodeReportForLlm,
} from "../bitum/llm.js";
import type { BitumCompanyGroup, BitumDelta } from "../bitum/analyzer.js";

const D = (iso: string) => new Date(iso);

function makeDelta(
  canonical: string,
  deltaAbs: number,
  source: "birzha" | "fca" = "birzha",
): BitumDelta {
  return {
    canonical,
    firstDate: D("2026-05-01T00:00:00Z"),
    firstPrice: 25000,
    lastDate: D("2026-05-08T00:00:00Z"),
    lastPrice: 25000 + deltaAbs,
    deltaAbs,
    deltaPct: 0,
    source,
  };
}

function makeGroup(
  company: BitumCompanyGroup["company"],
  deltas: BitumDelta[],
): BitumCompanyGroup {
  return {
    company,
    deltas,
    sumDeltaAbs: deltas.reduce((s, d) => s + Math.abs(d.deltaAbs), 0),
  };
}

function mockClient(content: string): OpenAI {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe("bitum/llm — BITUM_NARRATIVE_SYSTEM_PROMPT", () => {
  it("содержит жёсткий запрет на числа (D-08 jail)", () => {
    expect(BITUM_NARRATIVE_SYSTEM_PROMPT).toContain(
      "ЗАПРЕЩЕНО упоминать конкретные числа",
    );
  });

  it("указывает JSON формат ответа {topSummary, rosneft, gazpromneft, lukoil, others}", () => {
    expect(BITUM_NARRATIVE_SYSTEM_PROMPT).toContain("topSummary");
    expect(BITUM_NARRATIVE_SYSTEM_PROMPT).toContain("rosneft");
    expect(BITUM_NARRATIVE_SYSTEM_PROMPT).toContain("gazpromneft");
    expect(BITUM_NARRATIVE_SYSTEM_PROMPT).toContain("lukoil");
    expect(BITUM_NARRATIVE_SYSTEM_PROMPT).toContain("others");
  });
});

describe("bitum/llm — encodeReportForLlm", () => {
  it("сериализует groups без чисел, только direction", () => {
    const groups: BitumCompanyGroup[] = [
      makeGroup("Роснефть", [
        makeDelta("Саратовский НПЗ", 1000),
        makeDelta("Сызранский НПЗ", -500, "fca"),
      ]),
    ];
    const payload = encodeReportForLlm(groups, {
      start: D("2026-05-01"),
      end: D("2026-05-08"),
    });
    expect(payload.groups[0].movements[0].direction).toBe("up");
    expect(payload.groups[0].movements[1].direction).toBe("down");
    expect(payload.groups[0].movements[1].source).toBe("fca");
    // Числа НЕ должны попадать в payload
    const json = JSON.stringify(payload);
    expect(json).not.toContain("1000");
    expect(json).not.toContain("25000");
    expect(json).not.toContain("26000");
  });

  it("flat direction для deltaAbs === 0", () => {
    const groups: BitumCompanyGroup[] = [
      makeGroup("ЛУКОЙЛ", [makeDelta("Волгограднефтепереработка", 0)]),
    ];
    const payload = encodeReportForLlm(groups, {
      start: D("2026-05-01"),
      end: D("2026-05-08"),
    });
    expect(payload.groups[0].movements[0].direction).toBe("flat");
  });
});

describe("bitum/llm — buildBitumNarrative", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NarrativeResult from mocked OpenAI JSON", async () => {
    const client = mockClient(
      JSON.stringify({
        topSummary: "Цены росли",
        rosneft: "Ключевые движения вверх",
        gazpromneft: "",
        lukoil: "Без изменений",
        others: "Несколько снижений",
      }),
    );
    const payload = encodeReportForLlm(
      [],
      { start: D("2026-05-01"), end: D("2026-05-08") },
    );
    const r = await buildBitumNarrative(payload, { client });
    expect(r.topSummary).toBe("Цены росли");
    expect(r.rosneft).toBe("Ключевые движения вверх");
    expect(r.gazpromneft).toBe("");
    expect(r.lukoil).toBe("Без изменений");
    expect(r.others).toBe("Несколько снижений");
  });

  it("calls OpenAI with temperature=0, response_format=json_object", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"topSummary":"ok"}' } }],
    });
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const payload = encodeReportForLlm(
      [],
      { start: D("2026-05-01"), end: D("2026-05-08") },
    );
    await buildBitumNarrative(payload, { client });
    const args = create.mock.calls[0][0];
    expect(args.temperature).toBe(0);
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[0].content).toContain("ЗАПРЕЩЕНО");
  });

  it("throws when API key missing and no client passed", async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      await expect(
        buildBitumNarrative(
          encodeReportForLlm(
            [],
            { start: D("2026-05-01"), end: D("2026-05-08") },
          ),
        ),
      ).rejects.toThrow(/DEEPSEEK_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });

  it("throws when empty completion content", async () => {
    const client = mockClient("");
    await expect(
      buildBitumNarrative(
        encodeReportForLlm(
          [],
          { start: D("2026-05-01"), end: D("2026-05-08") },
        ),
        { client },
      ),
    ).rejects.toThrow(/пустой ответ/);
  });

  it("throws on invalid JSON response", async () => {
    const client = mockClient("not-json-at-all");
    await expect(
      buildBitumNarrative(
        encodeReportForLlm(
          [],
          { start: D("2026-05-01"), end: D("2026-05-08") },
        ),
        { client },
      ),
    ).rejects.toThrow(/невалидный JSON/);
  });

  it("missing fields → fallback to empty strings", async () => {
    const client = mockClient(JSON.stringify({ topSummary: "ok" }));
    const r = await buildBitumNarrative(
      encodeReportForLlm(
        [],
        { start: D("2026-05-01"), end: D("2026-05-08") },
      ),
      { client },
    );
    expect(r.topSummary).toBe("ok");
    expect(r.rosneft).toBe("");
    expect(r.gazpromneft).toBe("");
    expect(r.lukoil).toBe("");
    expect(r.others).toBe("");
  });
});
