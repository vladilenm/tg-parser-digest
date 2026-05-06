# Phase 2: Bot Commands — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 02-bot-commands
**Areas discussed:** Bot Token strategy, /remove_channel confirmation flow

---

## Bot Token strategy

### Q1: Под каким токеном живёт command-бот?

| Option | Description | Selected |
|--------|-------------|----------|
| Отдельный BOT_TOKEN_COMMANDS (Recommended) | Третий бот в @BotFather; полная изоляция rate-limit и failure | |
| Тот же TG_BOT_TOKEN | Один бот: и доставка дайджеста, и приём команд от allowlist'а | ✓ |
| Переиспользовать BOT_TOKEN_ALERTS | Добавить polling к alert-боту; ломает простоту fire-and-forget sender | |

**User's choice:** Тот же TG_BOT_TOKEN
**Notes:** Намеренное упрощение оператора. Risk-acceptance: rate-limit Bot API делится между delivery
и polling, но при 1 прогоне в сутки и единичных командах от 2 пользователей — это не критично.
Зафиксировано в D-01.

### Q2: Имя env-переменной для command-бота

| Option | Description | Selected |
|--------|-------------|----------|
| BOT_TOKEN_COMMANDS (Recommended) | Согласуется с BOT_TOKEN_ALERTS | |
| TG_BOT_TOKEN_COMMANDS | Согласуется с TG_BOT_TOKEN, но микс с BOT_TOKEN_ALERTS | |
| BOT_TOKEN_BOT / BOT_TOKEN_USER | Семантический ярлык, рискованно двусмысленно | |
| (n/a — переиспользуем TG_BOT_TOKEN) | Не нужно — отдельной переменной нет | ✓ |

**User's choice:** «мы выбрали делать в том же боте» (отказ от отдельной переменной)
**Notes:** Решение следует из Q1. Конфигурационная поверхность не растёт.

### Q3: Поведение при отсутствии токена / allowlist'а при boot

| Option | Description | Selected |
|--------|-------------|----------|
| log.warn + skip bot (Recommended) | Daemon стартует без polling; cron работает; симметрично src/alert.ts | ✓ |
| Fail fast — throw в boot | Daemon не стартует без обязательных env; ломает cron-доставку из-за бот-проблемы | |
| Bot обязателен — throw только на токене | Без токена throw, без allowlist start с warn (пустой allowlist = все отказы) | |

**User's choice:** log.warn + skip bot (Recommended)
**Notes:** Зафиксировано в D-04. Полная симметрия с alert.ts:23-32.

### Q4: Получатель ответа на команду

| Option | Description | Selected |
|--------|-------------|----------|
| Ответ в тот же chat (Recommended) | reply_to_message_id + chat_id из update; работает в личке и группе | ✓ |
| Только личка бота | Игнорируем группы; стандарт private chat | |

**User's choice:** Ответ в тот же chat (Recommended)
**Notes:** Зафиксировано в D-09. plain-text без HTML/Markdown (D-10) — снимает risk injection.

---

## /remove_channel confirmation flow

### Q1: Формат callback_data inline-кнопок confirm/cancel

| Option | Description | Selected |
|--------|-------------|----------|
| rm:<username>:confirm \| rm:<username>:cancel (Recommended) | Username в callback_data; self-contained; переживает PM2-рестарт | ✓ |
| rm:<token> + in-memory token→username Map | Map теряется при рестарте; старые кнопки умирают | |
| rm:<username>:<initiator_user_id>:confirm/cancel | Добавить инициатора в callback; больше байтов, требует «only-initiator» | |

**User's choice:** rm:<username>:confirm | rm:<username>:cancel (Recommended)
**Notes:** Зафиксировано в D-11. Лимит 64 байта callback_data ≫ длина username (≤32).

### Q2: Кто может нажать confirm/cancel

| Option | Description | Selected |
|--------|-------------|----------|
| Любой из allowlist (Recommended) | Оператор и Заказчик — одна команда; не-allowed → silent ignore | ✓ |
| Только инициатор команды | Жёстче, но мешает «второй оператор подтвердит» | |

**User's choice:** Любой из allowlist (Recommended)
**Notes:** Зафиксировано в D-12. Согласуется с «нет ролевой модели» (REQUIREMENTS Out of Scope).

### Q3: Поведение кнопки после нажатия

| Option | Description | Selected |
|--------|-------------|----------|
| editMessageReplyMarkup({}) + текст результата (Recommended) | Кнопки исчезают, текст «удалён @ch1» / «отменено» | ✓ |
| Новое сообщение + оставить кнопку | Повторный тык possible; complications | |
| answerCallbackQuery(toast) без редактирования | Только всплывашка; кнопки висят, история неаккуратная | |

**User's choice:** editMessageReplyMarkup({}) + текст результата (Recommended)
**Notes:** Зафиксировано в D-13.

### Q4: Race на confirm — канал уже удалён

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotent удаление + инфо ответ (Recommended) | mutate(filter), если username не найден — ответ «не найден» | ✓ |
| throw в mutate если нет в списке | Строгий контракт, alert на каждый race | |

**User's choice:** Idempotent удаление + инфо ответ (Recommended)
**Notes:** Зафиксировано в D-14. Phase 1 mutex + atomic rename(2) гарантируют корректный финал
при concurrent confirm'ах (Vitest-тест Phase 1 уже это проверяет).

---

## Claude's Discretion

Без обсуждения с пользователем — planner решает по best-practice:

- Структура `src/bot.ts` (single-file vs split) — по объёму кода
- Long-polling timeout — 25-30s стандарт
- Обработка сетевых ошибок `getUpdates` — exp.backoff (1000/2000/4000ms)
- Validation regex для username — Telegram-стандарт `[a-zA-Z][a-zA-Z0-9_]{4,31}`
- Real-resolve канала через GramJS — НЕ делать (YAGNI)
- Идемпотентность `/add_channel` — «уже в списке» без записи
- Тесты — `src/__tests__/bot-handlers.test.ts` через mock `mutate`
- Чанковка `/channels` — переиспользует паттерн `src/deliver.ts:18-41`

См. CONTEXT.md §«Claude's Discretion» — полный список.

## Deferred Ideas

См. CONTEXT.md §«Deferred Ideas».

Кратко: BOT-07 inline keyboard выбора канала (Future); real-resolve через GramJS (YAGNI);
persistence offset на диск (заменено на `drop_pending_updates: false`); отдельный токен (отклонён);
inline-кнопка timeout (D-13 убирает кнопки сразу); web-админка / RBAC / bot-команды статуса (Out of Scope).
