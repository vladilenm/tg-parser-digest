# tg-parser-demo

## What This Is

Node.js-daemon (`npm start` под PM2 на VPS), который ежедневно в 20:00 MSK читает до 50 публичных Telegram-каналов по российскому нефтегазу/нефтехимии за последние 24 часа, прогоняет все посты через DeepSeek и отправляет ранжированный по 5 направлениям дайджест с пометкой упоминаний Роснефть/Лукойл/Газпром в закрытый Telegram-канал Заказчика. С v3.0 — с кросс-прогонной дедупой через файловый hash-cache, файловыми архивами raw/output и алертами в личку владельца на любую ошибку pipeline.

## Core Value

В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором **каждая цитата дословно присутствует в исходном посте** — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.

## Current Milestone: v4.0 Управление каналами + парсинг сайтов

**Goal:** Оператор и Заказчик управляют списком каналов через Telegram-бота (просмотр/добавление/удаление), а дайджест дополняется парсингом веб-сайтов с отдельной сводкой в тот же канал.

**Target features:**
- Управление каналами через бота: просмотр списка, добавление, удаление; хранение в JSON; доступ для оператора и Заказчика
- Хранение каналов в `channels.json` с программным CRUD (миграция с YAML завершена)
- Парсинг списка веб-сайтов (скрейпинг HTML): тот же DeepSeek-пайплайн (classify по 5 направлениям), отдельное сообщение в канал Заказчика

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

Validated in Phase 1 (MVP дайджест, 2026-04-21):

- [x] Конфиг каналов и окружения: `channels.json` + `.env.example` читаются скриптом, 10–15 публичных каналов по `username`
- [x] Разовая генерация `TG_SESSION` через `npm run login` (StringSession, интерактивный ввод телефона/кода/2FA)
- [x] GramJS-клиент переиспользует сохранённую сессию и выглядит как обычный клиент (deviceModel/appVersion/langCode="ru")
- [x] `fetchLast24h(username)` собирает посты за `FETCH_WINDOW_HOURS` часов, останавливает итерацию по `msg.date < sinceUnix`, уважает `MAX_MESSAGES_PER_CHANNEL`
- [x] Последовательный обход каналов с jitter: `sleep(CHANNEL_DELAY_MS + randomInt(0, 500))` между каналами
- [x] Обработка `FloodWaitError`: один retry после `err.seconds*1000 + 2000`; второй подряд — прерывание прогона
- [x] Частные ошибки канала (`ChannelPrivateError`, `UsernameNotOccupiedError`, `UsernameInvalidError`) логируются и пропускают канал, прогон продолжается
- [x] Суммаризация одним батчем через DeepSeek (`deepseek-chat`, `response_format: json_object`), валидация ответа вручную (`typeof`/`Array.isArray`)
- [x] Проверка ядра экстрактивности: `keyQuote` каждой записи дайджеста — дословная подстрока исходного `text`
- [x] Server-side рендер JSON → HTML (заголовки тем, буллеты с `<i>`-цитатой и `<a>`-ссылкой), экранирование `<`, `>`, `&`
- [x] Доставка в приватный канал через `fetch` к Bot API `sendMessage`, `parse_mode: "HTML"`, нарезка на части по ~4000 символов с нумерацией `(i/N)`
- [x] Пустой день: если постов 0 — логируем `No posts in window`, выходим с кодом 0, DeepSeek и Telegram не дёргаем
- [x] README: запуск в 3 команды + дисциплина «не чаще одного прогона в 10–15 минут»

Validated in Phase 2 (Daemon + 50 каналов, 2026-04-26, code complete):

