// src/bitum/reporter.ts — структурный HTML-отчёт по docs/bitum/algoritm.md §6.
// Контракт: renderBitumReport(payload, opts) → { html, trace, warnings }.
//   - html: Telegram HTML (parse_mode=HTML), ТОЛЬКО whitelisted tags <b><i><code><a>
//   - trace: массив NumberTrace для footer + unit-тестов (REPORT-07)
//   - warnings: массив строк (cross-check + partial-render warnings)
//
// Холдинги ВСЕГДА в фиксированном порядке: Роснефть → Газпромнефть → ЛУКОЙЛ → Прочие.
// При <5 типах — partial render с warning-блоком в начале и «(нет данных)» в местах,
// требующих недостающие файлы.

import { chunkHtml } from "../deliver.js";
import { getCompany } from "../upload/refineries.js";
import type {
  ParsedRowBirzhaPrice,
  ParsedRowBirzhaVolume,
  ParsedRowFca,
  ParsedRowAllPrices,
  ParsedBitumPriceNewSnapshot,
  ReportResult,
  NumberTrace,
  RefineryEntry,
} from "./types.js";
import {
  deltasFor,
  byCompanyFixedOrder,
  volumeTotals,
  crossCheck,
  type BitumCompanyGroup,
} from "./analyzer.js";

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export interface ReporterPayload {
  prices?: ParsedRowBirzhaPrice[];
  volumes?: ParsedRowBirzhaVolume[];
  fca?: ParsedRowFca[];
  allPrices?: ParsedRowAllPrices[];
  bitumSnapshot?: ParsedBitumPriceNewSnapshot;
  files: {
    birzhaPricesFile?: string;
    birzhaVolumesFile?: string;
    fcaSellersFile?: string;
    allPricesFile?: string;
    bitumPriceNewFile?: string;
  };
}

export interface ReporterOptions {
  dict: RefineryEntry[];
  framingSentences?: {
    topSummary?: string;
    rosneft?: string;
    gazpromneft?: string;
    lukoil?: string;
    others?: string;
  };
  topN?: number;
  crossCheckThreshold?: number;
}

// ============================================================================
// Format helpers (HTML-safe, no Markdown).
// ============================================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtRu(n: number, decimals = 0): string {
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function fmtRubSigned(n: number): string {
  if (n > 0) return `+${fmtRu(Math.abs(n))} ₽`;
  if (n < 0) return `−${fmtRu(Math.abs(n))} ₽`;
  return "0 ₽";
}

function fmtPctSigned(n: number, decimals = 1): string {
  const s = Math.abs(n).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
  if (n > 0) return `+${s}%`;
  if (n < 0) return `−${s}%`;
  return "0%";
}

function fmtRuDate(d: Date): string {
  return `${d.getUTCDate()} ${RU_MONTHS[d.getUTCMonth()]}`;
}

function fmtRuDateFull(d: Date): string {
  return `${fmtRuDate(d)} ${d.getUTCFullYear()} г.`;
}

// ============================================================================
// Section builders.
// ============================================================================

interface BuildContext {
  payload: ReporterPayload;
  opts: ReporterOptions;
  trace: NumberTrace[];
  warnings: string[];
}

function buildHeader(ctx: BuildContext): string {
  const { payload, opts } = ctx;
  const allDates: Date[] = [
    ...(payload.prices?.map((r) => r.date) ?? []),
    ...(payload.fca?.map((r) => r.date) ?? []),
    ...(payload.volumes?.map((r) => r.date) ?? []),
    ...(payload.allPrices?.map((r) => r.date) ?? []),
  ];
  if (allDates.length === 0 && payload.bitumSnapshot) {
    allDates.push(payload.bitumSnapshot.date);
  }
  if (allDates.length === 0) {
    return "<b>Битум-отчёт</b>\n(нет данных)";
  }

  const min = allDates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
  const max = allDates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
  const period =
    min.getTime() === max.getTime()
      ? fmtRuDateFull(min)
      : `${fmtRuDate(min)} – ${fmtRuDate(max)} ${max.getUTCFullYear()} г.`;
  const framing = opts.framingSentences?.topSummary?.trim() ?? "";
  return `<b>Период: ${escapeHtml(period)}</b>${framing ? "\n" + escapeHtml(framing) : ""}`;
}

