# Project Research Summary

**Project:** tg-parser-demo v4.0
**Domain:** Node.js daemon — Telegram bot command handling + web scraping digest module
**Researched:** 2026-05-05
**Confidence:** HIGH

## Executive Summary

This project extends an existing single-process Node.js daemon (GramJS + DeepSeek + Bot API) with two new capabilities: interactive Telegram bot commands for channel list management, and a web scraping pipeline that feeds Russian oil/gas news articles into the same DeepSeek summarization pipeline. The codebase constraints are tight and intentional — no database, no new heavy dependencies, single operator + single client, Node.js 20.6+ with `tsx`. The recommended approach for both new capabilities follows a minimal-new-code philosophy: one new npm dependency (`cheerio`), raw `fetch` long-polling for bot commands (no framework), and full reuse of the existing `summarize()` + `sendToChannel()` pipeline for web content.

The highest-risk element is concurrency: the bot command loop and the nightly cron pipeline share the same `channels.json` file in the same process. Without an in-process mutex wrapping all JSON reads and writes, a bot command arriving at 20:00 MSK (cron tick) causes a race condition that corrupts the channel list and drops the night's digest. This must be solved architecturally in `channels-store.ts` before any bot command or pipeline code is wired together. All other pitfalls are real but recoverable; this one silently breaks the core product value without triggering any alert.

The feature scope for v4.0 is well-defined and achievable: YAML-to-JSON migration (prerequisite), three bot commands with authorization guard, a `websites.json`-driven scraper using `fetch` + `cheerio`, and web digest delivery as a separate message. The bot command architecture avoids the 409 Conflict pitfall by keeping the `getUpdates` polling loop inside `run.ts` (single process, single caller) and calling `deleteWebhook` at startup. Web scraping must implement fallback selectors and minimum content-length validation from day one to avoid silent DeepSeek hallucination on empty inputs.

---

## Key Findings

### Recommended Stack

The existing locked stack (Node.js 20.6+, `tsx`, ESM, GramJS, `openai`, `zod`, `vitest`) remains entirely unchanged. The only new runtime dependency is `cheerio ^1.0.0` for HTML parsing — dual ESM/CJS, TypeScript bundled, jQuery selectors, 20M+ weekly downloads, no browser overhead. Everything else (bot commands, JSON storage) is implemented with Node.js built-ins and patterns already established in the codebase.

**Core technologies (existing, unchanged):**
- `telegram` (GramJS): MTProto user-session reading of public channels — locked
- `openai` SDK: DeepSeek API via OpenAI-compatible endpoint — locked
- `node-cron ^3.0.3`: 20:15 MSK scheduling in daemon — locked
- `zod ^3.23.0`: DeepSeek response validation — locked

**New dependencies for v4.0:**
- `cheerio ^1.0.0`: HTML parsing for web scraper — only new runtime dep; use `import * as cheerio from 'cheerio'` in ESM
- `telegraf` (bot framework): listed in FEATURES.md as the bot integration approach, but STACK.md recommends raw `fetch` polling instead — **decision: use raw fetch, no new framework**. This contradiction is resolved in favor of minimal deps.
- `jsdom` + `@mozilla/readability`: listed in FEATURES.md for article extraction as alternative to `cheerio`. STACK.md chose `cheerio` as the lighter option. **Decision: use `cheerio` for v4.0; readability pair considered for v4.x if selector fragility becomes a problem.**

### Expected Features

**Must have (table stakes — v4.0 P1):**
- YAML → JSON migration — prerequisite for all bot CRUD; pipeline reads `channels.json`
- Access control middleware — `ALLOWED_USER_IDS` env var checked before every command handler
- `/channels` — list current channels (up to 50 entries, count if over)
- `/add_channel <username>` — validate, dedup-check, write atomically, confirm
- `/remove_channel <username>` — inline keyboard confirm/cancel (60s timeout), atomic write on confirm
- Telegraf bot loop integrated into daemon — concurrent with `node-cron`, same process, not awaited
- `websites.json` config — static `{url, label}[]` for scraper input
- Web scraper module — `fetch()` + `cheerio`; fallback selectors; skip on failure; non-blocking
- Web digest delivery — separate `sendToChannel()` call after TG digest, same channel

**Should have (v4.x P2):**
- `/status` command — last run time, channel count, site count, last delivery timestamp
- `/add_site` / `/remove_site` — only if client requests self-service; sites currently file-edit only

