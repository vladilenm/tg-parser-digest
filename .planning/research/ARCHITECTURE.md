# Architecture Research

**Domain:** Node.js daemon — Telegram bot command handling + web scraping module
**Researched:** 2026-05-05
**Confidence:** HIGH

## Standard Architecture

### System Overview (Current v3.0)

```
┌─────────────────────────────────────────────────────────────┐
│                      src/run.ts (daemon)                     │
│  node-cron "15 20 * * *" Europe/Moscow                       │
│  mutex isRunning, SIGINT/SIGTERM graceful shutdown           │
├────────────────────────┬────────────────────────────────────┤
│     tick() every 24h   │                                     │
│                        ▼                                     │
│             src/pipeline.ts (runPipeline)                    │
│   loadChannelsYaml → TG fetch → dedup → summarize → deliver │
├────────────────────────┴────────────────────────────────────┤
│  src/telegram.ts   src/summarize.ts   src/deliver.ts         │
│  (GramJS client)   (DeepSeek LLM)    (Bot API sendMessage)   │
├─────────────────────────────────────────────────────────────┤
│  src/dedup.ts   src/archive.ts   src/alert.ts  src/logger.ts │
├─────────────────────────────────────────────────────────────┤
│  channels.yaml (static)   data/   hash-cache.json            │
└─────────────────────────────────────────────────────────────┘
```

### System Overview (Target v4.0)

```
┌─────────────────────────────────────────────────────────────┐
│                      src/run.ts (daemon)                     │
│  node-cron "15 20 * * *" + bot command loop (concurrent)     │
│  mutex isRunning, SIGINT/SIGTERM graceful shutdown           │
│                                                              │
│  ┌──────────────────────┐  ┌────────────────────────────┐   │
│  │  cron tick() loop    │  │  startBotLoop() — NEW      │   │
│  │  (unchanged)         │  │  getUpdates long-poll       │   │
│  └──────────┬───────────┘  └─────────────┬──────────────┘   │
│             │                             │                  │
│             ▼                             ▼                  │
│    src/pipeline.ts              src/bot-handler.ts — NEW     │
│    (modified: JSON source)      /channels /add /remove       │
│             │                             │                  │
│             ▼                             ▼                  │
│    src/scraper.ts — NEW         src/channels-store.ts — NEW  │
│    fetch HTML → DeepSeek        JSON CRUD on channels.json   │
│    → deliver web digest                                       │
├─────────────────────────────────────────────────────────────┤
│  MODIFIED: src/pipeline.ts (reads channels.json not .yaml)   │
│  MODIFIED: src/run.ts (launches bot loop alongside cron)     │
├─────────────────────────────────────────────────────────────┤
│  channels.json — NEW (replaces channels.yaml)                │
│  websites.json — NEW (list of URLs to scrape)                │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### New Components

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| `src/bot-handler.ts` | Parse incoming Telegram updates, route commands (/channels, /add_channel, /remove_channel), enforce authorization allowlist | Stateless handler; no own HTTP server; called from bot loop in run.ts |
| `src/channels-store.ts` | CRUD for channels.json (read, add, remove, list); atomic write via .tmp+rename pattern (consistent with archive.ts) | Single source of truth for channel list |
| `src/scraper.ts` | Fetch HTML from website URLs, extract article text via cheerio, feed posts to existing summarize() pipeline, return web digest HTML | New runtime dep: cheerio |
| Bot loop in `src/run.ts` | Long-poll getUpdates (timeout=30s, allowed_updates=["message"]), advance offset, dispatch to bot-handler | Must live in same process as cron; single getUpdates caller enforced by architecture |

### Modified Components

| Component | Change | Reason |
|-----------|--------|--------|
| `src/pipeline.ts` | Replace `loadChannelsYaml()` with `loadChannels()` from channels-store | channels.json is the new source of truth |
| `src/run.ts` | Add `startBotLoop()` called once at daemon start; both bot loop and cron run concurrently via `Promise.race`-style non-blocking design | Bot commands must work 24/7, not just at cron tick |
| `src/types.ts` | Add `ChannelEntry` export (currently inline in pipeline.ts); add `WebPost` type for scraper | Shared types needed by multiple modules |

### Unchanged Components

| Component | Why Unchanged |
|-----------|---------------|
| `src/telegram.ts` | GramJS client used only for reading channels; bot commands use Bot API (different protocol) |
| `src/summarize.ts` | DeepSeek LLM call; scraper feeds same `Post[]` shape or similar, can reuse |
| `src/deliver.ts` | sendToChannel() unchanged; scraper digest delivered via same function |
| `src/alert.ts` | Error alerting unchanged |
| `src/dedup.ts` | Hash-cache dedup unchanged for TG pipeline; web scraper has no dedup requirement in v4.0 |
| `src/archive.ts` | Raw/output archiving unchanged |
| `src/logger.ts` | Unchanged |

## Recommended Project Structure (v4.0)

```
src/
├── run.ts               # MODIFIED: + startBotLoop() concurrent with cron
├── pipeline.ts          # MODIFIED: loadChannels() from channels-store
├── bot-handler.ts       # NEW: command routing + authorization
├── channels-store.ts    # NEW: channels.json CRUD
├── scraper.ts           # NEW: fetch HTML + cheerio extraction
├── telegram.ts          # unchanged: GramJS reader
├── summarize.ts         # unchanged: DeepSeek summarizer
├── deliver.ts           # unchanged: Bot API sendMessage
├── alert.ts             # unchanged
├── archive.ts           # unchanged
├── dedup.ts             # unchanged
├── logger.ts            # unchanged
├── schema.ts            # unchanged
└── types.ts             # MODIFIED: export ChannelEntry, add WebPost