function buildSnapshotBlock(ctx: BuildContext): string {
  const { payload } = ctx;
  if (!payload.bitumSnapshot) {
    return "<i>(нет данных: ожидается bitum_price_new.xlsx — средняя цена БНД snapshot)</i>";
  }
  const s = payload.bitumSnapshot;
  const file = payload.files.bitumPriceNewFile ?? "bitum_price_new.xlsx";
  ctx.trace.push({
    value: s.bnd.price,
    file,
    sheet: "Sheet1",
    cell: s.bnd.priceCell,
    semantic: "BND snapshot price",
  });
  ctx.trace.push({
    value: s.bnd.deltaAbs,
    file,
    sheet: "Sheet1",
    cell: s.bnd.deltaCell,
    semantic: "BND delta abs",
  });
  ctx.trace.push({
    value: s.pbv.price,
    file,
    sheet: "Sheet1",
    cell: s.pbv.priceCell,
    semantic: "PBV snapshot price",
  });
  ctx.trace.push({
    value: s.pbv.deltaAbs,
    file,
    sheet: "Sheet1",
    cell: s.pbv.deltaCell,
    semantic: "PBV delta abs",
  });
  return `на дату ${escapeHtml(fmtRuDateFull(s.date).replace(" г.", ""))} средняя цена <b>БНД</b> составила <b>${fmtRu(s.bnd.price)} ₽/т</b> (${fmtRubSigned(s.bnd.deltaAbs)}, ${fmtPctSigned(s.bnd.deltaPct)} за неделю)`;
}

function buildVolumesBlock(ctx: BuildContext): string {
  const { payload, opts } = ctx;
  if (!payload.volumes || payload.volumes.length === 0) {
    return "<b>### Объёмы биржевых торгов</b>\n<i>(нет данных: ожидается birzha_volumes.xlsx)</i>";
  }
  const totals = volumeTotals(payload.volumes, opts.dict);
  const topN =
    opts.topN ?? parseInt(process.env.BITUM_VOLUMES_TOP_N ?? "7", 10);
  const top = totals.perRefinery.slice(0, topN);
  const totalThousandT = totals.totalT / 1000;
  const file = payload.files.birzhaVolumesFile ?? "birzha_volumes.xlsx";
  const volCells = payload.volumes
    .map((v) => v.sourceCell)
    .filter(Boolean)
    .sort();
  const volRange =
    volCells.length > 0
      ? volCells.length === 1
        ? volCells[0]
        : `${volCells[0]}..${volCells[volCells.length - 1]}`
      : "B4";
  ctx.trace.push({
    value: totalThousandT,
    file,
    sheet: "Sheet1",
    cell: volRange,
    semantic: "Total volume Σ",
  });
  const lines = [
    `<b>### Объёмы биржевых торгов</b>`,
    `Суммарно за период реализовано <b>${fmtRu(totalThousandT, 2)} тыс. т</b>.`,
  ];
  for (const v of top) {
    const vThousand = v.totalT / 1000;
    const perCells = payload.volumes
      .filter((x) => x.refineryCanonical === v.canonical)
      .map((x) => x.sourceCell)
      .filter(Boolean)
      .sort();
    const perRange =
      perCells.length === 0
        ? "B4"
        : perCells.length === 1
          ? perCells[0]
          : `${perCells[0]}..${perCells[perCells.length - 1]}`;
    ctx.trace.push({
      value: vThousand,
      file,
      sheet: "Sheet1",
      cell: perRange,
      semantic: `Volume ${v.canonical}`,
    });
    lines.push(
      `- ${escapeHtml(v.canonical)} – ${fmtRu(vThousand, 2)} тыс. т`,
    );
  }
  return lines.join("\n");
}

