# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Статус репозитория

На текущий момент в репозитории только [SPEC.md](SPEC.md) — полная спецификация MVP. Код ещё не реализован. При старте имплементации следуй пошаговому плану из раздела 9 SPEC.md (шаги 1→12), а не пиши всё сразу.

## Что это за проект

Oil & Gas Intelligence Monitor — внутренний пилот для B2B-заказчика (нефтегаз). Ежедневно в 20:00 MSK шлёт Telegram-дайджест отраслевых новостей по 5 направлениям (бункеровка, масла, керосин/авиа, нефтехимия, битум) в закрытый канал. Источник — ~10–15 публичных Telegram-каналов (MVP). Фокус — целевая компания (TARGET) и её прямые конкуренты.

## Высокоуровневая архитектура

Поток данных — однонаправленный конвейер через BullMQ:

```
GramJS (user-session) → BullMQ [process] → pipeline → Postgres+pgvector → Cron 20:00 → grammy bot → private channel
```

Ключевые архитектурные решения, которые должны соблюдаться:

- **Два разных Telegram-клиента:** GramJS (user-session, MTProto) для **чтения** публичных каналов; grammy (bot API) для **отправки** дайджеста. Бот не может читать публичные каналы — не пытайся это обойти.
- **Pipeline per message — строго последовательно:** normalize → embed → classify → dedupe → summarize → persist. Если `classify.isRelevant === false` или `directions.length === 0` — обработка обрывается до создания item.
- **Экстрактивная суммаризация.** Каждая фраза в `summary` должна быть проверяема по `rawText`. `keyQuote` — **точная подстрока** исходника; после summarize проверяется `rawText.includes(keyQuote)`, при провале — один retry с более жёстким промптом.
- **Dedupe через pgvector.** Cosine similarity `> 0.90` в окне 24ч → присвоить существующий `cluster_id`. Порог в конфиге (`DEDUPE_COSINE_THRESHOLD`), не хардкод.
- **Компоновка дайджеста:** items за 24ч (окно 20:00 вчера → 20:00 сегодня MSK), по одному на кластер (max importance), фильтр `importance >= 2 AND (mentions target/competitor OR isEvent)`, группировка по `directions` (item в двух направлениях — в обоих), лимит 7 на группу.
- **Idempotency дайджеста:** если запись в `digests` за сегодня уже есть — skip.

## Слои и абстракции

Три провайдер-интерфейса — обязательны с первого дня, чтобы позже заменить Claude/OpenAI на GigaChat/YandexGPT/локальный Qwen без правок бизнес-логики:

- `LLMProvider` ([src/llm/gateway.ts](src/llm/gateway.ts)) — `complete({ system, user, jsonSchema? })`
- `EmbeddingProvider` ([src/llm/embedding.gateway.ts](src/llm/embedding.gateway.ts)) — `embed`, `embedBatch`
- `Deliverer` — чтобы в будущем доставлять не только в TG

Вся модель данных (`messages`, `items`, `digests`) — в разделе 5 SPEC.md. pgvector extension создаётся миграцией **до** создания vector-колонок (`CREATE EXTENSION IF NOT EXISTS vector` в [scripts/setup-db.ts](scripts/setup-db.ts)).

## Команды

Полный список команд — в разделе 11 SPEC.md. Ключевые (package.json ещё не существует — создать на шаге 1):

```bash
docker compose up -d       # Postgres (pgvector/pgvector:pg16) + Redis
pnpm install
pnpm setup:db              # миграции + CREATE EXTENSION vector
pnpm gen:session           # одноразовая генерация GramJS StringSession → в .env как TG_SESSION
pnpm dev                   # запускает ingest + workers + cron параллельно
pnpm test                  # vitest
pnpm tsx scripts/send-test-digest.ts   # ручная отправка для отладки
```

Тестов ещё нет; запускать один тест — стандартно через `pnpm vitest <file>` или `pnpm vitest -t "<name>"`.

## Жёсткие требования (из раздела 15 SPEC.md)

Эти вещи нарушать **нельзя** — они либо отражают требования заказчика, либо блокирующие технические ограничения:

1. **Идти по шагам 1→12 из раздела 9.** После каждого шага — `pnpm dev` и ручная проверка. Не реализовывать всё одним заходом.
2. **Не вставлять реальные имена компаний в код.** Всё через env/config (`TARGET`, `competitor_a`, `competitor_b`). Имена заполнит пользователь в финальном конфиге.
3. **Dedupe-порог 0.90 — стартовое значение**, держать в конфиге, не хардкодить.
4. **Embeddings кешировать в Redis** по `hash(normalizedText)`, TTL 7 дней.
5. **Prompt caching на Claude system-промптах обязателен** — экономит ~90% на повторных вызовах.
6. **Dev-логи:** LLM-вызовы полностью (prompt + response). **Prod-логи:** только metadata.
7. **Parse mode для Telegram — HTML**, не MarkdownV2 (без крайней нужды — слишком много эскейпинга).
8. **Для чтения каналов — только GramJS user-session.** Бот публичные каналы не читает.
9. **Telegram-лимит сообщения 4096 символов** — при превышении бить на части `(1/N)`.
10. **Экстрактивность строго.** Никаких "творческих" обобщений в summary. Промпт запрещает выдумывать факты/числа/имена, отсутствующие в источнике verbatim.

## Критерии приёмки MVP (раздел 12 SPEC.md)

Имплементация считается корректной, если выполнены все 6 пунктов: ingest в течение 60с, accuracy классификации направлений ≥85% / компаний ≥90% (на 50 сэмплах), дедуп одной новости из 3+ каналов в одну запись, 100% verbatim keyQuote на 20 случайных items, дайджест в 20:00 ± 1 минута MSK, 48ч аптайма без вмешательства.

## Out of scope для MVP (раздел 14 SPEC.md)

Не реализовывать без явного запроса: все 50 каналов (берём 10–15), RSS/сайты Роснефти/Лукойла/Газпрома, конференции и СМИ, СНГ-источники, Bitsab, Next.js/Metabase dashboard, RAG-ассистент, мульти-аккаунтная ротация TG-сессий, on-prem/локальный LLM (абстракции готовы, реализация — позже).

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Oil & Gas Intelligence Monitor**

Внутренний пилот-сервис для B2B-заказчика из нефтегазового сектора. Каждый день в 20:00 MSK собирает публикации из ~10–15 отраслевых Telegram-каналов, классифицирует по 5 направлениям (бункеровка, масла, керосин/авиа, нефтехимия, битум), дедуплицирует и шлёт экстрактивный дайджест в закрытый Telegram-канал заказчика. Фокус — новости о целевой компании (TARGET) и её прямых конкурентах.

**Core Value:** Дайджест приходит в 20:00 ± 1 минута MSK с проверяемыми по оригиналу цитатами, без галлюцинаций и без дубликатов — если это работает, пилот принят.

### Constraints

