---
phase: 02-bot-commands
plan: 01
subsystem: bot
tags: [telegram, bot, polling, getUpdates, deleteWebhook, allowlist, channels-store]

# Dependency graph
requires:
  - phase: 01-storage-migration
    provides: "channels-store.ts с mutate(), loadChannels(), saveChannels() — атомарная запись + in-process mutex"
provides:
  - "src/bot.ts: polling-loop через raw fetch к Bot API"
  - "Allowlist-авторизация через BOT_ALLOWED_USER_IDS (parseAllowlist)"
  - "Команды /channels (BOT-01) и /add_channel <username> (BOT-02)"
  - "CRUD-обёртки listChannels/addChannel/removeChannel поверх mutate() (D-16)"
  - "normalizeUsername helper — regex 5-32 chars, strip @"
  - "startBot/stopBot/isBotPolling lifecycle для интеграции в run.ts (Plan 3)"
  - ".env.example секция BOT_ALLOWED_USER_IDS с инструкцией про @userinfobot"
affects: [02-02 (remove_channel + callback_query), 02-03 (run.ts integration), 02-04 (unit tests)]

# Tech tracking
tech-stack:
  added: []  # никаких новых runtime-зависимостей (cap=4: telegram, openai, node-cron, zod)
  patterns:
    - "Raw fetch к Bot API без bot framework (повторяет паттерн src/alert.ts/deliver.ts)"
    - "Long-polling getUpdates с timeout=30s, exp.backoff 1000/2000/4000ms на сетевых ошибках"
    - "Module-level state без DI: lastOffset, stopRequested, pollingActive"
    - "deleteWebhook(drop_pending_updates=false) перед getUpdates — D-03 защита от 409 Conflict"

key-files:
  created:
    - "src/bot.ts (377 LOC) — polling + handlers + CRUD"
  modified:
    - ".env.example — секция BOT_ALLOWED_USER_IDS"

key-decisions:
  - "TgReplyMarkup и TgCallbackQuery типы объявлены заранее — нужны для Plan 2 (callback handlers)"
  - "callback_query пропускается в pollOnce без обработки — обработчик в Plan 2"
  - "В тексте `/add_channel @valid` ответ `Будет использован в следующем прогоне в 20:15 MSK` — оператор сразу видит, когда канал реально включится"
  - "Регистр username не нормализуется (Telegram case-insensitive, но храним как ввели) — D-13 спецификация"

patterns-established:
  - "Pattern: tgFetch<T>(token, method, body) — единственный путь к Bot API из bot.ts; ошибки → Error с HTTP-статусом"
  - "Pattern: handleCommand → silent ignore + log.info при denied (нет sendMessage / answerCallbackQuery)"
  - "Pattern: CRUD-обёртки возвращают discriminated union ('added'|'exists', 'removed'|'missing') — handler формирует UX-текст"

requirements-completed: [BOT-01, BOT-02, BOT-04, BOT-05]

# Metrics
duration: ~12min
completed: 2026-05-06
---

# Phase 02 Plan 01: Bot core — polling, allowlist, /channels, /add_channel Summary

**Telegram bot polling-loop через raw fetch к Bot API с allowlist-авторизацией; команды /channels (просмотр) и /add_channel @username (валидация regex + идемпотентная запись через mutate); 377 LOC в одном src/bot.ts; никаких новых runtime-зависимостей.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2
- **Files created:** 1 (src/bot.ts)
- **Files modified:** 1 (.env.example)

## Accomplishments

- **src/bot.ts (377 LOC)** — полный polling-loop с graceful start/stop, exp.backoff 1000/2000/4000ms на сетевых ошибках, deleteWebhook на boot (D-03), W-1 offset advance (`update_id + 1`).
- **9 экспортов** для unit-тестов Plan 4: `parseAllowlist`, `normalizeUsername`, `listChannels`, `addChannel`, `removeChannel`, `handleCommand`, `startBot`, `stopBot`, `isBotPolling`.
- **Allowlist-авторизация** через `BOT_ALLOWED_USER_IDS` (comma-separated numeric user.id → Set<number>); не-allowlist → silent ignore + `log.info('[bot] denied: from=%d cmd=%s')` (D-07/D-08).
- **`/channels`** возвращает список из `loadChannels()` с нумерацией и счётчиком (BOT-01).
- **`/add_channel @username`** — regex `^[a-zA-Z][a-zA-Z0-9_]{4,31}$`, strip `@`, идемпотентность через `mutate()` (BOT-02). Подсказка по ошибке регекса включает спецификацию допустимого формата.
- **`.env.example`** обновлён — отдельная секция `BOT_ALLOWED_USER_IDS` после блока delivery (TG_CHANNEL_ID), до DeepSeek; комментарий-инструкция через @userinfobot, пример формата `12345678,87654321`, поведение при отсутствии (D-04).

## Task Commits

Each task was committed atomically:

1. **Task 1: создать src/bot.ts со скелетом + handlers** — `57195f0` (feat)
2. **Task 2: BOT_ALLOWED_USER_IDS в .env.example** — `ceb7340` (feat)

_Note: Plan metadata commit включает только SUMMARY.md (см. final commit ниже)._

## Files Created/Modified

