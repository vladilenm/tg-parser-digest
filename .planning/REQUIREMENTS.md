# Requirements: tg-parser-demo

**Defined:** 2026-04-22
**Milestone:** v2.0 Автоматизация + 50 каналов
**Core Value:** За один прогон получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.
**Source spec:** [docs/phase-2.md](../docs/phase-2.md)

## v2.0 Requirements

Требования для milestone v2.0. Каждое REQ-ID мапится на ровно одну фазу в `ROADMAP.md`.

### Daemon Runtime

- [ ] **DAEMON-01**: `npm start` работает как long-running daemon, не завершается после старта; graceful shutdown по SIGINT/SIGTERM с ожиданием активного прогона перед `exit 0`
- [ ] **DAEMON-02**: Ежедневный прогон по `node-cron` с выражением `0 20 * * *` и `timezone: "Europe/Moscow"`
- [ ] **DAEMON-03**: Mutex `isRunning` — если предыдущий прогон ещё активен, второй тик пишет `prev run still in progress — skipping tick` и выходит без запуска пайплайна
- [ ] **DAEMON-04**: Прогон запускается только по расписанию; старт процесса (включая PM2-рестарт) не триггерит дайджест

### Pipeline Refactor

- [ ] **PIPE-01**: Логика прогона вынесена в `src/pipeline.ts` → `runPipeline(): Promise<RunSummary>`; `process.exit(...)` и глобальный `catch` уходят из entrypoint, ошибки пробрасываются вызывающему
- [ ] **PIPE-02**: Клиент GramJS создаётся per-run внутри `runPipeline` и дисконнектится в `finally` — живую сессию между прогонами не держим
- [ ] **PIPE-03**: In-memory дедуп с ключом `${username}:${messageId}` отбрасывает повторы в рамках одного прогона; в `RunSummary.postsDeduped` — количество отброшенных

### Reliability

- [ ] **RELI-01**: В `src/telegram.ts` `fetchLast24h` распознаёт сетевые сбои (сообщение содержит `"not connected"`/`"Disconnect"`/`"TIMEOUT"`, `ConnectionError`, либо `client.connected === false`) и делает до 3 попыток exp. backoff 1000/2000/4000 мс с `await client.connect()` между попытками
- [ ] **RELI-02**: После исчерпания reconnect-попыток канал помечается как skipped, прогон продолжается с остальными каналами, сообщение об ошибке добавляется в `RunSummary.errors` как `${username}: ${err.message}`
- [ ] **RELI-03**: Reconnect-счётчик отделён от FloodWait-счётчика — один общий лимит на ретраи не складывает случаи сети и FloodWait

### Observability

- [ ] **LOG-01**: `src/logger.ts` экспортирует `log.info/warn/error(msg, ...ctx)` с префиксом `[ISO-timestamp] [level]`, пишет через `console.log/warn/error`
- [ ] **LOG-02**: В `src/types.ts` добавлен интерфейс `RunSummary` с полями `runId`, `startedAt`, `finishedAt`, `durationMs`, `channelsTotal`, `channelsSucceeded`, `channelsSkipped`, `postsCollected`, `postsDeduped`, `digestDelivered`, `errors[]`
- [ ] **LOG-03**: `logRunSummary(s: RunSummary)` печатает многострочный блок формата из `docs/phase-2.md` §4 (runId, duration, channels/posts-счётчики, delivered, список errors)

### Scale

- [ ] **SCALE-01**: `channels.yaml` расширен до 50 каналов: к существующим 12 добавлено 38 публичных каналов по российскому нефтегазу/нефтехимии (нефтехимия/бункеровка/масла/битум/керосин), структура `{ username, priority }` сохранена
- [ ] **SCALE-02**: `CHANNEL_DELAY_MS=1750` зафиксирован и в `.env.example`, и как дефолт в коде `src/pipeline.ts`

### Deployment

- [ ] **DEPLOY-01**: `ecosystem.config.js` в корне проекта с конфигом PM2: `script: "src/run.ts"`, `interpreter: "node"`, `interpreter_args: "--env-file=.env --import tsx"`, `instances: 1`, `exec_mode: "fork"`, `autorestart: true`, `max_restarts: 10`, `min_uptime: "30s"`, `max_memory_restart: "300M"`, `time: true`
- [ ] **DEPLOY-02**: `package.json` получает runtime-dep `node-cron@^3.0.3` и devDep `@types/node-cron@^3.0.11`; существующие скрипты `npm start`/`npm run login` не переименовываются

### Documentation

