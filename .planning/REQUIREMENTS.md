# Requirements: Oil & Gas Intelligence Monitor

**Defined:** 2026-04-20
**Core Value:** Дайджест приходит в 20:00 ± 1 минута MSK с проверяемыми по оригиналу цитатами, без галлюцинаций и без дубликатов.

## v1 Requirements

Все v1-требования выведены из SPEC.md §9 (шаги 1–12), §12 (критерии приёмки) и §15 (жёсткие ограничения).

### Configuration & Secrets

- [ ] **CFG-01**: Сервис стартует с валидированным env (zod-схема): `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, `TG_BOT_TOKEN`, `TG_DIGEST_CHANNEL_ID`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`, `REDIS_URL`, `DIGEST_CRON`, `DIGEST_TIMEZONE`, `DEDUPE_COSINE_THRESHOLD`, `LOG_LEVEL`, `NODE_ENV`
- [ ] **CFG-02**: Список TG-каналов читается из `config/channels.yaml` (username, priority, enabled)
- [ ] **CFG-03**: Направления и ключевые слова/алиасы читаются из `config/keywords.yaml` (5 directions + target/competitor_a/competitor_b)
- [ ] **CFG-04**: Имена TARGET/competitor_a/competitor_b находятся ТОЛЬКО в env/yaml, не в коде — проверяется grep-тестом в CI или pre-commit
- [ ] **CFG-05**: `.env.example` содержит все необходимые ключи с безопасными заглушками

### Infrastructure

- [ ] **INF-01**: `docker-compose.yml` поднимает Postgres 16 + pgvector (`pgvector/pgvector:pg16`) и Redis 7
- [ ] **INF-02**: `pnpm setup:db` создаёт extension `vector` и применяет миграции Drizzle
- [ ] **INF-03**: HNSW индекс на `items.embedding` с оператором `vector_cosine_ops` создаётся миграцией
- [ ] **INF-04**: `pnpm dev` запускает ingest + workers + cron параллельно одним процессом
- [ ] **INF-05**: Сервис деплоится на VPS через docker compose или systemd и переживает reboot VPS

### Telegram Session

- [ ] **SESS-01**: `pnpm gen:session` интерактивно создаёт GramJS StringSession и выводит её в консоль для копирования в `.env`
- [ ] **SESS-02**: При невалидной сессии процесс падает с понятным сообщением и кодом выхода ≠ 0

### Ingest

- [ ] **ING-01**: GramJS-клиент подписан на `NewMessage` event из каналов `config/channels.yaml` с `enabled: true`
- [ ] **ING-02**: Новое сообщение из канала попадает в БД `messages` в течение 60 секунд после публикации (SPEC §12.1)
- [ ] **ING-03**: Upsert в `messages` по `(tg_channel_id, tg_message_id)` — дубли пропускаются
- [ ] **ING-04**: Сохранённое сообщение пушится в очередь BullMQ `process` job'ом `{ messageId }`
- [ ] **ING-05**: FloodWait обрабатывается экспоненциальным backoff с honor-им указанного `seconds`, ceiling = 3600с
- [ ] **ING-06**: Debounce 500ms между последовательными операциями чтения

### Database

- [ ] **DB-01**: Таблица `messages` соответствует SPEC §5 (uuid PK, bigint channel_id/message_id, text rawText, timestamps, unique constraint)
- [ ] **DB-02**: Таблица `items` соответствует SPEC §5 (fk на messages, directions[], companies[], isEvent, importance 1..5, summary, keyQuote, embedding vector(1536), cluster_id)
- [ ] **DB-03**: Таблица `digests` соответствует SPEC §5 (unique digest_date, content_md, item_ids[], sent_at, tg_message_id)
- [ ] **DB-04**: Индексы: `idx_messages_posted_at`, `idx_items_cluster`, HNSW на embedding

### LLM & Embeddings

- [ ] **LLM-01**: `LLMProvider` интерфейс с методом `complete({system, user, jsonSchema?})` — обязателен с первого дня (SPEC §3)
- [ ] **LLM-02**: `ClaudeProvider` реализует `LLMProvider` через `@anthropic-ai/sdk` с включённым prompt caching на system-промптах
- [ ] **LLM-03**: `EmbeddingProvider` интерфейс с методами `embed` и `embedBatch` — обязателен с первого дня
- [ ] **LLM-04**: `OpenAIEmbeddingProvider` использует `text-embedding-3-small` (1536 dim)
- [ ] **LLM-05**: Embeddings кешируются в Redis по `hash(normalizedText)`, TTL 7 дней
- [ ] **LLM-06**: В dev логируются полные LLM-запросы и ответы; в prod — только metadata (model, tokens, latency)

### Pipeline

