// src/bitum/reporter.ts — programmatic HTML дайджест (D-10 no LLM, D-11 плоский, D-12 структура).
// Telegram parse_mode=HTML, whitelist: <b>, <i>, <code>, <a> (НЕ <br>/<h1>/<hr>).
// T-04-06: escapeHtml для всех динамических строк (manual numbers / refinery names).
// T-04-07: cell-trace footer содержит только fileType.xlsx (без cwd / token).
// Default — нужно подтверждение оператора на execute-phase:
//   - cell-trace footer: per-file compact (одна строка per file, склейка через "; ")
//   - movements cap 50 (overflow → «… ещё N»)

import type {
  AnalysisResult,
  BitumType,
  ManualNumber,
  PriceMovement,
  ReportResult,
  ReportTrace,
  WeekStatus,
} from "./types.js";
import { BITUM_BUTTON_LABELS, BITUM_TYPES } from "./types.js";

const MOVEMENTS_CAP = 50;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDateRu(iso: string): string {
  // ISO "YYYY-MM-DD" → "DD.MM.YY"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
}

function signed(n: number, decimals = 0): string {
  if (n > 0) return `+${n.toFixed(decimals)}`;
  if (n < 0) return `−${Math.abs(n).toFixed(decimals)}`; // U+2212
  return "0";
}

function fmtNumber(n: number, decimals = 0): string {
  return n.toFixed(decimals);
}

function sourceLabel(s: PriceMovement["source"]): string {
  switch (s) {
    case "birzha":
      return "биржа";
    case "fca":
      return "FCA";
    case "bitum_price_new":
      return "Битум прайс";
  }
}

function buildPeriodHeader(analysis: AnalysisResult): string {
  if (!analysis.period.from && !analysis.period.to) {
    return `<b>Битумный отчёт</b> (период не определён)`;
  }
  return `<b>Битумный отчёт ${fmtDateRu(analysis.period.from)} – ${fmtDateRu(analysis.period.to)}</b>`;
}

function buildManualNumbersBlock(manualNumbers: ManualNumber[]): string | null {
  if (manualNumbers.length === 0) return null;
  const lines = manualNumbers.map(
    (m) => `<b>${escapeHtml(m.label)}:</b> ${escapeHtml(m.value)}`
  );
  return `<i>Контекст оператора:</i>\n${lines.join("\n")}`;
}

function buildPartialRenderBlock(analysis: AnalysisResult): string | null {
  const allPresent = BITUM_TYPES.every((t) => analysis.available[t]);
  if (allPresent) return null;
  const presentTypes: BitumType[] = BITUM_TYPES.filter(
    (t) => analysis.available[t]
  );
  const missingTypes: BitumType[] = BITUM_TYPES.filter(
    (t) => !analysis.available[t]
  );
  const presentLabels = presentTypes.map((t) => BITUM_BUTTON_LABELS[t]).join(", ");
  const missingLabels = missingTypes.map((t) => BITUM_BUTTON_LABELS[t]).join(", ");
  return `⚠️ Доступно ${presentTypes.length}/4 типов: ${escapeHtml(presentLabels || "—")}. Отсутствуют: ${escapeHtml(missingLabels || "—")}.`;
}

function buildVolumesBlock(analysis: AnalysisResult): string | null {
  if (!analysis.available.birzha_volumes) return null;
  if (analysis.volumes.byRefinery.length === 0) {
    return `<b>Объёмы биржевых торгов</b>\nДанных нет.`;
  }
  const totalKt = analysis.volumes.totalT / 1000;
  const lines: string[] = [
    `<b>Объёмы биржевых торгов</b>`,
    `Σ за период: ${fmtNumber(totalKt, 2)} тыс.т.`,
    `Топ-${analysis.volumes.byRefinery.length}:`,
  ];
  for (const v of analysis.volumes.byRefinery) {
    const kt = v.sumT / 1000;
    lines.push(
      `• ${escapeHtml(v.refineryCanonical)}: ${fmtNumber(kt, 2)} тыс.т`
    );
  }
  return lines.join("\n");
}