**Defer (v5+):**
- Semantic dedup for web articles (SHA-256 covers exact reprints; embeddings only if needed)
- Official source scraping: Minenergo, SPIMEX, FAS (contract Этап 2)
- Role-based permissions (flat allowlist is correct for 2 users)
- Telegram Mini App or webhook mode (massively over-engineered for this use case)

### Architecture Approach

The v4.0 architecture adds three new modules to the existing single-process daemon without changing any existing module's external interface. `src/bot-handler.ts` is a pure stateless command router; `src/channels-store.ts` is the single source of truth for `channels.json` CRUD with in-process mutex; `src/scraper.ts` produces `Post[]`-shaped objects that flow through the existing `summarize()` → `sendToChannel()` pipeline. The bot loop lives in `run.ts` as a fire-and-forget async loop alongside the existing `node-cron` scheduler, sharing the `shuttingDown` flag for clean SIGTERM handling. The single critical architectural constraint is that `getUpdates` polling must have exactly one caller in exactly one process — enforced by the single-process design.

**Major components (new):**
1. `src/channels-store.ts` — mutex-protected CRUD for `channels.json`; atomic `.tmp+rename` writes; includes one-time YAML migration function
2. `src/bot-handler.ts` — stateless command parser + authorization guard; dispatches to `channels-store`; replies via `sendMessage`
3. `src/scraper.ts` — `fetch` HTML → `cheerio` extraction → `Post[]`; per-site try/catch; min-length validation; feeds `summarize()`
4. Bot loop in `src/run.ts` — `getUpdates` long-poll (timeout=30s, offset-tracked); dispatches to `bot-handler`; integrated with `shuttingDown`

**Modified components:**
- `src/pipeline.ts`: replace `loadChannelsYaml()` with `channels-store.loadChannels()`; add `scrapeWebsites()` call after TG digest
- `src/run.ts`: add `startBotLoop()` + `deleteWebhook` at startup
- `src/types.ts`: export `ChannelEntry`, add `WebPost`

**Build order (dependency-aware):**
1. `types.ts` — unblocks everything
2. `channels-store.ts` — unblocks pipeline + bot-handler
3. `pipeline.ts` (JSON reader) — unblocks scraper integration
4. `bot-handler.ts` — unblocks bot loop
5. `run.ts` (bot loop) — completes bot feature
6. `scraper.ts` — unblocks web digest
7. `pipeline.ts` (scraper integration) + `websites.json` — completes web feature

### Critical Pitfalls

1. **Race condition on `channels.json`** — Bot write overlaps pipeline read at 20:00 MSK → `SyntaxError: Unexpected end of JSON input`, no digest delivered. Prevention: implement `channels-store.ts` with an in-process `Mutex` (or `async-mutex`) wrapping ALL reads and writes. Do this before any other code touches the file.

2. **Bot polling 409 Conflict** — Stale webhook or dual-process restart causes `getUpdates` to silently fail; bot appears alive but processes no commands. Prevention: call `deleteWebhook` at daemon startup unconditionally; keep bot loop inside `run.ts` (single process, single caller); use `fork` mode in PM2 (already set).

3. **GramJS session killed by bot unhandledRejection** — Bot polling error propagates as unhandled rejection → GramJS session killed mid-pipeline → manual `npm run login` on VPS to recover. Prevention: add `process.on('unhandledRejection', ...)` handler that logs but does not rethrow; wrap bot loop in try/catch.

4. **YAML → JSON migration ENOENT window** — Single-step migration script deletes YAML before JSON is confirmed written; cron fires during this window → ENOENT crash, no digest. Prevention: use expand/contract — write JSON, deploy code that reads JSON-first with YAML fallback, verify one successful run, then delete YAML.

5. **Web scraping silent empty extraction** — CSS selector matches 0 elements after site redesign; empty string passed to DeepSeek → hallucinated content or empty section with no error raised. Prevention: multi-level fallback selectors + `charCount >= 200` validation before DeepSeek call; log extraction result to `RunSummary.webScrape[]`.

6. **Open bot without authorization guard** — Any Telegram user who finds the bot can add noise channels or remove all legitimate channels. Prevention: `ALLOWED_USER_IDS` env var checked by `isAuthorized(userId)` middleware before every command handler, no exceptions.

---

## Implications for Roadmap

Based on the dependency graph and pitfall-to-phase mapping from research, the following phase structure is recommended. Bot commands (phases 1–3) should be built before web scraping (phase 4) because they are higher-value, lower-risk, and share the `channels-store.ts` foundation that scraping also benefits from indirectly.