- [ ] **DOC-01**: README секция «Запуск на VPS (PM2)» с командами `pm2 start ecosystem.config.js`, `pm2 logs tg-parser`, `pm2 save`, `pm2 startup`
- [ ] **DOC-02**: README отражает daemon-режим `npm start` (Ctrl+C для локальной остановки); старая формулировка «не чаще 1 прогона в 10–15 минут» удалена, т.к. контроль частоты теперь на стороне крона
- [ ] **DOC-03**: README содержит секцию «Ежедневный summary-лог» с примером вывода (runId, duration, channels/posts, errors)

## Future Requirements

Отложены на будущие milestone:

### Persistence & Dedupe

- **PERSIST-01**: Postgres-хранилище постов/дайджестов (миграции, connection pool)
- **PERSIST-02**: Semantic dedupe через `text-embedding-3-small` + pgvector
- **PERSIST-03**: Кросс-прогонная дедупа между дайджестами (окно ≥ 48ч)

### Classification

- **CLASSIFY-01**: Классификатор направлений (бункеровка/масла/керосин/нефтехимия/битум)
- **CLASSIFY-02**: Классификатор компаний (TARGET/конкуренты)

### Abstractions

- **ABSTRACT-01**: `LLMProvider` интерфейс (появится когда будет второй провайдер)
- **ABSTRACT-02**: `Deliverer` интерфейс (появится когда понадобится вторая цель доставки)

### Scope Extensions

- **SCOPE-01**: Приватные каналы по invite hash
- **SCOPE-02**: Multi-tenancy (несколько TG-сессий/каналов доставки)

## Out of Scope

Явно исключено из v2.0. Документируем, чтобы не разъехался scope.

| Feature | Reason |
|---------|--------|
| Postgres/pgvector, миграции, connection pool | v2.0 закрывает только автоматизацию запуска; персистентность требует отдельного milestone с БД-инфраструктурой |
| Embeddings + семантическая дедупа кросс-прогонно | Нужна БД и embeddings-API; в v2.0 достаточно in-memory дедупа в рамках одного прогона |
| Классификатор направлений/компаний | LLM генерирует темы сама; явный классификатор обоснуется только после наблюдения частоты/качества тем в v2.0 |
| `LLMProvider`/`Deliverer` абстракции | Один провайдер, одна цель доставки; абстракции появятся при появлении второго кандидата |
| Unicode NFC-фикс в `keyQuote` (IN-01 из v1.0) | v1.0 tech debt; переносится в v2.1 или backlog, не блокирует daemon-режим |
| chunkHtml edge cases (v1.0 REVIEW warnings) | v1.0 tech debt; в v2.0 не трогаем — сообщения режутся как раньше |
| NaN env validation, неполный `.gitignore` glob | v1.0 tech debt; отдельная задача на гигиену, вне v2.0 scope |
| Автотесты | v2.0 по-прежнему проверяется ручным чек-листом + summary-логом; автотесты обоснуются при появлении CI |
| `LOG_LEVEL` реальное чтение из env | В v2.0 используем простой префиксированный логгер без уровней-фильтров; `LOG_LEVEL` либо удаляется из `.env.example`, либо остаётся задокументированным (не блокер) |
| Ретраи на уровне прогона при падении DeepSeek/Telegram | Прогон суточный — проще ждать следующий тик, чем усложнять код ретраями |
| GitHub Actions/systemd таймер | Схема PM2+node-cron уже покрывает планирование; вторая схема избыточна |
| Dashboard/RAG/сторонние интеграции | Вне v2.0 по-прежнему (как и в v1.0 Out of Scope) |

## Traceability

Соответствие требований фазам.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DAEMON-01 | Phase 2 | Pending |
| DAEMON-02 | Phase 2 | Pending |
| DAEMON-03 | Phase 2 | Pending |
| DAEMON-04 | Phase 2 | Pending |
| PIPE-01 | Phase 2 | Pending |
| PIPE-02 | Phase 2 | Pending |
| PIPE-03 | Phase 2 | Pending |
| RELI-01 | Phase 2 | Pending |
| RELI-02 | Phase 2 | Pending |
| RELI-03 | Phase 2 | Pending |
| LOG-01 | Phase 2 | Pending |
| LOG-02 | Phase 2 | Pending |
| LOG-03 | Phase 2 | Pending |
| SCALE-01 | Phase 2 | Pending |
| SCALE-02 | Phase 2 | Pending |
| DEPLOY-01 | Phase 2 | Pending |
| DEPLOY-02 | Phase 2 | Pending |
| DOC-01 | Phase 2 | Pending |
| DOC-02 | Phase 2 | Pending |
| DOC-03 | Phase 2 | Pending |

**Coverage:**
- v2.0 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-22*
*Source: docs/phase-2.md (утверждено оператором 2026-04-22)*
*Traceability updated: 2026-04-22 — all 20 requirements mapped to Phase 2*
