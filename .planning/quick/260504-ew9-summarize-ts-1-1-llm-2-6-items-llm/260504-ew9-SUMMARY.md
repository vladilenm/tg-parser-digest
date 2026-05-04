---
phase: quick-260504-ew9
plan: "01"
subsystem: summarize
tags: [llm, two-pass, architecture, refactor]
dependency_graph:
  requires: [src/schema.ts, src/types.ts, src/logger.ts]
  provides: [classifyPosts, summarizeCategory, summarize]
  affects: [src/pipeline.ts]
tech_stack:
  added: []
  patterns:
    - "Two-pass LLM: 1 classify call + up to 6 parallel summarize calls via Promise.allSettled"
    - "Antifragile category buckets: failed bucket logged and skipped, never throws"
    - "Category injected by orchestrator after LLM response (LLM returns items without category field)"
key_files:
  created: []
  modified:
    - src/schema.ts
    - src/summarize.ts
decisions:
  - "Pass 1 uses a lean classification prompt (url+text only) to minimize token cost"
  - "Pass 2 uses extractive editor prompt per bucket — no item count limit"
  - "OpenAI client instance shared across all LLM calls for connection pooling"
  - "summarize() signature kept identical to v3.0 — pipeline.ts unchanged"
metrics:
  duration: "3 min"
  completed: "2026-05-04"
  tasks_completed: 3
  files_modified: 2
---

# Quick 260504-ew9: summarize.ts 1+1 LLM → 2–6 items/LLM Summary

**One-liner:** Refactored summarize.ts from single-pass to two-pass LLM architecture: 1 classify call assigns posts to 5 category buckets, then up to 6 parallel summarize calls produce all relevant items per bucket — no item count limit, antifragile via Promise.allSettled.

## What Was Built

### schema.ts — four new Zod schemas

- `ClassificationEntrySchema` — url + category (nullable) + mentions per post
- `ClassificationResponseSchema` — wraps array of entries (pass 1 LLM output)
- `CategoryItemSchema` — summary + keyQuote + url + channel + mentions (no category; injected by orchestrator)
- `CategoryItemsResponseSchema` — wraps array of items (pass 2 LLM output)
- Existing `DigestItemSchema` / `DigestJsonSchema` untouched

### summarize.ts — two-pass architecture

**Pass 1 — `classifyPosts(client, posts, model)`**
- Single LLM call with `CLASSIFY_SYSTEM_PROMPT`
- Input: `{posts: [{url, text}]}`
- Output: `{classifications: [{url, category, mentions}]}`
- On schema fail: retry once; double fail → throw (blocks the pipeline)
- Logs: post count, timing, bucket distribution

**Bucketing (orchestrator)**
- category != null → bucket by category (`bunker|oil|kerosene|petrochem|bitumen`)
- category == null AND mentions.length > 0 → `"mentions"` orphan bucket
- category == null AND mentions.length == 0 → silently dropped (irrelevant)

**Pass 2 — `summarizeCategory(client, category, posts, model)`**
- One LLM call per non-empty bucket via `Promise.allSettled` (max 6 concurrent)
- Input: `{category, posts: [{url, channelUsername, text}]}`
- Output: `{items: [{summary, keyQuote, url, channel, mentions}]}`
- On schema fail: retry once; double fail → `log.warn` + return `[]` (antifragile)
- Logs: post count per bucket, item count per bucket, timing per bucket

**Assembly (orchestrator)**
- Injects `category` field from bucket key into each item (`null` for mentions bucket)
- Builds `DigestJson` from assembled arrays

**Preserved unchanged:**
- `verifyExtractiveness` — Core Value keyQuote verbatim check
- `renderHtml`, `SECTION_HEADERS`, `MENTION_LABEL`, `renderItem`, `escapeHtml`, `formatDateRu`
- `summarize()` external signature — `pipeline.ts` needs no changes

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | f51c016 | feat(quick-260504-ew9): add ClassificationResponseSchema + CategoryItemsResponseSchema to schema.ts |
| 2 | cca3645 | feat(quick-260504-ew9): rewrite summarize.ts with two-pass LLM architecture |
| 3 | — | No files changed (smoke test only) |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced.

## Self-Check

### Files exist
- [x] src/schema.ts — modified, contains ClassificationResponseSchema + CategoryItemsResponseSchema
- [x] src/summarize.ts — rewritten with two-pass architecture

### Commits exist
- [x] f51c016 — schema.ts additions
- [x] cca3645 — summarize.ts rewrite

### Verification passed
- `npx tsc --noEmit` → zero errors
- All exports resolve at runtime (summarize, renderHtml, escapeHtml, ClassificationResponseSchema, CategoryItemsResponseSchema, DigestJsonSchema)

## Self-Check: PASSED