channels.json            # NEW: replaces channels.yaml (CRUD target)
channels.yaml            # KEPT: migration source (can be deleted post-migration)
websites.json            # NEW: list of URLs to scrape
```

## Architectural Patterns

### Pattern 1: Single-Process Bot Loop (CRITICAL)

**What:** Bot getUpdates long polling runs in the same OS process as the cron daemon, as a non-blocking async loop.

**When to use:** Always — this is the only safe architecture for a single-token bot on a single-process daemon.

**Why:** Telegram Bot API returns 409 Conflict if two processes call getUpdates with the same token simultaneously. Since both the cron and the bot share BOT_TOKEN, they must be in the same process. Node.js single-threaded async event loop makes this natural: the bot loop `awaits` each getUpdates call (30s long-poll) without blocking the cron scheduler.

**Trade-offs:** Pro: no extra process, no coordination. Con: if run.ts crashes, both cron and bot go down together — already true today.

**Example:**
```typescript
// src/run.ts (addition)
async function startBotLoop(): Promise<void> {
  let offset = 0;
  log.info("[bot] command loop started");
  while (!shuttingDown) {
    try {
      const updates = await getUpdates(offset, 30); // 30s long-poll
      for (const upd of updates) {
        offset = upd.update_id + 1;
        await handleUpdate(upd);
      }
    } catch (err) {
      log.warn("[bot] getUpdates error, retrying", err);
      await sleep(5000);
    }
  }
}

// Called once at daemon start, fire-and-forget (not awaited)
void startBotLoop();
```

### Pattern 2: Atomic JSON Store for Channel CRUD

**What:** channels.json read/write uses the same `.tmp + rename` pattern already established in `archive.ts`.

**When to use:** Any file that is mutated at runtime while also being read by the cron pipeline.

**Why:** Node.js `fs.rename` on the same filesystem is atomic on POSIX. Prevents partial writes corrupting the channel list mid-pipeline-run. The mutex `isRunning` in run.ts means the pipeline never runs concurrently with itself, but bot commands can fire during idle (between 20:00 runs). Atomic write ensures pipeline reads a consistent file.

**Trade-offs:** No transactions, no rollback, but for a list of ~50 entries this is acceptable. File is small enough to re-read fully on each pipeline run.

**Example:**
```typescript
// src/channels-store.ts
export function saveChannels(channels: ChannelEntry[]): void {
  const tmp = CHANNELS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify({ channels }, null, 2), "utf8");
  renameSync(tmp, CHANNELS_PATH);
}
```

### Pattern 3: Authorization Allowlist via ENV

**What:** Bot commands are gated by a comma-separated list of numeric Telegram user IDs in `.env` (`BOT_ALLOWED_USER_IDS=123456789,987654321`).

**When to use:** One operator + one customer; no multi-tenancy; no user DB.

**Why:** The simplest correct approach for a two-person access model. User IDs are stable (unlike usernames), numeric (no parsing ambiguity), and easily configurable via environment variable without code changes.

**Trade-offs:** No per-command RBAC — both operator and customer see the same commands. Acceptable since v4.0 spec says both can add/remove channels.

**Example:**
```typescript
// src/bot-handler.ts
const allowed = new Set(
  (process.env.BOT_ALLOWED_USER_IDS ?? "").split(",").map(Number).filter(Boolean)
);

