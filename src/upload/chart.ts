// src/upload/chart.ts — генерация combo bar+line чарта top-10 НПЗ через quickchart.io.
// Quick-260519-ojk: визуальное дополнение к LLM-narrative в /summarize.
// Quick-260519-p3g: переход c sendPhoto-by-URL на multipart upload. Возвращаем
// PNG bytes (Uint8Array) вместо короткой ссылки на quickchart.io/chart/render/<hash>.
// Причина: Telegram отвечал 400 на sendPhoto(photo=<quickchart URL>) — судя по
// логам прод-инфры TG не скачивает с quickchart.io (content-type/redirect/timeout).
// Multipart upload PNG bytes — единственный надёжный путь.
//
// Public API:
//   generateChartPng(result, opts?): Promise<Uint8Array | null>
//     null → недостаточно данных (<3 НПЗ с Δ) ИЛИ ошибка quickchart (логируется warn).
//     Uint8Array  → PNG bytes, готовые для multipart sendPhoto.
//
// Зависимости: только глобальный fetch + AbortController (Node 20.6+). НИ ОДНОЙ
// новой runtime-зависимости (см. CLAUDE.md Constraints — runtime ровно три).

import type { AnalysisResult, RefineryDelta, VolumeTotals } from "./types.js";
import { log } from "../logger.js";

// =============================================================================
// Constants.
// =============================================================================

// quick-260519-p3g: было /chart/create (возвращает JSON с url для рендера через
// /chart/render/<hash>); теперь /chart (возвращает PNG bytes напрямую с
// content-type: image/png). Для multipart sendPhoto нужны именно bytes.
const QUICKCHART_RENDER_URL = "https://quickchart.io/chart";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 500;
const TOP_N = 10;
const MIN_BARS = 3; // ниже этого — чарт визуально бессмыслен.
const LABEL_MAX_LEN = 14; // truncate с эллипсисом.

// Цвета по знаку дельты. Telegram-friendly (контраст на белом фоне).
const COLOR_POSITIVE = "rgba(16, 185, 129, 0.85)"; // emerald-500
const COLOR_NEGATIVE = "rgba(239, 68, 68, 0.85)"; // red-500
const COLOR_ZERO = "rgba(156, 163, 175, 0.85)"; // gray-400
const COLOR_LINE = "rgba(59, 130, 246, 0.95)"; // blue-500 для объёмов.

// =============================================================================
// Helpers.
// =============================================================================

/**
 * Truncate canonical name до LABEL_MAX_LEN символов с эллипсисом.
 * Пример: "Газпромнефть-Омский НПЗ" → "Газпромнефть-…"
 */
function truncateLabel(s: string): string {
  if (s.length <= LABEL_MAX_LEN) return s;
  return s.slice(0, LABEL_MAX_LEN - 1) + "…";
}

/**
 * Период → "DD.MM.YYYY – DD.MM.YYYY" (русская типографика, через en-dash).
 * UTC даты (deltaDates приходят из analyzer без timezone-нормализации).
 */
