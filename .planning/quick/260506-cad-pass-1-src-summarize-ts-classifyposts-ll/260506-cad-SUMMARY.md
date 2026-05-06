---
phase: 260506-cad
plan: 01
subsystem: summarize
tags: [pass1, chunking, deepseek, timeout-fix, antifragile]
dependency-graph:
  requires:
    - src/summarize.ts (existing classifyPosts, summarizeCategory, ClassificationResponseSchema)
    - process.env.CLASSIFY_CHUNK_SIZE (new env var)
  provides:
    - chunkArray<T>(arr, size): T[][] (exported pure helper)
    - classifyPosts with parallel chunking via Promise.allSettled
  affects:
    - src/__tests__/summarize.test.ts (new chunkArray test suite)
    - .env.example (CLASSIFY_CHUNK_SIZE=40 documented)
    - README.md (CLASSIFY_CHUNK_SIZE listed in optional env vars)
tech-stack:
  added: []
  patterns:
    - Promise.allSettled multi-chunk parallelism with antifragile per-chunk failure isolation
    - Single-path optimization for small inputs (no Promise.allSettled overhead)
    - Pure helper export pattern for testability of chunking math
key-files:
  created: []
  modified:
    - src/summarize.ts
    - src/__tests__/summarize.test.ts
    - .env.example
    - README.md
decisions:
  - "Failed chunks → log.warn + skip (not throw): preserves antifragile bucketing semantics"
  - "Single path when posts.length <= chunkSize: avoids Promise.allSettled overhead on small runs"
  - "Default CLASSIFY_CHUNK_SIZE=40: 220 posts → 6 chunks (5×40 + 20), each within 120s DeepSeek client timeout"
  - "chunkArray throws on size<=0/NaN: explicit contract, no silent fallback"
metrics:
  duration: 121s
  completed: 2026-05-06
  tasks: 2
  commits: 3
  files_changed: 4
---

# Quick Task 260506-cad: Pass 1 Chunking Summary

**One-liner:** Chunked Pass 1 classification (Promise.allSettled, env-configurable chunk size, antifragile per-chunk failure isolation) to avoid DeepSeek 120s client timeout at 220+ posts.

## Files Modified

- `src/summarize.ts` — added exported `chunkArray<T>` helper; refactored `classifyPosts` with internal `classifyChunk`, single-path for `posts.length <= chunkSize`, multi-chunk parallel path via `Promise.allSettled` otherwise. `classifyPosts` and `summarize` signatures unchanged; pipeline.ts requires no edits.
- `src/__tests__/summarize.test.ts` — added `describe("chunkArray")` with 8 cases (empty, size>length, exact split, remainder, size=1, throw on 0/negative/NaN).
- `.env.example` — added `CLASSIFY_CHUNK_SIZE=40` with multi-line explanation block in DeepSeek section.
- `README.md:159` — listed `CLASSIFY_CHUNK_SIZE` among optional env vars in the Timeweb deployment section.

## What Was Verified

- `npm test` green: 131/131 tests pass across 7 test files (8 new chunkArray cases + all pre-existing summarize tests).
- TDD cycle observed: RED commit (`f73c0aa`) shows 8 failing tests; GREEN commit (`36d9d01`) brings all 131 to passing.
- `grep -n "Promise.allSettled" src/summarize.ts` shows two real call sites (line 376 = pass1 multi-chunk, line 540 = pass2 categories).
- `grep -n "CLASSIFY_CHUNK_SIZE" .env.example README.md src/summarize.ts` shows all three files reference the env var.
- Public signature audit: `classifyPosts(client, posts, model)` and `summarize(posts, channelStats?)` are byte-identical to pre-refactor (only function body and helper added).

## Effect

At 220 posts, Pass 1 now issues ~6 parallel DeepSeek requests of ~40 posts each instead of one 220-post mega-request. Each chunk's response generation comfortably fits within the OpenAI SDK 120s `timeout` and avoids the ECONNRESET at exactly 2 minutes. A failed chunk (after its internal retry) logs a warning and is skipped — its posts get the same silent-drop treatment they would receive from any other classification miss in the existing bucketing logic, so the rest of the digest is preserved.

## Known Limitations

- The integration behavior of `classifyPosts` (single-path vs multi-chunk path; partial-chunk-failure path) is not covered by unit tests. Mocking the OpenAI client is more expensive than the helper test and out of scope for a quick task. Coverage is delegated to a manual smoke run on real channels and to log inspection (`[summarize] pass1: chunk N/M ...` lines must appear when post count crosses the chunk boundary).
- No new runtime dependencies introduced. Default `CLASSIFY_CHUNK_SIZE=40` chosen to fit 200+ post runs into 120s; the value can be tuned via env without code changes.

## Deviations from Plan

None — plan executed exactly as written, including the optional `chunkArray` throw-on-NaN test case.

## Commits

- `f73c0aa` test(260506-cad): add failing tests for chunkArray helper
- `36d9d01` feat(260506-cad): chunk Pass 1 classification to avoid 120s timeout
- `6d338e5` docs(260506-cad): document CLASSIFY_CHUNK_SIZE env variable

## Self-Check

- File `src/summarize.ts` exists: FOUND
- File `src/__tests__/summarize.test.ts` exists: FOUND
- File `.env.example` exists: FOUND
- File `README.md` exists: FOUND
- Commit `f73c0aa` exists: FOUND
- Commit `36d9d01` exists: FOUND
- Commit `6d338e5` exists: FOUND

## Self-Check: PASSED
