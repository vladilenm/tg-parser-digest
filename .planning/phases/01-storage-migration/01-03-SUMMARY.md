---
phase: 01-storage-migration
plan: 03
subsystem: storage
tags: [pipeline, wiring, channels-store, refactor]

# Dependency graph
requires:
  - 01-01-SUMMARY (loadChannels skeleton, ChannelEntry type, CHANNELS_PATH)
  - 01-02-SUMMARY (lazy auto-migration внутри loadChannels)
provides:
  - "src/pipeline.ts: runPipeline() читает каналы через loadChannels() из channels-store; больше не зависит от yaml/readFileSync напрямую"
affects:
  - 01-04-PLAN (Vitest unit tests могут опционально прогнать smoke runPipeline через mock-channels-store)
  - phase-02-bot-commands (бот-команды /add_channel и /remove_channel мутируют channels.json через mutate(); pipeline увидит обновления на следующем тике без рестарта daemon)

# Tech tracking
tech-stack:
  added: []  # никаких новых runtime/dev deps
  patterns:
    - "Wiring через type-only import (`import { loadChannels, type ChannelEntry } from './channels-store.js'`) — единая точка владения типом"
    - "Удаление дублирующихся interface'ов: ChannelEntry/ChannelsFile теперь единый source-of-truth в channels-store.ts"

key-files:
  created: []
  modified:
    - src/pipeline.ts (6 insertions, 33 deletions; net -27 строк)

key-decisions:
  - "Использован type-only import для ChannelEntry (`import { loadChannels, type ChannelEntry }`) — соответствует ESM-конвенции проекта и не тянет лишний runtime"
  - "Тип переменной channels указан явно (`const channels: ChannelEntry[] = loadChannels()`) — улучшает читаемость, явно фиксирует контракт между store-API и pipeline"
  - "Аргумент пути убран из вызова (`loadChannels()` вместо `loadChannels('./channels.yaml')`) — путь захардкожен в CHANNELS_PATH константе store-модуля (D-10)"

patterns-established:
  - "Pipeline → channels-store wiring: pipeline.ts больше не знает про формат хранилища (YAML/JSON) — это знание полностью инкапсулировано в channels-store.ts"
  - "Type-only re-export pattern: ChannelEntry не размножается по модулям, импортируется из единого источника"

requirements-completed:
  - STORE-01

# Metrics
duration: ~1min
completed: 2026-05-05
---

# Phase 01-storage-migration Plan 03: pipeline.ts wiring to channels-store Summary

**`src/pipeline.ts` переведён со старого `loadChannelsYaml('./channels.yaml')` на `loadChannels()` из `src/channels-store.ts`. Удалены: прямой импорт `yaml`, `readFileSync` из `node:fs`, локальные `interface ChannelEntry`/`ChannelsFile`, функция `loadChannelsYaml`. Файл сократился со 162 до 134 строк. Fisher-Yates shuffle, per-channel try/catch, in-memory dedup, archive (writeRaw/writeOutput), summarize, sendToChannel, commitHashCache — нетронуты побайтно.**

## Performance

- **Duration:** ~68 seconds wall-clock
- **Started:** 2026-05-05T13:17:25Z
- **Completed:** 2026-05-05T13:18:33Z
- **Tasks:** 1
- **Files modified:** 1 (no new files)

## Accomplishments

- Удалены два устаревших импорта из шапки `src/pipeline.ts`:
  - `import { readFileSync } from "node:fs"` — использовался только в `loadChannelsYaml`.
  - `import yaml from "yaml"` — после миграции pipeline не работает с YAML напрямую.
- Удалены три устаревших блока кода:
  - `interface ChannelEntry { username: string; priority?: number }` (lines 14-17 старой версии).
  - `interface ChannelsFile { channels: ChannelEntry[] }` (lines 19-21).
  - Функция `loadChannelsYaml(path: string): ChannelEntry[]` (lines 23-40, 18 строк включая `try`/`forEach`/throws).
- Добавлен один новый импорт:
  - `import { loadChannels, type ChannelEntry } from "./channels-store.js"` — type-only для `ChannelEntry`, runtime для `loadChannels`.
- Добавлен комментарий в шапке файла:
  - `// Список каналов читается через src/channels-store.ts (channels.json + auto-migration).`
- Замена единственной строки вызова в `runPipeline`:
  - ДО: `const channels = loadChannelsYaml("./channels.yaml");`
  - ПОСЛЕ: `const channels: ChannelEntry[] = loadChannels();`
- Обновлён JSDoc на `runPipeline()`:
  - Старая фраза «читает channels.yaml» → «читает channels.json через channels-store (auto-migration с YAML на первом запуске)».