export function isAuthorized(userId: number): boolean {
  return allowed.has(userId);
}
```

### Pattern 4: Scraper as Independent Post Source

**What:** `src/scraper.ts` produces `Post[]` with a synthetic `channelUsername` (e.g. `"web:<hostname>"`), which is fed directly to the existing `summarize()` function.

**When to use:** When web content must be classified by the same 5-category DeepSeek pipeline used for Telegram posts.

**Why:** Reusing `summarize()` avoids duplicating the LLM prompt and Zod schema logic. The `Post` type is loose enough (`text: string`, `url: string`) to accommodate scraped articles. The web digest is sent as a separate message from the TG digest (per spec), so it calls `sendToChannel()` separately.

**Trade-offs:** Mixes two conceptually different sources in one type. If web articles need different LLM handling later, `WebPost` type may diverge. For v4.0, sharing the pipeline is the right call.

## Data Flow

### Cron Pipeline Flow (unchanged logic, modified data source)

```
node-cron 20:15 MSK
    ↓
tick() — check isRunning mutex
    ↓
runPipeline()
    ↓
channels-store.loadChannels()    ← reads channels.json (was channels.yaml)
    ↓
GramJS fetchLast24h (per channel)
    ↓
in-memory dedup → hash-cache dedup
    ↓
summarize(freshPosts) — DeepSeek
    ↓
sendToChannel(html) — Bot API
    ↓
archive raw + output + commit hash-cache
```

### Bot Command Flow (new)

```
Telegram user sends /channels (or /add_channel @foo or /remove_channel @foo)
    ↓
Bot API getUpdates (long-poll, offset-tracked)
    ↓
startBotLoop() in run.ts dispatches to handleUpdate()
    ↓
bot-handler.ts: parse command, check isAuthorized(userId)
    ↓ (authorized)
channels-store.ts: listChannels() / addChannel() / removeChannel()
    ↓
Atomic write to channels.json
    ↓
Bot API sendMessage(chatId, confirmation_text)
```

### Web Scraper Flow (new, runs inside pipeline tick)

```
runPipeline() — after TG digest delivered
    ↓
scraper.ts: loadWebsites() — reads websites.json
    ↓
for each URL: fetch HTML → cheerio extract article text
    ↓
Build Post[] with channelUsername="web:<hostname>"
    ↓
summarize(webPosts) — same DeepSeek call, same 5 categories
    ↓
sendToChannel(webHtml) — separate message from TG digest
    ↓
