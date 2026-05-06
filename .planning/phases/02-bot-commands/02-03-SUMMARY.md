---
phase: 02-bot-commands
plan: 03
subsystem: bot
tags: [daemon, run.ts, bot-polling, graceful-shutdown, fire-and-forget]

# Dependency graph
requires:
  - phase: 02-bot-commands
    plan: 01
    provides: "src/bot.ts с startBot()/stopBot()/isBotPolling() lifecycle и контрактом «не throw'ает наверх»"
provides:
  - "src/run.ts с подключённым bot polling параллельно с cron (fire-and-forget IIFE)"
  - "Graceful shutdown через stopBot() + wait isBotPolling() ≤35s + wait isRunning"
  - "Outer try/catch на startBot() с одиночным sendAlert(stage='bot') без restart-loop'а"
affects: [02-04 (smoke/UAT — теперь bot polling и cron в одном npm start)]

# Tech tracking
tech-stack:
  added: []  # никаких новых runtime-зависимостей (cap=4)
  patterns:
    - "Fire-and-forget IIFE с outer try/catch — паттерн для длительных side-task'ов в daemon-entrypoint'е"
    - "Sequenced graceful shutdown: task.stop() → stopBot() → wait isBotPolling → wait isRunning → process.exit(0)"
    - "Bounded wait через Date.now()-deadline вместо setTimeout race (читаемее, не теряет timer)"

key-files:
  created: []
  modified:
    - "src/run.ts (+40 LOC) — импорт ./bot.js, fire-and-forget startBot, расширенный shutdown"

key-decisions:
  - "НЕТ supervisor-loop'а / rebackoff'а в run.ts — резильентность polling-loop'а уже обеспечена exp.backoff внутри pollLoop (Plan 1, telegram.ts pattern). Single-attempt + finальный alert при unexpected crash."
  - "stopBot() и cron task.stop() вызываются ОБА до wait'ов — параллельный signal обоим subsystem'ам, последовательный wait потом."
  - "35s shutdown deadline = 30s POLL_TIMEOUT_SEC из bot.ts + 5s buffer на закрытие fetch-сокета. Force-exit warn только если bot не уложился — pipeline-tick wait не упрётся в deadline."

patterns-established:
  - "Pattern: void (async () => { try { await longRunningStart(); } catch { sendAlert(stage); } })() — для side-task'ов рядом с cron"
  - "Pattern: graceful shutdown layered — внешний task.stop() + внутренний stopRequested флаг, потом ожидание pollingActive=false"

requirements-completed: [BOT-05]

# Metrics
duration: ~2min
completed: 2026-05-06
---

# Phase 02 Plan 03: Daemon-Bot Integration Summary

**Подключение bot polling-loop'а в `src/run.ts` параллельно с cron через fire-and-forget IIFE; graceful shutdown расширен ожиданием stopBot()/isBotPolling() с 35s deadline до wait'а pipeline-tick'а; никакого supervisor-loop'а в run.ts — резильентность уже внутри pollLoop (exp.backoff 1/2/4s).**

## Performance

- **Duration:** ~2 min
- **Tasks:** 1 (single autonomous task)
- **Files created:** 0
- **Files modified:** 1 (`src/run.ts`, +40 LOC)

## Accomplishments

- **Импорт `./bot.js`** добавлен после `./alert.js` — `startBot, stopBot, isBotPolling` теперь видны run.ts.
- **Fire-and-forget IIFE** установлена сразу после `cron.schedule(...)` и `log.info("daemon started, ...")`. `void (async () => { try { await startBot(); } catch (err) { ... sendAlert(stage="bot") ... } })()` — НЕ блокирует процесс на polling, НЕ создаёт floating-promise warning'а (через `void`).
- **Outer alert**: при попадании в catch (теоретически невозможно, т.к. внутренний catch в startBot уже ловит) — генерируется `crypto.randomUUID().slice(0, 8)` runId, отправляется единственный sendAlert. Без перезапуска. Daemon продолжает работать только с cron'ом.
- **Расширенный `shutdown()`**: log сообщение «stopping cron and bot», вызов `task.stop()`, потом `stopBot()`, потом bounded wait цикл `while (isBotPolling() && Date.now() < botShutdownDeadline)` с 35s deadline (30s POLL_TIMEOUT_SEC + 5s buffer). Если bot не уложился — `log.warn("bot polling did not stop within 35s — force exit")` и переход к существующему `while (isRunning)` на pipeline-tick.
- **TypeScript strict проходит** — `npx tsc --noEmit` exits 0.
- **Никаких новых runtime-зависимостей** (cap=4 сохранён).

## Task Commits

Each task was committed atomically:

1. **Task 1: подключить bot polling и расширить shutdown в src/run.ts** — `4554531` (feat)

## Files Created/Modified