- `channels.yaml` больше не упоминается в `src/pipeline.ts` ни в коде, ни в комментариях.

## Что осталось нетронутым (побайтно)

Этот раздел требуется success criterion #3 плана: «Никаких изменений в логике runPipeline».

- **Fisher-Yates shuffle** (lines 33-36 новой версии) — алгоритм перемешивания каналов между прогонами.
- **GramJS клиент lifecycle** — `createClient()` + `client.connect()` + `client.disconnect()` в `finally`.
- **Per-channel try/catch** — `fetchLast24h` оборачивается в локальный `try/catch`, ошибка одного канала не валит прогон.
- **In-memory dedup** через `Set<string>` с ключом `${channelUsername}:${messageId}`.
- **Между-канальная пауза** `sleep(channelDelayMs + randomInt(0, 2500))` — antiban-jitter.
- **ARCH-01** — `writeRaw(allPosts, runId)` сразу после fetch, до dedup и LLM.
- **DEDUP-01..02** — `dedupAgainstCache` + `commitHashCache` (только после успешной доставки).
- **STRUCT-01..03** — вызов `summarize(freshPosts)` и обработка `postsDropped`.
- **RENDER-01..03** — `sendToChannel(html)` в Telegram.
- **ARCH-02** — `writeOutput(html, runId)` после успешной доставки.
- **RunSummary contract** — все 6 счётчиков (`channelsTotal`, `channelsSucceeded`, `channelsSkipped`, `postsCollected`, `postsDeduped`, `postsDropped`, `digestDelivered`) и поле `errors[]` рассчитываются по тем же формулам.

## Task Commits

Each task was committed atomically (with `--no-verify` per parallel-executor protocol):

1. **Task 1: Заменить loadChannelsYaml на loadChannels из channels-store** — `2f3a286` (feat)

## Files Modified

- `src/pipeline.ts` (6 insertions, 33 deletions; net -27 строк, размер 162 → 134)
  - Удалены: 2 импорта (`readFileSync`, `yaml`), 2 интерфейса (`ChannelEntry`, `ChannelsFile`), 1 функция (`loadChannelsYaml`).
  - Добавлены: 1 импорт (`loadChannels` + type-only `ChannelEntry`), 1 комментарий в шапке, 1 строка типа в `const channels: ChannelEntry[] = loadChannels()`.
  - Обновлён JSDoc на `runPipeline()`.

## Decisions Made

Plan следовал явно прописанному `<action>` блоку без отступлений (4 точечные правки). Все решения plan-level — D-08, D-10, D-13 — соблюдены через store-API.

Дополнительные решения уровня executor:
- **Одна пустая строка между imports и JSDoc**, как требует `<action>` шаг 2 («После удаления — между блоком импортов и JSDoc-комментарием `/**\n * Один прогон пайплайна:` остаётся одна пустая строка»). Текущая версия (line 13: пустая, line 14: `/**`) соответствует этому требованию.
- **Type-only импорт `ChannelEntry`** оформлен как `import { loadChannels, type ChannelEntry }` (single-import statement с inline `type`), а не отдельным `import type` — обе формы корректны для TS bundler, но inline даёт меньше вертикальных строк и помещается в существующий стиль шапки.
- **`npx tsc --noEmit` запущен через `2>&1 | tail -20`**, чтобы поймать предупреждения, если бы они были — компилятор завершился без вывода (exit 0), что подтверждает отсутствие type-errors.

## Регрессионные риски

Plan корректно отмечает в `<verification>` что smoke `npm start:once` рекомендован, но не обязателен до Plan 01-04. Анализ рисков:

- **Риск 1** (контракт runPipeline): уровень функции не менялся — `runPipeline(): Promise<RunSummary>` сохранён, поле `channelsTotal` всё ещё читает `channels.length` (lines 124-125 новой версии). Регрессий быть не должно.
- **Риск 2** (формат channels): `loadChannels()` возвращает `ChannelEntry[]` с теми же полями (`username: string; priority?: number`), что и старый `loadChannelsYaml`. Структура совместима, downstream-код (`channels[i]!.username`) работает идентично.
- **Риск 3** (auto-migration на первом запуске): если на VPS нет `channels.json`, но есть `channels.yaml` — Plan 01-02 ветка миграции внутри `loadChannels()` создаст JSON синхронно. Pipeline получит массив, продолжит работу. Один лог-line «migrated» на первом тике после деплоя — ожидаемо.
- **Риск 4** (T-01-13: throw на битом JSON): если `channels.json` повреждён вручную — `loadChannels()` throw'ит, ловится `tick()` в `src/run.ts:26`, alert отправляется через `sendAlert`. Pipeline не глотает ошибку — by design (D-03). Регрессии нет.