function buildCompanyGroupBlock(
  ctx: BuildContext,
  group: BitumCompanyGroup,
  framingSentence?: string,
): string {
  const headerLabel =
    group.company === "Прочие" ? "Прочие и независимые" : group.company;
  const sumLine = `<b>### ${escapeHtml(headerLabel)} (Σ|Δ| = ${fmtRu(group.sumDeltaAbs)} ₽)</b>`;

  if (group.deltas.length === 0) {
    return `${sumLine}\nЦены остались без изменений.`;
  }

  const movements = group.deltas.filter((d) => Math.abs(d.deltaAbs) > 0);
  const stable = group.deltas.filter((d) => Math.abs(d.deltaAbs) === 0);

  const lines = [sumLine];
  if (framingSentence) lines.push(escapeHtml(framingSentence));
  for (const d of movements) {
    const file =
      d.source === "birzha"
        ? (ctx.payload.files.birzhaPricesFile ?? "birzha_prices.xlsx")
        : (ctx.payload.files.fcaSellersFile ?? "fca_sellers.xlsx");
    const lastCell = d.lastCell ?? "B4";
    const range =
      d.firstCell && d.lastCell ? `${d.firstCell}..${d.lastCell}` : lastCell;
    ctx.trace.push({
      value: d.lastPrice,
      file,
      sheet: "Sheet1",
      cell: lastCell,
      semantic: `${d.canonical} last price`,
    });
    ctx.trace.push({
      value: d.deltaAbs,
      file,
      sheet: "Sheet1",
      cell: range,
      semantic: `${d.canonical} delta (range)`,
    });
    const sourceTag = d.source === "fca" ? "FCA" : "биржа";
    lines.push(
      `- ${escapeHtml(d.canonical)} (${sourceTag}) ${d.deltaAbs > 0 ? "вырос" : "снизился"} на ${fmtRubSigned(d.deltaAbs)} (до ${fmtRu(d.lastPrice)} ₽).`,
    );
  }
  if (group.company === "Прочие" && stable.length > 0) {
    const tatneft = stable.filter(
      (d) => getCompany(d.canonical, ctx.opts.dict) === "Татнефть",
    );
    if (tatneft.length > 0) {
      const t = tatneft[0];
      lines.push(
        `Цены на НПЗ ${escapeHtml(t.canonical)} остались на уровне ${fmtRu(t.firstPrice)} ₽.`,
      );
    }
  }
  return lines.join("\n");
}

function buildCrossCheckBlock(ctx: BuildContext): string {
  const { payload, opts } = ctx;
  if (
    !payload.fca ||
    (!payload.bitumSnapshot &&
      (!payload.allPrices || payload.allPrices.length === 0))
  ) {
    return "";
  }
  const threshold =
    opts.crossCheckThreshold ??
    parseFloat(process.env.BITUM_CROSS_CHECK_THRESHOLD ?? "0.01");
  const prices1: {
    canonical: string;
    price: number;
    date: Date;
    source: string;
  }[] = [];
  if (payload.bitumSnapshot) {
    prices1.push({
      canonical: "БНД snapshot",
      price: payload.bitumSnapshot.bnd.price,
      date: payload.bitumSnapshot.date,
      source: "bitum_price_new",
    });
  }
  for (const r of payload.allPrices ?? []) {
    prices1.push({
      canonical: r.pointOfShipment,
      price: r.priceRub,
      date: r.date,
      source: "all_prices",
    });
  }
  const prices2 = payload.fca.map((f) => ({
    canonical: f.refineryCanonical,
    price: f.priceRub,
    date: f.date,
    source: "fca_sellers",
  }));

  const warnings = crossCheck(prices1, prices2, threshold);
  if (warnings.length === 0) return "";
  const lines = ["<b>⚠️ Цены расходятся (REPORT-08):</b>"];
  for (const w of warnings) {
    lines.push(
      `- ${escapeHtml(w.canonical)}: ${w.source1}=${fmtRu(w.price1)} ₽ vs ${w.source2}=${fmtRu(w.price2)} ₽ (${fmtPctSigned(w.diffPct)})`,
    );
    ctx.warnings.push(
      `Cross-check warning: ${w.canonical} ${w.source1}=${w.price1} vs ${w.source2}=${w.price2}`,
    );
  }
  return lines.join("\n");
}

