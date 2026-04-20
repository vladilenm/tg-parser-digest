# Architecture Patterns & Component Design

**Project:** Oil & Gas Intelligence Monitor MVP (1-VPS Deployment)  
**Researched:** 2026-04-20  
**Deployment Target:** Single VPS / cloud VM, docker-compose or systemd  
**Timeline:** 1–2 weeks sequential implementation (12-step build plan)

---

## Recommended Architecture

### High-Level Data Flow

```
Telegram Channels (public)
           │
           ▼
GramJS User-Session (MTProto read)
           │
           ▼
BullMQ [ingest] Queue (Redis)
           │
           ▼
┌─────────────────────────────────────────────┐
│ Sequential Pipeline (per message):          │
│  1. Normalize      (regex cleaning)         │
│  2. Embed          (OpenAI, Redis cache)    │
│  3. Classify       (Claude Haiku + cache)   │
│  4. Dedupe         (pgvector cosine sim)    │
│  5. Summarize      (Claude Sonnet, cached)  │
│  6. Persist        (PostgreSQL + pgvector)  │
└─────────────────────────────────────────────┘
           │
           ▼
PostgreSQL 16 + pgvector
  ├─ messages (raw ingest)
  ├─ items (pipeline output, vectors, clusters)
  └─ digests (composed, scheduled)
           │
           ▼
Cron 20:00 MSK (Europe/Moscow)
           │
           ▼
┌─────────────────────────────────────────────┐
│ Digest Composition:                         │
│  1. Select items (24h window: 20:00 → 20:00)
│  2. Cluster by direction, pick best/cluster│
│  3. Filter: importance ≥ 2 AND             │
│     (mentions target/competitor OR event)  │
│  4. Group by direction (7 items/group max) │
│  5. Render Handlebars template             │
│  6. Split if > 4096 chars (TG limit)       │
└─────────────────────────────────────────────┘
           │
           ▼
grammy Bot (Bot API, authenticated)
           │
           ▼
Private Telegram Channel (digest delivery)
```

### Process Topology (Single-Process Design for MVP)

The recommended topology for a 1-VPS deployment is **unified single process**:

```typescript
// src/index.ts (entry point)
async function main() {
  // 1. Initialize config, logger, DB, Redis
  await initializeInfra();
  
  // 2. Start GramJS ingest listener
  startTelegramIngest(); // Event-driven, emits to BullMQ [ingest]
  
  // 3. Start BullMQ process worker
  startProcessWorker();  // Consumes [ingest] → runs pipeline
  
  // 4. Start cron digest job
  startDigestCron();     // Croner instance, fires @ 20:00 MSK
  
  // 5. Graceful shutdown handlers
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

main().catch(panic);
```

**Why single process for MVP:**
- Simpler deployment (no service orchestration, no IPC)
- Easier debugging (single log stream, unified context)
- No race conditions between cron and workers
- Still horizontally scalable later (shard by channel_id)
- VPS constraints favor lightweight single-node setup

**For production scale-out:** Separate services into:
- `ingest-service` (GramJS subscriber → BullMQ producer)
- `process-service` (BullMQ worker, handles pipeline)
- `digest-service` (Cron + composition)
- `llm-gateway` (optional: shared LLM provider service)

---

## Component Boundaries & Responsibilities

### 1. Ingest Layer (`src/ingest/telegram-client.ts`)

**Input:** Telegram public channels (subscribed via user-session)  
**Output:** Raw messages → `messages` table → BullMQ [ingest] queue  
**Constraints:**
- Must use GramJS (user-session), never Bot API for reading
- Subscribes to channels listed in `config/channels.yaml`
- Handles Telegram FloodWait with exponential backoff
- Deduplicates messages at source: upsert `(tg_channel_id, tg_message_id)` on conflict → skip

**Key Invariants:**
- Messages arrive in BullMQ within 60 seconds of posting (per MVP acceptance criteria)
- Raw message persisted to DB before queue job created (ensures durability)
- No processing at ingest time — raw text only, minimal normalization
- Telegram message URL auto-constructed: `https://t.me/{username}/{msg_id}`