- [ ] **PIPE-01**: `processMessage(messageId)` выполняет стадии строго последовательно: normalize → embed → classify → dedupe → summarize → persist
- [ ] **PIPE-02**: `normalize` чистит эмодзи, рекламные подписи, повторы; пересылы без собственного комментария отсекаются
- [ ] **PIPE-03**: `classify` возвращает валидированный zod-schema JSON: `directions`, `companies`, `isEvent`, `importance`, `isRelevant`
- [ ] **PIPE-04**: Если `classify.isRelevant === false` ИЛИ `directions.length === 0` — обработка обрывается, item не создаётся
- [ ] **PIPE-05**: Classify accuracy ≥85% по направлениям и ≥90% по компаниям на 50 вручную размеченных сэмплах (SPEC §12.2)
- [ ] **PIPE-06**: `dedupe` находит items за 24ч с `cosine_similarity > DEDUPE_COSINE_THRESHOLD` (default 0.90, в конфиге) и присваивает существующий `cluster_id`; иначе — новый uuid
- [ ] **PIPE-07**: Одна новость, опубликованная в 3+ каналах, появляется в дайджесте один раз (SPEC §12.3)
- [ ] **PIPE-08**: `summarize` вызывается только для не-дубликатов; возвращает `{summary, keyQuote}` с summary ≤250 символов, 1–2 предложения на русском
- [ ] **PIPE-09**: После summarize проверяется `rawText.includes(keyQuote)`; при провале — один retry с более жёстким промптом, затем item skip
- [ ] **PIPE-10**: На 20 случайных items keyQuote verbatim найден в rawText в 100% случаев (SPEC §12.4)
- [ ] **PIPE-11**: LLM вызовы валидируются zod; при невалидном JSON — 1 retry с `response_format: json_object`

### Queues & Workers

- [ ] **QUE-01**: BullMQ очереди `process` и `digest` создаются на старте
- [ ] **QUE-02**: `process.worker.ts` — consumer для `process`, вызывает `processMessage`, retry 3 с экспоненциальным backoff
- [ ] **QUE-03**: Permanent failures попадают в DLQ и логируются

### Digest Composition

- [ ] **DIG-01**: `compose` выбирает items с `processed_at` в окне 20:00 вчера → 20:00 сегодня MSK
- [ ] **DIG-02**: Для каждого `cluster_id` берётся одна запись (с max importance)
- [ ] **DIG-03**: Фильтр: `importance >= 2` И (`companies` содержит `target|competitor_a|competitor_b` ИЛИ `isEvent === true`)
- [ ] **DIG-04**: Группировка по `directions` — item в двух направлениях попадает в обе группы
- [ ] **DIG-05**: Сортировка внутри группы: `importance DESC, postedAt DESC`
- [ ] **DIG-06**: Лимит 7 записей на группу; остаток помечается "ещё N"
- [ ] **DIG-07**: Handlebars рендерит шаблон из `config/digest-template.md` в Markdown

### Delivery

- [ ] **DEL-01**: `Deliverer` интерфейс реализуется `TelegramBotDeliverer` на grammy
- [ ] **DEL-02**: Parse mode HTML, не MarkdownV2; HTML-эскейпинг всех user-generated полей (summary, keyQuote, channelTitle)
- [ ] **DEL-03**: Сообщения длиннее 4096 символов бьются на части с нумерацией `(1/N)`
- [ ] **DEL-04**: Результат отправки сохраняется в `digests` (content_md, item_ids, sent_at, tg_message_id)

### Cron & Scheduling

- [ ] **CRON-01**: `Croner` с timezone `Europe/Moscow` триггерит digest worker по `DIGEST_CRON` (default `0 20 * * *`)
- [ ] **CRON-02**: Дайджест приходит в 20:00 ± 1 минута MSK (SPEC §12.5)
- [ ] **CRON-03**: Idempotency: если запись в `digests` за сегодня уже есть — skip (SPEC §11)

### Reliability & Ops

- [ ] **OPS-01**: Сервис работает 48 часов без ручного вмешательства (SPEC §12.6)
- [ ] **OPS-02**: Graceful shutdown на SIGINT/SIGTERM: дожидается in-flight BullMQ jobs (timeout 10с), закрывает pg pool и redis
- [ ] **OPS-03**: Pino-логгер пишет structured JSON; в dev включён pino-pretty
- [ ] **OPS-04**: Ручной re-send дайджеста через `pnpm tsx scripts/send-test-digest.ts`

### Quality Assurance

- [ ] **QA-01**: Golden dataset ≥50 размеченных сэмплов (directions, companies, importance) для acceptance-теста
- [ ] **QA-02**: Vitest тесты для dedupe (граница 24ч, порог similarity), classify (JSON validity), digest (форматирование, 4096-char split)
- [ ] **QA-03**: Script `pnpm tsx scripts/evaluate-classify.ts` запускает classify на golden set и печатает precision/recall по классам

## v2 Requirements

Отложено — не входит в приёмку пилота, зафиксировано для последующих этапов (SPEC §16).

### Expansion (после MVP)

- **EXP-01**: Расширение до 50 TG-каналов
- **EXP-02**: RSS/HTML ingest с сайтов Роснефти / Лукойла / Газпрома
- **EXP-03**: Мульти-аккаунтная ротация TG-сессий для обхода FloodWait
- **EXP-04**: Prometheus metrics endpoint + Grafana + Loki алертинг