- `src/run.ts` — расширен с 66 до 104 LOC. Добавлено:
  - Строка 9: `import { startBot, stopBot, isBotPolling } from "./bot.js";`
  - Строки 56–81: блок-комментарий + fire-and-forget IIFE с outer try/catch.
  - Строки 85–96: внутри `shutdown()` добавлены `stopBot()`, deadline-wait `isBotPolling()`, force-exit warn.
  - Строка 85 (бывшая 57): обновлено сообщение «stopping cron» → «stopping cron and bot».

## Decisions Made

- **Fire-and-forget без supervisor-loop'а (Approach B)** — startBot вызывается один раз. Если ушёл с ошибкой (что не должно быть по контракту) — sendAlert и daemon работает только с cron'ом. Альтернатива (rebackoff с setTimeout 5000) явно запрещена в плане (W-5: «не должно быть setTimeout(5000)»). Резильентность polling-цикла обеспечивается exp.backoff внутри `pollLoop` (Plan 1, 1/2/4s).
- **Параллельный stop, последовательный wait** — `task.stop()` и `stopBot()` оба вызываются сразу (signal'им обоим subsystem'ам), потом сначала ждём bot polling завершиться, затем pipeline-tick. Это минимизирует общее время shutdown'а и не выпускает rocgu pipeline'а в обратку pre-bot-stop.
- **35s deadline = 30s + 5s buffer** — POLL_TIMEOUT_SEC=30s в bot.ts (long-poll). 5s — запас на TCP teardown. Если deadline сорвался — логируем warn и продолжаем без прерывания цепочки shutdown (pipeline-tick всё равно ждёт через `while (isRunning)`).
- **`crypto.randomUUID().slice(0, 8)` для alertId** — соответствует существующему паттерну в `tick()` catch-блоке. Единый стиль runId-генерации.

## Deviations from Plan

None — plan executed exactly as written. Все правки в `src/run.ts` соответствуют action-разделу Task 1: импорт, IIFE, shutdown extension. Никаких bug-fix'ов / отсутствующей функциональности / архитектурных вопросов.

## Issues Encountered

- **Worktree base mismatch**: исходный HEAD моего worktree (`20214a3 "new sum"`) был ancestor'ом orchestrator-base'а `5c9872e4...`, но не содержал Plan 1 артефактов (src/bot.ts, .env.example, плановых файлов 02-bot-commands). `git merge-base HEAD <base>` вернул HEAD (one-way ancestor relationship), что технически не помечалось worktree-check'ом как «different». Применил `git reset --hard 5c9872e4...` — после reset'а Plan 1 артефакты появились (src/bot.ts, channels-store.ts из Phase 1, plan files). Working tree чистый, никаких конфликтов.

## Threat Flags

Никаких новых threat-surface не введено:
- `bot.js` уже использует `BOT_ALLOWED_USER_IDS` allowlist (Plan 1) — авторизация на уровне handler'а, run.ts не добавляет attack surface.
- `sendAlert(stage: "bot")` — payload не сериализует `process.env`, только переданные поля (T-01-02 уже соблюдён в src/alert.ts:4).
- Outer try/catch не маскирует ошибку — она идёт и в `log.error`, и в alert. Stack trace ограничен 1500 chars (alert.ts:42).
- `crypto.randomUUID()` — Web Crypto API, доступен в Node 20.6+ (PROJECT.md constraint).

## Self-Check

Артефакты плана:
- `src/run.ts` (+40 LOC, импорт+IIFE+shutdown) — FOUND
- Commit `4554531` (Task 1) — FOUND (`git log --oneline | grep 4554531`)
- `npx tsc --noEmit` exits 0 — VERIFIED
- All 12 acceptance grep checks — PASSED:
  - 9 positive (≥1 match): `from "./bot.js"`, `import.*startBot`, `stopBot()`, `isBotPolling()`, `void (async`, `await startBot()`, `stage: "bot"`, `task.stop()`, `while (isRunning)`
  - 3 negative (=0 matches): `botSupervisor`, `botSupervisorStop`, `setTimeout(...5000...)`

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 02-04 (unit tests + smoke):** daemon теперь стартует с cron + bot polling одной командой `npm start`. Smoke-сценарий: `pm2 logs` показывает обе строки старта (`daemon started, schedule: ...` и `[bot] polling started (allowlist size=N)`). Graceful shutdown через Ctrl+C даёт sequence: `stopping cron and bot` → `[bot] polling stopped` → exit 0 (если pipeline не активен).
- **Phase 03 (web scraping):** `src/run.ts` остаётся entrypoint'ом; future web-scraping-loop'у достаточно повторить fire-and-forget паттерн рядом с bot IIFE.

---
*Phase: 02-bot-commands*
*Completed: 2026-05-06*
