# Phase 1: Storage Migration — Context

**Gathered:** 2026-05-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Перевод хранения списка каналов с `channels.yaml` на `channels.json` через новый
модуль `src/channels-store.ts` с in-process mutex, атомарной записью (`.tmp + rename`)
и lazy auto-migration. Pipeline (cron 20:15 MSK) читает каналы из JSON; будущий бот
из Phase 2 пишет туда же без race condition. Mutex и store-API проектируются под
будущего consumer'а (бот), но сами CRUD-обёртки добавляются в Phase 2.

**Не входит** в Phase 1: реализация бот-команд (Phase 2), Telegram polling, allowlist,
inline-кнопки, web-scraping (Phase 3).

</domain>

<decisions>
## Implementation Decisions

### JSON Schema

- **D-01:** Структура `channels.json` — 1:1 как в YAML: `{ channels: [{ username: string, priority?: number }] }`. Никаких version-обёрток, audit-полей или метаданных. Минимизация изменений, ChannelEntry-тип переиспользуется.
- **D-02:** Валидация при чтении — Zod-схема в `src/channels-store.ts`. `zod` уже runtime-зависимость v3.0 (используется в `src/schema.ts` для DeepSeek). Минимум: `z.object({ channels: z.array(z.object({ username: z.string().min(1), priority: z.number().int().optional() })).min(1) })`.
- **D-03:** При битом JSON или провале Zod-валидации — `throw` наверх. Daemon ловит в `tick()` и шлёт alert через существующий `src/alert.ts` (D-12, D-13 из v3.0). Никакого fallback на YAML — это маскировало бы расхождение «бот пишет JSON, pipeline читает YAML».
- **D-04:** Сериализация — `JSON.stringify(value, null, 2)` (двухпробельный отступ, как в существующих `data/raw/*.json` и `data/hash-cache.json`).

### Mutex Implementation

- **D-05:** Mutex — самописный promise-chain (~10 строк) внутри `channels-store.ts`. **Никакой** новой зависимости (`async-mutex` отклонён ради сохранения lean-deps; сейчас 5 runtime-deps, добавление 6-й не оправдано для тривиального single-process кейса).
- **D-06:** Mutex сериализует **только записи**. `loadChannels()` читает файл напрямую без блокировки — атомарный `rename(2)` на POSIX гарантирует, что reader увидит либо старый, либо новый файл целиком, никогда не половину. Cron-tick никогда не ждёт бота.
- **D-07:** Public-API мьютекса: `mutate<T>(fn: (current: ChannelEntry[]) => Promise<ChannelEntry[]> | ChannelEntry[]): Promise<void>` — прочитать с диска, передать в `fn`, записать результат атомарно. Read-modify-write критическая секция в одной точке. Используется ботом в Phase 2.

### channels-store API Scope (Phase 1)

- **D-08:** Phase 1 экспортирует строго три публичные функции из `src/channels-store.ts`:
  1. `loadChannels(): ChannelEntry[]` — read-only, без mutex'а; используется в `pipeline.ts` вместо текущего `loadChannelsYaml()`.
  2. `saveChannels(channels: ChannelEntry[]): Promise<void>` — атомарная запись через mutex; нужна тестам и потенциально бот-CRUD'у.
  3. `mutate(fn): Promise<void>` — read-modify-write через mutex (см. D-07); основная точка входа для бот-команд в Phase 2.
- **D-09:** CRUD-обёртки (`addChannel`, `removeChannel`, `listChannels` с форматированием для `/channels`) **переносятся в Phase 2** — рядом с кодом бота, который их единственный consumer. YAGNI: тестировать `addChannel(username)` в Phase 1 без реального бот-вызывающего пути — мусор.
- **D-10:** Файл-источник истины: `./channels.json` (рядом с корнем проекта, как `channels.yaml`). Path захардкожен в `channels-store.ts` как константа `CHANNELS_PATH = "./channels.json"`.

### Auto-Migration (STORE-03)