- [x] **DAEMON-01..04**: `npm start` — long-running daemon с `node-cron` (`'0 20 * * *'`, `Europe/Moscow`); mutex `isRunning`; SIGINT/SIGTERM ждёт активный прогон → `exit 0`; запуск только по расписанию (PM2-рестарт не триггерит)
- [x] **PIPE-01..03**: `runPipeline(): Promise<RunSummary>` в `src/pipeline.ts`; per-run GramJS клиент с дисконнектом в `finally`; in-memory дедуп `${username}:${messageId}`
- [x] **RELI-01..03**: `fetchLast24h` распознаёт сетевые сбои (3 попытки exp. backoff 1000/2000/4000 мс); канал помечается skipped, прогон продолжается; reconnect-счётчик отделён от FloodWait
- [x] **LOG-01..03**: `src/logger.ts` (`[ISO] [level]`); `RunSummary` тип (runId, counters, errors[]); `logRunSummary` многострочным блоком
- [x] **SCALE-01..02**: `channels.json` 44+ каналов (12 реальных + 38 PLACEHOLDER); `CHANNEL_DELAY_MS=1750`
- [x] **DEPLOY-01..02**: `ecosystem.config.cjs` (PM2 fork, `--import tsx`, `kill_timeout=180000`); `node-cron@^3.0.3` + `@types/node-cron@^3.0.11`
- [x] **DOC-01..03**: README §«Запуск на VPS (PM2)», §«Ежедневный summary-лог», обновлён под daemon-режим

### Active

<!-- Current scope. Building toward these. -->

Milestone v4.0 «Управление каналами + парсинг сайтов» (REQ-IDs назначаются в `REQUIREMENTS.md`):

- Управление каналами через Telegram-бота: /channels (список), /add_channel, /remove_channel; доступ для оператора и Заказчика
- Хранение каналов в `channels.json` (миграция с YAML завершена); pipeline читает каналы из JSON
- Парсинг списка веб-сайтов (скрейпинг HTML): тот же DeepSeek-пайплайн, отдельное сообщение в канал Заказчика

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Реляционная/векторная БД (SQLite/Postgres/pgvector) — v3.0 закрывает дедуп и архив на ФС через `hash-cache.json` + `data/raw/*.json` + `data/output/*.md`; БД оправдана только при росте каналов/историй за пределы файлового подхода
- Семантический dedupe через embeddings (`text-embedding-3-small` + pgvector) — отложен в v4+; v3.0 проверяет лексическую дедупу через SHA-256 от нормализованного текста, embeddings подключим только если лексика даст ложные пропуски
- Веб-админка для управления каналами — v4.0 закрывает через Telegram-бота; веб-UI не нужен
- Верификация по официальным источникам (Минэнерго, СПИМЭКС, ФАС) — v5.0 (Этап 2 договора), сдвинуто с v4.0
- Подключение к Bitsab и другим ценовым системам — v6.0
- Дашборды (Grafana/Metabase) — v5.0; v3.0 наблюдается через summary-лог в `pm2 logs` + alert-bot
- Обучающие материалы (видео, обучение оператора Заказчика) — v7.0, Этап 3 договора
- Multi-tenancy (несколько TG-сессий/несколько каналов доставки) — один оператор, один потребитель = Заказчик
- Приватные каналы по `invite hash` — поддерживаем только публичные по `username`
- BullMQ/Redis/очереди/DLQ — daemon одиночный, ретраев на уровне процесса нет, повторный шанс — через 24 часа
- Docker / docker-compose — PM2 + Node-runtime на VPS достаточно; Docker оправдан только при появлении второго сервиса
- GitHub Actions scheduled / systemd-таймер — `node-cron` внутри daemon уже планирует, вторая схема избыточна
- `LLMProvider` / `Deliverer` абстракции — один провайдер DeepSeek, одна цель доставки; абстракции появятся при появлении второго кандидата
- Ретраи на уровне прогона при падении DeepSeek/Telegram (помимо STRUCT-02 retry x1 на невалидной схеме) — daemon ждёт следующий тик в 20:00 MSK; alert-bot уведомляет оператора немедленно
- Автотесты unit/E2E — v3.0 проверяется ручным smoke-pack + 7-day uptime; CI пока не подключаем
- Unicode NFC fix в `keyQuote includes()` (IN-01 v1.0 backlog) — не блокирует v3.0; всплывёт при наблюдении ложных drop'ов в STRUCT-валидации
- chunkHtml edge cases (v1.0 REVIEW warnings) — не задевают новый Markdown-рендер v3.0; v1.0 backlog

## Context

