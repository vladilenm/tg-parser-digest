// scripts/run-once.ts — разовый прогон pipeline без cron-ожидания.
// Запуск: `npm run start:once` (подставляет --env-file=.env).
// Использовать для теста/отладки. В отличие от daemon-режима (src/run.ts):
//   - нет cron, нет 0–30 мин jitter, прогон стартует мгновенно;
//   - exit 0 на успех, exit 1 на ошибку (без отправки alert-бота).

import { runPipeline } from "../src/pipeline.js";
import { logRunSummary } from "../src/logger.js";
import { buildAndSendDashboard } from "../src/dashboard.js";

try {
  // Phase 3 (D-07): runPipeline принимает runId параметром (генерация поднята из pipeline.ts).
  const runId = crypto.randomUUID().slice(0, 8);
  const summary = await runPipeline(runId);
  logRunSummary(summary);
  // I5V-02: автоотправка дашборда после ручного TG-прогона (тот же артефакт, что в cron-tick).
  // buildAndSendDashboard не throw'ит — невозможность отправить (нет TG_*) даст soft-skip,
  // а реальные сбои уйдут в sendAlert. Catch ниже остаётся как страховка инварианта.
  await buildAndSendDashboard(runId);
  process.exit(0);
} catch (err) {
  console.error("[run-once] pipeline failed:", err);
  process.exit(1);
}
