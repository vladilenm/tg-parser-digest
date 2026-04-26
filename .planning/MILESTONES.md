# Milestones

## v1.0 MVP дайджест (Shipped: 2026-04-21)

**Phases completed:** 1 phases, 3 plans, 9 tasks

**Key accomplishments:**

- Каркас ESM/TypeScript-проекта с 3 runtime-зависимостями (openai, telegram, yaml), 12-переменным env-контрактом, seed-списком 12 каналов и интерактивным GramJS StringSession-логином через readline
- GramJS user-client с anti-ban identity (Desktop/Windows 11/ru) + fetchLast24h с FloodWait retry + DeepSeek batch-суммаризация с серверной проверкой дословности keyQuote через Map<url, Post> + HTML-рендер для Telegram Bot API
- Замыкание MVP-пайплайна: `src/deliver.ts` (sendToChannel + chunkHtml через Bot API fetch), `src/run.ts` (main() — channels.yaml → GramJS → DeepSeek → HTML → Telegram с пустым днём и глобальным catch), `README.md` (3 команды + дисциплина 10–15 минут + 5 критериев §11).

**Archived artifacts:**
- [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- [milestones/v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md)
- [milestones/v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)

---

## v2.0 Автоматизация + 50 каналов (Shipped: 2026-04-26, code complete + known runtime gap)

**Phases completed:** 1 phase (YOLO), 7 plans, 20/20 requirements satisfied

**Key accomplishments:**

- Перевод `npm start` в long-running daemon: `src/run.ts` с `node-cron` (`'0 20 * * *'`, `Europe/Moscow`), mutex `isRunning`, graceful SIGINT/SIGTERM (ждёт активный прогон, затем `exit 0`).
- Выделение пайплайна в `src/pipeline.ts` (`runPipeline(): Promise<RunSummary>`, per-run GramJS клиент с дисконнектом в `finally`, in-memory дедуп `${username}:${messageId}`).
- Reliability: `fetchLast24h` распознаёт сетевые сбои, делает 3 попытки exp. backoff (1000/2000/4000 мс) с `client.connect()` между ними; счётчик отделён от FloodWait.
- Observability: `src/logger.ts` (префиксированный логгер `[ISO] [level]`), тип `RunSummary` (runId, counters, errors[]), `logRunSummary` многострочным блоком.
- Scale: `channels.yaml` расширен до 50 каналов (38 PLACEHOLDER-стабов под operator-replacement), `CHANNEL_DELAY_MS=1750`.
- Deployment: `ecosystem.config.cjs` (PM2 fork-mode, `--import tsx`, `kill_timeout=180000`); README с разделами «Запуск на VPS (PM2)» и «Ежедневный summary-лог».

**Known gap (carried into v3.0):**
- HUMAN-UAT smoke-test (npm start локально + временный cron + SIGINT) не подтверждён оператором; runtime-валидация SC1/SC2/SC5 принципиально откладывается до v3.0 7-day acceptance proof (ACCEPT-01).
- 38 каналов остались как `PLACEHOLDER_NN` — заполнение реальными username вынесено в operator-checkpoint, не блокирует код.

**Archived artifacts:**
- [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- [milestones/v2.0-REQUIREMENTS.md](milestones/v2.0-REQUIREMENTS.md)
- [milestones/v2.0-MILESTONE-AUDIT.md](milestones/v2.0-MILESTONE-AUDIT.md)
- [milestones/v2.0-phases/02-daemon-50/](milestones/v2.0-phases/02-daemon-50/)

---
