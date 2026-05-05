---
phase: 01-storage-migration
plan: 01
subsystem: storage
tags: [zod, fs, mutex, atomic-write, json, channels-store]

# Dependency graph
requires: []
provides:
  - "src/channels-store.ts: store API (loadChannels/saveChannels/mutate) с Zod-валидацией, атомарной записью .tmp+rename и self-rolled promise-chain mutex"
  - "exported type ChannelEntry (переехал из pipeline.ts; pipeline ещё держит локальную копию до Plan 01-03)"
  - "exported const CHANNELS_PATH = './channels.json'"
affects:
  - 01-02-PLAN (auto-migration channels.yaml → channels.json внутри loadChannels)
  - 01-03-PLAN (wiring в pipeline.ts: loadChannelsYaml → loadChannels)
  - 01-04-PLAN (Vitest unit tests для store API + concurrency)
  - phase-02-bot-commands (mutate(fn) — точка входа для /add_channel и /remove_channel)

# Tech tracking
tech-stack:
  added: []  # никаких новых runtime/dev deps; zod уже был
  patterns:
    - "atomicWriteJson: writeFileSync(.tmp) + renameSync — копия паттерна из src/archive.ts:34-39, адаптированная под JSON"
    - "promise-chain mutex: module-level let lockChain + withLock(op) — самописный, ~10 LOC, без async-mutex"
    - "Zod-валидация на чтении и на каждой записи (saveChannels, mutate) — три точки .parse"
    - "ESM .js suffix в относительных импортах (moduleResolution: bundler)"

key-files:
  created:
    - src/channels-store.ts
  modified:
    - src/types.ts (комментарий в Post.channelUsername)

key-decisions:
  - "D-01: схема channels.json 1:1 как YAML — { channels: [{ username, priority? }] }, без version-обёрток"
  - "D-02: Zod ChannelsFileSchema = z.object({ channels: z.array(...).min(1) })"
  - "D-03: на битом JSON или провале Zod — throw наверх; никакого fallback на YAML"
  - "D-04: JSON.stringify(value, null, 2) — двухпробельный отступ"
  - "D-05: mutex самописный promise-chain, без async-mutex (сохраняем 5-deps cap)"
  - "D-06: mutex сериализует только записи; loadChannels читает без блокировки"
  - "D-07: mutate<T>(fn: (current: ChannelEntry[]) => Promise<ChannelEntry[]> | ChannelEntry[]): Promise<void>"
  - "D-08: ровно три public функции — loadChannels / saveChannels / mutate"
  - "D-10: const CHANNELS_PATH = './channels.json'"

patterns-established:
  - "Atomic JSON write helper, локальный для модуля (дублирование с archive.ts/dedup.ts оправдано простотой 5 строк)"
  - "Promise-chain mutex с rollback хвоста через .then(undefined-handler) — переиспользуется потенциально в любом file-store"
  - "Forward-looking imports (existsSync, log) подготовлены для Plan 01-02 без preemptive коммента"

requirements-completed:
  - STORE-01
  - STORE-02

# Metrics
duration: ~4min
completed: 2026-05-05
---

# Phase 01-storage-migration Plan 01: channels-store.ts core Summary

**Foundation-модуль `src/channels-store.ts` с тремя public-функциями (`loadChannels`, `saveChannels`, `mutate`), Zod-валидацией, атомарной записью через `.tmp + rename` и in-process promise-chain mutex'ом — без новых runtime-зависимостей.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-05T13:04:07Z
- **Completed:** 2026-05-05T13:08:42Z
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Создан `src/channels-store.ts` (119 LOC), экспортирует ровно три public-функции (`loadChannels`, `saveChannels`, `mutate`), плюс `CHANNELS_PATH` и тип `ChannelEntry`.
- Реализован самописный promise-chain mutex (module-level `lockChain` + `withLock`) — сериализует параллельные `saveChannels`/`mutate` без новых deps; reader (`loadChannels`) обходит mutex и опирается на POSIX rename(2).
- Атомарная запись через `atomicWriteJson` (паттерн из `src/archive.ts`): сначала `.tmp`, затем `renameSync` — partial-write для reader невозможен.
- Zod `ChannelsFileSchema` валидируется в трёх точках (`loadChannels`, `saveChannels`, `mutate`) — на диск никогда не уходит битая структура; на чтении пустой/битый файл сразу throw'ит наверх (D-03).
- Косметика: `src/types.ts:4` теперь ссылается на `channels.json`.

