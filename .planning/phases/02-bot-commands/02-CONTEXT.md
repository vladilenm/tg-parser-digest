# Phase 2: Bot Commands — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Telegram-бот с тремя командами (`/channels`, `/add_channel <username>`, `/remove_channel <username>`)
поверх `channels.json`, использующий `mutate()` API из Phase 1 для всех записей.
Polling-цикл (raw `fetch` к Bot API `getUpdates`) запускается **внутри того же daemon-процесса**,
рядом с `cron.schedule(...)` в `src/run.ts` — без второго PM2-процесса, без webhook'а,
без bot-framework. Allowlist-авторизация через env `BOT_ALLOWED_USER_IDS`.

Команды управляют только списком каналов; никакой другой функционал бота
(статус прогона, ручной запуск, метрики) в Phase 2 не входит.

**Не входит** в Phase 2: web-scraping и `websites.json` (Phase 3); inline-keyboard выбора
канала при удалении (BOT-07, Future); ролевая модель (Out of Scope); webhook mode (Out of Scope);
любая работа с GramJS user-session — это про чтение, а не про команды.

</domain>

<decisions>
## Implementation Decisions

### Bot Token & Identity

- **D-01:** Command-бот использует **тот же `TG_BOT_TOKEN`**, что и доставка дайджеста — НЕ заводим
  отдельный `BOT_TOKEN_COMMANDS`. Один бот в @BotFather: одновременно `sendMessage` в канал
  Заказчика (delivery) и `getUpdates` в личке allowlist-пользователей (commands). Конфигурационная
  поверхность сужена; новый env-key не добавляется.
- **D-02:** Polling и delivery делят один HTTP-клиент Bot API (raw `fetch`). Никакой shared state
  между ними — каждая операция — это standalone POST. Возможный 409 Conflict при `pm2 restart`
  относится к polling-loop'у (см. D-03) и **не задевает** delivery, поскольку `sendMessage`
  вызывается синхронно внутри cron-tick без long-polling сессии.