function buildMovementsBlock(analysis: AnalysisResult): string {
  if (analysis.movements.length === 0) {
    return `<b>Движения цен</b>\nЦены остались на уровне начала периода.`;
  }
  const head = `<b>Движения цен</b>`;
  const items = analysis.movements.slice(0, MOVEMENTS_CAP);
  const lines: string[] = [head];
  for (const m of items) {
    const priceFromStr = m.priceFrom !== null ? fmtNumber(m.priceFrom, 0) : "?";
    const priceToStr = fmtNumber(m.priceTo, 0);
    const deltaAbsStr = signed(m.deltaAbs, 0);
    const deltaPctStr = m.deltaPct !== null ? `, ${signed(m.deltaPct, 1)}%` : "";
    lines.push(
      `• <b>${escapeHtml(m.refineryCanonical)}</b> (${sourceLabel(m.source)}): ${priceFromStr} → ${priceToStr} ₽ (Δ ${deltaAbsStr} ₽${deltaPctStr})`
    );
  }
  if (analysis.movements.length > MOVEMENTS_CAP) {
    lines.push(
      `… ещё ${analysis.movements.length - MOVEMENTS_CAP} движений (см. xlsx)`
    );
  }
  return lines.join("\n");
}

function buildCrossCheckBlock(analysis: AnalysisResult): string | null {
  if (analysis.crossCheck.length === 0) return null;
  const lines: string[] = [
    `⚠️ <b>Расхождения цен ≥ ${fmtNumber(analysis.thresholdPct, 1)}%</b> (источник: Битум прайс):`,
  ];
  for (const c of analysis.crossCheck) {
    const otherLabel = c.otherSource === "birzha" ? "биржа" : "FCA";
    lines.push(
      `• ${escapeHtml(c.refineryCanonical)}: Битум прайс ${fmtNumber(c.bitumPriceValue, 0)} ₽ vs ${otherLabel} ${fmtNumber(c.otherValue, 0)} ₽ (${fmtNumber(c.deltaPct, 1)}%)`
    );
  }
  return lines.join("\n");
}

function buildTraceFooter(
  analysis: AnalysisResult,
  traces: ReportTrace[]
): string {
  if (traces.length === 0) return `<code>Источники: —</code>`;
  const parts = traces.map(
    (t) =>
      `${t.fileType}.xlsx: ${t.numbersCount} чисел из ${t.cellRange || "?"}`
  );
  return `<code>Источники: ${parts.join("; ")}</code>`;
}

/**
 * Главная точка. Принимает аналитику + ручные числа + статус недели.
 * Возвращает {html, trace}. trace — список ReportTrace per файл.
 */
export function buildReport(
  analysis: AnalysisResult,
  manualNumbers: ManualNumber[],
  weekStatus: WeekStatus
): ReportResult {
  // Building traces — one per loaded type, numbersCount берётся из movements +
  // volumes для соответствующего источника.
  const traces: ReportTrace[] = [];
  if (analysis.available.birzha_volumes) {
    const cnt = analysis.volumes.byRefinery.reduce(
      (acc, v) => acc + (v.sumT > 0 ? 1 : 0),
      0
    );
    traces.push({
      fileType: "birzha_volumes",
      sheet: "Chart data",
      cellRange: "B4:T?",
      numbersCount: cnt,
    });
  }
  if (analysis.available.birzha_prices) {
    const cnt = analysis.movements.filter((m) => m.source === "birzha").length;
    traces.push({
      fileType: "birzha_prices",
      sheet: "Chart data",
      cellRange: "B4:T?",
      numbersCount: cnt,
    });
  }
  if (analysis.available.fca_sellers) {
    const cnt = analysis.movements.filter((m) => m.source === "fca").length;
    traces.push({
      fileType: "fca_sellers",
      sheet: "Chart data",
      cellRange: "A4:E?",
      numbersCount: cnt,
    });
  }
  if (analysis.available.bitum_price_new) {
    const cnt = analysis.movements.filter(
      (m) => m.source === "bitum_price_new"
    ).length;
    traces.push({
      fileType: "bitum_price_new",
      sheet: "Chart data",
      cellRange: "A2:I?",
      numbersCount: cnt,
    });
  }

  const blocks: (string | null)[] = [
    buildPeriodHeader(analysis),
    buildManualNumbersBlock(manualNumbers),
    buildPartialRenderBlock(analysis),
    buildVolumesBlock(analysis),
    buildMovementsBlock(analysis),
    buildCrossCheckBlock(analysis),
    buildTraceFooter(analysis, traces),
  ];
  const html = blocks.filter((b): b is string => Boolean(b)).join("\n\n");
  // weekStatus reserved for future per-week badge — пока используем только для
  // подсчёта numbersCount (косвенно через analysis.available).
  void weekStatus;
  return { html, trace: traces };
}