**Implementation Notes:**
- Event listener: `client.addEventHandler(onNewMessage, new NewMessage())`
- Backoff strategy: `min 1s, max 30s, exponential` on FloodWait
- Debounce: 500ms between Telegram API calls to avoid accidental limits
- Rate-limit accommodation: no hardcoded assumption of "X msgs/sec", reactive backoff only

**Communicates with:**
- Telegram (read-only)
- PostgreSQL (`messages` table insert/upsert)
- Redis BullMQ (`ingest` queue producer)
- Config (channels.yaml)

---

### 2. Pipeline Layer (Sequential Message Processing)

**Input:** Single message from `ingest` queue  
**Output:** Classified, deduplicated, summarized `item` record in DB  
**Constraint:** Strictly sequential per message — all stages must complete or early-exit atomically

#### 2.1 Normalize (`src/pipeline/normalize.ts`)

**Input:** `rawText` from message  
**Output:** `normalizedText` (ready for embedding/classify)

**Transformations:**
- Strip leading/trailing whitespace
- Remove advertisement footers (common in Telegram reposts)
- Collapse excessive blank lines (keep paragraph structure)
- Remove emoji sequences (optional: replace with text equivalent)
- Discard repost-only messages (forward with no caption)
- Truncate to reasonable length if extremely long (e.g., >5000 chars warning)

**Caching:** None (normalization is cheap, deterministic, stateless)

**Communicates with:** None (pure function)

#### 2.2 Embed (`src/pipeline/embed.ts`)

**Input:** `normalizedText`  
**Output:** `embedding: number[]` (1536 dims, OpenAI text-embedding-3-small)

**Cache Strategy (CRITICAL for cost):**
- Key: `embedding:sha256(normalizedText)` in Redis
- TTL: 7 days
- Hit rate expectation: 40–60% (many channels repost same news)
- Cost savings: ~90% reduction on embedding calls

**Provider Interface:**
```typescript
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

**Implementation:** `OpenAIEmbeddingProvider` wraps `@openai/sdk`  
**Error Handling:** Cache miss → API call → cache result → return; on API error → throw (retry in BullMQ)

**Communicates with:**
- Redis (cache check/set)
- OpenAI API (cache miss)

#### 2.3 Classify (`src/pipeline/classify.ts`)

**Input:** `normalizedText`, company aliases from config  
**Output:** Structured classification:
```typescript
{
  directions: string[];       // bunker, oil, kerosine, petrochem, bitumen
  companies: string[];        // target, competitor_a, competitor_b, other
  isEvent: boolean;
  importance: 1..5;
  isRelevant: boolean;
}
```

**Early Exit:** If `isRelevant === false` OR `directions.length === 0` → stop pipeline, do NOT create item record

**LLM Caching:** Prompt caching on system prompt (Claude API feature) — ~90% cost reduction on repeated invocations

**Provider Interface:**
```typescript
export interface LLMProvider {
  complete(params: {
    system: string;
    user: string;
    jsonSchema?: unknown;
  }): Promise<string>;
}
```

**Implementation:** `ClaudeProvider` wraps Anthropic SDK, uses `claude-haiku-4-5` for cost-efficiency

**Validation:** zod schema enforces response structure, retries once on JSON parse failure with stricter prompt

**Communicates with:**
- Claude API (Haiku model)
- Config (company aliases for prompt injection)

#### 2.4 Dedupe (`src/pipeline/dedupe.ts`)

**Input:** `embedding` (new item), lookback window 24 hours  
**Output:** Either new `cluster_id: uuid()` OR existing `cluster_id` from matched item

**Algorithm:**
```sql
SELECT id, cluster_id
FROM items
WHERE
  processed_at > now() - interval '24 hours'
  AND cosine_similarity(embedding, $1) > 0.90
