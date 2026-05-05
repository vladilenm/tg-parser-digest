# Pitfalls Research

**Domain:** Node.js daemon — adding Telegram bot command handling + web scraping to existing GramJS pipeline
**Researched:** 2026-05-05
**Confidence:** HIGH (race conditions, bot polling conflicts) / MEDIUM (scraping reliability, YAML migration)

## Critical Pitfalls

### Pitfall 1: Race Condition — Bot Writes channels.json While Pipeline Reads It

**What goes wrong:**
The pipeline's `runPipeline()` reads `channels.json` at the start of each cron tick. If the bot receives `/add_channel` or `/remove_channel` at the exact same moment (20:00 MSK cron fires), the Node.js event loop interleaves: the pipeline reads a partial/stale view of the file, or the bot's write corrupts the file mid-read. Because `JSON.parse` on a partially written file throws a SyntaxError, the pipeline crashes entirely — no digest is delivered, no alert fires (if the alert module itself uses the errored channel list).

**Why it happens:**
Developers assume Node.js single-threaded = no race conditions. This is wrong for async I/O: `fs.readFile` + `fs.writeFile` are non-atomic at the OS level. A write in progress (bot) overlaps with a read in progress (pipeline) even inside one process. The existing codebase already uses the `isRunning` mutex for the pipeline guard, but it does NOT yet guard file I/O across bot handler and pipeline concurrently.

**How to avoid:**
Use a single in-process `Mutex` (from `async-mutex`, already a well-known Node.js package with TypeScript support, zero extra runtime deps concept) to wrap all `channels.json` reads AND writes. Alternatively, implement the already-proven pattern in this codebase: write to `.tmp` then `fs.rename` (atomic on Linux/macOS for same-filesystem moves). For reads, always `JSON.parse` inside a try/catch with fallback to a stale cached copy. The simplest safe pattern for this project's single-process single-operator scope:

```typescript
// channels-store.ts
import { Mutex } from 'async-mutex';
const mutex = new Mutex();

export async function readChannels(): Promise<Channel[]> {
  return mutex.runExclusive(async () => {
    const raw = await fs.readFile(CHANNELS_PATH, 'utf8');
    return JSON.parse(raw);
  });
}

export async function writeChannels(channels: Channel[]): Promise<void> {
  return mutex.runExclusive(async () => {
    const tmp = CHANNELS_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(channels, null, 2), 'utf8');
    await fs.rename(tmp, CHANNELS_PATH);
  });
}
```

**Warning signs:**
- SyntaxError in pipeline logs at ~20:00 with message like "Unexpected end of JSON input"
- Channel list silently contains fewer entries than expected after a /add_channel command
- `channels.json` file size is 0 bytes (truncated write)

**Phase to address:**
Channel CRUD phase — implement `channels-store.ts` with mutex as the very first task, before wiring any bot command or pipeline read. All subsequent code imports from this module only.

---

### Pitfall 2: Bot Polling 409 Conflict — Second Process or Stale Webhook

**What goes wrong:**
Telegram Bot API enforces "only one active getUpdates connection per token." If:
- PM2 restarts the daemon AND the old process hasn't fully died yet (kill_timeout race), OR
- A webhook was ever set on this BOT_TOKEN (even accidentally via curl) and never cleared, OR
- The developer runs `npm start` locally while the VPS daemon is live

Then Telegram returns `409 Conflict: terminated by other getUpdates request`. Polling silently fails. Bot never receives commands. No error surfaces to the operator because polling libraries often swallow 409 and keep retrying — the bot appears alive but processes nothing.

**Why it happens:**
This project already runs BOT_TOKEN for one-way message delivery (no polling). Adding command handling requires starting `getUpdates` polling on the same token. The transition from "send-only" to "send+receive" is the classic moment for leaving a stale state. PM2 `kill_timeout=180000` (3 min) means during restart there's a 3-minute window with both old and new process alive.

