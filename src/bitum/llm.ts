// src/bitum/llm.ts — DeepSeek narrative для битум-отчёта (BITUM-REPORT-07, D-08).
// HYBRID SCOPE: LLM пишет ТОЛЬКО framing-предложения (1-3 на блок), числа подставляет
// reporter программно. response_format: json_object — jail для structured output.

import OpenAI from "openai";
import { log } from "../logger.js";
import type { BitumCompanyGroup } from "./analyzer.js";
import type { ParsedBitumPriceNewSnapshot } from "./types.js";

/**
 * D-08: LLM SCOPE — ТОЛЬКО framing, БЕЗ чисел.
 * Reporter подставит numbers из ParsedRow / analysis programmatically.
 */
export const BITUM_NARRATIVE_SYSTEM_PROMPT = [
  "Ты — аналитик битумного рынка РФ. На вход получаешь структурированную сводку",
  "Δ цен по холдингам (Роснефть/Газпромнефть/ЛУКОЙЛ/Прочие). Твоя задача —",
  "написать ТОЛЬКО framing-предложения (общий тон) для секций отчёта. Числа",
  "(цены, дельты, объёмы) reporter подставит сам — НЕ пиши их в своих framing'ах.",
  "",
  "ЖЁСТКИЕ ПРАВИЛА (нарушение = revoke output):",
  "1) ЗАПРЕЩЕНО упоминать конкретные числа: ₽, тонн, %, +5, −1000, 28 000.",
  "   Reporter подставляет числа сам — твоя задача — общая характеристика.",
  "2) Каждое framing-предложение = 1-2 коротких фразы; на уровне «тенденция»",
  "   («цены выросли», «движений не наблюдалось», «снижение по двум площадкам»).",
  "3) Если данных по группе нет — ставь empty string для этого ключа (НЕ пиши «нет данных»).",
  "4) Формат ответа — JSON {topSummary, rosneft, gazpromneft, lukoil, others}, БЕЗ markdown.",
  "5) Запрещены теги, эмодзи, разметка — простой текст внутри JSON-строк.",
  "",
  "Пример хорошего framing'а:",
  "  rosneft: 'Ключевые движения — рост по большинству заводов.'",
  "Пример плохого (числа):",
  "  rosneft: 'Ключевые движения — рост на 1000 ₽ по Саратовскому НПЗ.' ← ЗАПРЕЩЕНО",
].join("\n");

/**
 * Payload для LLM. Только canonical-имена + знаки (positive/negative/zero), БЕЗ значений.
 */
export interface NarrativePayload {
  period: { start: string; end: string };
  groups: {
    company: string;
    movements: {
      canonical: string;
      direction: "up" | "down" | "flat";
      source: "birzha" | "fca";
    }[];
  }[];
  hasSnapshot: boolean;
  hasVolumes: boolean;
}

export interface NarrativeResult {
  topSummary: string;
  rosneft: string;
  gazpromneft: string;
  lukoil: string;
  others: string;
}

/**
 * Сериализует BitumCompanyGroup[] в Payload (БЕЗ чисел — только direction).
 */
export function encodeReportForLlm(
  groups: BitumCompanyGroup[],
  period: { start: Date; end: Date },
  snapshot?: ParsedBitumPriceNewSnapshot,
  hasVolumes = false,
): NarrativePayload {
  return {
    period: {
      start: period.start.toISOString().slice(0, 10),
      end: period.end.toISOString().slice(0, 10),
    },
    groups: groups.map((g) => ({
      company: g.company,
      movements: g.deltas.map((d) => ({
        canonical: d.canonical,
        direction:
          d.deltaAbs > 0 ? "up" : d.deltaAbs < 0 ? "down" : "flat",
        source: d.source,
      })),
    })),
    hasSnapshot: !!snapshot,
    hasVolumes,
  };
}

export interface BuildBitumNarrativeOptions {
  client?: OpenAI;
  model?: string;
}

export async function buildBitumNarrative(
  payload: NarrativePayload,
  opts: BuildBitumNarrativeOptions = {},
): Promise<NarrativeResult> {
  let client = opts.client;
  let model = opts.model;
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY не задан.");
    const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
    model = model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    client = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 1 });
  } else {
    model = model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  }

  const startedAt = Date.now();
  log.info(`[bitum-llm] start: groups=${payload.groups.length} model=${model}`);

  let raw: string;
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: BITUM_NARRATIVE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    raw = (completion.choices[0]?.message?.content ?? "").trim();
    if (!raw) throw new Error("[bitum-llm] DeepSeek вернул пустой ответ");
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    log.error(
      `[bitum-llm] DeepSeek failed: ${e.message}${e.cause ? " cause=" + String(e.cause) : ""}`,
    );
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `[bitum-llm] DeepSeek вернул невалидный JSON: ${raw.slice(0, 200)}`,
    );
  }
  const result: NarrativeResult = {
    topSummary: String(parsed.topSummary ?? ""),
    rosneft: String(parsed.rosneft ?? ""),
    gazpromneft: String(parsed.gazpromneft ?? ""),
    lukoil: String(parsed.lukoil ?? ""),
    others: String(parsed.others ?? ""),
  };
  log.info(`[bitum-llm] done in ${Date.now() - startedAt}ms`);
  return result;
}