ORDER BY cosine_similarity(embedding, $1) DESC
LIMIT 1;
```

**Index:** HNSW on `items.embedding` using `vector_cosine_ops` (pgvector native)  
**Threshold:** Configurable `DEDUPE_COSINE_THRESHOLD` (default 0.90), never hardcoded

**Idempotency:** Same message ingested twice → deduped at table level by `(tg_channel_id, tg_message_id)` unique constraint

**Cost Trade-off:** Cosine threshold tuned via config, can be adjusted post-MVP if too many false positives/negatives

**Communicates with:**
- PostgreSQL (vector similarity query, index scan)

#### 2.5 Summarize (`src/pipeline/summarize.ts`)

**Input:** `normalizedText` (only if item is NOT a duplicate cluster member)  
**Output:** `{ summary: string, keyQuote: string }`

**Key Invariants:**
- **Extractive only:** Every phrase in summary must be verbatim from source or deducible from source
- **keyQuote is exact substring:** After summarize, code MUST verify `rawText.includes(keyQuote)` — if false, retry with stricter prompt
- **No hallucination:** Prompts explicitly forbid inventing facts, numbers, or names
- **Character limit:** summary ≤ 250 chars

**LLM:** `claude-sonnet-4-5` (upgraded from Haiku — extractive summarization requires higher quality)

**Retry Logic:**
```typescript
const firstAttempt = await llm.complete(/* original prompt */);
if (!rawText.includes(result.keyQuote)) {
  const secondAttempt = await llm.complete(/* stricter prompt, no retry allowed */);
  if (!rawText.includes(secondAttempt.keyQuote)) {
    throw new SummarizeError('keyQuote not verbatim after retry');
  }
}
```

**Caching:** Prompt caching on system prompt (same as classify)

**Communicates with:**
- Claude API (Sonnet model)

#### 2.6 Persist (`src/pipeline/persist.ts`)

**Input:** All pipeline outputs  
**Output:** Single `items` table record, all fields populated

**Fields Persisted:**
```typescript
{
  id: uuid();
  messageId: uuid();                    // reference to messages
  directions: string[];
  companies: string[];
  isEvent: boolean;
  importance: 1..5;
  summary: string;
  keyQuote: string;                     // verified to be substring
  embedding: numeric[];                 // 1536 dims
  clusterId: uuid();                    // from dedupe stage
  processedAt: timestamp;               // now()
}
```

**Transaction:** Single INSERT (Drizzle handles txn boundaries, but for MVP no explicit txn needed if insert succeeds)

**Communicates with:**
- PostgreSQL (items table insert)

---

### 3. Digest Composition & Delivery (`src/digest/`)

**Trigger:** Cron at 20:00 MSK (Europe/Moscow timezone)  
**Input:** All items with `processedAt` in last 24 hours (20:00 yesterday → 20:00 today MSK)  
**Output:** Markdown formatted, delivered to private Telegram channel  
**Idempotency:** Query `digests` for today's date — if exists, skip

#### 3.1 Compose (`src/digest/compose.ts`)

**Algorithm:**
1. Query items: `processedAt > date - 24h AND processedAt <= date`
2. Cluster: Group by `cluster_id`, pick one item per cluster with max `importance`
3. Filter: Keep only if `importance >= 2` AND (`companies` contains target/competitor OR `isEvent === true`)
4. Group by direction: If item mentions 2+ directions, include in both groups
5. Sort: Within each direction, sort by `importance DESC, postedAt DESC`
6. Limit: Max 7 items per direction, add "and X more..." footer if truncated
7. Render: Handlebars template with all data

**Key Invariants:**
- Only one item per cluster (no duplicate news sources in digest)
- Companies (TARGET + competitors) given priority
- Events always included regardless of company mention
- Each direction section independent (item can appear in 2 sections if relevant to 2 directions)

**Communicates with:**
- PostgreSQL (items query)

#### 3.2 Template Rendering (`src/digest/template.ts`)

**Input:** Processed items grouped by direction  
**Output:** Markdown HTML (for `parse_mode: "HTML"` in Telegram)

**Template Engine:** Handlebars (config/digest-template.md)  
**Parse Mode:** HTML (not MarkdownV2 — simpler escaping)

**Variables Available:**
```
{{date}}           // YYYY-MM-DD
{{sections[]}}     // grouped by direction
  {{label}}        // direction label
  {{items[]}}      // array of items
    {{summary}}    // 1–2 sentences
    {{keyQuote}}   // exact quote (HTML-escaped)
    {{importance}} // 1..5 stars or numeral
    {{channelTitle}} // source channel name
    {{messageUrl}}   // t.me link
{{totalProcessed}} // all items in window
{{totalPublished}} // after filtering
{{totalDedupe}}    // deduplicated count
```

**HTML Escaping:** All user-provided strings (channelTitle, keyQuote, summary) must be HTML-escaped  
**Character Limit:** 4096 per Telegram message — if composite digest > 4096, split into `(1/N)` parts

**Communicates with:**
- Handlebars (template engine)

#### 3.3 Delivery (`src/delivery/telegram-bot.ts`)

**Input:** Markdown/HTML content, target channel ID  
**Output:** Telegram message(s)

**Client:** `grammy` (modern, chainable Bot API wrapper)

**Message Splitting:**
```typescript
if (content.length > 4096) {
  const parts = splitContent(content, 4096);
  for (const [i, part] of parts.entries()) {
    await bot.api.sendMessage(channelId, 
      `${part}\n\n(${i+1}/${parts.length})`,
      { parse_mode: 'HTML' }
    );
  }
} else {
  await bot.api.sendMessage(channelId, content, { parse_mode: 'HTML' });
}
```

**Recording:** Save `digests` record with `contentMd`, `itemIds`, `sentAt`, `tgMessageId`

**Error Handling:** If delivery fails, retry 3 times with exponential backoff; on permanent failure, alert but don't crash cron

**Communicates with:**
- Telegram Bot API (authenticated)
- PostgreSQL (`digests` table insert)

---

### 4. Infrastructure & Config

#### 4.1 Configuration Layer (`src/config/index.ts`)

**Sources (in order of precedence):**
1. Environment variables (secrets)
2. YAML files (channels, keywords)
3. Defaults

**Environment Variables (`.env`):**
```bash
# Telegram user-session (GramJS)
TG_API_ID                        # int
TG_API_HASH                      # string
TG_SESSION                       # StringSession (generated once)