- **Shipped v1.0** (2026-04-21): ~651 LOC TypeScript в 6 модулях, 3 runtime-зависимости. Все 26/26 требований MVP-чек-листа §11 пройдены, 0 gaps в `v1.0-MILESTONE-AUDIT.md`. 12 items tech debt known-accepted.
- **Shipped v2.0** (2026-04-26, code complete + known runtime gap): daemon под PM2 с `node-cron 0 20 * * *` Europe/Moscow, mutex `isRunning`, graceful SIGINT/SIGTERM, reconnect 3x exp.backoff, structured logging + `RunSummary`, расширение до 50 каналов (12 реальных + 38 PLACEHOLDER), `CHANNEL_DELAY_MS=1750`. 20/20 REQ satisfied по коду; HUMAN-UAT smoke не подтверждён оператором — runtime-валидация переезжает в v3.0 ACCEPT-01 (7-day proof). 4-я runtime-dep — `node-cron`. Audit: `milestones/v2.0-MILESTONE-AUDIT.md`, status `gaps_found` (runtime sign-off).
- **Заказчик**: Роснефть через ИП-посредника. Договор №2020. Этап 1 закрыт v3.0. Этап 2 — v5.0 (верификация по официальным источникам). Этап 3 — v7.0+ (обучение).
- **Тематика**: российский нефтегаз и нефтехимия, 5 жёстких направлений в v3.0 — бункер/масла/керосин/нефтехимия/битум. Компании-маркеры: Роснефть (TARGET), Лукойл, Газпром (конкуренты).
- **Пользовательская сессия**: user-аккаунт, чей `TG_SESSION` в `.env`, обязан быть подписан на каждый канал из `channels.json`. Дисциплина оператора, не код.
- **Anti-ban дисциплина**: persistent StringSession, ограниченное 24ч окно, последовательный обход с jitter, FloodWait retry x1, правдоподобный клиент `Desktop/Windows 11/ru`. Частоту прогонов теперь контролирует cron (24ч), а не оператор.
- **Known tech debt (carried)**:
  - v1.0 backlog (12 items): chunkHtml edge cases, NaN env validation, Unicode NFC в `keyQuote.includes()`, `.gitignore` глоб, `LOG_LEVEL` задокументирован но не читается
  - v2.0 backlog (5 items info): `console.warn/error` в `telegram.ts:134-152` (pre-existing), stale comment `ecosystem.config.cjs:1`, double `username:` prefix в `errors[]` (`pipeline.ts:87` ↔ `telegram.ts:166`), README не предупреждает про `npm ci --omit=dev` gotcha с tsx, REQUIREMENTS.md DEPLOY-01/DOC-01 ссылаются на `.js` вместо `.cjs` (override accepted)
  - v2.0 runtime gap: HUMAN-UAT smoke не пройден; SC1/SC2/SC5 формально не verified до v3.0 ACCEPT-01
- **`spec-app.md`**: исходный design-doc, базовая часть §7-§9 реализована, §13 (Postgres+pgvector+embeddings) намеренно игнорируется — у Заказчика приоритет на ранжирование/дедуп/acceptance, а не на абстракции под второй сценарий.

## Constraints

