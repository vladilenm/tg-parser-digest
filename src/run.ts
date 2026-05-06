// src/run.ts — daemon entrypoint tg-parser-demo (v2.0).
// Запуск: `npm start` — процесс висит, cron триггерит tick() каждые сутки в 20:15 MSK + 0–30min jitter.
// Остановка: Ctrl+C (SIGINT) или SIGTERM от PM2 — graceful shutdown с ожиданием активного прогона.

import cron from "node-cron";
import { runPipeline } from "./pipeline.js";
import { runWebPipeline } from "./web-scraper.js";
import { log, logRunSummary, logWebRunSummary } from "./logger.js";
import { sendAlert } from "./alert.js";
import { startBot, stopBot, isBotPolling } from "./bot.js";

// DAEMON-03: mutex от параллельных тиков. In-memory boolean — достаточно для single-process PM2 fork.
let isRunning = false;

// WR-01: AbortController активного tick'а. shutdown() abort'ит его, чтобы прервать
// jitter-sleep (до 30 мин) и не упереться в PM2 kill_timeout=180s → SIGKILL посередине прогона.
let activeAbort: AbortController | null = null;

async function tick(): Promise<void> {
  if (isRunning) {
    log.warn("prev run still in progress — skipping tick");
    return;
  }
  isRunning = true;
  activeAbort = new AbortController();
  // D-07: единый runId на tick — TG и web фильтруются одним grep'ом.
  const runId = crypto.randomUUID().slice(0, 8);
  try {
    // WR-09: outer try/catch ловит любую ошибку из jitter/TG/web-секций, чтобы
    // unhandled rejection не пробрасывалась в node-cron callback и не съедалась молча.
    try {
      // ANTIBAN: рандомная пауза 0–30 минут перед прогоном, чтобы убрать детерминированную сигнатуру "ровно 20:15".
      const jitterMs = Math.floor(Math.random() * 30 * 60 * 1000);
      log.info(`[tick] runId=${runId} schedule jitter: sleeping ${(jitterMs / 1000).toFixed(0)}s before run`);
      // WR-01: abortable sleep — shutdown() abort'ит signal и мы тут же выходим из tick'а.
      try {
        await abortableSleep(jitterMs, activeAbort.signal);
      } catch (e) {
        if ((e as Error).message === "shutdown") {
          log.info(`[tick] runId=${runId} aborted during jitter sleep`);
          return;
        }
        throw e;
      }

      // ---- D-06: TG-pipeline (existing, unchanged behavior) ----
      try {
        const summary = await runPipeline(runId);
        logRunSummary(summary);
      } catch (err) {
        const e = err as Error;
        log.error(`[tick] runId=${runId} TG pipeline failed`, e);
        // ALERT-02 (D-13): await — гарантируем 60s окно.
        try {
          await sendAlert({
            stage: "tick",
            message: e?.message ?? String(err),
            runId,
            stack: e?.stack,
          });
        } catch (alertErr) {
          log.error("alert send failed", alertErr);
        }
      }

      // ---- D-08: Web-pipeline стартует НЕЗАВИСИМО от TG (даже если TG упал) ----
      try {
        const webSummary = await runWebPipeline(runId);
        logWebRunSummary(webSummary);
      } catch (err) {
        // D-09: alert stage="web" — оператор сразу различает TG vs web fail.
        const e = err as Error;
        log.error(`[tick] runId=${runId} web pipeline failed`, e);
        try {
          await sendAlert({
            stage: "web",
            message: e?.message ?? String(err),
            runId,
            stack: e?.stack,
          });
        } catch (alertErr) {
          log.error("alert send failed", alertErr);
        }
      }
    } catch (err) {
      // WR-09: catch-all — любая ошибка вне TG/web inner-блоков (например, из jitter
      // или из самого AbortController-кода). Логируем + alert, не пробрасываем в node-cron.
      const e = err as Error;
      log.error(`[tick] runId=${runId} unexpected tick failure`, e);
      try {
        await sendAlert({
          stage: "tick",
          message: e?.message ?? String(err),
          runId,
          stack: e?.stack,
        });
      } catch (alertErr) {
        log.error("alert send failed", alertErr);
      }
    }
  } finally {
    isRunning = false;
    activeAbort = null;
  }
}

/**
 * abortableSleep — setTimeout, который немедленно reject'ит "shutdown" при abort'е signal'а.
 * WR-01: используется для jitter-окна, чтобы SIGINT/SIGTERM не висели до 30 мин.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("shutdown"));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("shutdown"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
  // WR-01: abort активный jitter-sleep, чтобы tick() не висел до 30 мин.
  // Если pipeline уже стартовал — abort не повлияет (он только для sleep'а внутри tick).
  activeAbort?.abort();
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