# Telegram bot (grammy)
TG_BOT_TOKEN                     # string
TG_DIGEST_CHANNEL_ID             # int (negative for private: -100xxxxxxxxxx)

# LLM
ANTHROPIC_API_KEY                # string
ANTHROPIC_MODEL=claude-sonnet-4-5
OPENAI_API_KEY                   # string (embeddings only)
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Database
DATABASE_URL                      # postgresql://user:pass@host:5432/db
REDIS_URL                        # redis://host:6379

# Scheduling
DIGEST_CRON="0 20 * * *"         # 20:00 UTC (adjust for MSK in code)
DIGEST_TIMEZONE=Europe/Moscow

# Tuning
DEDUPE_COSINE_THRESHOLD=0.90     # configurable, never hardcoded
PROCESS_WORKER_CONCURRENCY=2     # BullMQ concurrency (1-VPS: 1-2)

# Logging
LOG_LEVEL=info                   # info, debug, warn, error
NODE_ENV=development             # or production
```

**YAML Files (`config/`):**

- `channels.yaml`: List of subscribed channels, priorities, toggles
- `keywords.yaml`: Direction keywords, company aliases (critical — replaces hardcoded names)
- `digest-template.md`: Handlebars template (can be overridden in deployment)

**Config Validation:** Zod schemas for all env vars and YAML structures

**Never Hardcoded:**
- Company names (only via config/env)
- Channel IDs (only via config/env)
- Dedupe threshold (only via env)
- Cron schedule (only via env)

#### 4.2 Database Layer (`src/db/`)

**ORM:** Drizzle + drizzle-kit (lightweight, native pgvector support)

**Migrations:** drizzle-kit generates from schema.ts, auto-applies on startup

**Schema Features:**
- `messages` table: Raw ingest, deduplicated at (channel_id, message_id) level
- `items` table: Pipeline output, clustered by cosine similarity
- `digests` table: Composed digests, one per calendar day
- HNSW index on `items.embedding` with `vector_cosine_ops` (pgvector native)

**Connection Pooling:**
- Pool size: 10 (sufficient for single-threaded event loop + occasional blocking queries)
- Idle timeout: 30s
- Query timeout: 5s (most queries should be < 1s)

**Important:** pgvector extension created in migration **before** vector columns:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**Communicates with:**
- PostgreSQL 16 (read/write)

#### 4.3 Queue Layer (`src/queue/bullmq.ts`)

**Queues:**
1. `ingest`: Raw messages from Telegram → ready for pipeline
2. `process`: Job payloads → execute pipeline
3. `digest`: (Optional — could use cron directly, but BullMQ gives durability)

**Queue Configuration:**
- Redis connection: from env `REDIS_URL`
- Retry: 3 attempts with exponential backoff (1s, 4s, 16s)
- DLQ: Separate queue for permanent failures (inspect before discarding)
- Job TTL: 7 days (standard)

**Worker Concurrency:**
- MVP: 1–2 (single VPS, avoid overload)
- Config: `PROCESS_WORKER_CONCURRENCY` env var

**Communicates with:**
- Redis (queue storage, locks, acknowledgments)

#### 4.4 Logging & Observability (`src/utils/logger.ts`)

**Logger:** Pino (structured JSON)

**Log Levels:**
- `debug`: LLM prompts + responses (dev only)
- `info`: Pipeline milestones, queue stats
- `warn`: Retries, skipped items
- `error`: Exceptions with stack

**Dev vs. Prod Modes:**
- **Dev:** Pretty-printed console, full LLM request/response, verbose pipeline traces
- **Prod:** JSON only, no credentials, metadata-only logging (no raw prompt/response)

**Structured Fields (always):**
- `timestamp`, `level`, `message`
- `component`: (e.g., "pipeline.classify", "ingest.telegram")
- `messageId`, `itemId`, `channelId` (when relevant)
- `durationMs` (for performance monitoring)

**Optional Metrics Endpoint:**
- Simple `/metrics` endpoint returning Prometheus format
- Counters: ingest_messages_total, processed_items_total, digests_sent_total
- Gauges: queue_depth, items_deduped_count
- Histograms: pipeline_duration_ms, llm_call_latency_ms

---

## Data-Flow Invariants

### Message Lifecycle Invariants

1. **Immutability:** Once a message is ingested (`messages` table), its `rawText` is immutable. Pipeline stages only add annotations (embedding, classification, summary).

2. **Early Exit:** If classification returns `isRelevant=false` OR `directions.length=0`, the message does NOT create an `items` record. It remains in `messages` for audit, but no digest impact.

3. **Dedupe is Idempotent:** Same message posted to 3 channels → deduped at `(tg_channel_id, tg_message_id)` at ingest, creating 1 message record but potentially 3 `items` records if processed separately. Dedupe stage groups them under 1 cluster_id → digest shows once.

4. **keyQuote Verification:** After summarization, code MUST check `rawText.includes(keyQuote)`. Failure → single retry. Persistent failure → log error, move to DLQ, do NOT use summary.

5. **Cluster ID Persistence:** Once an item is assigned a cluster_id (via dedupe), it never changes. Clustering is deterministic based on embedding + threshold.

6. **Digest Idempotency:** Only one `digests` record per calendar date. Second cron run of same day → query returns existing, skip delivery.

### Transaction Boundaries

**Level: Message (per item insertion)**
- Ingest → Persist is atomic from message creation to items insertion
- If pipeline fails mid-way, message exists but item does NOT (allows manual retry)

**Level: Digest (per date)**
- Compose → Render → Deliver is single transaction (no partial digests)
- If delivery fails, `digests` record NOT created (next cron retry)

### Timezone Assumption

- **Ingest timestamp:** `posted_at` from Telegram (UTC)
- **Digest window:** 24 hours in Europe/Moscow timezone (20:00 MSK today = 17:00 UTC)
- **Cron trigger:** Scheduled in Moscow time, converted to UTC for `croner` library
- **Logging:** All timestamps stored as UTC+timezone in PostgreSQL, rendered in UI per user

### Embedding Cache Invalidation

- **TTL:** 7 days in Redis
- **Key format:** `embedding:${hash(normalizedText)}`
- **Reuse:** Same text (even from different channels) hits cache
- **No invalidation needed:** Text is immutable, cache semantics are simple

### Rate Limiting & Backoff

**Telegram FloodWait:**
- If Telegram returns 429 + `seconds` header, wait exactly `seconds` before retry
- Exponential backoff only applies to other transient errors

**OpenAI Embeddings:**
- Rate limit: 5000 RPM (MVP usage way below)
- No batching required for MVP (typical 100–200 embeddings/day)

**Claude LLM:**
- Rate limit: 1000 RPM (well below)
- Prompt caching reduces repeated calls by 90%

---

## Build Order Implications

The 12-step build plan in SPEC §9 maps to natural deployment slices:

### Phase 1: Ingest + Persist (Steps 1–5)
**Deliverable:** Raw message ingestion + database schema

- Step 1: Project initialization
- Step 2: Config + logger
- Step 3: DB schema + migrations
- Step 4: GramJS session generation
- Step 5: Telegram ingest listener

**Testable:** Messages appear in `messages` table within 60s of posting  
**Demoable:** No LLM, no classifcation — just raw text collection  
**Phase 1 Slice Boundary:** Can deploy and validate ingest independently. If ingest is broken, pipeline impossible.

### Phase 2: Pipeline + Processing (Steps 6–8)
**Deliverable:** Full message → item pipeline with LLM classification + dedupe

- Step 6: LLM gateway (provider interfaces)
- Step 7: Pipeline stages (normalize → embed → classify → dedupe → summarize → persist)
- Step 8: BullMQ workers + retry logic

**Testable:** Feed raw messages, check items table for correct classification, embedding, summary  
**Demoable:** Send test message to subscribed channel, watch pipeline execute, verify item in DB  
**Phase 2 Slice Boundary:** Pipeline is now operational. Items are persisted with all annotations.

### Phase 3: Digest Scheduling + Delivery (Steps 9–12)
**Deliverable:** Daily digest composition, delivery, observability

- Step 9: Digest composition (query + filter + group)
- Step 10: Template rendering
- Step 11: Cron scheduling + delivery
- Step 12: Graceful shutdown + entry point

**Testable:** Manual trigger `pnpm tsx scripts/send-test-digest.ts`, verify digest sent to channel  
**Demoable:** Watch live cron job execute at 20:00 MSK  
**Phase 3 Slice Boundary:** System is production-ready for MVP acceptance criteria.

---

## Deployment Topology for Single VPS

### Docker Compose (Recommended for MVP)

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: monitor
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: monitor
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U monitor"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  monitor:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://monitor:${DB_PASSWORD}@postgres:5432/monitor
      - REDIS_URL=redis://redis:6379
      - TG_API_ID=${TG_API_ID}
      - TG_API_HASH=${TG_API_HASH}
      - TG_SESSION=${TG_SESSION}
      - TG_BOT_TOKEN=${TG_BOT_TOKEN}
      - TG_DIGEST_CHANNEL_ID=${TG_DIGEST_CHANNEL_ID}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  pgdata:
```

