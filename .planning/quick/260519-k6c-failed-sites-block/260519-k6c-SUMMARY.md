---
phase: quick-260519-k6c
plan: "01"
subsystem: web-scraper
tags: [web-scraper, html, operator-transparency, vitest, tdd]
dependency_graph:
  requires: [src/summarize.ts (escapeHtml), src/deliver.ts (chunkHtml/sendToChannel)]
  provides: [buildFailedSitesBlock export in src/web-scraper.ts]
  affects: [runWebPipeline both delivery paths (placeholder + content)]
tech_stack:
  added: []
  patterns: [TDD red-green, escapeHtml for XSS prevention, reason length cap 120ch]
key_files:
  created: []
  modified:
    - src/web-scraper.ts
    - src/__tests__/web-scraper.test.ts
decisions:
  - "REASON_MAX_CHARS=120: caps error reason in HTML bullets to prevent overly long lines; truncates with ellipsis «…»"
  - "failedSites[] collected only for r.status === 'rejected' (not fulfilled-empty): preserves operator distinction between 'site down' vs 'site alive but no news'"
  - "Prefix \\n\\n built into block return value: callers simply concatenate, no external separator needed"
metrics:
  duration: "~2 minutes"
  completed: "2026-05-19"
  tasks_completed: 1
  tasks_pending_human: 1
  files_modified: 2
---

# Phase quick-260519-k6c Plan 01: Failed Sites Block Summary

**One-liner:** Exported `buildFailedSitesBlock` appends an `⚠️ Не удалось распарсить (N)` HTML block with escaped URLs and capped reasons to both web digest delivery paths.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement buildFailedSitesBlock + integrate into both delivery paths + vitest tests | 2b16c14 | src/web-scraper.ts, src/__tests__/web-scraper.test.ts |

## Task 2: Pending Human Verification

**Status:** pending-human-verify (checkpoint:human-verify — not blocking per executor constraints)

**What was built:**
- New exported helper `buildFailedSitesBlock(failedSites: Array<{url, reason}>)` in `src/web-scraper.ts`
- Integrated in placeholder path: `buildPlaceholderHtml(websites.length) + buildFailedSitesBlock(failedSites)`
- Integrated in content path: `composeWebDigest(html, ...) + buildFailedSitesBlock(failedSites)`
- 4 vitest unit tests (non-empty block, empty→"", HTML escape, reason length cap)

**How to verify (run manually):**

1. Run the web pipeline: `npm run start:once:web`
2. Open the private Telegram channel (`TG_CHANNEL_ID`).
3. Find the fresh web digest (header: `🌐 Веб-источники — {today}`).
4. Scroll to the very end. Expected:
   - If at least one site rejected (network/HTTP error) → block present:
     ```
     ⚠️ Не удалось распарсить (N)
     • https://... — <reason>
     • ...
     ```
     where N matches the count of `[web-scraper] ... fail:` warn-log entries.
   - If all sites responded successfully → block absent (no "Не удалось распарсить" at all).
   - Sites that fulfilled but returned 0 posts (RSS 0 fresh items / HTML <200ch) → NOT in the block.
5. Cross-check: `cat data/run-*.log | grep "web-scraper.*fail:"` — every fail URL must appear in the block, and vice versa.
6. If N is large (>20): verify message is either one chunk ≤4000ch or correctly split by `chunkHtml` (no torn HTML tags between bullet lines).
7. Archive check: `cat data/output/$(date +%Y-%m-%d)-web.md | tail -30` — block must match what was sent to channel.

**Approve signal:** Type "approved" if block displays correctly, or describe issues (format, escape, missing/extra sites, chunk breakage).

## Deviations from Plan

None — plan executed exactly as written (including the optional test case D, reason length cap at 120ch with `…` suffix).

## Decisions Made

1. `REASON_MAX_CHARS = 120` — caps error reason bullets at 120 characters with `…` suffix. Prevents pathologically long undici error strings (e.g. full TLS chain dumps) from breaking the digest layout.
2. `failedSites[]` collected only on `r.status === "rejected"`, not on `r.value.length === 0` (fulfilled-empty). Preserves the operator distinction between "site is down" (actionable: fix cert/DNS/selector) vs "site is alive but had no news today" (not actionable).
3. The `\n\n` prefix is embedded inside the block return value so both callers (placeholder path and content path) can simply concatenate — no external separator logic needed.

## Known Stubs

None.

## Threat Flags

None — `buildFailedSitesBlock` applies `escapeHtml` to both `url` and `reason` fields before rendering into HTML. No new network endpoints or auth paths introduced.

## Self-Check

Files exist:
- `src/web-scraper.ts` — modified (contains `export function buildFailedSitesBlock`)
- `src/__tests__/web-scraper.test.ts` — modified (contains `describe("buildFailedSitesBlock"`)

Commits exist:
- `2b16c14` — feat(quick-260519-k6c): add buildFailedSitesBlock + integrate into both delivery paths

Tests: 186/186 pass (`npm test -- web-scraper`)
TypeScript: `npx tsc --noEmit` clean

## Self-Check: PASSED
