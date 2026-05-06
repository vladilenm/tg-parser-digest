---
phase: 02-bot-commands
plan: 04
subsystem: bot
tags: [vitest, tests, bot-handlers, readme, BOT-01, BOT-02, BOT-03, BOT-04]

# Dependency graph
requires:
  - phase: 02-bot-commands
    plan: 01
    provides: "src/bot.ts с экспортами parseAllowlist, normalizeUsername, listChannels, addChannel, removeChannel, handleCommand, startBot/stopBot/isBotPolling"
  - phase: 02-bot-commands
    plan: 02
    provides: "src/bot.ts с экспортами parseRemoveCallbackData, handleCallbackQuery + callback_query в pollOnce"
  - phase: 01-storage-migration
    provides: "channels-store.ts mock'ается через vi.mock — реальная атомарность вне scope unit-тестов"
provides:
  - "src/__tests__/bot-handlers.test.ts (586 LOC, 13 describe-блоков, 45 тестов)"
  - "README.md секция «Команды бота» (3 команды + BOT_ALLOWED_USER_IDS + @userinfobot инструкция + Out of Scope)"
  - "Inline-документация поведения /remove_channel inline-keyboard (D-11/D-12/D-13/D-14)"
  - "Доказательство BOT-01..04 через автотесты (BOT-05 covered Plan 3 + smoke)"
affects: [03-web-scraping (никак), HUMAN-UAT (smoke-чеклист бот-команд)]

# Tech tracking
tech-stack:
  added: []  # vitest 4.1.5 уже в devDependencies (quick-260504-f5z)
  patterns:
    - "vi.mock('../channels-store.js') — единая точка перехвата, перехватывает все import'ы из bot.ts"
    - "vi.stubGlobal('fetch', vi.fn()) — глобальный fetch mock; tgFetch внутри bot.ts получает ok: true"
    - "Единый helper withCurrentChannels(channels) (W-6) — подменяет current внутри mutate(fn) для CRUD-обёрток и handler'ов"
    - "fetchCallsTo(method) helper — фильтрует mock.calls по URL и парсит JSON-body, упрощает assertions на sendMessage/editMessageText/etc"
    - "console.log spy + helper consoleLogContains(needle) — проверка `[bot] denied:` формата лога без зависимости от структуры аргументов logger'а"

key-files:
  created:
    - "src/__tests__/bot-handlers.test.ts (586 LOC) — 13 describe-блоков, 45 тестов покрывающих 8 публичных функций bot.ts"
  modified:
    - "README.md (+42/-1 LOC) — новая секция «Команды бота» + одна строка предупреждения в §«Запуск на VPS (PM2)»"

key-decisions:
  - "Vitest mock через vi.mock('../channels-store.js') без spyOn: ESM hoisting + чистый замены всех вызовов; не нужен реальный tmpdir для CRUD-обёрток (атомарность доказана Plan 1 channels-store.test.ts)"
  - "Helper consoleLogContains вместо inline mock.calls.some(...): обходит TS strict проблему с MockInstance generic'ами для console.log в vitest 4 (Methods<Required<Console>> ограничение плохо матчит lib.dom Console)"
  - "В тесте `confirm на присутствующий канал` дополнительно проверяем editMessageReplyMarkup (D-13: пустая клавиатура) — не повторял в каждом тесте, чтобы не разводить дубли; cancel-test тоже проверяет editMessageReplyMarkup для гарантии что D-13 invariant держится"
  - "Один доп. тест на /channels с suffix @botname — это не в acceptance criteria, но явно покрывает feature parsing'а из handleCommand line 225, иначе она бы оставалась untested"

requirements-completed: [BOT-01, BOT-02, BOT-03, BOT-04]

# Metrics
duration: ~5min
completed: 2026-05-06
---

# Phase 02 Plan 04: Vitest tests + README «Команды бота» Summary

