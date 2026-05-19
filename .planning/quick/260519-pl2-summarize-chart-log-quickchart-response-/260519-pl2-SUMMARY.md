---
phase: quick-260519-pl2
plan: 01
subsystem: upload/chart
tags: [observability, error-handling, quickchart, tests]
completed: "2026-05-19T15:29:42Z"
duration: ~3 min
tasks_completed: 2
files_modified: 2
key_decisions:
  - "Used try/catch around res.text() so body-read failure cannot mask the original HTTP status"
  - "Truncation at 500 chars with single ellipsis char (…) to stay log-friendly"
  - "No new imports — purely local change to fetchQuickChartPng if-block"
---

# Quick 260519-pl2: Log Quickchart Response Body on HTTP !ok

**One-liner:** `fetchQuickChartPng` now embeds the first ≤500 chars of quickchart's response body in the thrown Error message, so `/summarize` logs show the real 400 cause (e.g. `{"success":false,"message":"Invalid chart config: ..."}`).

## What Changed

1. `src/upload/chart.ts` — `fetchQuickChartPng` `if (!res.ok)` block: added `await res.text()` inside a try/catch, truncated to 500 chars with `…` suffix if longer, falls back to `<body unavailable>` if text() throws. Error message format: `[chart] HTTP {status} {statusText} body={bodyExcerpt}`.
2. `src/__tests__/upload-chart.test.ts` — updated "throws on HTTP !ok" mock to include `text: async () => '...'` and tightened assertion to `/HTTP 500.*Invalid chart config/`; added two new tests: truncation+ellipsis (body >500 chars), and text()-failure resilience (`<body unavailable>` placeholder, no secondary error noise).

## Why

`/summarize` was logging `[chart] fail: [chart] HTTP 400 Bad Request` with no further context. Quickchart returns a JSON body explaining the config problem — surfacing it in the error message lets root-cause diagnosis happen from logs without re-running.

## Files Touched

- `src/upload/chart.ts` — 1 block changed (lines 225–232, +13/-1)
- `src/__tests__/upload-chart.test.ts` — 1 test updated + 2 tests added (+46/-1)

## Commits

- `7257193` — `fix(quick-260519-pl2): include quickchart response body in HTTP !ok error`
- `e376510` — `test(quick-260519-pl2): update + add tests for quickchart body logging`

## Verification

```
npx vitest run src/__tests__/upload-chart.test.ts
Tests  20 passed (20)   # was 18 before this task
```

## Follow-up

Once `/summarize` is run and the actual quickchart error message appears in logs (the `body=` portion), a separate quick task should fix the Chart.js config root cause identified there.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/upload/chart.ts` modified — FOUND
- `src/__tests__/upload-chart.test.ts` modified — FOUND
- commit `7257193` — FOUND
- commit `e376510` — FOUND
- 20 tests pass — VERIFIED
