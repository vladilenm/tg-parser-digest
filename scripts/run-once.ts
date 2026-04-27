// scripts/run-once.ts — разовый прогон pipeline без cron-ожидания.
// Запуск: `npm run start:once` (подставляет --env-file=.env).
// Использовать для теста/отладки. В отличие от daemon-режима (src/run.ts):
//   - нет cron, нет 0–30 мин jitter, прогон стартует мгновенно;
//   - exit 0 на успех, exit 1 на ошибку (без отправки alert-бота).

import { runPipeline } from "../src/pipeline.js";
import { logRunSummary } from "../src/logger.js";

try {
  const summary = await runPipeline();
  logRunSummary(summary);
  process.exit(0);
} catch (err) {
  console.error("[run-once] pipeline failed:", err);
  process.exit(1);
}
