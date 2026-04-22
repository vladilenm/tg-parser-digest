// src/logger.ts — структурированный логгер для daemon-режима.
// Пишет через console.log/warn/error; PM2 перехватит в pm2-out.log / pm2-err.log.
// Без сторонних зависимостей.

import type { RunSummary } from "./types.js";

function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(msg: string, ...ctx: unknown[]): void {
    console.log(`[${timestamp()}] [info] ${msg}`, ...ctx);
  },
  warn(msg: string, ...ctx: unknown[]): void {
    console.warn(`[${timestamp()}] [warn] ${msg}`, ...ctx);
  },
  error(msg: string, ...ctx: unknown[]): void {
    console.error(`[${timestamp()}] [error] ${msg}`, ...ctx);
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
    `  posts: collected=${s.postsCollected} deduped=${s.postsDeduped}`,
    `  delivered=${s.digestDelivered}`,
  ];
  if (s.errors.length > 0) {
    lines.push("  errors:");
    for (const e of s.errors) {
      lines.push(`    - ${e}`);
    }
  }
  console.log(lines.join("\n"));
}
