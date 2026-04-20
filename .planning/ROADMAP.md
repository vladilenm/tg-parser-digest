# Roadmap: Oil & Gas Intelligence Monitor

## Overview

Two phases that follow SPEC §9 steps 1→12 sequentially. Phase 1 builds the data collection foundation — project scaffold, config, infrastructure, database schema, and the GramJS ingest listener — delivering raw messages into Postgres within 60 seconds. Phase 2 completes the full MVP: LLM gateway abstractions, the sequential processing pipeline (normalize → embed → classify → dedupe → summarize → persist), BullMQ workers, digest composition, Telegram delivery, cron scheduling, reliability hardening, and QA scripts. When Phase 2 completes, the service satisfies all six acceptance criteria from SPEC §12 and is ready for the pilot handoff.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Ingest** - Project scaffold, config validation, infrastructure, DB schema, GramJS session and ingest listener — messages land in DB within 60 seconds
- [ ] **Phase 2: Pipeline, Digest & Delivery** - LLM gateway, sequential processing pipeline, BullMQ workers, digest composition and delivery, cron scheduling, reliability, QA — full MVP acceptance criteria met

## Phase Details

### Phase 1: Foundation & Ingest
**Goal**: Raw Telegram messages land in the database within 60 seconds of publication and are queued for processing
**Depends on**: Nothing (first phase)
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, INF-01, INF-02, INF-03, INF-04, INF-05, SESS-01, SESS-02, ING-01, ING-02, ING-03, ING-04, ING-05, ING-06, DB-01, DB-02, DB-03, DB-04
**Success Criteria** (what must be TRUE):
  1. `pnpm dev` starts without errors when all env vars from `.env.example` are present; missing required vars cause a clear exit with code != 0
  2. `pnpm setup:db` creates the `vector` extension, applies Drizzle migrations, and the `messages`, `items`, `digests` tables exist with correct schema and HNSW index
  3. A message posted to a subscribed Telegram channel appears as a row in `messages` within 60 seconds, with `tg_channel_id`, `tg_message_id`, and `raw_text` populated
  4. Re-ingesting the same `(tg_channel_id, tg_message_id)` does not create a duplicate row (upsert is idempotent)
  5. `pnpm gen:session` interactively produces a GramJS StringSession string; an invalid session causes `pnpm dev` to exit with a clear error message
**Plans**: 3 plans

Plans:
- [ ] 01-01: Project init, package.json, TypeScript config, docker-compose (Postgres + Redis), env validation (zod), config loader (channels.yaml, keywords.yaml), logger (pino)
- [ ] 01-02: Drizzle schema (messages, items, digests tables), pgvector extension migration, HNSW index, `pnpm setup:db` script
- [ ] 01-03: GramJS StringSession generator (`pnpm gen:session`), ingest listener (NewMessage event, upsert to messages, push to BullMQ `process` queue, FloodWait backoff, debounce)
**UI hint**: no

### Phase 2: Pipeline, Digest & Delivery
**Goal**: Every ingested message is classified, deduplicated, and summarized; a digest grouping the day's relevant news by segment arrives in the private Telegram channel at 20:00 MSK every day
**Depends on**: Phase 1
**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04, LLM-05, LLM-06, PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, PIPE-09, PIPE-10, PIPE-11, QUE-01, QUE-02, QUE-03, DIG-01, DIG-02, DIG-03, DIG-04, DIG-05, DIG-06, DIG-07, DEL-01, DEL-02, DEL-03, DEL-04, CRON-01, CRON-02, CRON-03, OPS-01, OPS-02, OPS-03, OPS-04, QA-01, QA-02, QA-03
**Success Criteria** (what must be TRUE):
  1. A test message posted to a subscribed channel produces an `items` row within the BullMQ retry window, with `directions`, `companies`, `importance`, `summary`, and `keyQuote` all populated; `rawText.includes(keyQuote)` is true for 100% of the 20 randomly sampled items
  2. One news story posted to 3 different subscribed channels results in exactly one item cluster in the digest (dedupe via pgvector cosine similarity > 0.90 in 24h window)
  3. Direction classification reaches ≥85% accuracy and company tagging ≥90% accuracy on the 50-item golden dataset (`pnpm tsx scripts/evaluate-classify.ts` reports passing scores)
  4. The digest arrives in the private Telegram channel at 20:00 ± 1 minute MSK; messages longer than 4096 characters are split with `(1/N)` numbering; a second cron run on the same calendar day skips sending (idempotency)
  5. The service runs for 48 hours without manual intervention on the VPS: ingest continues, two consecutive digests are sent on schedule, graceful shutdown on SIGTERM drains in-flight jobs within 10 seconds
**Plans**: 3 plans

Plans:
- [ ] 02-01: LLMProvider and EmbeddingProvider interfaces, ClaudeProvider (with prompt caching), OpenAIEmbeddingProvider (with Redis cache, TTL 7d), structured logging for LLM calls (full in dev, metadata-only in prod)
- [ ] 02-02: Sequential pipeline (normalize → embed → classify → dedupe → summarize → persist) with zod validation + retry, early-exit on isRelevant=false, keyQuote verbatim check; BullMQ `process` worker (retry 3x, exponential backoff, DLQ logging)
- [ ] 02-03: Digest composition (24h window, cluster dedup, importance filter, direction grouping, 7-item limit), Handlebars template rendering, TelegramBotDeliverer (grammy, HTML parse mode, 4096-char split), Croner scheduling (Europe/Moscow, idempotency), graceful shutdown (SIGINT/SIGTERM), `send-test-digest.ts` script, golden dataset + evaluate-classify script, vitest suite (dedupe boundary, classify JSON, digest formatting)
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Ingest | 0/3 | Not started | - |
| 2. Pipeline, Digest & Delivery | 0/3 | Not started | - |
