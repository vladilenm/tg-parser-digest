// src/upload/llm.ts — DeepSeek-narrative поверх AnalysisResult (quick-260519-lxu).
// quick-260519-tbo: narrative теперь Telegram HTML вместо Markdown V1.
// Зеркалит паттерн src/summarize.ts: lazy OpenAI client (с baseURL DeepSeek), system
// prompt на русском, response_format НЕ json_object (нужен HTML narrative),
// retry на сетевую/JSON-ошибку через maxRetries=1, log error.cause при провале.
//
// Public API:
//   buildLlmNarrative(result, opts?) → Promise<string[]>  — массив частей ≤4000 chars.
//
// Mock-friendly: client инжектируется через opts.client (для vitest без реального API).

import OpenAI from "openai";
import type { AnalysisResult, CompanyGroup, RefineryDelta } from "./types.js";
import { chunkMarkdown, CHUNK_LIMIT } from "./renderer.js";
import { log } from "../logger.js";

// =============================================================================
// System prompt — экстрактивный аналитик битумного рынка, без LLM-галлюцинаций.
// Тон/стиль зеркалит src/summarize.ts (RU, инструкция жёсткая, json НЕ требуется).
// =============================================================================
const NARRATIVE_SYSTEM_PROMPT = [
  "Ты — аналитик битумного рынка РФ. На вход получаешь структурированную сводку",
  "Δ цен по НПЗ и объёмов за период (1–2 недели). Твоя задача — написать короткий",
  "human-readable обзор для трейдера: что произошло за период, у каких компаний",
  "(холдингов) самые сильные движения цен, как это соотносится с объёмами на бирже.",
  "",
  "ЖЁСТКИЕ ПРАВИЛА:",
  "1) Пиши ТОЛЬКО по цифрам из input. Никаких прогнозов, причин и домыслов.",
  "2) Сначала summary (1–3 предложения): период, общая динамика, доминирующее направление.",
  "3) Затем разбор по компаниям-холдингам в порядке убывания Σ|Δ| (как в input).",
  "   Для каждой: 1–3 предложения о ключевых НПЗ группы и их Δ.",
  "4) Если данных по объёмам нет — раздел про объёмы не упоминай.",
  "5) Используй цифры из input точно: «+1 700 ₽», «−250 ₽», «33 500 ₽».",
  "6) Формат ответа — Telegram HTML (НЕ Markdown). Разрешены ТОЛЬКО теги:",
  "   <b>...</b> — жирный (используй для заголовков компаний и важных чисел),",
  "   <i>...</i> — курсив, <code>...</code> — моноширинный.",
  "   ЗАПРЕЩЕНО: <h1>/<h2>/<h3>/<hr>/<br>/<p>/<div>/<span>, любые markdown-конструкции",
  "   (`#`, `##`, `###`, `**`, `*`, `---`, `==`), а также атрибуты HTML кроме href у <a>.",
  "   Каждый тег открывается и закрывается на одной строке (не переноси текст внутри тега).",
  "   Абзацы и блоки разделяй пустой строкой; если нужен визуальный сепаратор между компаниями —",
  "   используй строку из символа «━» (≈8-12 штук), а НЕ <hr> и НЕ ---.",
  "7) НЕ выдумывай новые НПЗ/компании, не упомянутые в input.",
  "8) Лимит ответа: ≈300–600 слов. Краткость ценнее воды.",
  "",
  "Формат ответа — чистый Telegram HTML (НЕ JSON, НЕ Markdown). Без вступительных",
  "фраз вроде «Вот сводка:» — сразу к делу.",
].join("\n");

// =============================================================================
// Compact JSON-encoding для AnalysisResult (то, что уйдёт в user message).
// Дата → "YYYY-MM-DD", числа — round до 2 знаков (читаемее для LLM).
// =============================================================================

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function encodeDelta(d: RefineryDelta): Record<string, unknown> {
  return {
    canonical: d.canonical,
    firstDate: fmtDate(d.firstDate),
    firstPrice: round2(d.firstPrice),
    lastDate: fmtDate(d.lastDate),
    lastPrice: round2(d.lastPrice),
    deltaAbs: round2(d.deltaAbs),
    deltaPct: round2(d.deltaPct),
    source: d.source,
  };
}