### Productization

- **PRD-01**: Next.js + Metabase dashboard с историческими срезами
- **PRD-02**: RAG-ассистент для написания статей на базе накопленных items
- **PRD-03**: Bitsab integration для bunker-сегмента

### Prod-hardening

- **HRD-01**: On-prem деплой в инфраструктуре заказчика
- **HRD-02**: Замена Claude на GigaChat/YandexGPT/локальный Qwen через `LLMProvider` interface
- **HRD-03**: Замена OpenAI embeddings на отечественный provider через `EmbeddingProvider` interface

## Out of Scope

Явно исключено. Документируется, чтобы не переоткрывать на этапе планирования.

| Feature | Reason |
|---------|--------|
| Все 50 каналов на MVP | На пилоте — 10–15 приоритетных (SPEC §14) |
| RSS и официальные сайты | Не в скоупе MVP; этап 2 (SPEC §16) |
| Конференции / отраслевые СМИ / СНГ-источники | Не в скоупе MVP |
| Next.js/Metabase dashboard | Не в скоупе MVP (SPEC §14) |
| RAG-ассистент для статей | Не в скоупе MVP |
| Мульти-аккаунтная ротация сессий | Один аккаунт на MVP |
| On-prem + локальный LLM | Абстракции готовы, реализация — prod-этап |
| MarkdownV2 parse mode | HTML проще и надёжнее (CLAUDE.md §7) |
| Чтение публичных каналов через Bot API | Технически невозможно (CLAUDE.md §8) |
| Prometheus/Grafana/Loki | Пилот обходится логами + ручной проверкой |
| Обучение внутренней команды заказчика | Отдельный этап после MVP |
| Kubernetes / мульти-нодовое развёртывание | Один VPS на MVP |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 1 | Pending |
| CFG-02 | Phase 1 | Pending |
| CFG-03 | Phase 1 | Pending |
| CFG-04 | Phase 1 | Pending |
| CFG-05 | Phase 1 | Pending |
| INF-01 | Phase 1 | Pending |
| INF-02 | Phase 1 | Pending |
| INF-03 | Phase 1 | Pending |
| INF-04 | Phase 1 | Pending |
| INF-05 | Phase 1 | Pending |
| SESS-01 | Phase 1 | Pending |
| SESS-02 | Phase 1 | Pending |
| ING-01 | Phase 1 | Pending |
| ING-02 | Phase 1 | Pending |
| ING-03 | Phase 1 | Pending |
| ING-04 | Phase 1 | Pending |
| ING-05 | Phase 1 | Pending |
| ING-06 | Phase 1 | Pending |
| DB-01 | Phase 1 | Pending |
| DB-02 | Phase 1 | Pending |
| DB-03 | Phase 1 | Pending |
| DB-04 | Phase 1 | Pending |
| LLM-01 | Phase 2 | Pending |
| LLM-02 | Phase 2 | Pending |
| LLM-03 | Phase 2 | Pending |
| LLM-04 | Phase 2 | Pending |
| LLM-05 | Phase 2 | Pending |
| LLM-06 | Phase 2 | Pending |
| PIPE-01 | Phase 2 | Pending |
| PIPE-02 | Phase 2 | Pending |
| PIPE-03 | Phase 2 | Pending |
| PIPE-04 | Phase 2 | Pending |
| PIPE-05 | Phase 2 | Pending |
| PIPE-06 | Phase 2 | Pending |
| PIPE-07 | Phase 2 | Pending |
| PIPE-08 | Phase 2 | Pending |
| PIPE-09 | Phase 2 | Pending |
| PIPE-10 | Phase 2 | Pending |
| PIPE-11 | Phase 2 | Pending |
| QUE-01 | Phase 2 | Pending |
| QUE-02 | Phase 2 | Pending |
| QUE-03 | Phase 2 | Pending |
| DIG-01 | Phase 2 | Pending |
| DIG-02 | Phase 2 | Pending |
| DIG-03 | Phase 2 | Pending |
| DIG-04 | Phase 2 | Pending |
| DIG-05 | Phase 2 | Pending |
| DIG-06 | Phase 2 | Pending |
| DIG-07 | Phase 2 | Pending |
| DEL-01 | Phase 2 | Pending |
| DEL-02 | Phase 2 | Pending |
| DEL-03 | Phase 2 | Pending |
| DEL-04 | Phase 2 | Pending |
| CRON-01 | Phase 2 | Pending |
| CRON-02 | Phase 2 | Pending |
| CRON-03 | Phase 2 | Pending |
| OPS-01 | Phase 2 | Pending |
| OPS-02 | Phase 2 | Pending |
| OPS-03 | Phase 2 | Pending |
| OPS-04 | Phase 2 | Pending |
| QA-01 | Phase 2 | Pending |
| QA-02 | Phase 2 | Pending |
| QA-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 63 total
- Mapped to phases: 63
- Unmapped: 0

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 after roadmap creation*