**Deployment Flow:**
```bash
docker-compose up -d
docker-compose exec monitor pnpm setup:db  # migrations + pgvector
# Monitor service runs ingest + workers + cron as single process
```

### Systemd Alternative (if Docker unavailable)

```ini
# /etc/systemd/system/monitor.service
[Unit]
Description=Oil & Gas Intelligence Monitor
After=network.target postgres.service redis-server.service

[Service]
Type=simple
User=monitor
WorkingDirectory=/opt/monitor
ExecStart=/usr/bin/pnpm dev
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=monitor

# Graceful shutdown
TimeoutStopSec=30
KillMode=mixed
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
```

**Deployment Flow:**
```bash
systemctl enable monitor
systemctl start monitor
journalctl -u monitor -f
```

### Graceful Shutdown

Both deployments must handle SIGINT/SIGTERM:

```typescript
async function gracefulShutdown(signal: string) {
  logger.info(`Shutdown signal received: ${signal}`);
  
  // 1. Stop accepting new jobs
  stopIngest();
  digestCron.stop();
  
  // 2. Wait for in-flight jobs (with timeout)
  await processWorker.close({ timeout: 10000 });
  
  // 3. Close connections
  await db.close();
  await redis.disconnect();
  
  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
```

**Expected shutdown time:** 5–10 seconds (depends on in-flight job count)

