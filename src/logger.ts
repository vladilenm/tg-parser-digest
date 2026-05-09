// src/logger.ts — структурированный логгер для daemon-режима.
// quick-260508-fa1: dual sink — console (PM2 pm2-out.log / pm2-err.log) + appendFileSync
// в data/run-${YYYY-MM-DD-MSK}.log для post-run диагностики между прогонами.
// Без сторонних зависимостей. File-write завернут в try/catch — никогда не валим процесс.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RunSummary, WebRunSummary } from "./types.js";
import { paths } from "./paths.js";

function timestamp(): string {
  return new Date().toISOString();
}

// quick-260508-fa1: MSK-дата для имени файла. Совпадает с архивом raw/output (Europe/Moscow).
function mskDateYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function appendToFile(line: string): void {
  try {
    const file = paths.logFile(mskDateYmd());
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line + "\n", "utf8");
  } catch {
    // Намеренно глотаем — file-write не должен убить процесс.
  }
}

function formatCtx(c: unknown): string {
  if (c instanceof Error) return `${c.name}: ${c.message}${c.stack ? `\n${c.stack}` : ""}`;
  if (typeof c === "string") return c;
  try { return JSON.stringify(c); } catch { return String(c); }
}

export const log = {
  info(msg: string, ...ctx: unknown[]): void {
    const line = `[${timestamp()}] [info] ${msg}`;
    console.log(line, ...ctx);
    appendToFile(ctx.length > 0 ? `${line} ${ctx.map((c) => formatCtx(c)).join(" ")}` : line);
  },
  warn(msg: string, ...ctx: unknown[]): void {
    const line = `[${timestamp()}] [warn] ${msg}`;
    console.warn(line, ...ctx);
    appendToFile(ctx.length > 0 ? `${line} ${ctx.map((c) => formatCtx(c)).join(" ")}` : line);
  },
  error(msg: string, ...ctx: unknown[]): void {
    const line = `[${timestamp()}] [error] ${msg}`;
    console.error(line, ...ctx);
    appendToFile(ctx.length > 0 ? `${line} ${ctx.map((c) => formatCtx(c)).join(" ")}` : line);
  },
};

/**
 * Печатает многострочный summary-блок для RunSummary.
 * Формат зафиксирован в docs/phase-2.md §4.
 */
export function logRunSummary(s: RunSummary): void {
  const dur = (s.durationMs / 1000).toFixed(1);
  const lines = [
    `[${s.finishedAt}] [summary] runId=${s.runId}`,
    `  duration=${dur}s`,
    `  channels: total=${s.channelsTotal} succeeded=${s.channelsSucceeded} skipped=${s.channelsSkipped}`,
    `  posts: collected=${s.postsCollected} deduped=${s.postsDeduped} dropped=${s.postsDropped}`,
    `  delivered=${s.digestDelivered}`,
  ];
  if (s.errors.length > 0) {
    lines.push("  errors:");
    for (const e of s.errors) {
      lines.push(`    - ${e}`);
    }
  }
  // quick-260508-fa1: дублируем summary-блок в file sink. Не маршрутим через log.info,
  // чтобы не получить `[ts] [info] ` префикс на первой строке (ломает фиксированный формат).
  const out = lines.join("\n");
  console.log(out);
  appendToFile(out);
}

/**
 * Phase 3: печатает многострочный summary-блок для WebRunSummary.
 * Параллельный аналог logRunSummary, отдельно — чтобы оператор различал TG vs web в логах.
 */
export function logWebRunSummary(s: WebRunSummary): void {
  const dur = (s.durationMs / 1000).toFixed(1);
  const lines = [
    `[${s.finishedAt}] [web-summary] runId=${s.runId}`,
    `  duration=${dur}s`,
    `  websites: total=${s.websitesTotal} succeeded=${s.websitesSucceeded} skipped=${s.websitesSkipped}`,
    `  items: collected=${s.itemsCollected} dropped=${s.itemsDropped}`,
    `  delivered=${s.digestDelivered}`,
  ];
  if (s.errors.length > 0) {
    lines.push("  errors:");
    for (const e of s.errors) {
      lines.push(`    - ${e}`);
    }
  }
  // quick-260508-fa1: дублируем web-summary в file sink (см. logRunSummary).
  const out = lines.join("\n");
  console.log(out);
  appendToFile(out);
}