**How to avoid:**
1. Before starting polling, always call `deleteWebhook` on startup:
   ```typescript
   await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
   ```
2. Set `allowed_updates: ['message']` in `getUpdates` to scope what the bot fetches.
3. Use `bot.stop()` / proper cleanup in SIGINT/SIGTERM handlers so PM2 kills clean.
4. Consider grammY (lightweight, TypeScript-native) vs raw fetch polling — grammY handles the 409 gracefully by retrying with backoff and surfacing the error.
5. In PM2 `ecosystem.config.cjs`, do NOT use `cluster` mode — `fork` mode (already set) avoids dual-process polling.

**Warning signs:**
- Bot token sends messages fine but never responds to commands
- Logs show periodic 409 errors from the polling loop
- `pm2 logs` shows polling started but no commands processed

**Phase to address:**
Bot polling setup phase — add `deleteWebhook` call at daemon startup before any polling begins. Add bot lifecycle to the existing SIGINT/SIGTERM handler alongside `isRunning` guard.

---

### Pitfall 3: GramJS User Session Disruption From Bot Activity in Same Process

**What goes wrong:**
GramJS uses MTProto (Telegram's binary protocol) for the user session, while Bot API (used for sending + the new polling) uses a completely separate HTTP JSON API. They are architecturally independent protocols. However, both share the same Node.js event loop. If bot polling uses a library that crashes on unhandled promise rejection or calls `process.exit()` internally on error, it kills the GramJS user session mid-pipeline (during the nightly 20:00 run).

Additionally, GramJS's `TelegramClient` is created per-run and disconnected in `finally` — if bot polling emits flood errors or network errors as unhandled rejections during the pipeline window, the pipeline's `try/catch` won't catch them.

**Why it happens:**
Developers assume "same process, different libraries = isolated." In Node.js, unhandled rejections from any async code propagate to the global `unhandledRejection` event and can terminate the process. The existing daemon sets up a mutex for `isRunning` but has no error boundary around bot polling errors.

**How to avoid:**
- Add a global `process.on('unhandledRejection', ...)` handler that logs but does NOT re-throw (the alert-bot already handles this pattern for pipeline errors).
- Wrap bot polling startup in try/catch; if it fails, disable bot commands for the session but keep the pipeline running.
- Test: send a bot command at exactly 20:00 MSK and verify the pipeline still completes normally.
- Keep GramJS client creation inside `runPipeline()` as it already is — do not share it with bot code.

**Warning signs:**
- Pipeline fails exactly when a bot command is being processed
- `unhandledRejection` entries in PM2 logs correlating with command timestamps
- GramJS session throws "AUTH_KEY_INVALID" after bot restart

**Phase to address:**
Bot integration phase — add global unhandledRejection handler before wiring bot polling. Document the "no shared GramJS client" constraint explicitly in code comments.

---

### Pitfall 4: channels.yaml → channels.json Migration Breaks Running Daemon

**What goes wrong:**
The migration script runs, deletes (or renames) `channels.yaml`, and writes `channels.json`. If the daemon's cron fires at 20:00 MSK during this window — even for a few seconds — `readChannels()` finds no file (old YAML gone, new JSON not yet written) and crashes with "ENOENT: no such file or directory." Because the pipeline crashes before DeepSeek, no digest is delivered that night.

**Why it happens:**
Migrations are treated as "run once and forget" scripts. The timing overlap with a live cron daemon is not considered. The existing codebase uses `.tmp + rename` for hash-cache writes but this pattern isn't yet applied to the channels file itself.

**How to avoid:**
Migration must be three-step (expand/contract):
1. Write `channels.json` from `channels.yaml` content (both files exist).
2. Update the pipeline reader to try `channels.json` first, fall back to `channels.yaml` (deploy this code).
3. Only after the daemon has run at least once successfully with the new code — delete `channels.yaml`.

Never delete the source file in the same script that creates the destination. Add a validation step: `JSON.parse(fs.readFileSync('channels.json'))` must succeed before any cleanup.

**Warning signs:**
- ENOENT in pipeline logs at ~20:00 on migration day
- Empty channel list causing "No posts in window" false positive
- Pipeline completes in 0ms (no channels to process)

**Phase to address:**
Migration phase — implement expand/contract as a two-deploy strategy, not a single-step script.

---

### Pitfall 5: Web Scraping Fragility — Selectors Break Silently

**What goes wrong:**
A `cheerio`-based scraper uses CSS selectors like `.article-body p` or `#content .text` to extract article text. The news site redesigns its CMS layout (common for Russian energy news sites). The selector matches 0 elements. The scraper returns an empty string. DeepSeek receives empty content and either returns an empty digest section or hallucinates fill-in content. No error is thrown — everything appears to work, but the web news section of the digest is silently empty or garbage.

**Why it happens:**
HTML scraping has no schema contract. Unlike an API, there's no version or spec. Selectors are brittle by nature. Russian oil/gas news sites (Argus Media, Neftegaz.ru, Energy Today) redesign regularly without notice.

**How to avoid:**
- Never rely on a single CSS selector. Use a selector hierarchy: try primary, then fallback selectors, log which one succeeded.
- Validate minimum content length after extraction: if extracted text < 200 characters, treat as extraction failure and log a warning (do NOT pass to DeepSeek).
- Add a content-length check to the web scraping summary in `RunSummary`.
- Pass raw HTML to DeepSeek with a "extract article body" instruction as a last-resort fallback — this is more resilient than brittle selectors but costs more tokens.
- Keep a list of known-good selector patterns per domain in config (not hardcoded in the scraper).

**Warning signs:**
- Web news section of digest consistently empty
- `extractedLength: 0` in scraping logs
- DeepSeek response contains fabricated data about real companies (hallucination from empty context)

**Phase to address:**
Web scraping phase — build extraction with multi-level fallback selectors + minimum length validation from day one. Add scraping result to `RunSummary.webScrape[]` with `{ url, extracted: boolean, charCount: number }`.

---

### Pitfall 6: Bot Command Authorization — Open Bot Receives Commands From Anyone

**What goes wrong:**
The bot is started with polling. Its username is discoverable (anyone can search for it on Telegram). Without an allowlist check, any Telegram user can send `/add_channel`, `/remove_channel` to the bot and manipulate the channel list. At minimum, an attacker adds noise channels (e.g., spam or NSFW channels) to the digest. At worst, they remove all legitimate channels, resulting in an empty digest delivered to the client (Rosneft's ИП intermediary), breaking the contract.

**Why it happens:**
Developers add bot commands quickly for internal use and forget that Telegram bots are publicly addressable by default. There is no built-in Bot API mechanism to make a bot "private" — you must enforce access control in code.

**How to avoid:**
Hardcode an allowlist of `user_id` (numeric, not username — usernames can change) in `.env`:
```
ALLOWED_USER_IDS=123456789,987654321
```
Apply a guard middleware as the first handler in every command:
```typescript
function isAllowed(ctx: Context): boolean {
  const allowedIds = process.env.ALLOWED_USER_IDS!.split(',').map(Number);
  return allowedIds.includes(ctx.from?.id ?? -1);
}
bot.command('add_channel', async (ctx) => {
  if (!isAllowed(ctx)) { await ctx.reply('Not authorized.'); return; }
  // ...
});
```
Send an alert to the operator (via the existing alert-bot channel) whenever an unauthorized access attempt occurs — this is a free security signal.

**Warning signs:**
- Bot responds to users outside the expected operator/client set
- `channels.json` contains unfamiliar channel usernames
- Pipeline processes and delivers content from unexpected sources

**Phase to address:**
Bot command phase — implement allowlist middleware before any command logic. Never ship command handlers without this guard in place.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Read channels.json without mutex | Simpler code, no dependency | SyntaxError crash at 20:00 if bot writes simultaneously | Never — add mutex from day one |
| Hardcode CSS selectors per site | Fast to write | Breaks silently on site redesigns, no warning | Only for throwaway prototypes, not production |
| Skip deleteWebhook on startup | One less API call | Stale webhook causes 409 polling failure that's hard to diagnose | Never — it's a one-liner |
| Single ALLOWED_USER_IDS env var | No need for user DB | If operator changes, requires VPS env edit + PM2 restart | Acceptable at single-operator scale |
| Share bot polling errors globally | Simpler error propagation | Unhandled bot rejection kills GramJS pipeline | Never — add process.on('unhandledRejection') |
| Migrate YAML→JSON in single script step | Faster migration | ENOENT window during live daemon operation | Never — use expand/contract |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Bot API polling | Start polling without clearing webhook first | Call `deleteWebhook` at daemon startup unconditionally |
| Bot API polling | Run two processes with same BOT_TOKEN simultaneously (local + VPS) | Use PM2 `kill_timeout` and verify old process is dead before starting new |
| GramJS + Bot polling | Share GramJS TelegramClient between pipeline and bot code | Keep GramJS client creation inside `runPipeline()` only; bot uses raw fetch or grammY separately |
| channels.json reads | Call `JSON.parse(fs.readFileSync(...))` directly in pipeline | Import from `channels-store.ts` which wraps all I/O in a mutex |
| Cheerio extraction | Return empty string to DeepSeek when selectors fail | Validate `charCount >= 200` before passing to DeepSeek; log and skip on failure |
| Bot command access | Check `ctx.from?.username` for authorization | Check `ctx.from?.id` (numeric) — usernames are mutable, IDs are permanent |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Scraping all web sites sequentially with no delay | First few sites succeed, then HTTP 429/503 | Add `sleep(1000 + jitter)` between web requests, same pattern as TG channels | After 3-5 fast requests to same origin |
| Passing full raw HTML to DeepSeek as fallback | Token cost 10-50x normal; slow response; context window exceeded | Truncate HTML to first 8000 chars; strip script/style tags before sending | Any article > ~3000 words |
| Storing all scraped HTML in memory during pipeline | OOM on VPS with low RAM if scraping 20+ sites | Process sites one at a time, do not accumulate HTML arrays | At ~20+ sites with 100KB HTML each |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| No allowlist on bot commands | Any Telegram user can modify channel list | Hardcode `ALLOWED_USER_IDS` in .env; check `ctx.from.id` in middleware |
| Logging full `channels.json` content in pipeline output | Exposes internal channel list to anyone with VPS log access | Log only channel count and usernames, not full JSON payload |
| Using BOT_TOKEN in scraping requests as auth header | Token exposure in logs or error messages | Keep scraping HTTP requests token-free; BOT_TOKEN only for Telegram API calls |
| Trusting `/add_channel` input without validation | Invalid username crashes GramJS on next pipeline run | Validate: username must match `/^[a-zA-Z][a-zA-Z0-9_]{3,30}$/` before writing to channels.json |

## "Looks Done But Isn't" Checklist

- [ ] **Bot polling:** Polling appears to start — verify commands actually arrive by sending `/channels` and seeing a response. A started polling loop that swallows 409 looks identical to working polling.
- [ ] **channels.json migration:** Both YAML and JSON exist and pipeline uses JSON — verify by adding a test channel via bot command and checking it appears in digest output next run.
- [ ] **Race condition protection:** Mutex is imported in channels-store.ts — verify by checking that `readChannels()` and `writeChannels()` are the ONLY two functions that touch the file (grep for `channels.json` across codebase).
- [ ] **Authorization guard:** Bot responds to `/add_channel` — verify it REJECTS the command from a non-allowlisted user_id before shipping.
- [ ] **Scraping extraction:** Scraper returns text — verify `charCount > 0` in RunSummary.webScrape for each site, not just that the function returned without error.
- [ ] **Selector fallbacks:** Primary selector works today — verify behavior when selector returns 0 results by temporarily using a wrong selector in a local test.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| channels.json corrupted by race condition | LOW | Keep a backup: `cp channels.json channels.json.bak` after every write. Restore from `.bak` + restart PM2. |
| Bot stuck with 409 conflict | LOW | `curl https://api.telegram.org/bot<TOKEN>/deleteWebhook` then `pm2 restart tg-parser-demo` |
| YAML→JSON migration failed mid-run | LOW | channels.yaml still present (if expand/contract was followed). Revert pipeline to read YAML, fix JSON, retry migration. |
| Unauthorized user modified channels.json | MEDIUM | Review git history of channels.json (if committed) or backup. Restore known-good list. Revoke bot access by changing BOT_TOKEN. |
| Scraping selectors all broken after site redesign | MEDIUM | Add site to skip list in config immediately. Update selectors offline. The digest continues with Telegram-only content in the meantime. |
| GramJS session killed by bot unhandledRejection | HIGH | Requires manual `npm run login` to regenerate TG_SESSION on VPS. Prevention (global error handler) is far cheaper than recovery. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Race condition on channels.json | Channel CRUD phase (channels-store.ts first task) | Send bot command at exactly 20:00 MSK in staging; pipeline must complete |
| Bot polling 409 conflict | Bot polling setup (startup deleteWebhook) | Restart daemon twice rapidly; verify no 409 in logs |
| GramJS killed by bot rejection | Bot integration phase (global unhandledRejection) | Simulate bot error during mock pipeline run; verify pipeline completes |
| YAML→JSON migration ENOENT | Migration phase (expand/contract) | Deploy new reader code, run migration script, verify pipeline reads JSON |
| Scraping selector fragility | Web scraping phase (extraction with fallback + validation) | Deliberately break primary selector; verify warning logged, DeepSeek not called |
| Unauthorized bot access | Bot command phase (allowlist middleware first) | Send command from non-allowlisted account; verify rejection + alert |

## Sources

- [Node.js Race Conditions](https://nodejsdesignpatterns.com/blog/node-js-race-conditions/) — race condition mechanics in Node.js async I/O
- [async-mutex npm](https://www.npmjs.com/package/async-mutex) — in-process mutex for async workflows
- [write-file-atomic npm](https://www.npmjs.com/package/write-file-atomic) — atomic tmp+rename pattern
- [Telegram 409 Conflict fix](https://medium.com/@ratulkhan.jhenidah/telegram-polling-errors-and-resolution-4726d5eae895) — polling conflict resolution
- [Telegram bot access control](https://advancedweb.hu/how-to-implement-access-control-for-a-telegram-bot/) — user_id allowlist approach
- [Securing Telegram bot commands](https://phatdangx.medium.com/securing-your-telegram-bot-commands-4c0b740b8e81) — command authorization middleware
- [10 web scraping challenges 2025](https://dev.to/apify/10-web-scraping-challenges-solutions-in-2025-5bhd) — anti-bot, layout changes, silent failures
- [LLM web scraping effectiveness](https://dev.to/astro-official/effectiveness-of-traditional-and-llm-based-methods-for-web-scraping-dh6) — selector fragility vs LLM-based extraction
- [grammY deployment types](https://grammy.dev/guide/deployment-types) — polling vs webhook tradeoffs
- [GitHub issue: 409 conflict webhook→polling](https://github.com/openclaw/openclaw/issues/20506) — real-world stale webhook bug
- PROJECT.md — existing codebase constraints (isRunning mutex, GramJS per-run client, alert-bot pattern)

---
*Pitfalls research for: tg-parser-demo v4.0 — bot command handling + web scraping module*
*Researched: 2026-05-05*
