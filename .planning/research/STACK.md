# Stack Research

**Domain:** Telegram bot command handling + HTML web scraping (Node.js daemon, v4.0 milestone)
**Researched:** 2026-05-05
**Confidence:** HIGH (core choices), MEDIUM (cheerio version pinning)

## Context: What Is Already Locked In

These are NOT up for re-evaluation — they are the existing runtime and must be preserved:

| Technology | Version | Status |
|------------|---------|--------|
| Node.js | 20.6+ | locked — `--env-file` requirement |
| TypeScript via tsx | ^4.0.0 | locked — no build step |
| ESM + `moduleResolution: bundler` + `strict: true` | — | locked |
| `telegram` (GramJS) | ^2.22.0 | locked — user-session reading |
| `openai` | ^4.0.0 | locked — DeepSeek pipeline |
| `yaml` | ^2.5.0 | locked — config reading (being migrated from) |
| `node-cron` | ^3.0.3 | locked — scheduling daemon |
| `zod` | ^3.23.0 | locked — DeepSeek response validation |
| `vitest` | ^4.1.5 | locked — test runner |

---

## New Dependencies Required for v4.0

### Core Technologies (New Additions Only)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `cheerio` | ^1.0.0 | Parse HTML from scraped news sites, extract article text/title via CSS selectors | De-facto standard for static HTML scraping in Node.js (20M+ weekly downloads, dual CJS/ESM, TypeScript built-in, jQuery-like API, no browser overhead). News sites serving Russian oil/gas content are static HTML — Playwright/Puppeteer would be massive overkill. |
| (no new bot library) | — | Telegram Bot command handling | Existing `BOT_TOKEN` + native `fetch` is already used for `sendMessage` delivery. Extend the same pattern with a polling loop (`getUpdates`) rather than adding telegraf/grammy — saves a dependency and stays consistent with current architecture. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `write-file-atomic` | ^5.0.1 | Atomic JSON writes for `channels.json` CRUD | Use if the manual `.tmp + rename` pattern (already used in `archive.ts`) is not already abstracted — otherwise reuse the existing pattern. Skip if `fs.promises.writeFile` + `fs.promises.rename` already covers the pattern in the codebase. |

**Decision on `write-file-atomic`:** The project already does `.tmp + rename` for archives (see `archive.ts`). Extract that pattern into a shared `atomicWriteJson()` utility in `src/fs-utils.ts` — no new npm dependency needed. Confidence: HIGH.

---

## Telegram Bot Command Handling — Architecture Decision

**Recommendation: raw fetch polling loop, NO new bot framework.**

The project already uses `fetch` to call Bot API `sendMessage`. Extend this with a `startCommandListener()` function in a new `src/bot-commands.ts` module:

1. Long-poll `getUpdates` with `timeout=30` and `allowed_updates=["message"]`
2. Filter by `message.text` starting with `/`
3. Guard: check `message.from.id` is in `ALLOWED_USER_IDS` (env var, comma-separated)
4. Dispatch to handlers: `/channels`, `/add_channel <username>`, `/remove_channel <username>`
5. Respond via `sendMessage` to `message.chat.id`
6. Track `offset` (last `update_id + 1`) in memory — no persistence needed

**Why not Telegraf (^4.16.x) or grammY (^1.35.x):**
- Both are excellent frameworks for complex bots, but add ~200-800 KB of dependencies
- This bot needs exactly 3 commands with authorization — the polling loop is ~80 lines of TypeScript
- Telegraf requires webhook or polling setup that duplicates what `fetch` already does
- grammY is better for serverless/edge; irrelevant for a PM2 daemon
- Adding a framework means learning its session/middleware model for zero functional gain here

**Why not `node-telegram-bot-api` (^0.64.0):**
- No native TypeScript types (needs `@types/node-telegram-bot-api`)
- Marked as having maintenance issues; last major release 2021
- Adds dependency for functionality achievable in ~80 lines

**setMyCommands:** Call once on bot startup via `fetch` to register `/channels`, `/add_channel`, `/remove_channel` in the bot menu. No library needed — single POST to `setMyCommands`.

---

## Web Scraping — Architecture Decision

**Recommendation: native `fetch` (Node 20 built-in) + `cheerio` ^1.0.0.**

Static HTML pipeline:
1. `fetch(url)` with `User-Agent` header mimicking a browser (respect robots.txt, add 1s delay between sites)
2. `const $ = cheerio.load(await response.text())`
3. Extract: `$('article h1').text()`, `$('article p').text()`, `$('time').attr('datetime')`
4. Feed extracted `{title, text, url, date}` into the existing DeepSeek pipeline (same `classify` + `summarize` path)
5. Deliver as a second message block in the same channel (after the Telegram channels digest)

**Why cheerio over alternatives:**

| Option | Verdict |
|--------|---------|
| `cheerio` ^1.0.0 | USE — dual ESM/CJS, TypeScript included, jQuery selectors, 20M downloads/week, works with existing ESM project without config |
| `node-html-parser` ^6.x | SKIP — faster raw parse but no jQuery API; sites require CSS selector querying; less ecosystem |
| `playwright` / `puppeteer` | SKIP — heavyweight browser automation; overkill for static HTML news sites |
| `jsdom` | SKIP — full DOM simulation, 10x heavier than cheerio for this use case |
| `axios` | SKIP — native `fetch` in Node 20 covers the HTTP layer; one less dependency |

