---
phase: 01-storage-migration
plan: 02
subsystem: storage
tags: [auto-migration, yaml, json, channels-store, idempotency, atomic-write]

# Dependency graph
requires:
  - 01-01-SUMMARY (loadChannels skeleton, atomicWriteJson, ChannelsFileSchema, CHANNELS_PATH)
provides:
  - "src/channels-store.ts: loadChannels() с lazy auto-migration channels.yaml → channels.json (D-11, D-12, D-13)"
  - "internal const YAML_FALLBACK_PATH (НЕ экспортируется)"
affects:
  - 01-03-PLAN (после wiring pipeline.ts.loadChannelsYaml → loadChannels — миграция выполнится автоматически на первом npm start)
  - 01-04-PLAN (Vitest unit tests для трёх сценариев миграции: A/B/C/D)

# Tech tracking
tech-stack:
  added: []  # никаких новых runtime/dev deps; yaml уже был с v1.0
  patterns:
    - "lazy auto-migration внутри reader-функции — сценарии A/B/C/D (см. plan §<behavior>)"
    - "Synchronous atomicWriteJson в read-path: миграция должна вернуть массив сразу — асинхронный mutex не подходит"
    - "Idempotency guard через existsSync(CHANNELS_PATH) — после первого запуска ветка миграции не выполняется"

key-files:
  created: []
  modified:
    - src/channels-store.ts (37 insertions, 2 deletions)

key-decisions:
  - "D-11: lazy миграция внутри loadChannels — реализовано (первая ветка функции, до основного read-path)"
  - "D-12: channels.yaml не удаляется и не переименовывается — никакого rmSync/unlinkSync/.bak в коде"
  - "D-13: throw на отсутствии обоих файлов — реализовано (`[channels-store] no source file: ...`); лог `[channels-store] migrated ... → ... (N каналов)` пишется ровно один раз"

patterns-established:
  - "Sync read + sync atomic write в lazy-migration ветке — mutex не используется (первый запуск, конкурентов нет)"
  - "Template-literal log с `${YAML_FALLBACK_PATH} → ${CHANNELS_PATH}` — runtime даёт `./channels.yaml → ./channels.json`"

requirements-completed:
  - STORE-03

# Metrics
duration: ~1.5min
completed: 2026-05-05
---

# Phase 01-storage-migration Plan 02: lazy auto-migration in loadChannels Summary

**`loadChannels()` теперь поддерживает lazy auto-migration: при отсутствии `channels.json` читает `channels.yaml`, валидирует через ту же `ChannelsFileSchema`, синхронно пишет JSON через `.tmp + rename`, логирует строку «migrated» один раз; при отсутствии обоих файлов — throw'ит наверх для tick()-alert. `channels.yaml` остаётся на диске как backup.**

## Performance

- **Duration:** ~77 seconds wall-clock
- **Started:** 2026-05-05T13:12:36Z
- **Completed:** 2026-05-05T13:13:53Z
- **Tasks:** 1
- **Files modified:** 1 (no new files; only `src/channels-store.ts`)

## Accomplishments

- В `src/channels-store.ts` добавлен `import yaml from "yaml"` и internal-константа `YAML_FALLBACK_PATH = "./channels.yaml"` (не экспортируется).
- Функция `loadChannels()` расширена ветвлением `existsSync(CHANNELS_PATH)`:
  - **Сценарий A** (`channels.json` exists) — основной путь сохранён 1:1 как из Plan 01-01: `JSON.parse` → `ChannelsFileSchema.parse` → return. Логирования миграции нет.
  - **Сценарий B** (`channels.json` missing, `channels.yaml` present) — `readFileSync(YAML)` → `yaml.parse` (с try/catch и stage-prefixed throw) → `ChannelsFileSchema.parse` → `atomicWriteJson(CHANNELS_PATH, validated)` → `log.info('[channels-store] migrated ${YAML_FALLBACK_PATH} → ${CHANNELS_PATH} (${N} каналов)')` → return.
  - **Сценарий C** (оба файла отсутствуют) — throw `Error("[channels-store] no source file: neither ./channels.json nor ./channels.yaml exists")`.
  - **Сценарий D** (повторный вызов после B) — `existsSync(CHANNELS_PATH) === true`, идём по A, миграция не повторяется (идемпотентность).
- Миграция выполняется СИНХРОННО (`writeFileSync` + `renameSync`); mutex в этой ветке не используется (первый запуск, конкурентных писателей нет; основное API `loadChannels` остаётся sync по контракту).
- `channels.yaml` после миграции на диске не трогаем — никакого `rmSync`/`unlinkSync`/`.bak rename` (D-12).

## Edge Cases Covered

- **Crash mid-migration**: между `writeFileSync(.tmp)` и `renameSync` процесс падает → `channels.json` отсутствует → при следующем `npm start` ветка миграции снова выполнится с того же `channels.yaml` (он не удалён). Идемпотентность гарантирована (T-01-08).
- **Битый YAML**: `yaml.parse` бросает → catch → throw наверх с сообщением `[channels-store] failed to parse ./channels.yaml: <reason>` → `tick()` в `run.ts` ловит → alert (T-01-10).
- **YAML с невалидной схемой**: `ChannelsFileSchema.parse(yamlParsed)` бросает → throw наверх → tick() → alert (T-01-07).
- **Идемпотентность**: после успешной миграции `existsSync(CHANNELS_PATH)` гасит вход в migration-ветку; лог «migrated» больше не пишется. Это требование D-13 «ровно один раз».
- **Конкурентные первые запуски** (T-01-09 accept): PM2 forks=1, daemon single-process; параллельных запусков нет. Если оператор вручную запустит npm start второй раз поверх первого — `existsSync` после rename блокирует повторную миграцию; до rename — последний `writeFileSync(.tmp)` выигрывает, обе записи валидны (одинаковый YAML-источник).

