---
phase: 260519-na3
plan: 01
subsystem: bot-ui
tags:
  - bot
  - ui
  - telegram-bot-api
  - reply-keyboard
  - setMyCommands
requirements:
  - BOT-UI-01
  - BOT-UI-02
  - BOT-UI-03
  - BOT-UI-04
  - BOT-UI-05
dependency_graph:
  requires:
    - src/bot.ts (handleCommand, sendReply/sendPlain/sendMarkdown, pollLoop) — Phase 2/quick-l11/quick-lxu
  provides:
    - MAIN_KEYBOARD (внутренняя константа в src/bot.ts)
    - registerBotCommands(token) (внутренняя функция в src/bot.ts)
    - /start, /help команды (через handleCommand)
    - EMOJI_BUTTON_MAP (внутренний mapping в handleCommand)
  affects:
    - все исходящие bot→user сообщения (теперь несут reply_markup: MAIN_KEYBOARD, кроме inline-confirm /remove_channel и editMessage*)
tech_stack:
  added: []  # 0 новых runtime-deps
  patterns:
    - "Telegram Bot API ReplyKeyboardMarkup (resize_keyboard + is_persistent)"
    - "Telegram Bot API setMyCommands (7 команд для меню /)"
    - "Emoji-button → command normalization (нажатие нижней клавиатуры эмулирует /command)"
key_files:
  created: []
  modified:
    - src/bot.ts
    - src/__tests__/bot-handlers.test.ts
decisions:
  - "MAIN_KEYBOARD прикладывается ВСЕМИ sendReply/sendPlain/sendMarkdown (а не только sendReply): is_persistent: true сохраняет клавиатуру между сообщениями, но любой sendMessage без reply_markup её НЕ переопределяет — поэтому достаточно одного флага на каждое исходящее, и пользователь видит её всегда. Безопаснее, чем добавлять её только в одном helper'е."
  - "sendReplyWithKeyboard (inline confirm/cancel в /remove_channel) НЕ ТРОНУТ — Telegram не пропускает одновременно reply+inline. После закрытия inline-flow нижняя клавиатура вернётся со следующим обычным sendMessage."
  - "Нормализация эмодзи-text → /cmd сделана ДО парсинга команды и ДО allowlist gate. Allowlist gate работает по userId (а не по cmd), поэтому non-allowlist всё равно получит silent ignore."
  - "setMyCommands fire-and-forget: try/catch+warn, polling стартует независимо. Меню некритично для базовой работы."
metrics:
  duration_minutes: 12
  tasks_completed: 3
  files_modified: 2
  tests_added: 9
  tests_total_after: 256
  completed_date: "2026-05-19"
---

# Phase 260519-na3 Plan 01: Bot UI — ReplyKeyboard 2×2 + setMyCommands + /start + /help Summary

**One-liner:** Bot UI affordances — постоянная нижняя 2×2 reply-клавиатура + меню команд Telegram (/) + /start/help handlers + mapping эмодзи-кнопок в существующие команды.

## What Was Built

### Task 1 — MAIN_KEYBOARD + sendReply/sendPlain/sendMarkdown
**Commit:** `9b348ca`

- Добавлены типы `TgKeyboardButton` / `TgReplyKeyboardMarkup` (помимо существующего `TgReplyMarkup` для inline).
- Константа `MAIN_KEYBOARD` (2×2): `📊 Статус загрузок` / `🧠 Сделать сводку` / `📋 Каналы новостей` / `❓ Помощь`; `resize_keyboard: true`, `is_persistent: true`.
- `sendReply`, `sendPlain`, `sendMarkdown` теперь по умолчанию передают `reply_markup: MAIN_KEYBOARD` в каждом `sendMessage`.
- `sendReplyWithKeyboard` (inline confirm/cancel в `/remove_channel`) НЕ затронут — оставлен только inline_keyboard, чтобы не нарушить confirmation flow.
- Регрессионные ассерты: `/channels` проверяет полный layout + флаги; `/remove_channel` inline-confirm проверяет отсутствие поля `keyboard`.

### Task 2 — /start и /help handlers + emoji-button mapping
**Commit:** `0e424b0`

- В начале `handleCommand` добавлен `EMOJI_BUTTON_MAP`: текст кнопки нормализуется в `/cmd` ДО парсинга и allowlist gate. Нажатие «📊 Статус загрузок» эквивалентно `/upload_status`, и т.д.
- Allowlist gate срабатывает по `userId` (а не по `cmd`), поэтому non-allowlist даёт silent ignore + `[bot] denied: cmd=/start` (или нормализованный cmd).
- `/start`: короткое приветствие + MAIN_KEYBOARD (прикладывает дефолтный `sendReply`).
- `/help`: инструкция (пункты 1-4: xlsx upload, /summarize, /upload_status, /channels) + дополнительные команды.
- Suffix `@botname` работает для всех новых команд (общий парсер).
- 9 новых тестов: 3 для /start (greeting+keyboard, @MyBot suffix, non-allowlist silent ignore), 1 для /help (keyword scan), 5 для emoji-mapping (4 кнопки + проверка «обычный текст игнорируется»).