---

## JSON Storage (channels.json) — Architecture Decision

**Recommendation: `fs.promises` + manual `.tmp + rename`, zero new dependencies.**

The pattern is already established in the codebase (`archive.ts`). Extract to `src/fs-utils.ts`:

```typescript
// src/fs-utils.ts
import { writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = filePath + '.' + randomBytes(4).toString('hex') + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, filePath);
}
```

`channels.json` structure:
```json
{
  "channels": ["username1", "username2"],
  "updatedAt": "2026-05-05T20:00:00.000Z"
}
```

Migration from `channels.yaml`: one-time script `scripts/migrate-channels.ts` reads YAML, writes JSON, pipeline switches to reading JSON.

---

## Installation

```bash
# Only one new runtime dependency
npm install cheerio@^1.0.0
```

No other new npm installs needed. Bot command handling and JSON storage are implemented with Node.js built-ins and existing patterns.

---

## Alternatives Considered

| Recommended | Alternative | When Alternative Is Better |
|-------------|-------------|----------------------------|
| Raw `fetch` polling for bot commands | `telegraf` ^4.x | 10+ commands, scenes, wizard flows, session state, inline keyboards |
| Raw `fetch` polling for bot commands | `grammy` ^1.x | Serverless/edge deployment, plugin ecosystem needed |
| `cheerio` ^1.0.0 | `node-html-parser` ^6.x | Pure parsing speed matters more than selector ergonomics (rare) |
| `cheerio` ^1.0.0 | `playwright` | Target sites require JavaScript rendering (SPA/React) |
| `fs.promises` + rename | `write-file-atomic` | Multiple processes writing the same file concurrently (not our case) |
| Native `fetch` for HTTP | `axios` | Need interceptors, request cancellation, or auto-retries out of the box |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `telegraf` / `grammy` for this milestone | 3 commands don't justify a middleware framework; adds complexity with zero functional gain for this use case | Raw `fetch` polling loop, ~80 lines |
| `node-telegram-bot-api` | No built-in TypeScript types, maintenance concerns, adds dependency for something `fetch` handles | Raw `fetch` polling loop |
| `puppeteer` / `playwright` | Chromium binary adds 200+ MB to deploy; news sites we target are static HTML | `cheerio` + `fetch` |
| `axios` | Node 20 `fetch` is built-in and already used in `deliver.ts` | `fetch` (built-in) |
| `lowdb` / `nedb` / SQLite | Single JSON file with <100 records; a database is out of scope per PROJECT.md constraints | `fs.promises` + `atomicWriteJson()` |
| `write-file-atomic` npm package | Codebase already has the `.tmp + rename` pattern; avoid dependency duplication | Extract existing pattern to `src/fs-utils.ts` |

---

## Stack Patterns by Variant

**If a scraped news site requires JavaScript rendering (SPA):**
- Flag that URL as unsupported in v4.0 and log a warning
- Revisit with Playwright in v5.0 if the URL is high-value
- Do NOT add Playwright for v4.0 based on future-proofing speculation

**If the command list grows beyond 5-6 in a future milestone:**
- Re-evaluate `grammy` at that point — its plugin system and TypeScript inference are genuinely excellent
- For v4.0, the 3-command raw polling approach is the right call

**If multiple operators need authorization (future):**
- `ALLOWED_USER_IDS` env var (comma-separated chat IDs) covers 2 users (operator + Заказчик) without any framework change
- Multi-tenant would require a proper session store, out of scope per PROJECT.md

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `cheerio@^1.0.0` | Node.js 20.6+, ESM `"type": "module"` | Dual CJS/ESM since 1.0.0-rc.12; `import * as cheerio from 'cheerio'` works in ESM |
| `cheerio@^1.0.0` | TypeScript 5.x | Types bundled in package, no `@types/cheerio` needed |
| `cheerio@^1.0.0` | `tsx` ^4.0.0 | No issues — tsx handles ESM TypeScript natively |

---

## Sources

- [cheerio npm page](https://www.npmjs.com/package/cheerio) — version 1.1.2 confirmed current, ESM support, weekly downloads (HIGH confidence)
- [Cheerio official docs](https://cheerio.js.org/docs/intro/) — dual ESM/CJS confirmed, TypeScript built-in (HIGH confidence)
- [grammY comparison page](https://grammy.dev/resources/comparison) — framework comparison matrix (MEDIUM confidence — framework's own marketing)
- [Web Scraping with Node.js 2026 — DEV Community](https://dev.to/vhub_systems_ed5641f65d59/web-scraping-with-nodejs-in-2026-axios-cheerio-playwright-crawlee-4f4g) — current ecosystem state (MEDIUM confidence)
- [Telegram Bot API — setMyCommands](https://core.telegram.org/bots/api) — scope parameter for command registration (HIGH confidence — official)
- [write-file-atomic npm](https://www.npmjs.com/package/write-file-atomic) — atomic write pattern reference (HIGH confidence)
- [node-html-parser npm](https://www.npmjs.com/package/node-html-parser) — version 7.1.0 current, performance comparison (MEDIUM confidence)
- Existing codebase `src/deliver.ts`, `src/archive.ts` — confirmed patterns for `fetch` usage and `.tmp + rename` (HIGH confidence — direct inspection)

---

*Stack research for: tg-parser-demo v4.0 — Telegram bot command handling + web scraping module*
*Researched: 2026-05-05*