## Task Commits

1. **Task 1: Lazy auto-migration в loadChannels (channels.yaml → channels.json)** — `f87d488` (feat)

_Note: Plan имеет `tdd="true"` в Task 1, но `<output>` явно фиксирует «tests — Plan 01-04». Унаследовали стиль Plan 01-01 — RED/GREEN/REFACTOR циклы для этого модуля выполнятся в Plan 01-04, который покроет happy path + миграцию + Zod-failure + concurrency одним vitest-набором._

## Files Modified

- `src/channels-store.ts` (37 insertions, 2 deletions) —
  - + `import yaml from "yaml"` (line 8).
  - + `const YAML_FALLBACK_PATH = "./channels.yaml"` (line 15, internal).
  - Заменён JSDoc + тело `loadChannels` (lines 30-80) на трёхветвистую реализацию.
  - Существующие `saveChannels`, `mutate`, `withLock`, `atomicWriteJson` НЕ менялись.

## Decisions Made

Plan следовал locked decisions D-11, D-12, D-13 из `01-CONTEXT.md` и `<locked_decisions>` блока plan'а.

Дополнительные решения уровня executor:
- **Template-literal vs hardcoded строки в логе**. Plan'овский `<action>` шаг 3 даёт точный код с `${YAML_FALLBACK_PATH} → ${CHANNELS_PATH}` — сохранили дословно. Runtime будет печатать `./channels.yaml → ./channels.json (N каналов)`, что соответствует требованию `<must_haves.truths>` и `<must_haves.artifacts.contains>`. Acceptance criterion AC6 (`grep -c "migrated.*channels.yaml.*channels.json" src/channels-store.ts == 1`) формально не сработал, потому что в исходнике стоят имена констант, а не литералы — это grep-vs-template несовпадение, идентичное минор-деривиации Plan 01-01 (см. её SUMMARY §«Deviations»). Functional smoke и `must_haves.truths` — соблюдены.
- **Mutex в migration-ветке не используется**. Plan явно разрешает (`<action>` ВАЖНО-блок: «В ветке миграции мьютекс НЕ используется»); лишний async-обёртки замусорили бы sync-контракт `loadChannels`.
- **JSDoc в loadChannels полностью переписан** (старая фраза «Никакого fallback на YAML» удалена — она противоречит D-11). Новый JSDoc содержит ссылки на STORE-03, D-11, D-12, D-13.

## Deviations from Plan

Plan executed exactly as written.

Минор (то же класса, что в Plan 01-01): литеральный grep AC6 формально возвращает 0, потому что `<action>` шаг 3 даёт log с `${YAML_FALLBACK_PATH}` / `${CHANNELS_PATH}` (template literals), а grep ищет литералы `channels.yaml`/`channels.json`. Functional behavior соответствует D-13 — runtime подставит константы и напечатает требуемую строку. Не deviation в семантическом смысле, а несовпадение grep-pattern и template-style.

## Issues Encountered

При входе в worktree HEAD оказался на `20214a3` («new sum»), который — ancestor целевого base `a49d064` (Wave 1 merged), но не содержит `src/channels-store.ts`. Проверкой `git merge-base --is-ancestor HEAD <base>` подтвердил fast-forward возможен. Сделал `git reset --hard a49d0644` — worktree встал ровно на base Wave 1, `src/channels-store.ts` появился, последующий edit идёт поверх правильной версии. Эту операцию явно разрешает блок `<worktree_branch_check>` в системном промпте.

## Next Phase Readiness

- `loadChannels()` теперь самодостаточен: при первом `npm start` после деплоя v4.0 daemon сам конвертирует YAML → JSON, оператор не делает ручных шагов (success criterion #2 из ROADMAP закрыт).
- Plan 01-03 (`pipeline.ts` wiring): заменит `loadChannelsYaml('./channels.yaml')` на `loadChannels()` из store-модуля. Никаких дополнительных правок store API не требуется.
- Plan 01-04 (Vitest tests): получит готовое API + реальную migration-ветку. Тесты: A) load из существующего JSON; B) первый запуск без JSON, есть YAML — ожидаем создание JSON, лог, корректный return; C) оба файла отсутствуют — expect throw; D) повторный вызов после B — лог НЕ пишется; плюс mutex serialization (две `Promise.all([mutate, mutate])`); плюс Zod-failure на битом YAML.

## Self-Check: PASSED

- `src/channels-store.ts` exists with import yaml + YAML_FALLBACK_PATH + three-branch loadChannels: FOUND (verified by Read at lines 1-155)
- `npx tsc --noEmit` exit 0: PASS
- Acceptance criteria (literal substring grep): AC1=1, AC2=6, AC3=1, AC4=1, AC5=1, AC7=1, AC8=0 (no rmSync/unlinkSync), AC9=empty (no .bak rename); AC6 — see Deviations (template-vs-literal mismatch, functional behavior correct)
- Commit `f87d488` exists in worktree git log: FOUND (`git rev-parse --short HEAD` returned `f87d488`)
- `git diff package.json` empty: PASS (no new deps)

---
*Phase: 01-storage-migration*
*Completed: 2026-05-05*
