---
phase: 02-daemon-50
plan: 01
subsystem: pipeline
tags: [typescript, esm, gramjs, yaml, runpipeline, runsummary, dedupe]

# Dependency graph
requires:
  - phase: 01-mvp
    provides: "src/telegram.ts (createClient, fetchLast24h, sleep, randomInt), src/summarize.ts, src/deliver.ts, src/types.ts (Post)"
provides:
  - "src/types.ts: RunSummary interface (11 fields) — LOG-02"
  - "src/pipeline.ts: runPipeline(): Promise<RunSummary> — автономный pipeline (PIPE-01)"
  - "In-memory дедуп постов по ${username}:${messageId} в рамках прогона (PIPE-03)"
  - "Per-run GramJS-клиент с disconnect в finally (PIPE-02)"
affects: [02-02-logger, 02-04-reconnect, 02-05-daemon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "runPipeline() — чистая функция без process.exit; ошибки пробрасываются вызывающему"
    - "Per-channel try/catch: падение одного канала не ломает прогон, учтено в channelsSkipped и errors[]"
    - "In-memory Set<string> для дедупа внутри прогона; ключ ${channelUsername}:${messageId}"
    - "Логирование через log.* из ./logger.js (LOG-01) — единый формат префикса"

key-files:
  created:
    - "src/pipeline.ts"
  modified:
    - "src/types.ts"

key-decisions:
  - "runPipeline создаёт и дисконнектит GramJS-клиент per-run — живую сессию между прогонами не держим"
  - "Дедупа только in-memory в рамках одного прогона; cross-run дедуп остаётся вне scope v2.0"
  - "CHANNEL_DELAY_MS дефолт поднят до 1750 (SCALE-02) — согласован с .env.example plan 05"
  - "runId = crypto.randomUUID().slice(0, 8) — без импорта node:crypto (глобал в Node 20)"

patterns-established:
  - "Pipeline как экспорт: src/pipeline.ts содержит только экспорт runPipeline, без top-level main/catch"
  - "RunSummary фиксирует 11 полей метрик — будущий logRunSummary (plan 02) форматирует в лог"
  - "Комментарии к action-блокам плана: 'Не завершает процесс' вместо 'process.exit' чтобы не ложно триггерить verify-grep"

requirements-completed: [PIPE-01, PIPE-02, PIPE-03, LOG-02]

# Metrics
duration: ~10min
completed: 2026-04-22
---

# Phase 02 Plan 01: Pipeline extract + RunSummary + in-memory dedupe Summary

**Вынесена логика одного прогона в src/pipeline.ts как чистая runPipeline(): Promise<RunSummary>, добавлен 11-полевой интерфейс RunSummary в src/types.ts, реализован in-memory дедуп постов по ${username}:${messageId}.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-22T07:18:55Z (STATE.md last_updated)
- **Completed:** 2026-04-22T07:23:06Z
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- Интерфейс `RunSummary` (11 полей согласно LOG-02) добавлен в `src/types.ts` без изменения существующих типов.
- Новый модуль `src/pipeline.ts` экспортирует `runPipeline(): Promise<RunSummary>` — per-run GramJS-клиент, per-channel try/catch, in-memory дедуп, SCALE-02 дефолт `CHANNEL_DELAY_MS=1750`, нет `process.exit` в pipeline-коде.
- Все логи идут через `log.info`/`log.warn` из `./logger.js` (LOG-01); `console.*` отсутствует.
- `src/run.ts` не тронут — daemon-rewrite остаётся за plan 04.

## Task Commits

1. **Task 1: Добавить RunSummary в src/types.ts** — `5fff85b` (feat)
2. **Task 2: Создать src/pipeline.ts с runPipeline() + in-memory дедупа** — `4059062` (feat)

**Plan metadata commit:** добавляется финальным коммитом после обновления STATE.md/ROADMAP.md.

## Files Created/Modified

- `src/types.ts` (modified) — добавлен `export interface RunSummary` с 11 полями (runId, startedAt, finishedAt, durationMs, channelsTotal, channelsSucceeded, channelsSkipped, postsCollected, postsDeduped, digestDelivered, errors). Существующие `Post`/`DigestItem`/`DigestSection`/`DigestJson` не изменены.
- `src/pipeline.ts` (created, 126 LOC) — функция `runPipeline()`, локальные `loadChannelsYaml()` + `ChannelEntry`/`ChannelsFile`. Импорт `yaml`, `./telegram.js`, `./summarize.js`, `./deliver.js`, `./logger.js`. GramJS `client.disconnect()` в `finally` outer try-блока. Per-channel try/catch внутри цикла обходит 50 каналов с jitter `sleep(channelDelayMs + randomInt(0, 500))`. Дедуп через `Set<string>` с ключом `${post.channelUsername}:${post.messageId}`. Пустой прогон (allPosts.length===0) → `digestDelivered=false`, `summarize`/`sendToChannel` не вызываются.

## Decisions Made

- **Per-run GramJS client** (PIPE-02): создаём в runPipeline и дисконнектим в finally перед этапом LLM/delivery. Живую сессию между прогонами НЕ держим — соответствует v2.0 «daemon как серия независимых прогонов».
- **In-memory only дедуп** (PIPE-03): Set<string> в рамках одного прогона. Cross-run и embedding-based дедуп явно вне scope v2.0.
- **`crypto.randomUUID()` глобально**: без импорта `node:crypto` — глобал в Node 20.6+.
- **Нет `process.exit` в pipeline-коде**: соответствует PIPE-01; daemon в plan 04 оборачивает runPipeline в tick с retry/mutex.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Переформулировка doc-комментария, упоминавшего `process.exit`**

- **Found during:** Task 2 (verification step)
- **Issue:** JSDoc-комментарий `runPipeline` содержал фразу `Не вызывает process.exit — ошибки пробрасывает...`, что ломало negative-check плана `! grep -q "process\.exit" src/pipeline.ts` (grep находил упоминание в комментарии, хотя фактического вызова нет).
- **Fix:** Заменил комментарий на `Не завершает процесс — ошибки пробрасывает вызывающему (daemon в src/run.ts).` Семантика сохранена, verify-check проходит.
- **Files modified:** src/pipeline.ts
- **Verification:** `! grep -q "process\.exit" src/pipeline.ts` → exits 0.
- **Committed in:** `4059062` (Task 2 commit, в составе первичного Write).

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Косметическая правка комментария ради прохождения grep-verify; функциональной разницы нет, семантика идентична.

## Issues Encountered

**`npx tsc --noEmit` на выходе plan 01 падает с `Cannot find module './logger.js'` — ОЖИДАЕМОЕ поведение для wave-1 параллелизма.**

План в разделе `<interfaces>` и Task 2 action-блоке явно документирует:

> При изолированном исполнении plan 01 без plan 02 `npx tsc --noEmit` упадёт с `Cannot find module './logger.js'` — это ожидаемое поведение, означающее что нужно сначала завершить wave 1 целиком.

Также в `<verification>` плана пункт 1: «`npx tsc --noEmit` выводит 0 ошибок (**после завершения wave 1 целиком**, т.е. plan 02 также завершён и src/logger.ts существует).»

Текущее состояние:
- Единственная оставшаяся ошибка tsc — `src/pipeline.ts(10,21): error TS2307: Cannot find module './logger.js'`.
- Все остальные acceptance checks plan 01 прошли.
- tsc-чистота восстанавливается автоматически после завершения plan 02 (`src/logger.ts` создаётся там).

Не блокер для plan 01; блокер для merge в wave 2, если plan 02 не стартует.

## Threat Flags

Нет — plan 01 не вводит новых внешних поверхностей (сетевых эндпоинтов, файловых путей, trust boundaries). `runPipeline` использует уже существующие capabilities GramJS/DeepSeek/Bot API из phase 01.

## Known Stubs

Нет. Все поля `RunSummary` вычисляются из фактических счётчиков прогона; заглушек-плейсхолдеров в коде нет. Единственный неразрешённый импорт (`./logger.js`) — зависимость от параллельного plan 02 wave 1, не стаб.

## User Setup Required

None — внешних сервисов не добавлено.

## Next Phase Readiness

- **Ready for plan 02 (logger + logRunSummary):** `RunSummary` тип готов, `runPipeline` уже импортирует `log` с корректной сигнатурой (`info`/`warn`/`error`).
- **Ready for plan 04 (daemon):** `runPipeline(): Promise<RunSummary>` — детерминированная функция, daemon-tick обернёт её в mutex/retry.
- **Blocker для merge wave 1:** нужен plan 02 (logger.ts), чтобы `npx tsc --noEmit` прошёл чисто.
- **`src/run.ts` без изменений:** содержит старый `main()` — это намеренно, daemon-rewrite в plan 04.

## Self-Check: PASSED

- **FOUND:** `src/types.ts` (RunSummary interface 11 полей, `grep -q "export interface RunSummary"` exits 0)
- **FOUND:** `src/pipeline.ts` (126 LOC, `runPipeline` export, no process.exit, dedupe Set, logger import)
- **FOUND:** commit `5fff85b` (Task 1: types.ts RunSummary)
- **FOUND:** commit `4059062` (Task 2: pipeline.ts)
- **FOUND:** `.planning/phases/02-daemon-50/02-01-SUMMARY.md` (this file)
- **CONFIRMED:** `src/run.ts` unchanged — `git diff --quiet src/run.ts` exits 0.
- **KNOWN:** `npx tsc --noEmit` returns 1 error (`Cannot find module './logger.js'`) — ожидаемое wave-1 поведение, задокументировано в плане и выше в Issues Encountered.

---
*Phase: 02-daemon-50*
*Completed: 2026-04-22*
