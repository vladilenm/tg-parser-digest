// src/run.ts — daemon entrypoint tg-parser-demo (v2.0).
// Запуск: `npm start` — процесс висит, cron триггерит tick() каждые сутки в 20:15 MSK + 0–30min jitter.
// Остановка: Ctrl+C (SIGINT) или SIGTERM от PM2 — graceful shutdown с ожиданием активного прогона.

import cron from "node-cron";
import { runPipeline } from "./pipeline.js";
import { log, logRunSummary } from "./logger.js";
import { sendAlert } from "./alert.js";
import { startBot, stopBot, isBotPolling } from "./bot.js";

// DAEMON-03: mutex от параллельных тиков. In-memory boolean — достаточно для single-process PM2 fork.
let isRunning = false;

async function tick(): Promise<void> {
  if (isRunning) {
    log.warn("prev run still in progress — skipping tick");
    return;
  }
  isRunning = true;
  try {
    // ANTIBAN: рандомная пауза 0–30 минут перед прогоном, чтобы убрать детерминированную сигнатуру "ровно 20:15".
    const jitterMs = Math.floor(Math.random() * 30 * 60 * 1000);
    log.info(`[tick] schedule jitter: sleeping ${(jitterMs / 1000).toFixed(0)}s before run`);
    await new Promise((r) => setTimeout(r, jitterMs));
    const summary = await runPipeline();
    logRunSummary(summary);
  } catch (err) {
    const e = err as Error;
    log.error("pipeline failed", e);
    // ALERT-02 (D-12, D-13): await — не fire-and-forget, чтобы 60s-окно гарантировалось.
    // runId внутри pipeline нам недоступен (упало, не дошло до return);
    // используем отдельный alertId для трассировки.
    const alertId = crypto.randomUUID().slice(0, 8);
    try {
      await sendAlert({
        stage: "tick",
        message: e?.message ?? String(err),
        runId: alertId,
        stack: e?.stack,
      });
    } catch (alertErr) {
      // D-15: alert-on-alert-fail → log.error, не падаем дальше.
      log.error("alert send failed", alertErr);
    }
  } finally {
    isRunning = false;
  }
}

// DAEMON-02: ежедневный прогон в 20:15 MSK + рандомный jitter 0–30 минут (см. tick).
// DAEMON-04: опция auto-fire-on-start НЕ передаётся — PM2-рестарт не триггерит
// дайджест вне расписания, прогон идёт только по cron-времени.
const task = cron.schedule("15 20 * * *", tick, { timezone: "Europe/Moscow" });
log.info("daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter");

// BOT-05 / D-05: bot polling запускается параллельно с cron.
// НЕ await — startBot бесконечный (polling-loop), иначе блокирует процесс.
// void маркирует floating promise намеренно. Контракт startBot: внутри уже
// exp.backoff на сетевых ошибках (см. src/bot.ts pollLoop) и финальный try/catch.
// Outer catch здесь — страховка на случай если что-то проскочит мимо внутреннего try.
// crypto.randomUUID() глобально доступен в Node 20.6+ (Web Crypto API);
// паттерн runId-генерации см. src/run.ts существующий tick().
void (async () => {
  try {
    await startBot();
  } catch (err) {
    const e = err as Error;
    log.error("bot startBot exited with unexpected error", e);
    const alertId = crypto.randomUUID().slice(0, 8);
    try {
      await sendAlert({
        stage: "bot",
        message: e?.message ?? String(err),
        runId: alertId,
        stack: e?.stack,
      });
    } catch (alertErr) {
      log.error("alert send failed", alertErr);
    }
  }
})();

// DAEMON-01: graceful shutdown — ждём активный прогон, потом exit 0.
const shutdown = async (signal: string): Promise<void> => {
  log.info(`received ${signal}, stopping cron and bot`);
  task.stop();
  // D-06: остановить bot polling и дождаться завершения текущего getUpdates
  // (≤30s timeout polling'а + 5s buffer = 35s total).
  stopBot();
  const botShutdownDeadline = Date.now() + 35_000;
  while (isBotPolling() && Date.now() < botShutdownDeadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (isBotPolling()) {
    log.warn("bot polling did not stop within 35s — force exit");
  }
  // Существующий wait для активного pipeline-tick'а.
  while (isRunning) {
    await new Promise((r) => setTimeout(r, 500));
  }
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