(no dedup, no archive for web in v4.0)
```

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Telegram Bot API (getUpdates) | HTTP fetch, long-poll timeout=30s, offset-tracked | Same BOT_TOKEN as deliver.ts; MUST be single-caller in same process |
| Telegram Bot API (sendMessage) | HTTP fetch — already in deliver.ts | No change |
| DeepSeek via openai SDK | Unchanged batch call in summarize.ts | Scraper feeds same Post[] shape |
| Target websites | HTTP fetch → cheerio parse | New dep: cheerio; no JS rendering; static HTML only |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| run.ts ↔ bot-handler.ts | Direct async function call from bot loop | bot-handler.ts is a stateless function module |
| bot-handler.ts ↔ channels-store.ts | Direct function calls | channels-store is the only writer of channels.json |
| pipeline.ts ↔ channels-store.ts | Direct function call: loadChannels() | Replaces inline loadChannelsYaml() |
| pipeline.ts ↔ scraper.ts | Direct function call: scrapeWebsites() returns Post[] | Called after TG digest, before pipeline return |
| scraper.ts ↔ summarize.ts | Calls summarize() with web Post[] | Reuses existing LLM summarizer |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (1 operator, 1 customer, 50 channels) | Single process, file-based JSON store, inline bot loop — correct |
| 200+ channels | channels.json flat file still fine; scraper concurrency controls needed |
| Multi-operator | Would require per-session GramJS clients and separate BOT_TOKEN; out of scope until v6+ |

## Anti-Patterns

### Anti-Pattern 1: Two-Process Bot Split

**What people do:** Run a separate Node.js process dedicated to bot command handling, sharing BOT_TOKEN with the daemon.

**Why it's wrong:** Telegram returns 409 Conflict when two getUpdates callers share a token. One process gets silently terminated. Leads to intermittent command failures that are hard to diagnose.

**Do this instead:** Run the bot loop inside run.ts as a concurrent async loop alongside the cron scheduler. Single process, single getUpdates caller.

### Anti-Pattern 2: Mutating channels.yaml in place

**What people do:** Continue using channels.yaml but add write logic, modifying it with string manipulation or re-serializing YAML.

**Why it's wrong:** YAML serialization loses comments and formatting; file corruption risk on concurrent read (pipeline) + write (bot command). The `yaml` dep adds write complexity.

**Do this instead:** Migrate to channels.json for the CRUD target. JSON is natively serializable, atomic-write-safe via .tmp+rename, and already the pattern in this codebase.

### Anti-Pattern 3: Calling getUpdates in bot-handler.ts (not run.ts)

**What people do:** Import and call getUpdates inside bot-handler.ts or a separate module that manages its own polling loop.

**Why it's wrong:** Hides lifecycle coupling from run.ts; shutdown handling (shuttingDown flag, SIGTERM wait) lives in run.ts and must control the bot loop too. Two polling loops could spin up if bot-handler.ts is imported multiple times.

**Do this instead:** Keep the polling loop in run.ts. bot-handler.ts is a pure handler function: `handleUpdate(update) → void`.

### Anti-Pattern 4: Puppeteer / Headless Browser for Scraping

**What people do:** Use Puppeteer or Playwright to scrape target news/industry sites.

**Why it's wrong:** Headless Chromium is a 150MB+ binary, incompatible with the project's lightweight single-runtime constraint. Most Russian oil/gas industry sites serve static HTML (news portals, agency releases); JS rendering is not needed.

**Do this instead:** `fetch()` (built-in Node 20.6+) + `cheerio` for HTML parsing. One new runtime dep, 100KB vs 150MB.

## Migration Plan: channels.yaml → channels.json

The migration is a one-time operation, not an architectural concern, but it must be sequenced correctly:

1. `channels-store.ts` includes `migrateFromYaml(yamlPath, jsonPath)` — reads YAML, writes JSON, logs.
2. `run.ts` calls migration at startup if `channels.json` does not exist (one-time auto-migration).
3. After first successful run, `channels.yaml` is retained as backup but no longer read by pipeline.
4. `loadChannelsYaml()` in pipeline.ts is replaced by `channels-store.loadChannels()`.

## Build Order (dependency-aware)

1. **`src/types.ts`** — export `ChannelEntry`, add `WebPost`. No deps. Unblocks everything.
2. **`src/channels-store.ts`** — CRUD for channels.json + YAML migration. Deps: `types.ts`, `fs`, `yaml`. Unblocks pipeline change and bot-handler.
3. **`src/pipeline.ts` (modify)** — replace `loadChannelsYaml()` with `channels-store.loadChannels()`. Unblocks scraper integration.
4. **`src/bot-handler.ts`** — command parsing, authorization, CRUD dispatch. Deps: `channels-store.ts`, `deliver.ts` (for reply sendMessage). Unblocks bot loop.
5. **`src/run.ts` (modify)** — add `startBotLoop()` with offset tracking, shutdown integration. Deps: `bot-handler.ts`.
6. **`src/scraper.ts`** — HTML fetch + cheerio parsing. Deps: `types.ts`, `cheerio`. Unblocks web digest.
7. **`src/pipeline.ts` (modify again)** — add `scrapeWebsites()` call after TG digest. Deps: `scraper.ts`, `summarize.ts`.
8. **`websites.json`** — initial list of web URLs to scrape.

Steps 1–5 (bot commands) and steps 1, 6–8 (web scraper) are largely independent after step 1. Bot commands (steps 2–5) should be built first as they are higher value and lower risk.

## Sources

- Telegram Bot API official docs (getUpdates): https://core.telegram.org/bots/api#getupdates
- Telegram Bot API 409 Conflict behavior: confirmed via community sources and Telegram FAQ
- Cheerio ESM/Node.js 20 compatibility: https://cheerio.js.org/ + https://www.npmjs.com/package/cheerio
- Authorization via user ID allowlist pattern: https://advancedweb.hu/how-to-implement-access-control-for-a-telegram-bot/
- fs.rename atomic write on POSIX: Node.js official docs (HIGH confidence, standard POSIX guarantee)

---
*Architecture research for: tg-parser-demo v4.0 — bot command handling + web scraping*
*Researched: 2026-05-05*
