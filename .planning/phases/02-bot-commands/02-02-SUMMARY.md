---
phase: 02-bot-commands
plan: 02
subsystem: bot
tags: [telegram, bot, callback_query, inline_keyboard, remove_channel, idempotent]

# Dependency graph
requires:
  - phase: 02-bot-commands
    plan: 01
    provides: "src/bot.ts с polling-loop'ом, handleCommand, removeChannel(), normalizeUsername(), tgFetch(); TgCallbackQuery/TgInlineKeyboardButton/TgReplyMarkup типы уже объявлены"
  - phase: 01-storage-migration
    provides: "channels-store.ts → mutate() + filter — атомарное идемпотентное удаление"
provides:
  - "src/bot.ts: /remove_channel handler с inline-keyboard confirm/cancel"
  - "handleCallbackQuery: allowlist-фильтр + silent ignore (D-07/D-08/D-12)"
  - "parseRemoveCallbackData: парсер callback_data формата `rm:<username>:confirm|cancel`"
  - "sendReplyWithKeyboard helper (inline-keyboard вариант sendReply)"
  - "Idempotent removeChannel flow с editMessageReplyMarkup + editMessageText (D-13/D-14)"
  - "callback_query подключён в pollOnce"
affects: [02-03 (run.ts integration — без изменений API), 02-04 (unit tests парсера и handler'а)]

# Tech tracking
tech-stack:
  added: []  # никаких новых runtime-зависимостей
  patterns:
    - "Inline-keyboard через raw fetch к Bot API (sendMessage с reply_markup) — никакого bot framework"
    - "Self-contained callback_data: username внутри (`rm:<u>:confirm`) — переживает pm2 restart, никакого in-memory state"
    - "Silent ignore non-allowlist callback: НЕ вызываем answerCallbackQuery (D-12) — клиент видит loading 15 мин, потом Telegram очищает"
    - "Каждый editMessage* в свой try/catch с warn-логом (W-3) — 'message is not modified' / 'message not found' не валит handler"
    - "editMessageReplyMarkup ([] keyboard) ДО editMessageText — гарантия что кнопки убраны даже если text update упадёт"

key-files:
  created: []
  modified:
    - "src/bot.ts (+165 LOC, total 540) — sendReplyWithKeyboard, /remove_channel branch, parseRemoveCallbackData, handleCallbackQuery, callback_query в pollOnce"

key-decisions:
  - "Silent ignore без answerCallbackQuery для non-allowlist: симметрично D-07 для message — non-allowlist ничего не получает (ни ответа, ни ack); вечный loading на стороне клиента — приемлемая UX-стоимость, поскольку клиент не должен знать об отказе"
  - "Неизвестный callback format → answerCallbackQuery без actions (graceful no-op): чтобы не завязнуть на клиентском loading при будущих расширениях формата (новые callback_data добавятся в Plan'ы дальше — bypass на нейтральный ack)"
  - "editMessageReplyMarkup идёт ПЕРВЫМ (D-13): даже если editMessageText упадёт, кнопки уже убраны — пользователь не нажмёт повторно ту же кнопку"

requirements-completed: [BOT-03]

# Metrics
duration: ~2min
completed: 2026-05-06
---

# Phase 02 Plan 02: /remove_channel + callback handlers Summary

**Добавлен handler команды `/remove_channel <username>` с inline-keyboard confirm/cancel и обработчик callback_query: allowlist-фильтр (silent ignore для non-allowlist), self-contained callback_data `rm:<u>:confirm|cancel` (переживает рестарты), idempotent удаление через `removeChannel()` (D-14), editMessageReplyMarkup + editMessageText в собственных try/catch (W-3); +165 LOC к существующему src/bot.ts (теперь 540 LOC); 0 новых runtime-зависимостей.**

## Performance

- **Duration:** ~2 min
- **Tasks:** 1
- **Files created:** 0
- **Files modified:** 1 (src/bot.ts)

## Accomplishments

- **`sendReplyWithKeyboard(token, chatId, replyToMessageId, text, keyboard)`** — внутренний хелпер для отправки `sendMessage` с `reply_markup.inline_keyboard`. Plain-text без HTML/Markdown форматирования (D-10), `reply_to_message_id` (D-09), `disable_web_page_preview: true`.
- **Ветка `/remove_channel` в `handleCommand`** — валидирует argument через `normalizeUsername` (regex 5–32 символа, начинается с буквы), формирует две inline-кнопки «Удалить» / «Отмена» с `callback_data` `rm:<username>:confirm` / `rm:<username>:cancel` (D-11). Без аргумента — usage-подсказка; невалидный username — спецификация regex.
- **`parseRemoveCallbackData(data)` (exported)** — split по `:`, проверка длины и префикса `rm`, валидация action ∈ `{confirm, cancel}`. Возвращает `{ username, action }` или `null`. Готов к unit-тестам Plan 4.
- **`handleCallbackQuery(token, cb, allowlist)` (exported)** — полный flow:
  - Non-allowlist (D-07/D-08/D-12): `log.info('[bot] denied: from=N cmd=callback:DATA')` + return БЕЗ `answerCallbackQuery` — silent ignore.
  - Невалидный формат / отсутствует `cb.message`: `answerCallbackQuery` без actions (graceful no-op).
  - confirm: `removeChannel(username)` через `mutate` (idempotent, D-14) → текст «Удалён @x» либо «не найден в списке (возможно, уже удалён)».
  - cancel: текст «Отмена удаления @x», `channels.json` не трогаем.
  - `editMessageReplyMarkup({ inline_keyboard: [] })` ПЕРВЫМ (D-13: убираем кнопки до апдейта текста, чтобы пользователь не нажал повторно).
  - `editMessageText({ text: newText })` ВТОРЫМ. Каждый editMessage* в собственном `try/catch` с `log.warn('[bot] editMessage* failed: ...')` (W-3) — Telegram возвращает 400 на «message is not modified» / удалённый message; этого не должно ронять handler.
- **`pollOnce` подключает callback_query** — `else if (upd.callback_query) await handleCallbackQuery(...)`. `lastOffset` уже шёл вперёд по callback'ам в Plan 1, теперь они реально обрабатываются.

## Task Commits

1. **Task 1: /remove_channel + callback handlers в src/bot.ts** — `b8097ea` (feat)

## Files Created/Modified

- `src/bot.ts` (modified, +165/-2 LOC, total 540 LOC) — добавлены: `sendReplyWithKeyboard`, ветка `/remove_channel` в `handleCommand`, `parseRemoveCallbackData`, `handleCallbackQuery`, ветка `callback_query` в `pollOnce`. Никаких изменений в существующих экспортах из Plan 1.

## Decisions Made

- **Silent ignore без `answerCallbackQuery` для non-allowlist** — симметрично D-07 для message-команд: non-allowlist пользователь не должен получать никакого signal'а, что бот его «увидел». Стоимость: клиент видит «loading» на кнопке до ~15 минут, потом Telegram сам очищает. Альтернатива (тихий ack) была отклонена в плане — ack даст клиенту понять, что бот существует и видит callback. План явно требует `// ВАЖНО: НЕ вызываем answerCallbackQuery` (line 172).
- **Неизвестный callback format → graceful `answerCallbackQuery` без действий** — чтобы клиент не залип на loading'е, когда формат расширится (например, в будущем добавится `add:<u>:confirm`). План разрешает это как «нейтральный ack».
- **`editMessageReplyMarkup` ПЕРВЫМ** (D-13) — гарантия защиты от повторного нажатия даже если update текста упадёт. Если упадёт editMessageReplyMarkup — текст всё равно обновится (но кнопки останутся; в этом случае повторный confirm idempotent через D-14, второе нажатие даст «не найден в списке»).
- **Один task в плане** — план был спроектирован как single-task (все правки в одном файле, ~80–100 LOC прирост). Сделано как один atomic commit, что и предполагалось.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Удалить упоминание `parse_mode` в новом JSDoc-комментарии `sendReplyWithKeyboard`**
- **Found during:** Task 1 verification (post-tsc grep sanity check)
- **Issue:** В новом JSDoc'е `sendReplyWithKeyboard` я написал «Plain-text без parse_mode (D-10)» — это нарушило Phase 2 Plan 1 acceptance criterion `grep "parse_mode" src/bot.ts` returns NO matches (D-10 защита от случайного включения parse_mode). План 02-02 явно не повторял этот criterion, но D-10 — invariant фазы.
- **Fix:** Переформулирован комментарий на «Plain-text без HTML/Markdown форматирования (D-10), reply_to_message_id (D-09)» — семантика идентична, термин `parse_mode` исключён.
- **Files modified:** `src/bot.ts` (одна строка комментария)
- **Verification:** `grep -c "parse_mode" src/bot.ts` → 0
- **Committed in:** `b8097ea` (Task 1 commit) — правка вошла в общий task-commit до его создания.

---

**Total deviations:** 1 auto-fixed (Rule 1 — текстовая правка комментария для сохранения D-10 invariant из Phase 2; не задевает семантику кода или контракт API).
**Impact on plan:** Никакого scope creep. План завершён ровно как написан.

## Issues Encountered

- **Worktree base mismatch на старте.** Worktree был создан с веткой, основанной на коммите `20214a3` (более поздний), но orchestrator указывал ожидаемый базовый коммит `5c9872e`. После `git reset --soft 5c9872e` working tree оказался захламлён удалениями Phase 1/2 (потому что worktree содержал ещё более позднее состояние с переехавшими файлами). Решение: `git checkout HEAD -- .` восстановил working tree из HEAD `5c9872e` — нужные файлы (`src/bot.ts` от Plan 1, `02-02-PLAN.md`) встали на свои места. Два неотслеживаемых артефакта (`channels.yaml`, `prod-channels.yaml`) от старого worktree оставлены без коммита (out of scope для Plan 2-2).
- **`tsc --noEmit` прошёл с первого раза.** Никаких type-mismatch с существующими типами `TgCallbackQuery`/`TgInlineKeyboardButton`/`TgReplyMarkup` (введены в Plan 1 заранее).

## Threat Flags

Никаких новых threat-surface не введено вне `<threat_model>` плана:

- **Allowlist-filter в `handleCallbackQuery` идентичен `handleCommand`** (D-07/D-12): non-allowlist callback не доходит до `removeChannel`, не пишет в `channels.json`, не получает `answerCallbackQuery` — нет signal'а, что бот существует.
- **Idempotent remove через `mutate(filter)` из Phase 1**: concurrent confirm'ы (двойной тык / ребут / два allowlist-юзера одновременно) не могут оставить файл в полупустом состоянии — гарантия атомарности `.tmp + rename` + mutex.
- **`callback_data` self-contained**: никакого in-memory token→username стейта. Stale callback после `pm2 restart` всё ещё валиден; idempotent flow обрабатывает «уже удалённый» канал корректно.
- **`parseRemoveCallbackData` строго валидирует формат**: ровно 3 части, prefix `rm`, action ∈ `{confirm, cancel}`. Невалидное → `null` → graceful answerCallbackQuery; никакого pass-through невалидных данных в `removeChannel`.
- **Plain-text без `parse_mode`** (D-10): все ответы и `editMessageText` идут без HTML/Markdown — нет surface для injection через `username` (хотя regex и так пропускает только `[a-zA-Z0-9_]`).
- **`tgFetch` обрезает body ошибки до 300 символов** (унаследовано из Plan 1) — нет утечки длинных response в логи.

## Self-Check

Проверка артефактов плана:

- `src/bot.ts` (modified, 540 LOC) — FOUND
- Commit `b8097ea` (Task 1) — FOUND
- `grep "/remove_channel" src/bot.ts` → 5 matches — PASSED (≥1)
- `grep "parseRemoveCallbackData" src/bot.ts` → 2 matches — PASSED (≥2)
- `grep "handleCallbackQuery" src/bot.ts` → 2 matches — PASSED (≥2)
- `grep "rm:" src/bot.ts` → 3 matches — PASSED (≥2)
- `grep "answerCallbackQuery" src/bot.ts` → 5 matches — PASSED (≥1)
- `grep "editMessageReplyMarkup" src/bot.ts` → 3 matches — PASSED (≥1)
- `grep "editMessageText" src/bot.ts` → 4 matches — PASSED (≥1)
- `grep "inline_keyboard: \[\]" src/bot.ts` → 1 match — PASSED (≥1, D-13 пустая клавиатура)
- `grep "callback:" src/bot.ts` → 1 match — PASSED (≥1, D-08 log format для callback denied)
- `grep "removeChannel(" src/bot.ts` → 2 matches — PASSED (definition + call)
- `grep "callback_data" src/bot.ts` → 5 matches — PASSED (≥2, две кнопки)
- `grep "editMessageReplyMarkup failed" src/bot.ts` → 1 match — PASSED (warn из catch)
- `grep "editMessageText failed" src/bot.ts` → 1 match — PASSED (warn из catch)
- try/catch вокруг `editMessageReplyMarkup` → 1 — PASSED (≥1, W-3)
- try/catch вокруг `editMessageText` → 1 — PASSED (≥1, W-3)
- `grep "parse_mode" src/bot.ts` → 0 matches — PASSED (D-10 invariant сохранён)
- `npx tsc --noEmit` exits 0 — PASSED

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 02-03 (run.ts integration):** контракты не изменились — `startBot()`, `stopBot()`, `isBotPolling()` те же, callback_query теперь обрабатывается «изнутри» pollOnce. Plan 3 интегрирует startBot в `src/run.ts` без особых правок.
- **Plan 02-04 (unit tests):** к 9 экспортам Plan 1 добавились 2 новых: `parseRemoveCallbackData` (pure function — легко тестируется через таблицу инпутов), `handleCallbackQuery` (мокается через mock'нутый `tgFetch` + `mutate`). UX-сценарии: confirm/cancel, idempotent re-confirm, non-allowlist silent ignore, невалидный формат, editMessage* failure не валит handler.

---
*Phase: 02-bot-commands*
*Completed: 2026-05-06*
