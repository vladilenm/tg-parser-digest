# Phase 1: Foundation & Ingest - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Проектный скаффолд (package.json, tsconfig, docker-compose), env/yaml конфиг-валидация (zod), pino-логгер, Drizzle schema с pgvector HNSW индексом и миграциями, GramJS StringSession generator, ingest listener: сообщения из `config/channels.yaml` (enabled:true) попадают в таблицу `messages` в течение ≤60с после публикации и пушатся в BullMQ очередь `process`. Обработка сообщений (normalize/embed/classify/dedupe/summarize), воркеры пайплайна, дайджест и доставка — в Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Ingest Edge Cases

- **D-01:** Медиа-сообщения без caption → skip на ingest. Если `rawText` пустой или whitespace-only — не вставляем в `messages`, не пушим в очередь. Согласуется с `messages.raw_text NOT NULL` из SPEC §5.
- **D-02:** Forwards без собственного комментария → отсекать на ingest. Ловим по GramJS флагу `fwdFrom` в сочетании с пустым caption. Раньше, чем SPEC §7.1 (там normalize делает то же), экономит DB/queue/LLM бюджет.
- **D-03:** Edit events → игнорировать. Подписываемся только на `NewMessage`, не на `EditedMessage`. Уже отправленные дайджесты не перерендерятся в MVP.
- **D-04:** Минимальная длина `rawText` на ingest — не отсекать. Всё непустое сохраняем. Фильтрация по информативности — ответственность `classify.isRelevant` в Phase 2.

### Catch-up & Restart Strategy

- **D-05:** При любом старте (cold boot, реcтарт, деплой) выполняется catch-up на последние `INGEST_CATCHUP_HOURS` часов через `GramJS.iterMessages({offsetDate})` по каждому `enabled:true` каналу. Единая логика, без ветвления first-start vs restart. Unique constraint `(tg_channel_id, tg_message_id)` гасит дубли upsert'ом при горячем рестарте.
- **D-06:** `INGEST_CATCHUP_HOURS` — новая переменная env, default = `6`, добавляется в zod-схему env и в `.env.example` (CFG-01/CFG-05). Поддерживаемые типичные значения: `6`, `12`, `24` (документируется в `.env.example`).
- **D-07:** Last-seen tg_message_id по каналу берётся из **самой таблицы `messages`** через `SELECT MAX(tg_message_id) FROM messages WHERE tg_channel_id=$1`. Отдельной таблицы `channel_state` в Phase 1 не создаём (SPEC §5 её не описывает). Catch-up окно (INGEST_CATCHUP_HOURS) применяется как `offsetDate` к `iterMessages` независимо от last-seen — дубли отсекает unique constraint. Это упрощает логику и избегает drift между двумя источниками правды.
- **D-08:** Поведение при первом старте (messages пустой) идентично рестарту: тянем последние `INGEST_CATCHUP_HOURS` часов по каждому каналу. Первый дайджест имеет непустой контекст.

### Config Reload Strategy

- **D-09:** `config/channels.yaml` и `config/keywords.yaml` читаются **один раз при старте**. Изменения в YAML требуют рестарта процесса (`docker compose restart` или `systemctl restart monitor`). Hot-reload / SIGHUP не реализуем в MVP — race condition в GramJS listener не стоит усложнения.
- **D-10:** Валидация `channels.yaml` при старте — двухуровневая:
  1. **Структурная:** zod-схема `{ channels: [{ username, priority, enabled }] }`. Невалидная структура → exit(1) с понятным сообщением.
  2. **Runtime resolution:** после `GramJS.connect()` — `client.getEntity(username)` для каждого `enabled:true`. Если канал не резолвится (закрыт / забанен / опечатка) → `logger.warn` + skip **этого** канала, сервис не падает. 1 мёртвый канал не должен убивать весь ingest.