function encodeGroup(g: CompanyGroup): Record<string, unknown> {
  return {
    company: g.company,
    sumDeltaAbs: round2(g.sumDeltaAbs),
    deltas: g.deltas.map(encodeDelta),
  };
}

/**
 * Сериализует AnalysisResult в компактный JSON для отправки в LLM.
 * Экспортирована для unit-теста (проверяем, что в payload попадают именно цифры из input).
 */
export function encodeAnalysisForLlm(result: AnalysisResult): string {
  const payload: Record<string, unknown> = {
    period: { start: fmtDate(result.periodStart), end: fmtDate(result.periodEnd) },
    weekFolder: result.weekFolder,
    byCompany: result.byCompany.map(encodeGroup),
  };
  if (result.volumes) {
    payload.volumes = {
      totalT: round2(result.volumes.totalT),
      perRefinery: result.volumes.perRefinery.map((v) => ({
        canonical: v.canonical,
        totalT: round2(v.totalT),
      })),
    };
  }
  return JSON.stringify(payload);
}

// =============================================================================
// Public API.
// =============================================================================

export interface BuildLlmNarrativeOptions {
  /**
   * Mock-friendly: тесты передают свой OpenAI-инстанс (с vi.fn() поверх
   * chat.completions.create). Production-вызов не передаёт — создаётся lazily
   * с env DEEPSEEK_API_KEY/DEEPSEEK_BASE_URL/DEEPSEEK_MODEL.
   */
  client?: OpenAI;
  /**
   * Переопределение модели (по умолчанию DEEPSEEK_MODEL env или "deepseek-chat").
   */
  model?: string;
}

/**
 * Строит human-readable narrative-сводку по AnalysisResult через DeepSeek.
 * Возвращает массив частей ≤4000 chars (chunked через chunkMarkdown).
 *
 * Бросает Error при:
 *   — отсутствии DEEPSEEK_API_KEY (если client не передан)
 *   — сетевой ошибке (после внутренних maxRetries=1)
 *   — пустом ответе LLM
 *
 * Сетевые ошибки и пустые ответы логируются через log.error с error.cause
 * (паттерн из src/summarize.ts:callLLM).
 */
export async function buildLlmNarrative(
  result: AnalysisResult,
  opts: BuildLlmNarrativeOptions = {}
): Promise<string[]> {
  const startedAt = Date.now();

  // Lazy client creation, same pattern as src/summarize.ts:summarize.
  let client = opts.client;
  let model = opts.model;
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("DEEPSEEK_API_KEY не задан.");
    }
    const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
    model = model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    client = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 1 });
  } else {
    model = model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  }

  const userMsg = encodeAnalysisForLlm(result);
  log.info(
    `[upload-llm] start: companies=${result.byCompany.length} deltas=${result.deltas.length} model=${model}`
  );

  let text: string;
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      // НЕ json_object — мы хотим plain markdown narrative.
      messages: [
        { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    text = raw.trim();
    if (!text) {
      throw new Error("[upload-llm] DeepSeek вернул пустой ответ");
    }
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    log.error(
      `[upload-llm] DeepSeek failed: ${e.message}` +
        (e.cause ? ` cause=${String(e.cause)}` : "")
    );
    throw err;
  }

  log.info(
    `[upload-llm] done: ${text.length}ch in ${Date.now() - startedAt}ms`
  );

  // Telegram 4000-char chunking (резерв 80 chars на (i/N) префикс).
  const PREFIX_RESERVE = 80;
  const rawParts = chunkMarkdown(text, CHUNK_LIMIT - PREFIX_RESERVE);
  if (rawParts.length === 1) return rawParts;
  const n = rawParts.length;
  return rawParts.map((p, i) => `(${i + 1}/${n})\n${p}`);
}