- **Tech stack**: Node.js 20.6+ (для `--env-file`), TypeScript без шага сборки (`tsx`), ESM, `moduleResolution: bundler`, `strict: true`. Runtime-зависимости (4): `telegram` (GramJS), `openai` (DeepSeek через OpenAI-совместимый SDK), `node-cron`, `zod` (валидация STRUCT-02). YAML-зависимость удалена в quick-260506-dht (channels.json — единственный источник правды).
- **Без реляционной/векторной БД** — всё на ФС: `hash-cache.json`, `data/raw/*.json`, `data/output/*.md`, атомарная запись через `.tmp + rename`.
- **PM2 + node-cron** — единственная схема планирования; daemon крутится на VPS, рестарт через PM2.
- **Один оператор, один потребитель Заказчика** — никакого multi-tenancy, один TG_SESSION, один канал доставки + один alert-чат для владельца.
- **Telegram API limits**: окно чтения ≤24ч, ≤50 сообщений на канал по умолчанию, задержка между каналами ≥1.75с + jitter, частоту контролирует `0 20 * * *` крон (1 прогон в сутки).
- **DeepSeek**: один батч-запрос на прогон, `response_format: json_object`, ответ обязан удовлетворять Zod-схеме v3.0 (5 направлений + блок упоминаний), retry x1 на схема-mismatch.
- **Telegram Bot API**: лимит 4096 символов — Markdown-рендер режет с запасом и нумерует сегменты.
- **Без ломки публичного контракта v2.0**: cron в 20:00 MSK, тот же канал доставки, тот же daemon-режим `npm start` под PM2.
- **Дедлайн**: 2 рабочих дня на код v3.0 + 7-day smoke-acceptance до 22.05.2026 (срок Этапа 1+2 в договоре).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Ручной запуск, без крона (v1.0) | Самая дешёвая проверка связки GramJS→LLM→Telegram; расписание добавим когда появится стабильный sender | ✓ Superseded — v2.0 перевёл в daemon-режим под PM2 + node-cron `'0 20 * * *'` Europe/Moscow |
| Только MVP, SPEC.md отложен (v1.0) | Все усложнения окупаются только после подтверждённой ценности дайджеста | ✓ Superseded — v3.0 берёт критическую часть SPEC.md (структурированный JSON, дедуп, архивы), но всё ещё без БД |
| GramJS user-session вместо Bot API для чтения | Bot API не видит историю произвольных публичных каналов | ✓ Good (carried v1.0+v2.0) — identity `Desktop/Windows 11/ru` работает, FloodWait на 50 каналах с CHANNEL_DELAY_MS=1750 ещё не наблюдался |
| DeepSeek как единственный LLM | Дешёвый, OpenAI-совместимый SDK, русский язык подходит | ✓ Good — `response_format: json_object` сработал в v1.0; v3.0 добавляет Zod-валидацию + retry x1 на схема-mismatch |
| Экстрактивный промпт с обязательной дословностью `keyQuote` | Защита от галлюцинаций на отраслевой лексике | ⚠️ Revisit — `Map<url, Post>` + `includes()` даёт ложные несовпадения при Unicode NFC vs NFD (IN-01 backlog); v3.0 STRUCT-валидация + drop постов вне категорий частично снижает риск |
| Без тестов | Ручной чек-лист §11 + summary-лог + alert-bot | ✓ Carried v1.0→v2.0→v3.0 — v3.0 добавляет 7-day acceptance proof; CI откладывается до появления второго инженера |
| Без персистентности между запусками (v1.0) | Повтор одних и тех же новостей допустим в MVP | ✓ Closed — Заказчик в Этапе 1 явно требует дедуп; v3.0 закрывает через SHA-256 hash-cache.json (rolling 14 дней) |
| YOLO-режим с одной фазой (v1.0+v2.0) | Пайплайн не даёт верифицируемой ценности в подмножествах | ✓ Good v1.0/v2.0; v3.0 — TBD по итогам roadmap-фазы (4 wave-группы STRUCT/RENDER → DEDUP/ARCH → ALERT/DOC → ACCEPT могут стать одной или несколькими фазами) |
| Дедуп на ФС через SHA-256, не embeddings (v3.0) | Файловый hash-cache достаточен для лексических повторов; embeddings + pgvector — отдельный milestone v4+ | — Pending — реальное качество дедупы оценится по 7-day smoke; ложные пропуски/задвоения сигналят к семантическому подходу |
| Архивы на ФС (raw + output), не в БД (v3.0) | Атомарный `.tmp + rename` достаточен для одного оператора и acceptance-пакета; БД оправдана только при росте каналов/историй | — Pending — после 7 суток оценить размер директории `data/` и решить про ротацию/архивацию |
| Alert-bot отдельным `BOT_TOKEN_ALERTS` (v3.0) | Не загрязнять канал Заказчика тех-ошибками; алерты в личку владельца — изолированный канал реагирования | — Pending — выяснится по частоте срабатываний на 7-day smoke (адекватный сигнал vs шум) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-05 — milestone v4.0 «Управление каналами + парсинг сайтов» started; v3.0 closed (delivered via quick tasks)*