- **D-03:** На boot polling-loop'а **обязателен `deleteWebhook({ drop_pending_updates: false })`** —
  Bot API не отдаёт `getUpdates`, если включён webhook (419/Conflict). Это idempotent-операция.
  `drop_pending_updates: false` сохраняет очередь команд, накопившуюся за время рестарта (success
  criteria #4: «не теряет очередь команд»).

### Bot Lifecycle & Daemon Integration

- **D-04:** Если `TG_BOT_TOKEN` или `BOT_ALLOWED_USER_IDS` не заданы — daemon стартует **без
  polling-loop'а** (только cron). Лог: `log.warn('[bot] TG_BOT_TOKEN/BOT_ALLOWED_USER_IDS не задан — bot polling выключен')`.
  Это симметрично поведению `src/alert.ts:23-32`: оператор может ещё не настроить, daemon не падает.
- **D-05:** Polling-loop стартует один раз в `src/run.ts` на boot — параллельно с `cron.schedule(...)`,
  до первого тика. Падение polling'а (uncaught exception) **не должно** валить процесс: внешний
  `try/catch` логирует ошибку, шлёт alert через `src/alert.ts` с `stage: "bot"`, после чего
  loop перезапускается с тем же offset (in-memory).
- **D-06:** Graceful shutdown в `shutdown()` (текущий `src/run.ts:56-65`) **дополняется**
  остановкой polling-loop'а: устанавливаем `botStopRequested = true`, ждём текущий
  `getUpdates` (timeout ≤30s), после чего выходим. Cron-task и polling-loop оба должны
  завершиться до `process.exit(0)`.

### Allowlist & Authorization

- **D-07:** `BOT_ALLOWED_USER_IDS` — comma-separated numeric `user.id` (например `12345,67890`),
  парсится один раз при boot в `Set<number>`. Любой update с `from.id` вне множества — silent ignore
  (никакого ответа, никакого `answerCallbackQuery` для callback). Это и для `message`, и для `callback_query`.
- **D-08:** Логирование отказа — `log.info('[bot] denied: from=%d cmd=%s', userId, cmd)` (info, не warn —
  это не ошибка, это ожидаемое поведение). Важно для аудита: оператор видит, кто пытался обращаться.

### Reply Behaviour

- **D-09:** Ответ на команду — `sendMessage({ chat_id: msg.chat.id, reply_to_message_id: msg.message_id, ... })`
  в **тот же chat**, где пришла команда (личка бота или группа, если бот добавлен). UX по умолчанию:
  пользователь видит ответ там же, где написал.
- **D-10:** Формат ответов — plain-text (без HTML/Markdown parse_mode). Команды короткие, форматирование
  не нужно; снимаем риск injection через `username` (хотя он уже валидируется regex'ом — D-13).

### `/remove_channel` Confirmation Flow

- **D-11:** Inline-кнопки confirm/cancel: `callback_data` формата **`rm:<username>:confirm`** и
  **`rm:<username>:cancel`**. Username в callback_data — никаких in-memory token→username карт,
  переживает любой `pm2 restart`, никакого state'а вне Telegram'а. Лимит callback_data 64 байта
  ≫ длина наших username (validation D-13: ≤32 символов).
- **D-12:** **Любой пользователь из allowlist** может нажать confirm/cancel — не обязательно
  инициатор `/remove_channel`. Один оператор и Заказчик, ролевой модели нет (Out of Scope),
  доверие симметричное. Не-allowed `from.id` → silent ignore (D-07).
- **D-13:** После confirm/cancel — **`editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } })`
  + `editMessageText` нового текста**: «Удалён @ch1» / «Отмена удаления @ch1». Кнопки исчезают,
  одно сообщение = один результат. Stale-кнопок не бывает (после ребута callback всё ещё
  валиден — username self-contained).
- **D-14:** **Idempotent удаление**: `mutate(channels => channels.filter(c => c.username !== u))`.
  Если `username` не найден (повторный confirm после первого, или ручная правка `channels.json`)
  — не throw, ответ «@ch1 не найден в списке (возможно, уже удалён)». Phase 1 mutex + atomic
  rename(2) гарантируют, что concurrent confirm'ы не оставят файл в полупустом состоянии.

### Shared from Phase 1 (Confirmed)

- **D-15:** Все записи в `channels.json` идут **только через `mutate(fn)`** из `src/channels-store.ts`.
  Никаких прямых `saveChannels()` из бот-handler'ов — это противоречило бы read-modify-write
  семантике mutex'а. Phase 1 D-07/D-08.
- **D-16:** CRUD-обёртки `addChannel(username)`, `removeChannel(username)`, `listChannels()` живут
  **рядом с handler'ами** — `src/bot.ts` или `src/bot-handlers.ts`, а не в `channels-store.ts`
  (Phase 1 D-09: «YAGNI: тестировать `addChannel(username)` в Phase 1 без реального бот-вызывающего пути — мусор»).

### Claude's Discretion

Planner/researcher решает по best-practice, без обращения к оператору:

- **Структура `src/bot.ts` vs `src/bot/*.ts`** — single-file vs split (poll loop + handlers + auth);
  выбор по объёму кода, единичный `bot.ts` ожидаем (~150-250 LOC).
- **Точное имя env-переменной allowlist'а** — `BOT_ALLOWED_USER_IDS` (по REQUIREMENTS BOT-04, как
  написано в milestone). Если planner найдёт лучшее имя — допустимо переименовать в `.env.example` + REQUIREMENTS.
- **Long-polling timeout** — рекомендуемый 25-30s `getUpdates({ timeout: 30 })`. Без обоснования
  обсуждения — Telegram-стандарт.
- **Обработка `getUpdates` сетевых ошибок** — exp.backoff аналогично GramJS reconnect (Phase 2 v2.0
  pattern: 1000/2000/4000ms), потом continue без падения daemon'а.
- **Validation regex для username** — Telegram-стандарт `[a-zA-Z][a-zA-Z0-9_]{4,31}` (5-32 символов,
  начинается с буквы). Normalize: strip leading `@` если есть. Без обсуждения — стандарт.
- **Real-resolve канала через GramJS при /add_channel** — не обсуждалось пользователем; **не делать**
  по принципу YAGNI: оператор сам ставит подписку, проверять удалённо — overkill для `npm start` под
  PM2 одним пользователем. Лучше пропустить канал в pipeline с уже существующим обработчиком частных
  ошибок (`UsernameNotOccupiedError` и т.п. — `pipeline.ts`).
- **Идемпотентность `/add_channel`** — если канал уже в списке, ответ «@ch1 уже в списке» без записи.
  По умолчанию из принципа Принципе наименьшего удивления.
- **Тесты Vitest** — `src/__tests__/bot-handlers.test.ts`: парсинг команд, allowlist-фильтр,
  CRUD через mock'ом replaced `mutate()`. Polling-loop сам по себе не тестируется в Phase 2
  (требует реальный bot token); covered ручным smoke в HUMAN-UAT.
- **Сообщение `/channels` при пустом списке** — «Список каналов пуст» (хотя по STORE-валидации
  `channels: []` запрещено — но защитный текст не помешает).
- **Чанковка `/channels` при 50+ каналах** — переиспользуется паттерн из `src/deliver.ts:18-41`
  (`chunkHtml` или его plain-text аналог). Один список ≤4000 символов влезает прямо.

### Folded Todos

Cross-reference с pending-todos (по Phase 1 — 0 совпадений; новых todo'шек по бот-командам не
зафиксировано). Раздел не нужен.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §«Phase 2: Bot Commands» — goal, depends-on (Phase 1), success criteria 1–4
- `.planning/REQUIREMENTS.md` §«Channel Management (BOT)» — BOT-01..BOT-05 полные формулировки + Future BOT-06..07 + Out of Scope reasons
- `.planning/PROJECT.md` §«Constraints» — runtime-deps cap (4: telegram, openai, node-cron, zod — никаких новых), §«Out of Scope» — bot framework, webhook, RBAC

### Prior phase context (carried forward)
- `.planning/phases/01-storage-migration/01-CONTEXT.md` §«channels-store API Scope» (D-08 — три public функции), §«Mutex Implementation» (D-05/D-06/D-07 — `mutate(fn)` контракт)
- `.planning/phases/01-storage-migration/01-VERIFICATION.md» — статус Phase 1, `mutate()` готов к consumer'у

### Existing code to read/extend
- `src/run.ts` (полностью, 66 строк) — текущий daemon entrypoint; тут добавляется bot polling-loop рядом с `cron.schedule(...)`, расширяется `shutdown()` (lines 56-65)
- `src/channels-store.ts` — `mutate(fn)`, `loadChannels()`, `saveChannels()`; единственный API для CRUD-обёрток в Phase 2
- `src/alert.ts` (полностью, 71 строка) — паттерн raw-fetch к Bot API + behaviour при отсутствии env (warn + continue, D-04)
- `src/deliver.ts:43-61` — паттерн `fetch(\`https://api.telegram.org/bot${token}/sendMessage\`)`, error handling (`res.ok` → `throw`); Phase 2 переиспользует тот же стиль
- `src/logger.ts` — `log.info/warn/error` со стейдж-префиксом; Phase 2 использует `[bot]`
- `src/types.ts` — `ChannelEntry` тип (с Phase 1 переехал в `channels-store.ts`)
- `src/__tests__/` — место для `bot-handlers.test.ts`

### Test/build infrastructure
- `vitest.config.ts` — конфиг без изменений
- `package.json` — runtime-deps cap = 4; никаких новых
- `tsconfig.json» — `strict: true`, ESM, `moduleResolution: bundler» — новый `src/bot.ts` обязан соответствовать

### Telegram Bot API reference
- https://core.telegram.org/bots/api#getupdates — long-polling спецификация (timeout, offset, allowed_updates)
- https://core.telegram.org/bots/api#deletewebhook — `drop_pending_updates: false` для D-03
- https://core.telegram.org/bots/api#answercallbackquery — обязательный ack callback'а в течение 15 мин
- https://core.telegram.org/bots/api#editmessagereplymarkup — D-13: уборка inline-клавиатуры

### Configuration
- `.env.example` — добавится `BOT_ALLOWED_USER_IDS=` (комментарий формата + где взять numeric id; pattern из ALERTS_CHAT_ID — `@userinfobot`)
- `channels.json` (корень) — единственный источник правды; Phase 2 пишет через `mutate()`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/alert.ts:50-60`** — эталон raw-fetch к Bot API (`POST /bot${token}/sendMessage`, JSON content-type, error handling). Polling-loop и `sendMessage`-helper в `src/bot.ts` копируют тот же паттерн.
- **`src/alert.ts:23-32`** — паттерн «env не задан → log + return», аналогичен D-04.
- **`src/channels-store.ts:110-121`** — `mutate(fn)` готов к consumer'у; CRUD-обёртки в `src/bot.ts` будут вида `mutate(channels => [...channels, { username: u }])`.
- **Vitest** — настроен (260504-f5z); место для `src/__tests__/bot-handlers.test.ts`.
- **`src/deliver.ts:18-41`** (`chunkHtml`) — паттерн нарезки длинных сообщений; пригодится при `/channels` с 50+ каналами (если влезет в 4000 — не нужен).
- **`src/logger.ts`** — `log.info/warn/error` со стейдж-префиксом; Phase 2 использует `[bot]`.
- **`crypto.randomUUID().slice(0,8)`** — `runId` style для alert'ов; в Phase 2 переиспользуется для `botRunId` при ошибках polling-loop'а.

### Established Patterns

- **Module-level helpers, no DI** — каждый `src/*.ts` экспортирует функции, никакого классового DI. `bot.ts` следует этому.
- **ESM + `.js` суффиксы в импортах** — `import { mutate } from "./channels-store.js"`. Обязательно.
- **Атомарность через `channels-store.mutate()`** — никакой прямой `writeFileSync` к `channels.json` из бота.
- **Stage-prefixed logs** — `log.info('[bot] ...')`, `log.warn('[bot] ...')`. Symmetric с `[pipeline]`, `[alert]`, `[channels-store]`.
- **In-memory state без persistence** — `let isRunning` (run.ts:11), `lockChain` (channels-store.ts:70). Polling offset тоже in-memory (`let lastOffset = 0`); persistence на диск НЕ нужна, бот после restart'а догонит updates за счёт `drop_pending_updates: false` в `deleteWebhook` (D-03).
- **Graceful shutdown** — `await shutdown()` с polling-проверкой `isRunning` (run.ts:59-61). Phase 2 расширяет `shutdown()` для polling-loop'а.

### Integration Points

- **`src/run.ts` (entire file)** — добавляется новый импорт `startBot` из `./bot.js`, вызывается параллельно с `cron.schedule(...)`. `shutdown()` ждёт и cron, и polling-loop.
- **`channels.json`** — единственный источник правды; пишется только через `channels-store.mutate()`.
- **`.env.example`** — добавляется секция «Command bot allowlist» с `BOT_ALLOWED_USER_IDS=` + комментарий «через @userinfobot» (как ALERTS_CHAT_ID).
- **`README.md`** — секция «Команды бота» (3 команды + как получить numeric user_id), §«Запуск на VPS (PM2)» дополняется требованием задать `BOT_ALLOWED_USER_IDS`.
- **`package.json`** — НЕ меняется. Никаких новых runtime/dev зависимостей (D-01, PROJECT cap=4).

</code_context>

<specifics>
## Specific Ideas

- **Один токен — намеренное упрощение оператора, не недосмотр.** Решение принято после явного
  вопроса (см. DISCUSSION-LOG). Risk-acceptance: rate-limit Bot API делится между delivery и
  polling, но при 1 прогоне в сутки и единичных командах от 2 пользователей — лимит не критичен.
- **Phase 1 mutex — точка опоры для D-14 (idempotent remove).** Concurrent confirm'ы (двойной
  тык на кнопку, Заказчик + оператор одновременно) обязаны давать корректный финал; Vitest-тест
  Phase 1 уже проверяет `Promise.all([store.mutate(addOne), store.mutate(addTwo)])`. Phase 2
  тестирует bot-handler'ы через mock'нутый `mutate`, а реальная атомарность — гарантия Phase 1.
- **Inline-кнопка не имеет timeout'а.** D-13 убирает кнопки сразу после нажатия; повторный
  callback на удалённую кнопку Telegram не отправит. Stale-callback после `pm2 restart` всё
  ещё валиден (username self-contained, D-11) — обработчик вызовет idempotent remove (D-14).

</specifics>

<deferred>
## Deferred Ideas

Идеи, которые всплыли в обсуждении и не входят в Phase 2.

- **Inline keyboard для выбора канала при `/remove_channel`** (BOT-07) — Future, REQUIREMENTS.md.
  Сейчас username в команде; кнопочный выбор из списка — отдельная фича.
- **Real-resolve канала через GramJS при `/add_channel`** — отклонено по YAGNI (см. Claude's
  Discretion). Ре-открыть, если оператор начнёт массово добавлять опечатки и удивляться, что
  pipeline падает.
- **Persistence offset polling-loop'а на диск** — отклонено в пользу `deleteWebhook({ drop_pending_updates: false })`
  + in-memory offset (D-03, D-05). Ре-открыть, если оператор пожалуется на потерю команд при PM2-рестарте
  (теоретически невозможно при D-03, но если в проде вылезет — пересмотрим).
- **Отдельный токен `BOT_TOKEN_COMMANDS`** — обсуждалось, отклонено пользователем (D-01).
  Ре-открыть, если: (a) bot rate-limit начнёт мешать delivery, (b) появится вторая роль (например
  read-only Заказчик с другими командами).
- **Inline-кнопка timeout / истечение** — отклонено. D-13 убирает кнопки после первого клика;
  повторный нажим на удалённую кнопку невозможен. Если кнопка осталась после рестарта — D-14
  delivers idempotent поведение.
- **Web-админка для управления каналами** — Out of Scope (REQUIREMENTS.md).
- **Ролевая модель (admin/viewer)** — Out of Scope (REQUIREMENTS.md). Оператор и Заказчик —
  одна и та же роль.
- **Bot-команды для статуса прогона / ручного триггера** — НЕ в scope Phase 2; v5+ если
  понадобится. Сейчас оператор смотрит `pm2 logs`.

### Reviewed Todos (not folded)

Cross-reference вернул 0 совпадений с pending-todos — раздел не нужен.

</deferred>

---

*Phase: 02-bot-commands*
*Context gathered: 2026-05-06*
