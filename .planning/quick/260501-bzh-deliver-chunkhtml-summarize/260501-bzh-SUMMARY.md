---
phase: quick-260501-bzh
plan: 01
subsystem: delivery
tags: [telegram, html, openai, deepseek, logging, chunking]

# Dependency graph
requires:
  - phase: phase-1-code
    provides: deliver.ts (chunkHtml, sendToChannel), summarize.ts (DeepSeek call), logger.ts (log.info/warn/error)
provides:
  - chunkHtml инвариант «один буллет — одна строка» (throw вместо тихого среза)
  - summarize falls within 120s on hung DeepSeek (was 10min default)
  - visibility logs around DeepSeek call (sending / response / retry)
affects: [delivery, daemon, pm2-logs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hard-fail invariants over silent fallbacks for HTML safety"
    - "info-logs around long-running external calls для PM2 видимости"

key-files:
  created: []
  modified:
    - src/deliver.ts
    - src/summarize.ts

key-decisions:
  - "chunkHtml бросает Error вместо тихого среза по max — лучше fail loud, чем сломанный HTML в Telegram"
  - "Удалён space-fallback (Приоритет 3) — он ломал <i>«…»</i>; буллет должен помещаться в одну строку"
  - "OpenAI client получает timeout=120_000 + maxRetries=1 вместо дефолтных 10min/2 retries — для daemon-режима критично fail-fast"
  - "info-логи через log.info, не console.log — единый логгер для PM2 perceived"

patterns-established:
  - "External call observability: log.info перед запросом + log.info после с длительностью"
  - "Surgical edits принцип — не мигрируем существующие console.warn/console.error на log.*, чтобы изменения были минимальны"

requirements-completed:
  - QUICK-260501-bzh-FIX1
  - QUICK-260501-bzh-FIX2

# Metrics
duration: 2min
completed: 2026-05-01
---

# Phase quick-260501-bzh Plan 01: Deliver chunkHtml + Summarize Surgical Fixes Summary

**chunkHtml теперь бросает Error на буллете шире лимита (вместо разрыва <i>…</i>), а summarize получил 120с таймаут и info-логи вокруг DeepSeek-запроса.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-01T05:41:11Z
- **Completed:** 2026-05-01T05:43:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- chunkHtml: удалены space-fallback (Приоритет 3) и тихий срез `cutAt = max`; разрыв возможен только на `\n\n` или `\n`, иначе диагностический Error.
- chunkHtml: убран порог `< Math.floor(max * 0.5)` для Приоритета 2 — `\n` используется сразу, если `\n\n` не найден.
- summarize: OpenAI-клиент сконфигурирован с `timeout: 120_000, maxRetries: 1` (вместо дефолтных 10 минут / 2 ретраев).
- summarize: добавлены три info-лога — «sending N posts to DeepSeek», «response received in Xms», «retry attempt after schema-validation failure».
- summarize: импортирован `log` из `./logger.js`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix chunkHtml — remove space-fallback, throw on no newline** — `c300ad8` (fix)
2. **Task 2: Add timeout + visibility logs to summarize** — `7d7275e` (feat)

_Plan metadata commit will be added by the orchestrator._

## Files Created/Modified
- `src/deliver.ts` — `chunkHtml` сокращён до 2 приоритетов разрыва + throw; doc-комментарий обновлён (инвариант «буллет = строка»).
- `src/summarize.ts` — `import { log } from "./logger.js"`; OpenAI с `timeout: 120_000, maxRetries: 1`; три `log.info` в `summarize`/`ask`.

## Decisions Made
- **Fail loud вместо тихого среза в chunkHtml.** Телеграм возвращает 400 «Can't find end tag corresponding to start tag i», когда HTML разорван. Лучше упасть с понятным Error, чем доставить сломанное сообщение или потерять секцию.
- **Логи через `log.info`, а не `console.log`.** В проекте уже есть `src/logger.ts` с timestamp-обёрткой — используем единый логгер для daemon/PM2 perceived. Существующие `console.warn`/`console.error` оставлены без изменений (surgical scope).
- **120с timeout, не 60.** DeepSeek на больших промптах бывает медленным; 60с может ложно срабатывать, 120с — разумный потолок при дефолте 600с.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- При запуске `node --input-type=module -e "import('./src/summarize.ts')..."` без tsx-loader получили `Cannot find module './schema.js'` (TS-файл `schema.ts` не резолвится без tsx-хука). Это особенность ESM resolution, не баг кода. Перезапустили с `node --import tsx ...` — модуль грузится OK. На реальный запуск проекта (`npm start` через `tsx`) это не влияет.

## User Setup Required

None — изменения чисто внутренние, переменных окружения не добавлено.

## Next Phase Readiness
- `chunkHtml` теперь имеет жёсткий контракт: один буллет шире `CHUNK_SAFE_LIMIT (4000)` → Error. Если в будущем `renderItem` начнёт генерировать буллеты длиннее 4000 символов (например, очень длинный `keyQuote`), придётся либо обрезать `keyQuote`/`summary` в рендере, либо увеличить лимит — это поведение теперь видимо в логах и алертах.
- `summarize` теперь видим в PM2-логах: оператор сразу увидит, висит ли DeepSeek или просто долго отвечает.

## Self-Check: PASSED

Verified files and commits exist:
- FOUND: src/deliver.ts (modified)
- FOUND: src/summarize.ts (modified)
- FOUND: commit c300ad8 (Task 1: chunkHtml fix)
- FOUND: commit 7d7275e (Task 2: summarize timeout + logs)
- FOUND: tsc --noEmit passes
- FOUND: chunkHtml smoke test (3 chunks with balanced `<i>`/`</i>`)
- FOUND: chunkHtml throws on no-newline input
- FOUND: all 6 grep markers in summarize.ts (timeout: 120_000, maxRetries: 1, sending posts, response received, retry attempt, from "./logger.js")

---
*Phase: quick-260501-bzh*
*Completed: 2026-05-01*
