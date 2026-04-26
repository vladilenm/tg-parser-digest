---
phase: 02-daemon-50
plan: 02
subsystem: logging
tags: [typescript, esm, console, structured-logging, runsummary, pm2-log]

# Dependency graph
requires:
  - plan: 02-01
    provides: "src/types.ts: RunSummary interface (11 fields)"
provides:
  - "src/logger.ts: log.info/warn/error с префиксом [ISO-timestamp] [level] (LOG-01)"
  - "src/logger.ts: logRunSummary(s: RunSummary) — многострочный summary-блок (LOG-03)"
affects: [02-04-reconnect, 02-05-daemon, 02-07-readme]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structured logging через console.log/warn/error — без сторонних зависимостей; PM2 сам разложит stdout/stderr в pm2-out.log/pm2-err.log"
    - "Type-only импорт RunSummary из ./types.js — не создаёт runtime-циклов между logger.ts и pipeline.ts (pipeline.ts импортирует log из logger.ts, logger.ts импортирует только тип из types.ts)"
    - "logRunSummary как чистая функция: формирует массив строк и печатает одним console.log (join \"\\n\")"
    - "Опциональный блок errors: печатается только при s.errors.length > 0 — чистый лог при success-прогонах"

key-files:
  created:
    - "src/logger.ts"
  modified: []

key-decisions:
  - "console.log/warn/error вместо pino/winston — единственная зависимость (PM2) перехватывает stdout/stderr в отдельные файлы без доп. конфига"
  - "Разделение stdout (info) vs stderr (warn/error) — нужно PM2 для корректного сплита в pm2-out.log / pm2-err.log"
  - "type-only import RunSummary (`import type`) — защита от возможных circular deps в будущем, даже если logger начнут импортировать из места, на которое ссылается RunSummary-consumer"
  - "logRunSummary формат зафиксирован one-to-one с docs/phase-2.md §4 — шаблон, на который строится Success Criterion 2 (summary содержит total=50, delivered=true, durationMs)"

patterns-established:
  - "logger — single-responsibility модуль ~43 LOC, без уровней-фильтров (LOG_LEVEL из v1.0 backlog не вводится в v2.0 — out-of-scope)"
  - "Все новые модули v2.0 используют log.info/warn/error — никаких прямых console.* в бизнес-коде"

requirements-completed: [LOG-01, LOG-03]

# Metrics
duration: ~1min
completed: 2026-04-22
---

# Phase 02 Plan 02: Structured logger + logRunSummary Summary

**Создан src/logger.ts со структурированным логгером (`log.info/warn/error` с префиксом `[ISO-timestamp] [level]`) и функцией `logRunSummary(s: RunSummary)`, печатающей многострочный диагностический блок в каноническом формате docs/phase-2.md §4 — без новых runtime-зависимостей, через `console.log/warn/error`.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-22T07:25:58Z
- **Completed:** 2026-04-22T07:26:56Z
- **Tasks:** 1
- **Files modified:** 1 (1 created, 0 modified)

## Accomplishments

- `src/logger.ts` (43 LOC) экспортирует `log` с методами `info`/`warn`/`error` и `logRunSummary(s: RunSummary): void`.
- Префикс логов реализован через локальную функцию `timestamp()` → `new Date().toISOString()` и template string `[${timestamp()}] [level] ${msg}` с `...ctx` пробросом.
- `logRunSummary` формирует массив из 5 строк: `[ISO] [summary] runId=…`, `  duration=Xs`, `  channels: total=… succeeded=… skipped=…`, `  posts: collected=… deduped=…`, `  delivered=…`; при `s.errors.length > 0` добавляет блок `  errors:` + индентированный список `    - ${err}`.
- Длительность рендерится как `(durationMs / 1000).toFixed(1) + "s"` — соответствует `duration=58.4s` из канонического примера docs/phase-2.md §4.
- Wave 1 замкнута: `npx tsc --noEmit` теперь проходит чисто (исчезла ожидаемая ошибка plan 01 `Cannot find module './logger.js'` — задокументирована в 02-01-SUMMARY).
- 0 новых зависимостей: `package.json` не тронут.
- `console.warn`/`console.error` выбраны сознательно (а не всё через `console.log`) — PM2 в Phase 2 plan 06 разложит stdout/stderr в `pm2-out.log` / `pm2-err.log`.

## Task Commits

1. **Task 1: Создать src/logger.ts с log.info/warn/error и logRunSummary** — `97d4c51` (feat)

**Plan metadata commit:** добавляется финальным коммитом после обновления STATE.md/ROADMAP.md.

## Files Created/Modified

- `src/logger.ts` (created, 43 LOC) — новый модуль. Один type-only импорт `import type { RunSummary } from "./types.js"`. Функция `timestamp()` возвращает `new Date().toISOString()`. Объект `log` с тремя методами: `info` → `console.log`, `warn` → `console.warn`, `error` → `console.error`, все с префиксом `[${timestamp()}] [level] ${msg}` и spread `...ctx`. Функция `logRunSummary` строит 5-строчный массив + опциональный блок `errors:`, печатает одним `console.log(lines.join("\n"))`.

## Decisions Made