**45 Vitest-тестов в 13 describe-блоках (586 LOC) покрывают все 8 публичных функций src/bot.ts: parseAllowlist (вкл. большие positive numeric id W-2), normalizeUsername, parseRemoveCallbackData, addChannel/removeChannel CRUD-обёртки (через mock'нутый mutate), listChannels, handleCommand allowlist+/channels+/add_channel+/remove_channel (B-5: раздельные describe), handleCallbackQuery allowlist+confirm+cancel+неизвестный формат (D-13/D-14 idempotent); README расширен секцией «Команды бота» с настройкой BOT_ALLOWED_USER_IDS через @userinfobot, таблицей 3 команд и поведением при pm2 restart; 0 новых dev-зависимостей.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 2
- **Files created:** 1 (src/__tests__/bot-handlers.test.ts)
- **Files modified:** 1 (README.md)
- **Tests added:** 45 (file passes 45/45; total project npm test = 363 passed)

## Accomplishments

- **`src/__tests__/bot-handlers.test.ts` (586 LOC, 13 describe, 45 тестов)** покрывает:
  - **`parseAllowlist`** (BOT-04): undefined/empty Set, comma-separated, trim, нечисловые/0/отрицательные отсеяны, Set дедуп, **большой 10-значный positive id 7382916482 (W-2)**.
  - **`normalizeUsername`**: strip `@`, trim, regex 5-32 символа начинается с буквы, граничные случаи (4/5/32/33 символа), дефис не разрешён.
  - **`parseRemoveCallbackData`** (BOT-03 D-11): валидные `rm:durov:confirm|cancel`, невалидные (неверный action / неверный prefix / неполный формат / пустой username / пустая строка).
  - **`addChannel`/`removeChannel` CRUD-обёртки** (BOT-02/BOT-03): `'added'`/`'exists'`/`'removed'`/`'missing'` через mock'нутый `mutate`, **I-3: `mockedMutate.toHaveBeenCalledTimes(1)` + проверка типа аргумента fn**, idempotent semantics (D-14).
  - **`listChannels`** (BOT-01): пустой массив → «Список каналов пуст», непустой → форматированный список с нумерацией и счётчиком.
  - **`handleCommand` allowlist** (BOT-04 D-07/D-08): не-allowlist → silent ignore + лог `[bot] denied:` (через `consoleLogContains` helper); не-команда (text без `/`) тоже silent.
  - **`handleCommand /channels`** (BOT-01): allowlist → sendMessage с текстом списка (D-09 reply_to_message_id, chat_id); suffix `@botname` парсится корректно.
  - **`handleCommand /add_channel`** (BOT-02): валидный → mutate + «Добавлен», уже существующий → mutate + «уже в списке», без аргумента → usage, невалидный username → «Невалидный username».
  - **`handleCommand /remove_channel`** (BOT-03): валидный → sendMessage с inline_keyboard содержащим `rm:durov:confirm` И `rm:durov:cancel`; без аргумента → usage.
  - **`handleCallbackQuery` allowlist** (BOT-04 D-07/D-12): не-allowlist → НИКАКОГО fetch (даже answerCallbackQuery) + лог `[bot] denied:`.
  - **`handleCallbackQuery confirm`** (BOT-03 D-13/D-14): на отсутствующий канал → «не найден в списке (возможно, уже удалён)» (idempotent), на присутствующий → «Удалён @durov» + editMessageReplyMarkup с пустой клавиатурой.
  - **`handleCallbackQuery cancel`** (BOT-03 D-13): mutate НЕ вызван, «Отмена удаления @durov», editMessageReplyMarkup тоже вызван; неизвестный формат → answerCallbackQuery без действий (graceful no-op).
- **W-6 единый helper `withCurrentChannels(channels)`**: один способ подмены current в `mutate(fn)`, использован 10 раз. Никаких альтернативных подходов (acceptance: ≥3 использования).
- **I-2 spy на console.log + helper `consoleLogContains(needle)`**: проверяет формат лога `[bot] denied:` без зависимости от внутренней структуры аргументов logger'а (logger.info → console.log с timestamp+level в первом аргументе, message во втором).
- **README.md секция «Команды бота»** (между §«Запуск на VPS (PM2)» и §«Деплой через Docker / Timeweb Cloud Apps»): настройка allowlist через @userinfobot, таблица 3 команд с описанием идемпотентности, примеры с/без `@`, поведение при pm2 restart (deleteWebhook drop_pending_updates: false), Out of Scope (нет resolve канала, нет управления расписанием, нет webhook).
- **README §«Запуск на VPS (PM2)»**: добавлена одна строка-предупреждение «Перед запуском задайте `BOT_ALLOWED_USER_IDS` в `.env`, иначе bot polling будет выключен (daemon стартует только с cron).» с ссылкой на новую секцию.

## Task Commits

1. **Task 1: src/__tests__/bot-handlers.test.ts (45 tests)** — `ae177a4` (test)
2. **Task 2: README §«Команды бота» + BOT_ALLOWED_USER_IDS warning в PM2** — `f2905f6` (docs)

## Files Created/Modified

- `src/__tests__/bot-handlers.test.ts` (created, 586 LOC) — 13 describe, 45 it, импортирует 8 публичных функций из `../bot.js` + `loadChannels`/`mutate`/`type ChannelEntry` из `../channels-store.js`. vi.mock перехватывает channels-store, vi.stubGlobal перехватывает fetch.
- `README.md` (modified, +42/-1 LOC) — новая секция «Команды бота» с 4 подсекциями (Настройка allowlist / Список команд / Поведение при перезапуске / Out of Scope) + одна строка предупреждения в существующей §«Запуск на VPS (PM2)».

## Decisions Made

- **vi.mock channels-store вместо реального tmpdir:** Plan 1 channels-store.test.ts уже доказал реальную атомарность mutate (Promise.all 10 concurrent), поэтому в bot-handlers тестах достаточно mock'а — фокус на бот-логике, не на storage. Mock использует ESM-совместимый паттерн `vi.mock('../channels-store.js', () => ({ ... }))` без `__esModule` хака.
- **Helper `consoleLogContains` вместо inline expect:** Vitest 4's `vi.spyOn<Console, 'log'>` ругается на TS error TS2344 — `Methods<Required<Console>>` ограничение. Простое решение через `let consoleLogSpy: any` + helper-функцию, которая типизирует доступ к `mock.calls as unknown[][]`.
- **Тест `/channels с suffix @botname` добавлен сверх плана:** План явно требует «handleCommand /channels» describe (B-5 acceptance), но не покрывал case suffix'а (`/channels@MyBot` → `/channels`). Этот тест документирует non-trivial парсинг строки 225 src/bot.ts (`firstWord.split("@")[0]`). Не deviation — это extension в рамках одного describe.
- **`/remove_channel` без аргумента включён в describe:** План явно требует только «inline-keyboard test», но usage-test добавлен по симметрии с `/add_channel` describe (тоже 4 теста); поведение симметрично, проверка тривиальна, ценность для regression — высокая.
- **README секция вставлена между PM2 и Docker (а не в конец):** Естественное место для «оператор-должен-знать-перед-первым-запуском» документации, ровно на стыке инструкций по запуску и деплою. Альтернатива «в конец перед Лицензией» была бы менее findable при первом чтении.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] TS error TS2344 на `vi.spyOn<Console, "log">` в типизации consoleLogSpy**
- **Found during:** Task 1 verification (npx tsc --noEmit)
- **Issue:** Vitest 4.1.5 объявляет `spyOn` через `Methods<Required<T>>`, что не находит метод "log" в типе `Console` (lib.dom). Ошибка: `error TS2344: Type '"log"' does not satisfy the constraint '"Console"'`.
- **Fix:** Удалил generic-параметры из `ReturnType<typeof vi.spyOn<...>>`, заменил тип `consoleLogSpy` на `any` с eslint-disable комментарием + добавил helper-функцию `consoleLogContains(needle)` которая безопасно типизирует доступ к `mock.calls as unknown[][]`. Семантика теста идентична (поиск строки в любом аргументе любого вызова).
- **Files modified:** `src/__tests__/bot-handlers.test.ts` (helper-функция + замена 2 inline-блоков на вызов helper'а)
- **Verification:** `npx tsc --noEmit` exits 0; `npm test` passes 45/45.
- **Committed in:** `ae177a4` (Task 1 commit) — все правки вошли до создания commit'а.

**2. [Rule 3 - Blocker] vi.stubGlobal записан в multi-line форме, grep "vi.stubGlobal.*fetch" возвращал 0**
- **Found during:** Task 1 acceptance grep verification
- **Issue:** Изначально написал `vi.stubGlobal(\n  "fetch",\n  vi.fn()...\n)` — multi-line, grep по одной строке не находил pattern. Acceptance criterion: `grep "vi.stubGlobal.*fetch" src/__tests__/bot-handlers.test.ts ≥ 1`.
- **Fix:** Переписал на `const fetchMock = vi.fn().mockResolvedValue({...}); vi.stubGlobal("fetch", fetchMock);` — теперь `"fetch"` лежит на той же строке что и `vi.stubGlobal`. Бонус: добавил inline-комментарий объясняющий назначение.
- **Files modified:** `src/__tests__/bot-handlers.test.ts` (beforeEach hook)
- **Verification:** `grep -c "vi.stubGlobal.*fetch" src/__tests__/bot-handlers.test.ts` → 2 (комментарий + actual call); `npm test` все ещё 45/45.
- **Committed in:** `ae177a4` (Task 1 commit) — все правки вошли до создания commit'а.

---

**Total deviations:** 2 auto-fixed (обе по Rule 3 — blocker'ы verification: TS error и неудовлетворённый grep-acceptance, обе сводятся к локальным правкам без изменения семантики тестов).
**Impact on plan:** Никакого scope creep. План завершён ровно как написан. Оба deviation'а — стандартные TS/grep-ловушки, которые planner не мог предвидеть точно.

## Issues Encountered

- **Worktree base mismatch на старте.** `git merge-base HEAD 7775a41` выдал `20214a3` (более поздний коммит) — worktree был создан с веткой, основанной не на ожидаемой Plan 02-02 base. После `git reset --hard 7775a411e3087a5022c376d9d35b89583e5ff57e` working tree встал на правильное место (Plan 02-02 завершён, src/bot.ts содержит `parseRemoveCallbackData` и `handleCallbackQuery`). Подтверждено через `grep -c "parseRemoveCallbackData|handleCallbackQuery" src/bot.ts` → 4 (≥2).
- **Vitest подхватывает test-файлы из всех `.claude/worktrees/agent-*/` директорий.** Полный `npm test` запускает 18 test-files (363 теста) — это включает старые worktree'ы соседних агентов. Не блокер для plan'а: наш `src/__tests__/bot-handlers.test.ts` корректно подхватывается и проходит 45/45. Out of scope для текущего plan'а — править vitest.config.ts; зафиксировано как наблюдение для будущего deferred-items списка.
- **`tsc --noEmit` прошёл с минимальным fix'ом** (типизация consoleLogSpy через `any` + helper) — других type errors не было.

## Threat Flags

Никаких новых threat-surface не введено вне `<threat_model>` плана:

- **Vi.mock channels-store перехватывает все import'ы** — никаких реальных file I/O в тестах, никакой race condition или corrupted JSON in unit tests. Реальная атомарность доказана отдельно в `channels-store.test.ts` (Phase 1 STORE-02).
- **`vi.stubGlobal('fetch', ...)`** — все вызовы tgFetch внутри bot.ts получают mocked response (200 OK, пустой result), никаких реальных HTTP к Telegram Bot API из тестов.
- **Тесты явно покрывают allowlist invariant'ы** — handleCommand allowlist (отказ → silent ignore + log) и handleCallbackQuery allowlist (отказ → НИКАКОГО fetch, даже answerCallbackQuery) — два раздельных describe (B-5). Регрессия в любой из этих веток будет немедленно поймана CI.
- **README документирует «Не работают через webhook — только long-polling»** — out-of-scope явно зафиксирован для оператора, не оставляет surface для surprise через webhook.
- **README документирует «Не резолвят канал через Telegram»** — оператор предупреждён что несуществующие каналы будут пропущены в pipeline стандартным `UsernameNotOccupiedError` обработчиком, а не упадут в бот-команде.

## Self-Check

Проверка артефактов плана:

- `src/__tests__/bot-handlers.test.ts` (created, 586 LOC) — FOUND
- `README.md` (modified, +42 LOC) — FOUND
- Commit `ae177a4` (Task 1: bot-handlers test suite) — FOUND
- Commit `f2905f6` (Task 2: README «Команды бота») — FOUND

Acceptance criteria — Task 1:
- `wc -l src/__tests__/bot-handlers.test.ts` → 586 — PASSED (≥200)
- `grep -c "describe(" src/__tests__/bot-handlers.test.ts` → 13 — PASSED (≥12)
- `grep "describe.*parseAllowlist"` → 1 — PASSED (≥1)
- `grep "describe.*normalizeUsername"` → 1 — PASSED (≥1)
- `grep "describe.*parseRemoveCallbackData"` → 1 — PASSED (≥1)
- `grep "describe.*addChannel"` → 1 — PASSED (≥1)
- `grep "describe.*removeChannel"` → 1 — PASSED (≥1)
- `grep "describe.*listChannels"` → 1 — PASSED (≥1)
- `grep "describe.*handleCommand.*allowlist|allowlist.*handleCommand"` → 1 — PASSED (≥1)
- `grep "describe.*handleCommand.*add_channel"` → 1 — PASSED (≥1)
- `grep "describe.*handleCommand.*remove_channel"` → 1 — PASSED (≥1)
- `grep "describe.*handleCallbackQuery.*allowlist|allowlist.*handleCallbackQuery"` → 1 — PASSED (≥1)
- `grep "describe.*handleCallbackQuery.*confirm"` → 1 — PASSED (≥1)
- `grep "describe.*handleCallbackQuery.*cancel"` → 1 — PASSED (≥1)
- `grep "describe.*handleCommand.*/channels"` → 1 — PASSED (≥1, B-5)
- `grep "vi.mock.*channels-store"` → 2 — PASSED (≥1)
- `grep "vi.stubGlobal.*fetch"` → 2 — PASSED (≥1, после fix Rule 3 deviation #2)
- `grep -c "function withCurrentChannels"` → 1 — PASSED (≥1, W-6)
- `grep -c "withCurrentChannels("` → 10 — PASSED (≥3, W-6)
- `grep "7382916482"` → 1 — PASSED (≥1, W-2)
- `grep "spyOn(console"` → 1 — PASSED (≥1, I-2)
- `grep "\\[bot\\] denied:"` → 8 — PASSED (≥1, I-2)
- `grep "mockedMutate.*toHaveBeenCalled|mutate.*toHaveBeenCalled"` → 13 — PASSED (≥2, I-3)
- `grep "rm:"` → 17 — PASSED (≥4)
- `grep "уже удалён|уже в списке|не найден"` → 5 — PASSED (≥1, idempotent BOT-02/BOT-03)
- `npm test` exits 0, output contains "bot-handlers" — PASSED (45/45 в файле, 363/363 в проекте)
- `npx tsc --noEmit` exits 0 — PASSED

Acceptance criteria — Task 2:
- `grep "## Команды бота" README.md` → 1 — PASSED (≥1)
- `grep "BOT_ALLOWED_USER_IDS" README.md` → 3 — PASSED (≥1)
- `grep "@userinfobot" README.md` → 2 — PASSED (≥1)
- `grep "/channels" README.md` → 1 — PASSED (≥1)
- `grep "/add_channel" README.md` → 3 — PASSED (≥1)
- `grep "/remove_channel" README.md` → 2 — PASSED (≥1)
- `grep "deleteWebhook" README.md` → 1 — PASSED (≥1)
- `grep "drop_pending_updates" README.md` → 1 — PASSED (≥1)

## Self-Check: PASSED

## Next Plan Readiness

- **Phase 2 завершён по тестам** — BOT-01..04 покрыты автотестами; BOT-05 (run.ts integration) — Plan 03 (если был запланирован) или covered typecheck'ом + smoke-cheklist в HUMAN-UAT.
- **Phase 3 (Web Scraping)** — никак не зависит от bot-handlers тестов; vitest setup готов к расширению на `web-scraping.test.ts`.
- **HUMAN-UAT smoke-чеклист** — оператор может пройти по README §«Команды бота» как готовому скрипту: настроить `BOT_ALLOWED_USER_IDS`, написать `/channels`, `/add_channel @testch`, `/remove_channel @testch` → проверить inline-кнопки → подтверждение / отмена.
- **Future deferred:** `vitest.config.ts` исключение `.claude/worktrees/**` из test glob — наблюдение, что текущий npm test подхватывает старые worktree-test-files. Низкий приоритет, не блокирует текущую работу.

---
*Phase: 02-bot-commands*
*Completed: 2026-05-06*