- `src/bot.ts` — Telegram bot polling + commands handler (377 LOC). Содержит:
  - Минимальные типы Bot API (TgUser/TgChat/TgMessage/TgCallbackQuery/TgUpdate/TgGetUpdatesResponse + TgInlineKeyboardButton/TgReplyMarkup для Plan 2).
  - Helpers: `parseAllowlist`, `normalizeUsername`, `tgFetch`, `sendReply`.
  - CRUD-обёртки (D-16): `listChannels`, `addChannel`, `removeChannel`.
  - Router: `handleCommand`.
  - Polling: `pollOnce`, `pollLoop`.
  - Lifecycle: `startBot`, `stopBot`, `isBotPolling`.
- `.env.example` — добавлена секция «Telegram bot commands» с переменной `BOT_ALLOWED_USER_IDS`, комментарием-инструкцией про `@userinfobot`, примером формата.

## Decisions Made

- **TgReplyMarkup и TgCallbackQuery типы введены заранее** — Plan 2 будет использовать их для inline-кнопок confirm/cancel `/remove_channel`. tsc не ругается на «unused interface», конкретные значения создаются позже.
- **callback_query пропускается в pollOnce** — комментарий `// callback_query — Plan 2`. lastOffset двигается по всем updates, чтобы не получить тот же callback повторно после Plan 2 деплоя (offset уйдёт вперёд естественно).
- **Текст подтверждения /add_channel включает «20:15 MSK»** — соответствует расписанию `cron.schedule("15 20 * * *", ...)` в src/run.ts. Оператор сразу понимает, когда добавленный канал реально попадёт в pipeline (нет on-the-fly применения).
- **Регистр username не нормализуется** — Telegram username case-insensitive по семантике, но храним как ввели (D-13). Лимит regex покрывает только формат, не case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Удалить упоминание `parse_mode` в комментарии sendReply**
- **Found during:** Task 1 verification
- **Issue:** Комментарий «БЕЗ parse_mode (plain-text)» в JSDoc'е sendReply содержал слово `parse_mode` — Acceptance criterion явно требует `grep "parse_mode" src/bot.ts` returns NO matches (D-10 защита от случайных HTML-инъекций).
- **Fix:** Переформулирован комментарий на «plain-text без HTML/Markdown форматирования».
- **Files modified:** `src/bot.ts`
- **Verification:** `grep -c "parse_mode" src/bot.ts` → 0
- **Committed in:** `57195f0` (Task 1 commit)

**2. [Rule 1 - Bug] Уточнение комментария секции BOT_TOKEN_ALERTS, чтобы не дублировать `TG_BOT_TOKEN`**
- **Found during:** Task 2 verification
- **Issue:** Pre-existing комментарий на строке 60 `.env.example`: «# @BotFather → /newbot → Bot Token (отдельный от TG_BOT_TOKEN)» приводил к `grep -c "TG_BOT_TOKEN" .env.example` = 2 при acceptance criterion «exactly 1». План был написан в предположении, что `TG_BOT_TOKEN` встречается ровно один раз (только как объявление переменной).
- **Fix:** Заменено «отдельный от TG_BOT_TOKEN» на «отдельный от delivery-бота выше» — семантика идентична, чтения комментария оператором не страдает.
- **Files modified:** `.env.example` (строка 60, не относящаяся к новой секции)
- **Verification:** `grep -c "TG_BOT_TOKEN" .env.example` → 1
- **Committed in:** `ceb7340` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (обе по Rule 1 — несоответствие фактического состояния файла плановым acceptance criteria; обе сводятся к минимальной правке комментариев без изменения семантики кода/конфига).
**Impact on plan:** Никакого scope creep. Обе правки — текстовые правки комментариев, чтобы acceptance grep'и проходили. Архитектурные решения и контракт API не изменены.

## Issues Encountered

Существенных проблем нет.

- `tsc --noEmit` прошёл с первого раза.
- `git reset --soft 4a90815...` потребовался в начале — worktree был основан на более ранней базе, чем требовала orchestrator-инструкция; после reset working tree оказался чистым (мои изменения = 0).

## Threat Flags

Никаких новых threat-surface не введено вне `<threat_model>` плана:
- Allowlist filter в `handleCommand` блокирует любые non-allowlist команды до записи в `channels.json` (Phase 2 requirement BOT-04).
- Все записи идут через `mutate()` из Phase 1 (атомарный rename + mutex) — race condition на 20:15 MSK тике закрыт.
- `parse_mode` отсутствует в sendReply (D-10 plain-text) — нет surface для HTML-инъекции через username.
- `tgFetch` обрезает тело ошибочного ответа до 300 символов перед throw — нет утечки в логи длинных responses.

## Self-Check

Проверка артефактов плана:
- `src/bot.ts` — FOUND (377 LOC)
- `.env.example` (modified) — FOUND
- Commit `57195f0` (Task 1) — FOUND
- Commit `ceb7340` (Task 2) — FOUND

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 02-02 (`/remove_channel` + callback handlers):** контракт `removeChannel(username)` готов и идемпотентен; `TgCallbackQuery`/`TgReplyMarkup` типы объявлены; pollOnce уже комментарий «callback_query — Plan 2» — точка для добавления `handleCallback()`. `allowed_updates` в getUpdates уже включает `"callback_query"`.
- **Plan 02-03 (run.ts integration):** `startBot()`, `stopBot()`, `isBotPolling()` готовы. Контракт: startBot НЕ throw'ает наверх — Plan 3 вызывает fire-and-forget с outer try/catch только для финального alert.
- **Plan 02-04 (unit tests):** 9 публичных функций экспортированы, parseAllowlist/normalizeUsername — pure functions без env (легко мокаются), `mutate()` мокается стандартно.

---
*Phase: 02-bot-commands*
*Completed: 2026-05-06*