**Рекомендация:** smoke `node --env-file=.env --import tsx scripts/run-once.ts` после Plan 01-04 (Vitest unit tests) — финальная проверка перед merge wave-3.

## Deviations from Plan

Plan executed exactly as written.

Минорные наблюдения (не deviations):
- Plan фиксирует «удаление ~25 строк» — фактическое удаление 27 строк (net), небольшое различие в счёте, потому что `<action>` пересчёт на «удаление» не делал чёткой формулы. wc -l даёт 134 (162 − 28 удалено + 0 чистых добавлений + 1 комментарий шапки + 1 type-аннотация = чистый -27, плюс уже учтённый JSDoc rewrite). Acceptance criterion `wc -l < 162` — выполнен с запасом.
- `loadChannels()` в JSDoc упоминается двумя точками в файле: в шапке-комменте «через src/channels-store.ts» и в JSDoc функции «через channels-store». Это не нарушает требование `grep -c "loadChannels()" === 1` (criterion смотрит на parens-form, а не на голое имя): результат 1.

## Issues Encountered

При входе в worktree `git merge-base HEAD c000cc4` вернул `20214a3` — старый commit без Wave 1+2 изменений. Применил `git reset --soft c000cc4754cb9d7f95b6257559326bf4621504e6`, который перенёс рабочее дерево в индекс как удаления, но базу history оставил на нужном `c000cc4`. Затем `git checkout HEAD -- .` восстановил рабочее дерево из индекса HEAD'a (где `src/channels-store.ts` уже есть как результат Wave 1+2). Worktree встал ровно на нужный base. Эти операции явно разрешены блоком `<worktree_branch_check>` в системном промпте.

Также первичный Read для `src/pipeline.ts` вернул контент через init-context (`<files_to_read>`), а после восстановления worktree файл на диске стал актуальной версией с Wave 1+2. Edit'ы прошли корректно — оба `PreToolUse:Edit` reminder'а сработали ложно (файл уже был прочитан в текущей сессии), но runtime принял правки. Финальный Read подтвердил, что обе правки и все четыре изменения применены.

## Next Phase Readiness

- **Phase 1 (storage-migration) close-out:** все три wiring-задачи (Plan 01-01 store skeleton, Plan 01-02 auto-migration, Plan 01-03 pipeline wiring) выполнены. После merge всех wave-веток `npm start` на VPS:
  1. Прочитает `channels.yaml` (если `channels.json` отсутствует), сделает миграцию, залогирует строку `migrated`.
  2. Передаст массив в pipeline, прогон стартует с обычным GramJS-флоу.
  3. На следующих запусках читать будет напрямую из `channels.json` (without migration log).
- **Plan 01-04 (Vitest tests):** все три тестируемых модуля стабилизированы: `channels-store.ts` (skeleton + migration), `pipeline.ts` (новый wiring). Тесты для pipeline опциональны — wiring-правка тривиальна, основной риск регрессии в `loadChannels`/`saveChannels`/`mutate` сценариях, которые Plan 01-04 уже покрывает.
- **Phase 2 (bot commands):** точка входа `mutate(channels => [...channels, { username, priority }])` доступна; pipeline видит обновления на следующем тике без рестарта daemon (PM2-managed `npm start` continues running, `loadChannels()` читает новый JSON каждый прогон).

## Self-Check: PASSED

- `src/pipeline.ts` exists at expected path: FOUND
- `src/pipeline.ts` does NOT contain `loadChannelsYaml`: PASS (grep -c == 0)
- `src/pipeline.ts` does NOT contain `import yaml`: PASS (grep -c == 0)
- `src/pipeline.ts` does NOT contain `readFileSync`: PASS (grep -c == 0)
- `src/pipeline.ts` does NOT contain `interface ChannelEntry`: PASS (grep -c == 0)
- `src/pipeline.ts` does NOT contain `interface ChannelsFile`: PASS (grep -c == 0)
- `src/pipeline.ts` contains `from "./channels-store.js"`: PASS (grep -c == 1)
- `src/pipeline.ts` contains `loadChannels()`: PASS (grep -c == 1)
- `src/pipeline.ts` does NOT contain `channels.yaml`: PASS (grep -c == 0)
- `src/pipeline.ts` contains `channels.json`: PASS (grep -c == 2; one in header comment, one in JSDoc)
- `wc -l src/pipeline.ts` < 162: PASS (134)
- `npx tsc --noEmit` exits 0: PASS (no output)
- `git diff package.json` empty: PASS (no new deps)
- Commit `2f3a286` exists in worktree git log: FOUND

---
*Phase: 01-storage-migration*
*Completed: 2026-05-05*