function formatPeriod(start: Date, end: Date): string {
  const fmt = (d: Date): string => {
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const year = d.getUTCFullYear();
    return `${day}.${month}.${year}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Из result.deltas выбирает топ-N уникальных НПЗ по |deltaAbs|.
 * Если у одного canonical две дельты (birzha + fca) — берём ту, у которой |Δ| больше.
 * Возвращает массив, отсортированный по |deltaAbs| desc.
 */
function topDeltas(deltas: RefineryDelta[], n: number): RefineryDelta[] {
  const bestPerCanonical = new Map<string, RefineryDelta>();
  for (const d of deltas) {
    const prev = bestPerCanonical.get(d.canonical);
    if (!prev || Math.abs(d.deltaAbs) > Math.abs(prev.deltaAbs)) {
      bestPerCanonical.set(d.canonical, d);
    }
  }
  const arr = [...bestPerCanonical.values()];
  arr.sort((a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs));
  return arr.slice(0, n);
}

/**
 * Lookup totalT для canonical из volumes (если есть). 0 если canonical нет.
 */
function volumeFor(canonical: string, volumes: VolumeTotals | undefined): number {
  if (!volumes) return 0;
  for (const v of volumes.perRefinery) {
    if (v.canonical === canonical) return v.totalT;
  }
  return 0;
}

/**
 * Цвет bar'а по знаку deltaAbs.
 */
function colorFor(delta: number): string {
  if (delta > 0) return COLOR_POSITIVE;
  if (delta < 0) return COLOR_NEGATIVE;
  return COLOR_ZERO;
}

// =============================================================================
// Chart.js config builder.
// =============================================================================

/**
 * Собирает Chart.js v3 config object для quickchart.io.
 * Mixed type:
 *   - bar dataset: |Δ цены| top-N (per-bar цвет по знаку), yAxisID 'y' (левая ось).
 *   - line dataset (если volumes есть): totalT для тех же canonical, yAxisID 'y1' (правая).
 *
 * Экспортирован для unit-теста (проверяем структуру конфига без вызова сети).
 */
export function buildChartConfig(result: AnalysisResult): Record<string, unknown> {
  const top = topDeltas(result.deltas, TOP_N);
  const labels = top.map((d) => truncateLabel(d.canonical));
  const barData = top.map((d) => d.deltaAbs);
  const barColors = top.map((d) => colorFor(d.deltaAbs));
  const hasVolumes =
    !!result.volumes && result.volumes.perRefinery.length > 0 &&
    top.some((d) => volumeFor(d.canonical, result.volumes) > 0);

  const datasets: Record<string, unknown>[] = [
    {
      type: "bar",
      label: "Δ цены, ₽",
      data: barData,
      backgroundColor: barColors,
      borderColor: barColors,
      borderWidth: 1,
      yAxisID: "y",
      order: 2,
    },
  ];

  if (hasVolumes) {
    datasets.push({
      type: "line",
      label: "Объёмы, т",
      data: top.map((d) => volumeFor(d.canonical, result.volumes)),
      borderColor: COLOR_LINE,
      backgroundColor: COLOR_LINE,
      borderWidth: 2,
      pointRadius: 4,
      fill: false,
      tension: 0.2,
      yAxisID: "y1",
      order: 1,
    });
  }

  const title = `Δ цены и объёмы по НПЗ (${formatPeriod(result.periodStart, result.periodEnd)})`;

  const scales: Record<string, unknown> = {
    y: {
      type: "linear",
      position: "left",
      title: { display: true, text: "Δ цены, ₽" },
    },
  };
  if (hasVolumes) {
    scales.y1 = {
      type: "linear",
      position: "right",
      title: { display: true, text: "Объёмы, т" },
      grid: { drawOnChartArea: false },
    };
  }

  return {
    type: "bar",
    data: { labels, datasets },
    options: {
      plugins: {
        title: { display: true, text: title, font: { size: 16 } },
        legend: { display: true, position: "top" },
      },
      scales,
    },
  };
}

// =============================================================================
// PNG magic detection (quick-260519-pwy).
// =============================================================================

// quick-260519-pwy: PNG magic — первые 8 байт PNG-файла.
// quickchart.io на 400/500 может вернуть error-PNG (картинку с красным текстом
// ошибки) вместо JSON — мы детектим это по magic и возвращаем bytes как обычно,
// чтобы handleSummarizeCommand доставил картинку в TG (sendPhotoMultipart).
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function hasPngMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

// =============================================================================
// quickchart.io client.
// =============================================================================

/**
 * POST chart-config на quickchart.io/chart. Возвращает PNG bytes (Uint8Array).
 * Response: image/png напрямую — читаем через res.arrayBuffer().
 *
 * Throw'ает при:
 *   — HTTP !ok
 *   — Empty body (bytes.length === 0)
 *   — AbortController timeout (через fetch signal)
 *
 * Экспортирован для unit-теста (mock fetchImpl).
 *
 * quick-260519-p3g: было fetchQuickChartUrl → string (url). Изменили на
 * fetchQuickChartPng → Uint8Array (PNG bytes для multipart sendPhoto).
 */
export async function fetchQuickChartPng(
  config: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(QUICKCHART_RENDER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chart: config,
        backgroundColor: "white",
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        format: "png",
      }),
      signal: controller.signal,
    });
    // quick-260519-pwy: quickchart на HTTP !ok может вернуть error-PNG (картинка
    // с текстом ошибки) вместо JSON/HTML. Читаем body ОДИН раз через arrayBuffer,
    // проверяем PNG magic. Если PNG — возвращаем bytes (caller отправит как обычно
    // через sendPhotoMultipart, пользователь увидит причину 400 прямо на картинке).
    // Если не PNG — throw как и раньше (quick-260519-pl2), decode'я bytes через
    // TextDecoder (НЕ res.text() — стрим уже прочитан arrayBuffer'ом).
    if (!res.ok) {
      let bytes: Uint8Array;
      try {
        const buf = await res.arrayBuffer();
        bytes = new Uint8Array(buf);
      } catch {
        // arrayBuffer() сам упал — не маскируем оригинальный HTTP-статус.
        throw new Error(`[chart] HTTP ${res.status} ${res.statusText} body=<body unavailable>`);
      }
      if (hasPngMagic(bytes)) {
        log.warn(`[chart] HTTP ${res.status} ${res.statusText} but body is PNG (quickchart error-image), returning bytes=${bytes.length}`);
        return bytes;
      }
      // Non-PNG body: decode как UTF-8 (lossy, не throw'ает на невалидных байтах),
      // truncate 500ch + '…' (как было после quick-260519-pl2).
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const bodyExcerpt = text.length > 500
        ? text.slice(0, 500) + "…"
        : (text.length === 0 ? "<body unavailable>" : text);
      throw new Error(`[chart] HTTP ${res.status} ${res.statusText} body=${bodyExcerpt}`);
    }
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length === 0) {
      throw new Error(`[chart] empty PNG body from quickchart`);
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Public entry.
// =============================================================================

export interface GenerateChartPngOptions {
  /** Mock-friendly: тесты передают свой fetch. По умолчанию global fetch. */
  fetchImpl?: typeof fetch;
  /** Override timeout (default 15s). */
  timeoutMs?: number;
}

/**
 * Главный entry-point для bot.ts. Возвращает PNG bytes чарта или null.
 *
 * null когда:
 *   — уникальных НПЗ с дельтой < MIN_BARS (=3). Визуальный bar-чарт на 1-2 столбцах
 *     бесполезен; лучше не показывать ничего, чем мусор.
 *   — quickchart упал (network/HTTP/timeout) — в этом случае
 *     log.warn и null, чтобы caller (handleSummarizeCommand) НЕ ломал handler:
 *     narrative уже доставлен, чарт — bonus.
 *
 * НЕ throw'ает.
 *
 * quick-260519-p3g: было generateChartUrl → string|null (url). Изменили на
 * generateChartPng → Uint8Array|null (PNG bytes для multipart sendPhoto).
 */
export async function generateChartPng(
  result: AnalysisResult,
  opts: GenerateChartPngOptions = {}
): Promise<Uint8Array | null> {
  // Считаем уникальных canonical (одна и та же канонизированная НПЗ может появиться
  // дважды — birzha + fca; для оценки порога интереснее физических НПЗ, а не источников).
  const unique = new Set(result.deltas.map((d) => d.canonical));
  if (unique.size < MIN_BARS) {
    log.info(
      `[chart] skip: only ${unique.size} unique НПЗ с дельтой (< ${MIN_BARS})`
    );
    return null;
  }

  const config = buildChartConfig(result);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const bytes = await fetchQuickChartPng(config, fetchImpl, timeoutMs);
    log.info(`[chart] ok bytes=${bytes.length}`);
    return bytes;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    log.warn(`[chart] fail: ${msg}`);
    return null;
  }
}
