# Feature Research

**Domain:** Telegram bot channel management + web scraping digest module
**Researched:** 2026-05-05
**Confidence:** HIGH (bot UX patterns verified against official Telegram docs; scraping stack verified against npm + official sources)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `/channels` — list all channels | Before adding/removing, operator must see current state | LOW | Returns paginated or truncated list if >50 entries; plain text or formatted table in one message |
| `/add_channel <username>` — add channel | Core write operation; single-argument command is the standard Telegram UX | LOW | Validate username format (alphanumeric + underscore, 5–32 chars); check duplicate before writing; confirm with "Added: @username" reply |
| `/remove_channel <username>` — remove channel | Core delete operation | LOW | Must confirm removal (see confirmation flow below); return "Not found" if username absent |
| Access control by Telegram user ID | Without auth, any user who finds the bot can modify the channel list | LOW | Allowlist of permitted `user_id` values stored in `.env` as comma-separated string: `ALLOWED_USER_IDS=123456,789012`. No DB needed. |
| Confirmation flow for `/remove_channel` | Destructive action; accidental removal disrupts next digest | MEDIUM | Inline keyboard with "Confirm" / "Cancel" callback buttons; 60s timeout; answer callback to dismiss keyboard regardless of choice |
| Persistent channel list in JSON | YAML was read-only by hand; JSON with atomic write (`tmp + rename`) enables programmatic CRUD | LOW | Migrate `channels.yaml` → `channels.json`; pipeline must switch `loadChannels` to read JSON; schema: `{channels: [{username, priority?, added_at?}]}` |
| Error reply when command fails | If write fails (disk error, validation error), bot must say so — silent failure breaks trust | LOW | `ctx.reply("Error: …")` with safe message; do not expose stack traces to end users |
| "Unknown command" fallback | Users try `/help` or typos — bot should not stay silent | LOW | Respond with the list of valid commands |

### Differentiators (Competitive Advantage)

Features that set this product apart for the specific single-operator/single-client use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dual-role access (operator + client) | Client (Заказчик) can self-service add/remove without contacting operator; reduces friction in day-to-day operation | LOW | Both operator and client Telegram IDs in `ALLOWED_USER_IDS`; no role distinction needed at v4.0 — same permissions for both |
| Web scraping digest as separate message | Web content arrives in the same delivery channel but as a distinct message, making it skimmable independently of the TG digest | MEDIUM | `sendToChannel()` already handles chunking; add `sendWebDigest(html)` calling same function with a distinct header like `<b>Веб-дайджест</b>` |
| `@mozilla/readability` + `jsdom` for article extraction | Extracts clean article text from HTML without requiring headless browser; works for news sites, ministry sites, industry portals that render server-side | MEDIUM | Pair with `fetch()` (Node 20 native); pass raw HTML through `new Readability(dom).parse()` → get `{title, textContent}`; feed `textContent` to DeepSeek same as TG post `text` |
| Reuse of existing DeepSeek classify pipeline | Web articles classified by the same 5-direction schema (bunker/oils/kerosene/petrochemistry/bitumen) + company mentions; zero new LLM prompt engineering | LOW | Normalize scraped article into `Post`-like objects with `{text, url, sourceLabel}`; pass to existing `summarize()` or a thin wrapper; avoids drift between TG and web classification |
| Separate web sites config list | Sites list stored in `websites.json` (or `websites.yaml`) analogous to `channels.json`; easy to extend without code changes | LOW | Structure: `{sites: [{url, label}]}`; `label` used as `channelUsername` equivalent in digest output |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Inline keyboard for /add_channel | "Better UX" — avoid typing usernames | Requires conversation state; user would need to type username anyway; adds session complexity with no gain over simple argument | Keep `/add_channel @username` as single-line command; it is standard Telegram bot UX |
| Role-based permissions (admin vs viewer) | Multi-stakeholder scenarios seem to need it | At v4.0 there are exactly 2 users (operator + client); role distinction adds YAML/JSON config complexity with zero practical benefit | Flat `ALLOWED_USER_IDS` allowlist; revisit only if a third user type emerges |
| Telegram Mini App for channel management | "Modern UX" — visual admin panel | Requires separate web hosting, HTTPS endpoint, JS frontend build; massively over-engineered for 2 users and <50 channels | Command-based interface is sufficient; decision backed by official Telegram docs noting Mini Apps suit complex admin scenarios only |
| Webhook mode for the management bot | Perceived as "more production-ready" | Requires public HTTPS endpoint + TLS cert management; existing daemon runs on VPS without exposed ports; long polling is correct for single-process PM2 daemon | Long polling via Telegraf `bot.launch()` coexists cleanly with `node-cron` in the same process |
| Headless browser (Puppeteer/Playwright) for scraping | Some sites load content dynamically | Adds ~150MB+ binary dependency, high memory, startup latency; contra-indicated by "no Docker, minimal deps" constraint | `fetch()` + `@mozilla/readability` + `jsdom` covers ~90% of static/SSR Russian industry/government news sites; flag JS-heavy sites as skipped with warning |
| Web scraping bot command (/add_site, /remove_site) | Symmetry with channel management | Sites list changes infrequently (monthly at most); bot command infra adds code surface; sites are operator-curated, not client-driven | Sites managed in `websites.json` by editing file + PM2 reload; add bot commands only if client explicitly requests self-service |
| Storing bot conversation state in Redis/DB | "Proper" state machine for confirmation flows | The only stateful interaction is a 60s remove confirmation; in-memory `Map<chatId, PendingConfirmation>` with TTL is sufficient for 2 users | In-memory state; lost on restart (benign: user just re-sends the command) |
| Per-channel priority sorting in the digest | Channels have `priority` field already | DeepSeek selects the 15 most newsworthy items itself; feeding priority metadata to LLM creates unpredictable prompt interaction | Keep `priority` field in JSON schema for future use; do not pass to LLM |

