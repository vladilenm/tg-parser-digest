// scripts/run-once-web.ts — разовый прогон ТОЛЬКО web-pipeline без TG и без cron.
// Запуск: `npm run start:once:web` (подставляет --env-file=.env).
// Использовать для теста websites.json / отладки extractText / проверки SSRF-фильтра.
// В отличие от daemon-режима (src/run.ts):
//   - нет cron, нет jitter, нет TG-pipeline, прогон стартует мгновенно;
//   - exit 0 на успех (включая случай «все сайты упали» → placeholder),
//     exit 1 на катастрофу (broken websites.json, summarize() crash);
//   - alert-бот НЕ дёргается — alerty падают только в daemon-режиме (как в run-once.ts).

import { runWebPipeline } from "../src/web-scraper.js";
import { logWebRunSummary } from "../src/logger.js";
import { buildAndSendDashboard } from "../src/dashboard.js";

try {
  const runId = crypto.randomUUID().slice(0, 8);
  const summary = await runWebPipeline(runId);
  logWebRunSummary(summary);
  // I5V-03: автоотправка дашборда после ручного web-прогона (тот же артефакт, что в cron-tick).
  await buildAndSendDashboard(runId);
  process.exit(0);
} catch (err) {
  console.error("[run-once-web] web pipeline failed:", err);
  process.exit(1);
}