### Phase 1: YAML → JSON Migration and Channel Store Foundation

**Rationale:** Everything else depends on `channels.json` being the source of truth. The race condition pitfall makes `channels-store.ts` with mutex the very first deliverable — no other code should touch `channels.json` directly. Migration must use expand/contract (not single-step) to avoid ENOENT during live daemon operation.

**Delivers:** `channels-store.ts` with mutex-protected CRUD; one-time migration function; `channels.json` created from existing `channels.yaml`; `pipeline.ts` switched to reading JSON; `types.ts` updated with `ChannelEntry` export.

**Addresses:** YAML → JSON migration (FEATURES.md P1 prerequisite); `ChannelEntry` type export (ARCHITECTURE.md)

**Avoids:** Race condition pitfall (PITFALLS Pitfall 1); YAML migration ENOENT pitfall (PITFALLS Pitfall 4)

### Phase 2: Bot Command Handling — Authorization and `/channels` List

**Rationale:** Authorization guard must exist before any command is live (PITFALLS Pitfall 6). `/channels` is read-only and the simplest command — lowest risk, immediate operator value. Setting up the bot loop in `run.ts` with `deleteWebhook` on startup eliminates the 409 Conflict pitfall from day one.

**Delivers:** `startBotLoop()` in `run.ts` with `deleteWebhook` + offset tracking + `shuttingDown` integration; `bot-handler.ts` with `isAuthorized()` middleware; `/channels` list command; `setMyCommands` registration on startup.

**Uses:** Raw `fetch` polling (STACK.md decision); `ALLOWED_USER_IDS` env var (ARCHITECTURE.md Pattern 3)

**Avoids:** 409 Conflict pitfall (PITFALLS Pitfall 2); open bot access pitfall (PITFALLS Pitfall 6); GramJS session kill (PITFALLS Pitfall 3 — add `unhandledRejection` handler here)

### Phase 3: Bot Commands — Add/Remove Channel with Confirmation

**Rationale:** Write commands depend on the mutex-protected `channels-store.ts` (Phase 1) and the authorized bot loop (Phase 2). `/remove_channel` requires an inline keyboard confirmation flow with in-memory TTL state — the only stateful element in this milestone; build after read-only commands are verified working.

**Delivers:** `/add_channel <username>` with validation and dedup-check; `/remove_channel <username>` with inline keyboard confirm/cancel and 60s timeout; "unknown command" fallback; error replies.

**Uses:** `channels-store.ts` write operations; in-memory `Map<userId, PendingConfirmation>` for remove confirmation state

**Avoids:** Race condition on JSON write (channels-store mutex); unauthorized modification (allowlist guard from Phase 2)

### Phase 4: Web Scraping Digest

**Rationale:** Web scraping is independent of bot commands after `types.ts` and `pipeline.ts` changes from Phase 1. It adds a new external dependency (`cheerio`) and introduces a new failure mode (selector fragility). Should be built after bot commands are stable to keep risk isolated.

**Delivers:** `src/scraper.ts` with `fetch` + `cheerio` extraction; multi-level fallback selectors; `charCount >= 200` validation; `websites.json` initial config; `scrapeWebsites()` integrated into `pipeline.ts` after TG digest; web digest sent as separate `sendToChannel()` call; `RunSummary.webScrape[]` logging.

**Uses:** `cheerio ^1.0.0` (STACK.md — only new npm install); native `fetch` (Node 20 built-in); existing `summarize()` and `sendToChannel()` unchanged; `WebPost` type from `types.ts`

**Avoids:** Scraping silent empty extraction pitfall (PITFALLS Pitfall 5 — fallback selectors + length validation); Puppeteer overhead (STACK.md anti-pattern); blocking TG digest on scraping failure (non-blocking per-site try/catch)

### Phase Ordering Rationale

- Phase 1 must come first: `channels.json` is a shared resource written by bot commands and read by the pipeline. The mutex in `channels-store.ts` is a safety gate that must exist before any code path modifies the file.
- Phase 2 before Phase 3: authorization guard and bot loop infrastructure must be verified before write commands are added. A working `/channels` read command proves the polling loop and auth work end-to-end with zero mutation risk.
- Phase 4 last: web scraping is additive and independent. Its failure mode (scraping errors) must not jeopardize the working bot commands from phases 1–3. Isolating it to the final phase means a broken scraper never delays channel management delivery.
- The expand/contract migration in Phase 1 means Phase 2–4 can be deployed to a live daemon without a maintenance window.