---

## Feature Dependencies

```
[channels.json CRUD]
    └──requires──> [channels.yaml → channels.json migration]
                       └──required by──> [pipeline loadChannels switch to JSON]

[/add_channel bot command]
    └──requires──> [channels.json CRUD]
    └──requires──> [access control (ALLOWED_USER_IDS)]

[/remove_channel bot command]
    └──requires──> [channels.json CRUD]
    └──requires──> [access control (ALLOWED_USER_IDS)]
    └──requires──> [inline confirmation flow (in-memory state)]

[/channels list command]
    └──requires──> [channels.json CRUD (read)]

[web scraping digest]
    └──requires──> [websites.json config]
    └──requires──> [fetch + readability text extraction]
    └──enhances──> [existing summarize() pipeline — reuse or thin wrapper]
    └──requires──> [sendToChannel() — already exists]

[Telegraf bot (long polling)]
    └──coexists with──> [node-cron daemon (20:00 MSK tick)]
    └──must not conflict──> [GramJS user session (different credential scope)]
```

### Dependency Notes

- **channels.json CRUD requires migration first:** `loadChannelsYaml` in `pipeline.ts` must be replaced with `loadChannelsJson` before any bot write operation; otherwise a bot add would write JSON while pipeline reads YAML, causing split-brain.
- **Bot requires access control before any command is live:** Connecting the bot without auth guard creates a window where any Telegram user can modify the channel list.
- **Web scraping requires websites.json before any scraper logic:** Pipeline integration must have a known input format; define schema first, then build fetcher.
- **Telegraf coexists with node-cron:** Both run in the same process. Telegraf `bot.launch()` starts long polling on a background async loop; `node-cron` fires the pipeline tick at 20:00 MSK. No port, no webhook, no clustering conflict. GramJS user session is separate from bot session — different credentials, no interference.

---

## MVP Definition

### Launch With (v4.0)

Minimum viable set that delivers the milestone goal: operator + client manage channels via bot, web digest delivered.

- [ ] **YAML → JSON migration** — prerequisite for all bot CRUD; pipeline reads from channels.json
- [ ] **Access control middleware** — `ALLOWED_USER_IDS` check before any command handler; reply "Access denied" to unauthorized users
- [ ] **`/channels`** — list current channels, truncate to 50 entries with count if over limit
- [ ] **`/add_channel <username>`** — validate, dedup-check, write to channels.json, confirm
- [ ] **`/remove_channel <username>`** — inline keyboard confirm/cancel, write on confirm, timeout handling
- [ ] **Telegraf bot launch integrated into daemon** — `bot.launch()` called alongside `node-cron` setup in `src/run.ts`; graceful stop on SIGINT/SIGTERM alongside existing shutdown logic
- [ ] **websites.json config** — static list of sites with `{url, label}` entries
- [ ] **Web scraper module** — `fetch()` + `@mozilla/readability` + `jsdom`; returns `{title, text, url, label}[]`; skips sites that fail with warning (non-blocking)
- [ ] **Web digest integration in pipeline** — scrape websites after TG fetch; pass articles through summarize (or wrapper); deliver as separate message in client channel

### Add After Validation (v4.x)

- [ ] **`/add_site` / `/remove_site` bot commands** — only if client requests self-service; sites currently change rarely enough to justify file-edit workflow
- [ ] **Priority field surfaced in `/channels` output** — show `priority` alongside username if set; useful for operator housekeeping
- [ ] **`/status` command** — show last run timestamp, channels count, sites count, last digest delivered; read from RunSummary log or a small status file

### Future Consideration (v5+)