### Task 3 — registerBotCommands (setMyCommands) в startBot
**Commit:** `19dcb57`

- Функция `registerBotCommands(token)` шлёт `setMyCommands` с 7 командами: `start`, `help`, `upload_status`, `summarize`, `channels`, `add_channel`, `remove_channel` — с короткими описаниями.
- Вызов внутри `pollLoop` сразу после `deleteWebhook`, до входа в while-loop. Один раз на старт.
- На ошибку — `log.warn`, polling продолжается (D-06: меню некритично). Try/catch паттерн идентичен `deleteWebhook`.
- Никаких новых тестов: setMyCommands — fire-and-forget tgFetch, сетевая обвязка покрыта моками fetch.

## Где теперь видны клавиатура и меню

В **личной переписке пользователя с ботом** (DM):

- **Нижняя клавиатура 2×2** — отображается под полем ввода после ЛЮБОГО ответа бота (на команду или на эмодзи-кнопку). Сохраняется между сообщениями благодаря `is_persistent: true`.
- **Меню Telegram (иконка `/` слева от поля ввода)** — после `npm start` (когда бот успел сделать setMyCommands при поднятии polling) показывает 7 команд с описаниями.
- **Исключение**: при отправке `/remove_channel @name` появляется inline-сообщение «Удалить @name? [Удалить][Отмена]» — на этом ОДНОМ сообщении нижняя клавиатура может временно «исчезнуть» (Telegram при наличии inline_keyboard не показывает reply_keyboard). После нажатия «Удалить»/«Отмена» (или после следующего ответа бота) клавиатура вернётся.

## Manual Smoke Walk-Through (после рестарта бота)

После `npm start` пользователь из allowlist:

1. **Открывает DM с ботом** → видит иконку меню `/` слева от поля. Жмёт — открывается список 7 команд.
2. **Жмёт /start** → бот отвечает «Привет! Я бот-помощник по битуму…» + появляется нижняя клавиатура 2×2.
3. **Жмёт «📊 Статус загрузок»** → бот отвечает блоком «Папка YYYY-WW: prices: ❌, fca: ❌…» (или какие файлы есть). Клавиатура остаётся.
4. **Жмёт «🧠 Сделать сводку»** → для пустой недели — «За эту неделю файлов не загружено…»; для полной — DeepSeek narrative из quick-260519-lxu. Клавиатура остаётся.
5. **Жмёт «📋 Каналы новостей»** → список каналов («Каналов: N\n1. @…\n…»). Клавиатура остаётся.
6. **Жмёт «❓ Помощь»** → инструкция (xlsx, биржа, FCA, /summarize, /upload_status, /channels). Клавиатура остаётся.
7. **Шлёт `/remove_channel @durov`** → бот шлёт inline-confirm «Удалить @durov? [Удалить][Отмена]»; на ЭТОМ сообщении нижняя клавиатура временно отсутствует. Жмёт «Отмена» → бот редактирует сообщение «Отмена удаления @durov.» — кнопки убраны. Следующее обращение к боту вернёт нижнюю клавиатуру.
8. **Шлёт что угодно, не являющееся командой и не эмодзи-кнопкой** → бот молчит (silent ignore).

Non-allowlist пользователь:

9. **Шлёт /start** или жмёт любую эмодзи-кнопку (в DM с ботом, если каким-то образом смог открыть переписку) → бот молчит, в логе `[bot] denied: from=N cmd=/start` (или нормализованный cmd).

## Test Results

```
npx tsc --noEmit  →  clean (0 errors)
npx vitest run    →  15 files, 256 tests passed
```

Прирост по сравнению с baseline: `+9 тестов` (47 → 56 в bot-handlers.test.ts, общий suite 247 → 256).

## Deviations from Plan

**None — план выполнен ровно как написан.**

Все 3 задачи, mapping, layout кнопок, описания команд для setMyCommands и тексты /start /help совпадают с PLAN.md дословно (где это релевантно). Существующая логика handleCommand/handleCallbackQuery/handleDocument не тронута.

## Threat Flags

Не выявлено: новых сетевых endpoint'ов, файловых путей, auth-flow или trust boundaries не добавлено. `setMyCommands` — read-only публичная запись метаданных бота через тот же `tgFetch` (тот же токен, та же endpoint-обвязка), без изменения уровня доверия.

## Known Stubs

Отсутствуют. Все 4 эмодзи-кнопки маршрутизируются в реальные ветки (`/upload_status`, `/summarize`, `/channels`, `/help`), которые уже имеют рабочую реализацию из предыдущих quick-задач.

## Self-Check: PASSED

- src/bot.ts: MAIN_KEYBOARD, EMOJI_BUTTON_MAP, /start, /help, registerBotCommands присутствуют (verified via tsc + tests).
- src/__tests__/bot-handlers.test.ts: 3 новых describe (handleCommand /start, /help, emoji-button mapping) + регрессии в /channels и /remove_channel (verified via vitest run).
- Все 3 коммита Task 1/2/3 присутствуют в `git log` ветки.
- npx tsc --noEmit без ошибок.
- npx vitest run: 256 зелёных.