- **`console.log/warn/error` без внешних пакетов**: избегаем pino/winston и их зависимостей. PM2 сам перехватывает stdout/stderr → файлы; дополнительный JSON-формат не нужен на v2.0 (человеко-читаемый лог достаточен для single-operator дисциплины).
- **Разделение stdout vs stderr**: `info` → stdout, `warn`/`error` → stderr. Обязательное условие для PM2-разделения в `pm2-out.log` / `pm2-err.log` (подтверждено в 02-RESEARCH §7).
- **type-only импорт `RunSummary`**: `import type` — не создаёт runtime-связи между `logger.ts` и `types.ts`. Это страховка на случай, если кто-то из будущих модулей начнёт импортировать `RunSummary` через logger (гипотетический циркул).
- **Без `LOG_LEVEL` фильтра**: v1.0 backlog содержит IN-пункт «LOG_LEVEL задокументирован в `.env.example`, нигде не читается» — в v2.0 намеренно не внедряем уровни-фильтры (out-of-scope по STATE.md, v2.0 = автоматизация+50 каналов, не observability-рефакторинг).
- **Формат summary one-to-one с docs/phase-2.md §4**: пять базовых строк + опциональный `errors:` блок. Шаблон напрямую связан с Success Criterion 2 из ROADMAP: summary-лог должен содержать `total=50`, `delivered=true`, `durationMs`.

## Deviations from Plan

None — plan executed exactly as written. Action-блок Task 1 прописан вербатим; проверка `grep`-паттернов и `npx tsc --noEmit` прошли с первой попытки; ручной smoke-тест (две ветки: с errors и без) воспроизвёл канонический вывод из docs/phase-2.md §4 без расхождений.

## Issues Encountered

None. Wave 1 замыкается как и планировалось: после создания `src/logger.ts` ожидаемая ошибка `Cannot find module './logger.js'` из 02-01-SUMMARY («Issues Encountered») разрешилась автоматически — `npx tsc --noEmit` выходит с exit code 0 без дополнительных правок в `src/pipeline.ts`.

## Threat Flags

Нет — plan 02 не вводит новых внешних поверхностей (сетевых эндпоинтов, файловых путей, trust boundaries). `logger.ts` использует только встроенный `console` и `Date` — никаких IO за пределами stdout/stderr.

## Known Stubs

Нет. Все функции полностью реализованы и проверены ручным smoke-тестом:
- `log.info('test', {k: 1})` → `[2026-04-22T07:26:26.475Z] [info] test { k: 1 }`
- `logRunSummary({...with errors...})` → канонический 7-строчный вывод (5 базовых + `  errors:` + 1 элемент)
- `logRunSummary({...errors: []...})` → 5-строчный вывод без секции `errors:`

## Verification Output

**Automated checks** (все из verify-блока Task 1 прошли):
- `test -f src/logger.ts` ✓
- `grep -q "export const log" src/logger.ts` ✓
- `grep -q "export function logRunSummary" src/logger.ts` ✓
- `grep -q "import type { RunSummary }" src/logger.ts` ✓
- `grep -q '[${timestamp()}] [info]' src/logger.ts` ✓
- `grep -q "console.log" src/logger.ts` ✓
- `grep -q "console.warn" src/logger.ts` ✓
- `grep -q "console.error" src/logger.ts` ✓
- `grep -q "runId=${s.runId}" src/logger.ts` ✓
- `grep -q "channels: total=${s.channelsTotal}" src/logger.ts` ✓
- `grep -q "delivered=${s.digestDelivered}" src/logger.ts` ✓
- `npx tsc --noEmit` ✓ (0 ошибок)
- `grep "^import" src/logger.ts` → единственная строка `import type { RunSummary } from "./types.js";` ✓

**Manual smoke** (из `<verification>` блока plan):

```
[2026-04-22T07:26:26.475Z] [info] test { k: 1 }
[2026-04-22T17:00:00Z] [summary] runId=abc12345
  duration=58.4s
  channels: total=50 succeeded=47 skipped=3
  posts: collected=412 deduped=5
  delivered=true
  errors:
    - neftegazru: FloodWait retry exhausted
```

Совпадает с каноническим примером из docs/phase-2.md §4 символ в символ.

## User Setup Required

None — ни одной внешней зависимости/сервиса не добавлено.

## Next Phase Readiness

- **Ready for plan 02-04 (GramJS reconnect retry):** `log.warn` доступен для строки `reconnect attempt 1/3` (Success Criterion 4 из ROADMAP).
- **Ready for plan 02-05 (daemon entrypoint):** `log.info`/`log.warn`/`log.error` и `logRunSummary` — обе импортируемые функции присутствуют; daemon-шаблон из docs/phase-2.md §2 использует ровно эти имена.
- **Wave 1 unblocked for wave 2:** `npx tsc --noEmit` = 0 ошибок. pipeline.ts из plan 02-01 теперь компилируется без предупреждений.
- **SCALE-02 не закрыт** этим планом (в scope plan 02-03 — channels.yaml + CHANNEL_DELAY_MS=1750); никаких зависимостей отсюда нет.

## Self-Check: PASSED

- **FOUND:** `src/logger.ts` (43 LOC, exports log + logRunSummary, type-only import RunSummary)
- **FOUND:** commit `97d4c51` (Task 1: logger.ts) in `git log --oneline --all`
- **FOUND:** `.planning/phases/02-daemon-50/02-02-SUMMARY.md` (this file)
- **CONFIRMED:** `npx tsc --noEmit` exits 0 (wave 1 замкнута)
- **CONFIRMED:** `package.json` не изменён — `git diff --quiet package.json` exits 0 (0 новых runtime-зависимостей)
- **CONFIRMED:** ручной smoke воспроизводит канонический вывод из docs/phase-2.md §4

---
*Phase: 02-daemon-50*
*Completed: 2026-04-22*