- [ ] **Semantic dedup for web articles** — SHA-256 hash-cache covers exact reprints; embeddings needed only if same story appears on multiple sites with different wording
- [ ] **Official source verification** — Minenergo, SPIMEX, FAS scraping (v5.0 per contract Этап 2)
- [ ] **Bot commands for websites management** — if client grows to >5 sites they manage

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| YAML → JSON migration | HIGH (prerequisite) | LOW | P1 |
| Access control (ALLOWED_USER_IDS) | HIGH (security gate) | LOW | P1 |
| `/channels` list | HIGH | LOW | P1 |
| `/add_channel` | HIGH | LOW | P1 |
| `/remove_channel` + confirmation | HIGH | MEDIUM | P1 |
| Telegraf bot in daemon | HIGH | LOW | P1 |
| websites.json config | HIGH (prerequisite for scraping) | LOW | P1 |
| Web scraper (fetch + readability) | HIGH | MEDIUM | P1 |
| Web digest delivery (separate message) | HIGH | LOW | P1 |
| `/add_site` / `/remove_site` | MEDIUM | MEDIUM | P2 |
| `/status` command | MEDIUM | LOW | P2 |
| Priority field in `/channels` output | LOW | LOW | P3 |
| Semantic dedup for web articles | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v4.0 milestone
- P2: Should have, add when P1 is stable
- P3: Nice to have, defer to v5+

---

## Implementation Notes by Feature Area

### Bot Command UX Patterns (verified against Telegram official docs)

**Command argument convention:** Use positional argument — `/add_channel oil_capital` (without `@`), or accept `@oil_capital` and strip the `@`. Strip whitespace, lowercase. Max 32 chars.

**Confirmation flow for remove:** Standard pattern is: user sends `/remove_channel oil_capital` → bot replies with inline keyboard `[Confirm removal] [Cancel]` → user taps button → bot edits message to "Removed: @oil_capital" or "Cancelled" and answers callback query. In-memory `Map<userId, {username, expiresAt}>` as pending state. 60s TTL — if user doesn't respond, bot ignores stale callback.

**`/channels` list format:** Plain text response listing one channel per line:
```
Каналы (12):
1. @oil_capital
2. @oilfly
...
```
If >30 channels, truncate with "...и ещё N". Single message stays under 4096.

**Access control:** Middleware that checks `ctx.from?.id` against `ALLOWED_USER_IDS.split(',').map(Number)`. Applied globally before all command handlers. Unauthorized → `ctx.reply("Access denied.")` and return. No logging of denied attempts to client channel — alert to operator DM only if abuse pattern detected.

### Web Scraping Architecture (HIGH confidence)

**Extraction stack:** `fetch()` (native Node 20) + `jsdom` + `@mozilla/readability`. Pattern:
```typescript
const html = await fetch(url).then(r => r.text());
const dom = new JSDOM(html, { url });
const reader = new Readability(dom.window.document);
const article = reader.parse(); // { title, textContent, byline, ... }
```
`textContent` is fed to DeepSeek as the `text` field of a synthetic Post object.

**Failure handling:** Per-site try/catch; failed sites log warning and are skipped. Same pattern as per-channel errors in pipeline.ts. Web scraping errors must NOT block TG digest delivery.

**Ordering in pipeline:** Scrape websites AFTER TG channel fetch + dedup + LLM summarize + deliver. Web digest is supplementary; TG digest is primary. If web scraping fails entirely, pipeline still succeeds.

**New runtime dependencies needed:** `telegraf` (bot framework), `jsdom`, `@mozilla/readability`. Total runtime deps grows from 4 to 7. All ESM-compatible.

---

## Sources

- [Telegram Bot Features — Official Docs](https://core.telegram.org/bots/features) — command syntax, scope, inline keyboards
- [Telegram Bot API — Inline Keyboards](https://core.telegram.org/api/bots/buttons) — callback button confirmation patterns
- [Telegraf.js v4 TypeScript](https://telegraf.js.org/) — Node.js bot framework, ESM support, middleware pattern
- [grammY: Long Polling vs Webhooks](https://grammy.dev/guide/deployment-types) — polling + cron coexistence rationale
- [@mozilla/readability npm](https://www.npmjs.com/package/@mozilla/readability) — article extraction library
- [Readability.js for RAG — Phil Nash, 2025](https://philna.sh/blog/2025/01/09/html-content-retrieval-augmented-generation-readability-js/) — Node.js integration pattern with jsdom
- [WebcrawlerAPI: Extract article content with Readability.js](https://webcrawlerapi.com/blog/how-to-extract-article-or-blogpost-content-in-js-using-readabilityjs) — fetch + jsdom + readability code pattern

---
*Feature research for: Telegram bot channel management + web scraping digest (v4.0 milestone)*
*Researched: 2026-05-05*
