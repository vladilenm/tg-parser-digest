---
quick_id: 260508-juw
description: Add daily raw-posts cache for web-scraper to prevent info loss across same-day runs
date: 2026-05-08
commits:
  - a9852f4
  - bd51216
  - 4b25035
status: completed
---

# Quick 260508-juw — Daily raw-posts cache for web-pipeline

## Problem
Each web-pipeline run successfully scrapes only ~17–19 of 33 sources; the failing
set varies between runs, so information visible in one run disappears in the next.
The pre-existing `data/hash-cache.json` only dedups *delivered* keyQuotes — it does
nothing for *raw posts that were never scraped this run*.

## Solution
New module `src/web-posts-cache.ts` that persists every fresh scraped post to
`data/web-posts-${MSK-date}.json` (rotates by MSK day). On each run, `web-scraper`
loads the same-day cache, unions it with this run's fresh fetches by composite
key `sha256(url + "\n" + text)`, persists the union back to disk, then passes the
**merged set** (not just this run's fresh) to `summarize()`.

The downstream `hash-cache.json` (delivered keyQuotes, 14-day rolling) is
unchanged — it continues to filter already-shipped items, so the digest grows
incrementally over the day instead of repeating.

## Files
- `src/web-posts-cache.ts` (+184) — new module: `compositeHash`, `loadDailyWebPostsCache`, `mergeWebPostsByCompositeHash`, `saveDailyWebPostsCache`, `todayMsk`, `CachedWebPost`
- `src/__tests__/web-posts-cache.test.ts` (+283) — 16 unit tests
- `src/web-scraper.ts` (+33/-3) — merge hook between `writeRawWeb` and `summarize`; placeholder gate now also requires `mergedPosts.length === 0`

## Atomic commits
1. `a9852f4` test: failing tests for web-posts-cache module (RED)
2. `bd51216` feat: web-posts-cache module (GREEN)
3. `4b25035` feat: wire merge hook into web-scraper between writeRawWeb and summarize

## Verification
- 150/150 vitest suites green (16 new tests added)
- `npx tsc --noEmit` clean
- `git diff --stat fba1c5e..HEAD -- src/pipeline.ts src/summarize.ts src/dedup.ts` empty (TG-pipeline untouched, constraint satisfied)
- No new entries in `package.json` dependencies (only `node:crypto`/`node:fs`/`node:path`)

## Out of scope (deferred)
- Per-domain Pass2 (separate later iteration, user explicitly deferred)
- GC of stale `data/web-posts-*.json` files (user OK with accumulation in v1)
- Generalize `todayMsk()` into shared helper (currently 4 call sites; defer until 5th)
- Live-run smoke test via `npm run start:once:web` (requires operator's `.env` with TG + DeepSeek creds)