---

## Provider Abstractions (Mandatory)

All external service integrations must use typed provider interfaces for future replacement (production phase) without touching business logic.

### LLMProvider Interface

```typescript
// src/llm/gateway.ts
export interface LLMProvider {
  complete(params: {
    system: string;
    user: string;
    jsonSchema?: ZodSchema;
    temperature?: number;
  }): Promise<string>;
}

// src/llm/claude.provider.ts
export class ClaudeProvider implements LLMProvider {
  async complete({ system, user, jsonSchema }: {
    system: string;
    user: string;
    jsonSchema?: ZodSchema;
  }): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: [{
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' }  // Prompt caching
      }],
      messages: [{
        role: 'user',
        content: user
      }],
      temperature: 0.2  // Low temperature for deterministic classify/summarize
    });
    
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    
    if (jsonSchema) {
      return jsonSchema.parse(JSON.parse(text));
    }
    return text;
  }
}
```

**Future Implementations (production phase):**
- `GigaChatProvider` (Russian LLM alternative)
- `YandexGPTProvider` (another Russian alternative)
- `LocalQwenProvider` (on-prem, huggingface)

### EmbeddingProvider Interface

```typescript
// src/llm/embedding.gateway.ts
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// src/llm/openai-embedding.provider.ts
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    // Check Redis cache first
    const cached = await this.cache.get(`embedding:${hash(text)}`);
    if (cached) return JSON.parse(cached);
    
    // API call
    const result = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536
    });
    
    const embedding = result.data[0].embedding;
    await this.cache.set(`embedding:${hash(text)}`, JSON.stringify(embedding), { EX: 604800 }); // 7 days
    return embedding;
  }
  
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Batch embedding for efficiency
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
```