## Task Commits

Each task was committed atomically:

1. **Task 1: channels-store.ts skeleton (loadChannels, Zod schema)** — `08f3e50` (feat)
2. **Task 2: saveChannels + mutate with promise-chain mutex** — `70236dd` (feat)
3. **Task 3: Update src/types.ts comment to channels.json** — `4197295` (chore)

_Note: Plan имеет `tdd="true"` в Task 1/Task 2, но в `<action>` явно написано «тестирование выносится в Plan 01-04» — следовали явному тексту action. RED/GREEN/REFACTOR циклы выполнятся в Plan 01-04._

## Files Created/Modified

- `src/channels-store.ts` (создан) — store API: `loadChannels`/`saveChannels`/`mutate`, helper `atomicWriteJson`, mutex `withLock`, типы `ChannelEntry`/`ChannelsFile`, константа `CHANNELS_PATH`.
- `src/types.ts` (изменён) — комментарий у `Post.channelUsername` теперь ссылается на `channels.json` вместо `channels.yaml`.

## Decisions Made

Plan следовал locked decisions из `01-CONTEXT.md`. Имплементированы D-01..D-08, D-10 (см. frontmatter `key-decisions`). D-09 (CRUD-обёртки) и D-11..D-13 (auto-migration) намеренно отложены — это Plan 01-02 и Phase 2.

Дополнительные решения уровня executor:
- Импортированы `existsSync` и `log` "впрок" — оба нужны для Plan 01-02 auto-migration; tsc не падает (в проекте нет `noUnusedLocals`).
- Internal helper `atomicWriteJson` дублирован локально из `archive.ts`/`dedup.ts` — не вынесен в общий модуль; 5-строчная утилита, единственный callsite в этом плане. Согласовано с D-04 и текстом плана (`Atomic write helper — паттерн из src/archive.ts:34-39, адаптированный под JSON`).

## Deviations from Plan

Plan executed exactly as written.

Минор: literal grep acceptance criteria для Task 1 (`grep -c "addChannel\|removeChannel" === 0`) и Task 2 (`grep -c "async-mutex\|p-queue\|@isaacs/ttlcache" === 0`) формально возвращают 1, но это совпадения внутри **комментариев**, которые сам plan просит вставить вербатим (`// CRUD-обёртки (addChannel/removeChannel) — Phase 2 (D-09, ...)`, `// D-05: НИКАКОЙ новой зависимости (async-mutex отклонён ...)`). Функциональный смысл критериев соблюдён: ни одной CRUD-функции, ни одного нового импорта. Не deviation, а несовпадение между литерой grep и duck-test.

## Issues Encountered

В начале сессии после `git reset --hard 2513f3b` cwd bash-инструмента ушёл в основной репозиторий вместо worktree-директории, и Task 1 был ошибочно закоммичен в `main` (`80aee38`). Откатил `main` обратно на `2513f3b` через `git reset --hard`, переписал файл в правильный worktree-путь (`/.../worktrees/agent-a1bbb19cd90898b3f/`), переделал коммит. Зафиксированный финальный коммит Task 1 в worktree — `08f3e50`. Все последующие команды используют `git -C <worktree>` или абсолютные пути.

## Next Phase Readiness

- API store-модуля стабилен и проверен `tsc --noEmit`. Plan 01-02 может добавлять auto-migration внутрь `loadChannels` без правки сигнатур.
- Plan 01-03 (wiring в `pipeline.ts`) ещё не начат — `pipeline.ts:14-17` всё ещё содержит локальный `interface ChannelEntry` (по плану — это сделает Plan 01-03, не этот).
- Plan 01-04 (Vitest unit tests) получает готовый API для тестов: happy-path load, mutex serialization (Promise.all двух mutate), Zod-failure, идемпотентность будущей миграции.
- Phase 2 (бот) сможет вызывать `mutate(channels => [...channels, { username, priority }])` без ожидания дополнительной обвязки — точка входа уже есть.

## Self-Check: PASSED

- `src/channels-store.ts` exists at expected path: FOUND
- `src/types.ts` modified: FOUND (line 4 references channels.json)
- Commit `08f3e50` exists in worktree git log: FOUND
- Commit `70236dd` exists in worktree git log: FOUND
- Commit `4197295` exists in worktree git log: FOUND
- `npx tsc --noEmit` exit 0: PASS
- `package.json` unchanged vs base: PASS

---
*Phase: 01-storage-migration*
*Completed: 2026-05-05*