- **D-11:** Каналы с `enabled: false` полностью игнорируются (не подписываемся, не catch-up'им). Исторические `messages` этих каналов остаются в БД — для дедупа в Phase 2 и аудита.

### Claude's Discretion

- Точная форма pino-логов (какие поля base vs child), но обязательно: dev → `pino-pretty`, prod → JSON, `LOG_LEVEL` из env (OPS-03).
- Структура `src/config/index.ts` и разбиение на подмодули — свободно, но экспортируется типизированный `Config` с env + yaml merge.
- Drizzle migration workflow (push vs generate+migrate) не обсуждался — планировщик выбирает сам; рекомендация: `drizzle-kit generate` → SQL-файлы в `drizzle/migrations/` коммитятся, `pnpm setup:db` сначала `CREATE EXTENSION vector`, потом `drizzle-kit migrate`.
- FloodWait backoff: exponential с honor указанного `seconds`, ceiling `3600s`, jitter ±10% (соответствует ING-05 + SPEC §13). Конкретная base-задержка — на усмотрение планировщика.
- Debounce 500ms между операциями чтения (ING-06) — реализация (per-channel vs global) свободна.
- HNSW индекс параметры (m, ef_construction) — разумные defaults pgvector, тюнинг откладываем на Phase 2.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Specification & Requirements

- `SPEC.md` §3 — технологический стек (GramJS, Drizzle, pgvector, BullMQ)
- `SPEC.md` §4 — структура проекта (layout `src/` и `scripts/`)
- `SPEC.md` §5 — модель данных (messages, items, digests) — схема Drizzle
- `SPEC.md` §6 — формат `channels.yaml` и `keywords.yaml`
- `SPEC.md` §7 — ingest flow и нюансы normalize (§7.1 — forwards-без-caption отсекаются)
- `SPEC.md` §8 — docker-compose (pgvector/pgvector:pg16 + redis:7-alpine)
- `SPEC.md` §9 Шаги 1–5 — пошаговый план именно для Phase 1
- `SPEC.md` §12 criterion 1 — ingest ≤60с после публикации
- `SPEC.md` §13 — таблица рисков, колонка «Митигация в коде» (FloodWait, Postgres lock, dedupe miss)
- `SPEC.md` §15 — жёсткие требования (шаги по порядку, имена в env, prompt caching, HTML parse)

### Requirements Mapping (Phase 1)

- `.planning/REQUIREMENTS.md` §Configuration & Secrets — CFG-01..CFG-05
- `.planning/REQUIREMENTS.md` §Infrastructure — INF-01..INF-05
- `.planning/REQUIREMENTS.md` §Telegram Session — SESS-01..SESS-02
- `.planning/REQUIREMENTS.md` §Ingest — ING-01..ING-06
- `.planning/REQUIREMENTS.md` §Database — DB-01..DB-04

### Project-Level Context

- `.planning/PROJECT.md` — vision, constraints, key decisions table
- `.planning/ROADMAP.md` Phase 1 details — success criteria (5 пунктов)
- `CLAUDE.md` — высокоуровневая архитектура, жёсткие требования, команды

### Research Artifacts

- `.planning/research/STACK.md` — обоснования версий (Node 22, Drizzle+pgvector, BullMQ 5.71, GramJS 2.16, Croner, Pino 10.3)
- `.planning/research/PITFALLS.md` — критические риски (семантический порог, FloodWait, LLM галлюцинации)
- `.planning/research/ARCHITECTURE.md` — детализация потока данных
- `.planning/research/FEATURES.md` — раскрытие требований в контексте домена

</canonical_refs>

<code_context>
## Existing Code Insights

Репозиторий **на текущий момент содержит только планирование** (CLAUDE.md, SPEC.md, `.planning/`). Кода нет — Phase 1 стартует с нуля.

### Reusable Assets

Нет — greenfield.

### Established Patterns

Нет внутренних. Следуем конвенциям из `.planning/research/STACK.md`:

- Node 22 LTS + TypeScript 5.9 (ESM, `"type": "module"`)
- pnpm workspace-less (простой `package.json`)
- Drizzle schema в `src/db/schema.ts`, миграции в `drizzle/migrations/`
- zod для всех внешних границ (env, yaml, LLM output позже)
- pino: JSON в prod, `pino-pretty` в dev, `LOG_LEVEL` из env
- BullMQ + `ioredis` с `maxRetriesPerRequest: null`, `enableReadyCheck: false`

### Integration Points

- `scripts/gen-session.ts` — интерактивный CLI через `tsx`; выводит StringSession в stdout для ручного копирования в `.env`
- `scripts/setup-db.ts` — `pg` raw-query `CREATE EXTENSION IF NOT EXISTS vector`, затем drizzle-kit migrate
- `src/index.ts` — entry-point запускает ingest listener; workers и cron подключатся в Phase 2 к тому же процессу
- `src/ingest/telegram-client.ts` — GramJS client + `NewMessage` event handler + catch-up stage при старте + BullMQ producer

</code_context>

<specifics>
## Specific Ideas

- `INGEST_CATCHUP_HOURS` — новая env-переменная, не описанная в SPEC §7/REQUIREMENTS §Configuration. Добавить в zod env-схему (CFG-01), в `.env.example` (CFG-05), документировать значения 6/12/24 в комментарии.
- `logger.warn(..., { channel, username })` при неудачном `getEntity` — критично для диагностики «почему канал не ловится».
- Первый старт без `.env` / без `TG_SESSION` должен падать с **конкретными** сообщениями («TG_SESSION пуст — запусти `pnpm gen:session`»), не generic zod error.
- GramJS не имеет встроенного debounce — использовать `p-debounce` или простой `setTimeout`-wrapper вокруг чтений.

</specifics>

<deferred>
## Deferred Ideas

- **Hot-reload channels.yaml без рестарта** — chokidar + переподписка GramJS. Отложено: реализуется если оператор захочет менять список каналов без остановки сервиса. Не вошло в MVP — рестарт приемлем для 10-15 каналов и редких изменений.
- **Таблица `channel_state`** (last_seen_id, last_seen_at, paused_until) — отложено до момента, когда понадобятся per-channel метаданные помимо MAX(message_id). Сейчас MAX() достаточно.
- **Edit events → UPDATE messages.rawText** — отложено, в MVP правки редки в отраслевых каналах, и уже отправленные дайджесты всё равно не перерендериваются.
- **Health endpoint (`/health`: pg ping, redis ping, last ingest ts)** — не обсуждали, но возможно полезно для VPS monitoring. Отложено до явного запроса.
- **Процесс topology в prod (split ingest vs workers)** — Phase 1 имеет только ingest-процесс, workers появляются в Phase 2. Решение split vs single откладывается на Phase 2.
- **Drizzle `push` vs `generate+migrate`** — не обсуждали явно, рекомендация в Claude's Discretion выше.
- **BullMQ job retention (removeOnComplete/removeOnFail TTL)** — отложено на Phase 2 (там появляются воркеры).

</deferred>

---

*Phase: 01-foundation-ingest*
*Context gathered: 2026-04-20*