### Research Flags

Phases with well-documented patterns (can skip `/gsd-research-phase`):
- **Phase 1 (YAML → JSON migration + channel store):** Standard POSIX atomic rename + in-process mutex — both are established Node.js patterns with clear implementation examples in ARCHITECTURE.md and PITFALLS.md.
- **Phase 2 (Bot loop setup):** Telegram `getUpdates` long-poll + `deleteWebhook` — fully documented in Bot API official docs; implementation example in ARCHITECTURE.md Pattern 1.
- **Phase 3 (Add/remove commands):** Inline keyboard confirmation — standard Telegram bot UX with examples in FEATURES.md implementation notes.

Phases that may benefit from targeted research during planning:
- **Phase 4 (Web scraping):** Specific CSS selector patterns for Russian oil/gas news sites (Neftegaz.ru, Argus Media, Energy Today) are not documented in research. Per-site selector discovery will be needed during implementation. Consider whether `@mozilla/readability` + `jsdom` would be more resilient than `cheerio` selectors for this specific domain — deferred to planning.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core stack is locked; `cheerio` choice verified against official docs and npm; raw `fetch` polling rationale is solid. Minor inconsistency between STACK.md (cheerio) and FEATURES.md (readability+jsdom) resolved in favor of STACK.md. |
| Features | HIGH | Bot UX patterns verified against official Telegram docs; feature priorities are clear; anti-features well-argued. |
| Architecture | HIGH | Dependency graph is explicit; build order is deterministic; component boundaries are clean. Single-process constraint is critical and well-understood. |
| Pitfalls | HIGH (concurrency/polling) / MEDIUM (scraping) | Race condition and 409 Conflict are well-sourced and specific to this codebase. Scraping fragility is general — site-specific selector reliability is unknown until implementation. |

**Overall confidence:** HIGH

### Gaps to Address

- **Site-specific CSS selectors:** Research identified the scraping framework and validation approach but did not enumerate selectors for target Russian oil/gas news sites (Neftegaz.ru, Argus Media, Energy Today, etc.). These must be discovered and tested during Phase 4 implementation. Fallback to `@mozilla/readability` should be evaluated if manual selectors prove too fragile.
- **`async-mutex` dependency decision:** PITFALLS.md recommends `async-mutex` for the channels-store mutex. STACK.md mentions no new dependencies except `cheerio`. If `async-mutex` is added, it is the second new runtime dep. Alternative: use a simple in-process promise-chain mutex (no extra dep) — evaluate during Phase 1 planning.
- **FEATURES.md / STACK.md bot framework inconsistency:** FEATURES.md assumes `telegraf` as the bot integration framework throughout its implementation notes; STACK.md explicitly recommends raw `fetch` polling. This is a notation inconsistency in the research, not a real ambiguity — the decision is raw `fetch` per STACK.md rationale (3 commands, no framework overhead). The roadmap should note this for the implementer.

---

## Sources

### Primary (HIGH confidence)
- Telegram Bot API official docs — `getUpdates`, `deleteWebhook`, inline keyboards, `setMyCommands`
- `cheerio` official docs + npm — ESM/CJS dual mode, TypeScript bundled, Node 20 compatibility
- Node.js official docs — `fs.rename` POSIX atomicity guarantee
- Existing codebase `src/deliver.ts`, `src/archive.ts` — confirmed `fetch` usage and `.tmp+rename` pattern

### Secondary (MEDIUM confidence)
- grammY comparison page — framework tradeoff analysis (framework's own marketing, but consistent with independent assessment)
- DEV Community: Web Scraping with Node.js 2026 — ecosystem state, `cheerio` vs alternatives
- advancedweb.hu: Telegram bot access control — `user_id` allowlist pattern
- Readability.js for RAG (Phil Nash, 2025) — `fetch` + `jsdom` + `@mozilla/readability` integration
- WebcrawlerAPI: Extract article content with Readability.js — code pattern example

### Tertiary (LOW confidence)
- LLM web scraping effectiveness (DEV.to) — general comparison of selector-based vs LLM-based extraction; not specific to Russian oil/gas sites
- 10 web scraping challenges 2025 (Apify) — general scraping pitfalls; site-specific behavior unknown

---
*Research completed: 2026-05-05*
*Ready for roadmap: yes*