- **D-11:** Триггер — **lazy внутри `loadChannels()`**: если `channels.json` отсутствует — читаем `channels.yaml`, пишем JSON через mutex+atomic, возвращаем массив. Идемпотентно: при следующем вызове JSON уже есть, миграция пропускается.
- **D-12:** Поведение с YAML после миграции — **оставляем на диске как backup**. Никаких rename в `.bak`, никакого удаления. Оператор сам решает, удалять ли позже. Файл становится «информационным», pipeline его больше не читает.
- **D-13:** Логирование миграции — `log.info('migrated channels.yaml → channels.json (N каналов)')` ровно один раз, при первом срабатывании. Если YAML тоже отсутствует — `throw` (нечего мигрировать; daemon упадёт с alert'ом, оператор увидит).

### Claude's Discretion

Запланированные детали, в которых planner/researcher имеет свободу:

- **Структура файла `channels-store.ts`** — порядок функций, named export'ы vs default — не обсуждалось, делать в стиле существующих модулей (`src/dedup.ts`, `src/archive.ts`).
- **Имена internal-функций** — `readChannelsFromDisk`, `writeChannelsToDisk`, `runMigrationIfNeeded` или их аналоги.
- **Vitest unit tests** — в `src/__tests__/channels-store.test.ts`. Tests покрывают: happy-path load, valid migration YAML→JSON, идемпотентность, Zod-failure, mutex serialization (последовательность mutate-вызовов даёт корректный финал).
- **`.gitignore` статус `channels.json`** — не обсуждался; planner решает по аналогии с `channels.yaml` (сейчас в репе) — скорее всего тоже коммитить, иначе Phase 2 boot на CI/PM2-deploy сломается.

### Folded Todos

Никакие из todo'шек проекта не были связаны со Storage Migration (cross-reference вернул 0 совпадений).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §«Phase 1: Storage Migration» — goal, depends-on, success criteria 1–3
- `.planning/REQUIREMENTS.md` §«Storage Migration (STORE)» — STORE-01, STORE-02, STORE-03 (полные формулировки)
- `.planning/PROJECT.md` §«Constraints» — runtime-deps cap (5+0 — никаких новых), §«Key Decisions» — `.tmp+rename` (D-17), §«Out of Scope» — нет БД, нет файловых OS-locks
- `.planning/STATE.md» §«Critical Pitfall (Phase 1)» — race-condition сценарий 20:15 MSK

### Existing code to read/extend
- `src/pipeline.ts` §loadChannelsYaml (lines 14-40) — текущая реализация, заменяется на `loadChannels()` из нового модуля; вызов в `pipeline.ts:52` — точка миграции
- `src/archive.ts` §atomicWriteText (lines 34-39) — эталон `.tmp + rename` для копирования в `channels-store.ts`
- `src/dedup.ts` §commitHashCache (полностью) — второй пример rolling-файла с атомарной записью + чтение/слияние
- `src/schema.ts` — пример Zod-схемы в проекте (для DeepSeek-ответа); стиль валидации применить аналогично
- `src/run.ts` lines 11-18, 56-65 — текущий `isRunning` boolean (про tick-mutex, не про file-mutex; смешивать не надо, но как inspiration для in-process semaphores)
- `src/types.ts:4` — текущий комментарий «без "@", как в channels.yaml» — обновить ссылку на `channels.json` после миграции
- `src/__tests__/` — существующие vitest-тесты (260504-f5z); место для `channels-store.test.ts`

### Test/build infrastructure
- `vitest.config.ts` — конфиг Vitest, без изменений
- `package.json` — подтверждает `zod`, `yaml`, `node:fs`/`node:crypto` в наличии; новых deps нет
- `tsconfig.json` — `strict: true`, `moduleResolution: bundler`, ESM; новый модуль обязан соответствовать

### Source data
- `channels.yaml` (корень репо) — текущий source-of-truth (50 каналов: 12 реальных + 38 PLACEHOLDER); используется как input для одноразовой миграции

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`atomicWriteText(path, content)`** в `src/archive.ts:34-39` — паттерн `.tmp + rename`. Можно вынести в общий helper или скопировать в `channels-store.ts` (микрофункция, дублирование оправдано простотой).
- **`zod`** — уже в runtime-deps с v3.0 (`src/schema.ts`). Schema-валидация сразу пишется в zod-стиле, без typeof-проверок.
- **`ChannelEntry` интерфейс** — определён локально в `src/pipeline.ts:14-17`. Переехать в `src/channels-store.ts` как exported type, удалить из `pipeline.ts`, импортировать обратно.
- **Vitest** — настроен в проекте (260504-f5z), `src/__tests__/` директория существует. Тесты для `channels-store.ts` ложатся туда же без конфигурации.
- **`yaml` пакет** — runtime-dep с v1.0 (`src/pipeline.ts:6`). Переиспользуется в auto-migration (`yaml.parse` для одноразового чтения `channels.yaml`).
- **`src/logger.ts`** — структурированное логирование `log.info/warn/error` уже в проекте; channels-store пишет миграцию через тот же интерфейс.

### Established Patterns
- **`.tmp + rename` atomic write** — в `archive.ts` (raw/output) и `dedup.ts` (hash-cache). Channels-store обязан использовать тот же паттерн (D-04).
- **Zod валидация** — в `src/schema.ts` (DeepSeek), `runtime-validate-then-throw`; channels-store применяет тот же стиль.
- **Module-level helpers, no DI** — каждый `src/*.ts` экспортирует функции, инстанцируется через прямые импорты. Channels-store следует этому.
- **ESM + `.js` суффиксы в импортах** — `import { x } from "./foo.js"` (даже для .ts-файлов из-за `moduleResolution: bundler`). Новый модуль обязан так же.
- **Логи stage-помеченные** — `log.info('[pipeline] ...')` или `log.info('[dedup] ...')`. Channels-store: префикс `[channels-store]` или `[store]`.
- **In-memory state** — `let isRunning` в `run.ts:11`. Promise-chain mutex — module-level `let lockChain: Promise<void>` в том же стиле.

### Integration Points
- **`src/pipeline.ts:52`** — единственная точка вызова `loadChannelsYaml('./channels.yaml')`. Заменяется на `loadChannels()` из `channels-store.ts`. `loadChannelsYaml` функция и тип `ChannelsFile` удаляются из `pipeline.ts`.
- **`src/types.ts:4`** — комментарий ссылается на `channels.yaml`; обновить ссылку (косметически).
- **`src/run.ts`** — НЕ трогаем. Auto-migration срабатывает lazy в первом `loadChannels()` из `tick()→runPipeline()`, отдельный bootstrap-step не нужен.
- **`package.json`** — НЕ меняется. Никаких новых runtime/dev зависимостей.

</code_context>

<specifics>
## Specific Ideas

- Архитектурный приоритет: **mutex-помог-боту-в-Phase-2**. Если `mutate()` API в Phase 1 спроектирован неудобно — Phase 2 будет страдать, и придётся рефакторить store до того, как бот стабилизируется. Planner: спроектировать сигнатуру `mutate()` под realistic Phase 2 use-case (бот делает `mutate(channels => [...channels, { username, priority: nextPriority }])`).
- Test-критерий для mutex (success criteria #3 в ROADMAP): «при одновременном обращении бота и cron» — Vitest должен реально симулировать конкурентный вызов (две `Promise.all([store.mutate(addOne), store.mutate(addTwo)])`) и проверять, что оба канала в финальном файле. Это центральный гарант Phase 1.

</specifics>

<deferred>
## Deferred Ideas

Идеи, которые всплыли в обсуждении и не входят в Phase 1.

- **CRUD-обёртки `addChannel`/`removeChannel`/`listChannels`** — Phase 2 (рядом с бот-handler'ами), не Phase 1.
- **Per-channel audit fields (`addedBy`, `addedAt`)** — рассмотрено и отклонено в Phase 1 (схема 1:1 как YAML). Ре-открыть, если в Phase 2 появится требование «кто добавил канал» — тогда расширение схемы + миграция.
- **Version-wrapper `{ version: 1, channels: [...] }`** — отклонено по YAGNI; рассмотреть в v5+ при появлении breaking-changes схемы.
- **Library `async-mutex`** — отклонено ради сохранения 5-deps-cap. Ре-открыть, если самописный mutex даст ≥1 баг в Phase 2 runtime.
- **Eager migration в `src/run.ts` boot** — отклонено в пользу lazy; ре-открыть, если оператор массово жалуется, что миграция «не сразу видна» (маловероятно — оператор один).
- **`channels.yaml.bak` rename после миграции** — отклонено; ре-открыть, если оператор будет случайно править YAML после миграции и удивляться, что это не работает.
- **`.gitignore` статус `channels.json`** — не обсуждалось, planner решает по аналогии с `channels.yaml`.
- **Web-admin для управления каналами** — Out of Scope в REQUIREMENTS.md (бот покрывает кейс).

### Reviewed Todos (not folded)

Cross-reference вернул 0 совпадений с pending-todos — раздел не нужен.

</deferred>

---

*Phase: 01-storage-migration*
*Context gathered: 2026-05-05*