- **Tech stack**: Node.js 20+, TypeScript 5, PostgreSQL 16 + pgvector, Redis, BullMQ, Drizzle ORM — зафиксировано в SPEC §3, менять без причины не надо
- **Timeline**: 1–2 недели на MVP до передачи пилота заказчику
- **LLM budget**: сознательно дёшево — Claude Haiku для classify, Sonnet только для summarize (где экстрактивность критична); prompt caching обязателен
- **Deployment**: VPS / cloud VM, docker compose или systemd, без Kubernetes
- **Telegram**: для чтения — только GramJS user-session (MTProto); для отправки — grammy bot API. Смешивать нельзя
- **LLM abstractions mandatory**: `LLMProvider` / `EmbeddingProvider` / `Deliverer` интерфейсы с первого дня — на prod-этапе будет замена Claude на GigaChat/YandexGPT/Qwen
- **Экстрактивность**: `keyQuote` — точная подстрока `rawText`; `rawText.includes(keyQuote)` обязательная проверка; retry при провале
- **Dedupe threshold 0.90**: стартовое значение, держать в конфиге (`DEDUPE_COSINE_THRESHOLD`), не хардкодить
- **TG message limit 4096 chars**: дайджест бьётся на части с нумерацией `(1/N)`
- **Security**: имена TARGET/конкурентов — только в env/config, никогда в коде
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Runtime & Language
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22.x LTS | Server runtime | Node.js 20 reaches EOL April 30, 2026. Node 22 is Active LTS through April 2027. For greenfield projects in April 2026, 22.x is mandatory. Node 24 is newer but 22 is battle-tested ecosystem-wide. **CRITICAL: Do NOT use Node 20 for new projects.** |
| TypeScript | 5.9 or 6.0 | Type safety | 5.9 is last traditional 5.x release. 6.0 shipped March 2026, mature for production. Recommend 5.9 for stability until migration validated; 6.0 if willing to validate config changes (strict, module, target defaults shifted). |
| pnpm | 8.0+ | Package manager | Faster, more reliable than npm. Monorepo-ready. Use `pnpm@latest` (v10.x available April 2026). |
### Telegram Integration
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `telegram` (GramJS) | 2.16.0+ | MTProto client for reading public channels | **Official:** `telegram` npm package from gram-js org. StringSession auth is stable & production-proven. GramJS remains the only way to read public channels—Bot API cannot. User-session (MTProto) is non-negotiable per CLAUDE.md. Current stable version is 2.16.x. |
| `grammy` | 1.28.0+ | Bot API wrapper for sending digests | **Official:** grammy.dev. Supports all parse modes including HTML (recommended over MarkdownV2 per CLAUDE.md). Latest v1.28+ is February 2026, fully stable. Parse mode: use `parse_mode: "HTML"` for simplicity (avoids MarkdownV2 escaping complexity). |
### Database & Persistence
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL | 16 | Primary database | Via `pgvector/pgvector:pg16` Docker image. pg16 is LTS, stable, widely used. pgvector extension creates vector column support. |
| pgvector | 0.5.0+ | Vector similarity for dedupe | Supports HNSW and IVFFlat indexes. **HNSW is recommended** (faster queries, slower build, more memory) over IVFFlat (slower queries, faster build, less memory). For 10–15 channels with ~100 items/day, HNSW is overkill but safer for scaling. Use cosine distance operator `<=>` (via `vector_cosine_ops` in Drizzle). Minimum cacheable threshold in config: `DEDUPE_COSINE_THRESHOLD=0.90`. |
| `drizzle-orm` | 0.36.0+ | ORM & migrations | **Official:** orm.drizzle.team. **Natively supports pgvector** via typed `vector()` column type with dimension parameter. Drizzle is lighter than Prisma, better for pgvector. Use `drizzle-kit` for migrations. CRITICAL: Create `CREATE EXTENSION IF NOT EXISTS vector` **before** vector column definitions (done in `scripts/setup-db.ts`). |
| `pg` | 8.11.0+ | PostgreSQL driver | Native driver for Drizzle. Standard, stable, widely trusted. |
### Job Queue & Cache
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| BullMQ | 5.71.0+ | Job queue with retry/backoff | v5 API is stable (February 2026). Supports concurrency config: for IO-bound work (LLM calls, embeddings), concurrency 50–100 is typical; adjust by observing production load. Retry: 3 attempts with exponential backoff (default: 1000ms base, 2x multiplier). DLQ support for permanent failures. |
| Redis | 7.0+ | Cache & queue backend | Via `redis:7-alpine` Docker image. ioredis handles connection pooling. **Critical config:** `maxRetriesPerRequest: null` (required for BullMQ blocking ops), `enableReadyCheck: false` (faster startup). Embedding cache: Redis TTL 7 days on hash(normalizedText) keys. |
| `ioredis` | 5.3.0+ | Redis client | Handles connection pooling, auth, retries. Works seamlessly with BullMQ. |
### LLM & Embedding
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@anthropic-ai/sdk` | 0.32.0+ | Claude API client | **Official:** platform.claude.com. **Current model IDs (April 2026):** `claude-haiku-4-5-20251001` (fastest, cheapest, 200k context), `claude-sonnet-4-6` (balanced, 1M context, fast). **Do NOT use Haiku for classify** (per analysis: Haiku is 200k context, suitable for < 10k token classify job). **Use Sonnet 4.6 for classify + summarize** (1M context, 3x cost of Haiku but better accuracy for RU text classification + extractive summarization). Prompt caching **MANDATORY**: system prompts are cached, reducing input cost 90% on repeats. Minimum cache block: 1024 tokens for Sonnet. **Pricing (April 2026):** Haiku $1/$5 (M tokens in/out), Sonnet $3/$15. |
| `openai` | 4.68.0+ | Embeddings only | **Model:** `text-embedding-3-small` (1536 dims, $0.02 per M tokens). Works well with Russian text per MIRACL benchmark. Batching supported: send multiple texts in single request (cost-effective). Cache in Redis per hash(normalizedText), TTL 7 days. Do NOT use for summarization—quality on Russian extractive summaries is poor vs. Claude Sonnet. |
### Validation & Configuration
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `zod` | 3.24.x (v3, stable) or 4.2.0+ (v4, new) | Schema validation for LLM outputs & config | **Breaking change alert:** Zod v4 (March 2026) has major breaking changes: string validators moved from methods to functions (`.email()` → `z.email()`), error params unified, default behavior in optionals changed. **Recommendation: Stick with Zod v3.24.x for MVP** (no breaking changes, works today). If upgrading to v4, expect refactoring work; codemods available but manual review required. Since this is MVP and time-constrained, v3 is safer. |
| `dotenv` | 16.4.0+ | Environment variable loading | Standard, lightweight, zero config. Loads .env on startup. |
| `yaml` | 2.4.0+ | YAML config parsing | For `config/channels.yaml` and `config/keywords.yaml`. Lightweight, standard library. |
### Logging
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `pino` | 10.3.0+ | Structured JSON logging | Super fast, natural JSON output. **ESM/CJS:** Pino 10.x supports both seamlessly. In dev, use `pino-pretty` for readability. In prod, ship JSON to observability platform (Grafana Loki, DataDog, etc.). Config: `LOG_LEVEL=debug` in dev, `info` in prod. |
| `pino-pretty` | 10.3.0+ | Pretty-print for development | Dev-only. Colorized, readable output. Don't use in prod (JSON is better for log aggregation). |
### Task Scheduling
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `croner` | 8.0.0+ | Timezone-aware cron jobs | Modern, TypeScript-native, handles DST edge cases correctly. For `DIGEST_CRON="0 20 * * *"` with `DIGEST_TIMEZONE=Europe/Moscow`, Croner handles timezone shifts properly. Alternative (`node-cron`) lacks DST awareness. Croner is production-proven 2026. |
### Testing
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `vitest` | 1.6.0+ | Unit & integration tests | Faster than Jest, Vite-native, ESM-first. Use `vitest --ui` for visual feedback. Mock Redis/Postgres via `@testcontainers/testcontainers` for integration tests (optional, but recommended). |
| `@testcontainers/testcontainers` | 10.0.0+ | Docker containers for test DB/Redis | Optional but recommended: spin up real Postgres + Redis in tests, tear down after. Catches migration & query bugs that mocks miss. |
### Build & Dev
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `tsx` | 4.7.0+ | TypeScript executor for scripts | Run `.ts` files directly without compile step. Used for `pnpm tsx scripts/gen-session.ts`, `pnpm tsx scripts/setup-db.ts`. |
| `docker-compose` | 2.27.0+ | Dev infrastructure | Spins up Postgres + Redis locally. Replaces Kubernetes complexity. Use `docker-compose up -d` to start, `docker-compose down` to clean. |
## Alternatives Considered
| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|-------------------|
| Node version | 22 LTS | Node 20 LTS | Node 20 EOL April 30, 2026. Security patches stop; unsafe for production new code. |
| Node version | 22 LTS | Node 24 (newest) | Node 24 is newer but less battle-tested in production ecosystems. 22 has wider third-party support (pnpm, native addons, cloud runtimes). Upgrade to 24 in 6 months. |
| ORM | Drizzle | Prisma | Prisma has pgvector support but less fine-grained control. Drizzle is lighter, better DX for vector operations. Prisma adds ~500ms startup (cold boot issue for serverless). |
| ORM | Drizzle | Raw `pg` client | Raw SQL is error-prone (no type safety on results, manual migrations). Drizzle provides typed queries + migrations without weight. |
| LLM (classify) | Sonnet 4.6 | Haiku 4.5 | Haiku is fast/cheap but may struggle with RU text classification accuracy. Start with Sonnet (safer), then A/B test Haiku on validation set. |
| LLM (summarize) | Sonnet 4.6 | Opus 4.7 | Sonnet is 10x cheaper, sufficient for extractive summarization. Opus adds no value for verbatim quote + 1–2 sentence summary. |
| Embeddings | text-embedding-3-small | OpenAI `ada` (deprecated) | ada is deprecated and slower. text-embedding-3-small is the new standard, better multilingual support. |
| Embeddings | text-embedding-3-small | Open source (e.g., Sentence Transformers) | Local embedding models (e.g., `all-MiniLM-L6-v2`, 384 dims) are cheaper but require GPU for inference. For MVP, cloud embedding is simpler operationally. Revisit for prod-scale (10M+ embeddings). |
| Cron | croner | node-cron | node-cron doesn't handle DST (daylight saving time) transitions properly. Croner does. For Europe/Moscow schedule, Croner is safer. |
| Cron | croner | node-schedule | node-schedule is older, less actively maintained. Croner is the modern choice. |
| Queue | BullMQ | Bull (legacy) | Bull is older, BullMQ v5 is the successor. Use BullMQ. |
| Queue | BullMQ | AWS SQS | BullMQ + Redis is simpler to run on VPS. SQS adds AWS account dependency, cost unpredictability at MVP scale. Use BullMQ first, migrate to SQS later if needed. |
| Logging | pino | winston | pino is faster (edge case at MVP scale, but better). Both are good; pino is trend. |
| Logging | pino | console.log + custom wrapper | No structure, no levels, hard to aggregate. Use pino. |
| Parse mode (TG) | HTML | MarkdownV2 | MarkdownV2 requires escaping 15+ special chars (`<`, `>`, `&`, `_`, etc.). HTML only requires `<`, `>`, `&`. 10x fewer escaping bugs. CLAUDE.md explicitly forbids MarkdownV2 without strong reason. |
| Validation | Zod v3 | Joi | Zod is more lightweight, TypeScript-first. Joi is heavier, more enterprise-focused. Both work; Zod is trend. |
| Validation | Zod v3 | io-ts | io-ts is powerful but steeper learning curve. Zod is simpler to reason about. |
## Installation & Quick Setup
# 1. Create project structure
# 2. Initialize pnpm (or use npm/yarn)
# 3. Install core dependencies
# 4. Install dev dependencies
# 5. Setup docker-compose (pull postgres:16 + redis:7-alpine)
# 6. Initialize database with pgvector extension
# 7. Generate Telegram session (one-time)
# → Copy TG_SESSION output to .env
# 8. Verify everything starts
## Critical Version-Specific Gotchas
### 1. **Node 20 EOL (April 30, 2026)**
### 2. **Drizzle ORM + pgvector migration order**
### 3. **BullMQ + ioredis connection pooling**
### 4. **Claude prompt caching minimum block size**
### 5. **OpenAI text-embedding-3-small batching**
### 6. **Croner timezone validation**
### 7. **Zod v3 vs v4 incompatibility**
### 8. **Pino + pino-pretty in production**
## Ecosystem Maturity & Risk Assessment
| Component | Maturity | Risk | Notes |
|-----------|----------|------|-------|
| Node 22 LTS | ✅ Stable (Apr 2026) | Low | Fully supported through Apr 2027. Ecosystem-wide adoption. |
| TypeScript 5.9 | ✅ Stable | Low | Used in thousands of prod systems. No breaking changes until v6. |
| GramJS / `telegram` | ✅ Stable | Low | MTProto is canonical for reading public channels. No viable alternatives. StringSession auth proven at scale. |
| grammy | ✅ Stable | Low | Modern bot API wrapper. Active development (Feb 2026 release). HTML parse mode is robust. |
| PostgreSQL 16 + pgvector | ✅ Stable | Low | pg16 is LTS. pgvector v0.5+ is production-ready (HNSW index handles 1M+ vectors). |
| Drizzle ORM 0.36+ | ✅ Stable | Low | pgvector support confirmed in official docs. Actively maintained. |
| BullMQ v5.71 | ✅ Stable | Low | Widely used for production queues (Stripe, Segment use BullMQ). v5 API stable since 2024. |
| Anthropic Claude Sonnet 4.6 | ✅ Stable | Low | Prod-proven since Dec 2024. Prompt caching works as documented. |
| OpenAI text-embedding-3-small | ✅ Stable | Low | Standard embedding model since Dec 2024. Multilingual support proven. |
| Croner | ✅ Stable | Low | Modern cron library, but smaller ecosystem than node-cron. Still 10K+ weekly npm downloads. |
| Zod v3 | ✅ Stable | Low | Used in production globally. No planned breaking changes until v5. |
| Pino 10.3 | ✅ Stable | Low | Industry-standard for structured logging. Active maintenance. |
## Recommendations Summary
### MVP Stack (Greenfield, April 2026)
### Why This Stack Wins
## Phases of Validation
### Phase 1 (MVP): Confirm Compatibility
- [ ] Node 22 binary download & test `node --version`
- [ ] pnpm install on empty `package.json` (verify no native addon issues)
- [ ] `docker-compose up -d` (Postgres pg16 + Redis) and test connection
- [ ] GramJS StringSession generation (requires real Telegram account)
- [ ] First Claude Haiku classify call (validate JSON output + cost)
- [ ] First embeddings call (OpenAI text-embedding-3-small)
### Phase 2 (Validation): Accuracy & Performance
- [ ] Classify accuracy on 50 hand-labeled samples (directions ≥85%, companies ≥90%)
- [ ] Embeddings quality check: cosine similarity of duplicates within 0.90–0.99 range
- [ ] LLM cost analysis: tally actual spend vs budget ($10/day limit)
- [ ] Ingest latency: GramJS lag from channel post → DB (target < 60s)
### Phase 3 (Production): Reliability
- [ ] Cron job fires at 20:00 MSK ± 1 minute for 7 consecutive days
- [ ] Graceful shutdown on SIGTERM (workers drain, connections close)
- [ ] Log aggregation pipeline (pino → observability tool)
- [ ] Backup/restore of vector embeddings (pgvector dump/restore test)
## Sources & Documentation
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)
- [Node.js 20 EOL Migration (April 2026)](https://dev.to/matheus_releaserun/nodejs-20-end-of-life-migration-playbook-for-april-30-2026-2onh)
- [Claude API Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [GramJS GitHub](https://github.com/gram-js/gramjs)
- [grammY Documentation](https://grammy.dev/)
- [Drizzle ORM Vector Similarity](https://orm.drizzle.team/docs/guides/vector-similarity-search)
- [BullMQ Concurrency Guide](https://docs.bullmq.io/guide/workers/concurrency)
- [pgvector GitHub & AWS Blog](https://github.com/pgvector/pgvector)
- [Croner npm](https://www.npmjs.com/package/croner/v/5.0.0)
- [Zod v4 Migration Guide](https://zod.dev/v4/changelog)
- [Pino Logging Guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/)
## What NOT to Use & Why
| Anti-Pattern | Why Avoid | Alternative |
|--------------|-----------|-------------|
| Node 20 for new projects | EOL April 30, 2026. No patch for post-EOL vulns. | Node 22 LTS (support through Apr 2027). |
| Bot API for reading public channels | Telegram Bot API has no read access to public channels. Hard limit. | GramJS user-session (MTProto). |
| MarkdownV2 parse mode in Telegram | 15+ special chars to escape. Bug-prone. | HTML parse mode (3 chars to escape: `<>& `). |
| Prisma for pgvector | Heavier startup, less pgvector control. | Drizzle ORM (lighter, more vector-aware). |
| Zod v4 without migration | Breaking changes in string validators, error params, optionals. | Stick with v3 for MVP (no breaking changes). Migrate post-launch if needed. |
| Local embeddings (e.g., Sentence Transformers) at MVP | Requires GPU/ML infrastructure, ops overhead. | OpenAI text-embedding-3-small (cloud API, managed). Revisit for prod-scale. |
| node-cron for Europe/Moscow schedule | Doesn't handle DST transitions correctly. | Croner (modern, DST-aware). |
| Raw `pg` client without ORM | Manual migrations, no type safety on results. | Drizzle ORM (typed queries, auto migrations). |
| Hardcoding dedupe threshold (0.90) | Config change requires code redeployment. | `DEDUPE_COSINE_THRESHOLD` env var (hot-swappable). |
| Logging to console (console.log) in production | Unstructured, unsearchable, breaks aggregation pipelines. | Pino JSON output → log aggregator (Grafana Loki, DataDog). |
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