### Deliverer Interface (Future-Proofing)

```typescript
// src/delivery/gateway.ts
export interface Deliverer {
  send(target: string, content: string, options?: unknown): Promise<{ messageId: string }>;
}

// src/delivery/telegram-bot.ts
export class TelegramDeliverer implements Deliverer {
  async send(channelId: string, content: string): Promise<{ messageId: string }> {
    // Split if needed
    // Send via grammy
    // Record in digests table
  }
}

// Future: EmailDeliverer, SlackDeliverer, etc.
```

---

## Scalability Considerations

| Concern | At 100 msgs/day | At 10K msgs/day | At 1M msgs/day |
|---------|-----------------|-----------------|----------------|
| **Ingest Rate** | ~1 msg/min, trivial | ~10 msgs/min, bursty | ~700 msgs/min, requires sharding |
| **Pipeline Processing** | 1 worker, 2–5 min latency | 2–4 workers, 1 min latency | Shard workers by channel_id |
| **Embedding Cache** | 50% hit rate, < 100 Redis ops/day | 60% hit rate, < 10K Redis ops/day | 70% hit rate, requires Redis cluster |
| **Vector Search** | HNSW index, sub-10ms dedupe query | HNSW index, sub-10ms dedupe query | HNSW index, may need partitioning |
| **Database Connections** | 10-pool sufficient | 20-pool recommended | Connection pool per shard, or PgBouncer |
| **Cron Digest** | 5s composition, instant delivery | 30s composition, split delivery | 5min+ composition, parallel digest sections |
| **Storage** | ~50 MB items + vectors | ~5 GB items + vectors | 500 GB, requires archival strategy |

