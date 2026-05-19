// src/upload/renderer.ts — Markdown-сводка по AnalysisResult + chunking ≤4000.
// Telegram Markdown V1: `*bold*`, `_italic_`, простой текст, без хитрого экранирования.
// chunkMarkdown — inline-копия паттерна chunkHtml из src/deliver.ts (разрыв по \n\n → \n).

import type { AnalysisResult, RefineryDelta } from "./types.js";

const CHUNK_LIMIT = 4000;
const VOLUMES_TOP_N = 10;

// =============================================================================
// Format helpers.
// =============================================================================

/** Date → "YYYY-MM-DD" (UTC). */
function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date → "YYYY-MM-DD HH:MM MSK" (Europe/Moscow). */
function fmtMsk(d: Date): string {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // ru-RU returns "DD.MM.YYYY, HH:MM" — normalise to ISO-ish.
  const parts = fmt.formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} MSK`;
}

/** Number → "30 500" (ru-RU separators), 0-2 decimals. */
function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** Signed rubles: "+1 700 ₽" / "−250 ₽" (Unicode minus for visual symmetry). */
function fmtRubSigned(n: number): string {
  if (n > 0) return `+${fmtNum(Math.abs(n))} ₽`;
  if (n < 0) return `−${fmtNum(Math.abs(n))} ₽`;
  return `0 ₽`;
}

/** Signed pct: "+5.4%" / "−0.7%". */
function fmtPctSigned(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  if (n > 0) return `+${s}%`;
  if (n < 0) return `−${s}%`;
  return `0%`;
}

/** Тонны с 1-2 знаками: "10.2 т". */
function fmtT(n: number): string {
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} т`;
}

// =============================================================================
// Body builders.
// =============================================================================

function renderDeltaLine(d: RefineryDelta): string {
  return `${d.canonical}: ${fmtNum(d.firstPrice)}₽ → ${fmtNum(d.lastPrice)}₽   Δ ${fmtRubSigned(d.deltaAbs)} (${fmtPctSigned(d.deltaPct)})  [${d.source}]`;
}

function renderBody(result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push(
    `*Битум — сводка за ${fmtDate(result.periodStart)}..${fmtDate(result.periodEnd)}*`
  );
  lines.push(`Прогон: ${fmtMsk(result.runAt)}`);
  lines.push(`Папка: ${result.weekFolder}`);
  lines.push("");

  lines.push("*Цены (Δ first→last)*");
  if (result.deltas.length === 0) {
    lines.push("(нет данных)");
  } else {
    for (const d of result.deltas) lines.push(renderDeltaLine(d));
  }

  if (result.volumes) {
    lines.push("");
    lines.push("*Объёмы*");
    lines.push(`Итого: ${fmtT(result.volumes.totalT)}`);
    const top = result.volumes.perRefinery.slice(0, VOLUMES_TOP_N);
    for (const v of top) {
      lines.push(`${v.canonical}: ${fmtT(v.totalT)}`);
    }
  }

  return lines.join("\n");
}

// =============================================================================
// Chunking: mirrors src/deliver.ts:chunkHtml.
// =============================================================================

/**
 * Режет Markdown-строку на части ≤ max. Приоритет разрыва: \n\n → \n.
 * Бросает Error если в окне нет ни одного перевода (строка длиннее max).
 *
 * exported for unit tests through renderMarkdown.
 */
function chunkMarkdown(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    const window = remaining.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < 0) cut = window.lastIndexOf("\n");
    if (cut < 0) {
      throw new Error(
        `chunkMarkdown: line exceeds max=${max}; offending fragment starts: ${window.slice(0, 80)}...`
      );
    }
    parts.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

/**
 * Главный entry-point: рендерит AnalysisResult в массив Markdown-частей.
 * Каждая часть ≤ 4000 символов; если их >1 — добавляется префикс "(i/N)\n".
 * Если префикс выводит часть за 4000 — рекурсивно режем сильнее
 * (с запасом 80 символов под префикс).
 */
export function renderMarkdown(result: AnalysisResult): string[] {
  const body = renderBody(result);
  const PREFIX_RESERVE = 80;
  const rawParts = chunkMarkdown(body, CHUNK_LIMIT - PREFIX_RESERVE);
  if (rawParts.length === 1) return rawParts;
  const n = rawParts.length;
  return rawParts.map((p, i) => `(${i + 1}/${n})\n${p}`);
}