function buildSourcesFooter(ctx: BuildContext): string {
  // D-09: компактный <code> блок со сводкой ПО ФАЙЛУ (не построчно)
  const { trace } = ctx;
  const byFile = new Map<string, number>();
  for (const t of trace) {
    byFile.set(t.file, (byFile.get(t.file) ?? 0) + 1);
  }
  if (byFile.size === 0) return "";
  const lines = ["Источники:"];
  for (const [file, count] of byFile) {
    lines.push(`• ${file}: ${count} ${count === 1 ? "число" : "чисел"}`);
  }
  return `<code>${escapeHtml(lines.join("\n"))}</code>`;
}

function buildPartialRenderWarning(ctx: BuildContext): string {
  const { payload } = ctx;
  const present: string[] = [];
  const missing: string[] = [];
  if (payload.prices?.length) present.push("birzha_prices");
  else missing.push("birzha_prices");
  if (payload.volumes?.length) present.push("birzha_volumes");
  else missing.push("birzha_volumes");
  if (payload.fca?.length) present.push("fca_sellers");
  else missing.push("fca_sellers");
  if (payload.allPrices?.length) present.push("all_prices");
  else missing.push("all_prices");
  if (payload.bitumSnapshot) present.push("bitum_price_new");
  else missing.push("bitum_price_new");
  if (missing.length === 0) return "";
  ctx.warnings.push(`Partial render: ${present.length}/5 types present`);
  return `<b>⚠️ Доступно ${present.length}/5 типов:</b> ${present.join(", ")}.\nОтсутствуют: ${missing.join(", ")} — соответствующие блоки пропущены.`;
}

// ============================================================================
// Main entry.
// ============================================================================

export function renderBitumReport(
  payload: ReporterPayload,
  opts: ReporterOptions,
): ReportResult {
  const ctx: BuildContext = { payload, opts, trace: [], warnings: [] };

  const sections: string[] = [];
  const partialWarn = buildPartialRenderWarning(ctx);
  if (partialWarn) sections.push(partialWarn);

  sections.push(buildHeader(ctx));
  sections.push(buildSnapshotBlock(ctx));
  sections.push(buildVolumesBlock(ctx));

  // BITUM-REPORT-03..06: фиксированный порядок холдингов
  if (payload.prices || payload.fca) {
    const birzhaDeltas = deltasFor(payload.prices ?? [], "birzha");
    const fcaDeltas = deltasFor(payload.fca ?? [], "fca");
    const allDeltas = [...birzhaDeltas, ...fcaDeltas];
    const groups = byCompanyFixedOrder(allDeltas, opts.dict);
    const framingMap: Record<string, string | undefined> = {
      Роснефть: opts.framingSentences?.rosneft,
      Газпромнефть: opts.framingSentences?.gazpromneft,
      ЛУКОЙЛ: opts.framingSentences?.lukoil,
      Прочие: opts.framingSentences?.others,
    };
    for (const g of groups) {
      sections.push(buildCompanyGroupBlock(ctx, g, framingMap[g.company]));
    }
  }

  const crossBlock = buildCrossCheckBlock(ctx);
  if (crossBlock) sections.push(crossBlock);

  const footer = buildSourcesFooter(ctx);
  if (footer) sections.push(footer);

  return {
    html: sections.join("\n\n"),
    trace: ctx.trace,
    warnings: ctx.warnings,
  };
}

/**
 * Нарезка отчёта на ≤4000 chars с префиксом (i/N). Reuse chunkHtml из src/deliver.ts.
 */
export function chunkBitumHtml(html: string): string[] {
  const parts = chunkHtml(html, 3920); // 80 chars reserve для (i/N)
  if (parts.length === 1) return parts;
  return parts.map((p, i) => `(${i + 1}/${parts.length})\n${p}`);
}