**MVP Target:** 100–500 msgs/day (10–15 channels, 5–10 posts/channel/day)  
**Scale-Out Triggers:**
- Ingest lag > 60s → add ingest service replica (channel-aware sharding)
- Processing queue depth > 100 → add process worker replicas
- Digest composition > 30s → parallel compose per direction
- Disk > 80% capacity → implement item archival policy

---

## Error Handling & Resilience

### Pipeline Error Scenarios

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Telegram FloodWait | HTTP 429 + seconds header | Exponential backoff, wait exact duration |
| OpenAI embedding timeout | API call fails after 5s | BullMQ retry (3x), log for manual review |
| Claude classify returns invalid JSON | zod.parse throws | Retry once with stricter prompt, fail item if 2nd attempt invalid |
| keyQuote not verbatim | rawText.includes check fails | Retry summarize once; fail if still invalid |
| Dedupe query timeout | Postgres timeout | Log warning, assign new cluster_id (conservative), continue |
| Digest delivery fails | grammy API error | Retry 3x; on failure, alert but don't crash cron (next run retries) |
| Postgres connection lost | Pool error | Exponential backoff on reconnect, hold jobs in BullMQ |
| Redis connection lost | ioredis error | Queue becomes unavailable, pause ingest, alert operator |

### Observability

**Health Checks:**
- `GET /health` → check DB connectivity, Redis connectivity, return 200 if all OK
- `GET /metrics` → Prometheus format counter/gauge/histogram exports

**Alerting (suggested for production):**
- Ingest lag > 2 min
- Process queue depth > 500
- Redis memory > 80%
- Error rate > 5% of jobs
- Cron digest failed
- Any DLQ entries

---

## Configuration Surface (Deployment-Time)

The system is configured through three mechanisms:

1. **Environment Variables (secrets & tuning):**
   - All API keys, credentials
   - Database URL, Redis URL
   - Cron schedule, timezone
   - Dedupe threshold, worker concurrency
   - Log level, node env

2. **YAML Files (content, channel subscriptions):**
   - `config/channels.yaml` — which channels to monitor
   - `config/keywords.yaml` — direction keywords, company aliases
   - `config/digest-template.md` — digest format

3. **Database Schema (immutable post-deployment):**
   - Table definitions, index configuration
   - Created once via `pnpm setup:db`, never modified in code

**Recommended deployment flow:**
```bash
# 1. Prepare secrets in .env
cp .env.example .env
# Edit .env with real values

# 2. Prepare content config
# Edit config/channels.yaml, config/keywords.yaml

# 3. Deploy
docker-compose up -d
docker-compose exec monitor pnpm setup:db

# 4. Start monitor service
docker-compose exec monitor pnpm dev
```

---

## Summary

**Recommended Architecture for 1-VPS MVP:**

1. **Single unified Node.js process** (ingest listener + process worker + cron, all in one)
2. **Three strictly sequential pipeline stages** (normalize → classify/embed/dedupe → summarize, with early exits)
3. **Provider abstractions from day one** (LLMProvider, EmbeddingProvider, Deliverer) for future LLM swapping
4. **Docker Compose for dev/prod parity**, systemd fallback
5. **pgvector HNSW index** for sub-10ms deduplication
6. **Redis for embedding cache** (7-day TTL, 40–60% hit rate expected)
7. **Prompt caching** on Claude system prompts (~90% cost reduction)
8. **Graceful shutdown** with 10s timeout for in-flight jobs
9. **Configuration via env + YAML**, never hardcoded secrets or company names
10. **Structured JSON logging** (pino), full LLM traces in dev, metadata-only in prod

**Natural phase boundaries:**
- **Phase 1 (Steps 1–5):** Ingest + DB → raw messages collected
- **Phase 2 (Steps 6–8):** Pipeline + workers → items persisted with ML annotations
- **Phase 3 (Steps 9–12):** Digest + delivery → production-ready service

Each phase is independently testable and deployable, with clear invariants and component boundaries.
