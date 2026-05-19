---
phase: quick-260519-swc
plan: 01
subsystem: bot
tags: [refactor, dead-code-removal, chart, summarize]
dependency_graph:
  requires: []
  provides: [handleSummarizeCommand narrative-only flow]
  affects: [src/bot.ts, src/__tests__/bot-summarize.test.ts]
tech_stack:
  added: []
  patterns: []
key_files:
  modified:
    - src/bot.ts
    - src/__tests__/bot-summarize.test.ts
decisions:
  - "Remove broken chart delivery path entirely; src/upload/chart.ts stays on shelf for later"
  - "No feature flags or TODO comments — clean removal, git history is the record"
metrics:
  duration: ~5min
  completed: 2026-05-19
  tasks_completed: 2
  files_modified: 2
---

# Phase quick-260519-swc Plan 01: Remove Chart Block from /summarize Summary

**One-liner:** Deleted broken quickchart delivery path (sendPhotoMultipart, sendDocumentMultipart, chart try/catch block) from bot.ts and all 5 chart tests + mocks from bot-summarize.test.ts; handleSummarizeCommand is now narrative-only.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove chart block and dead helpers from src/bot.ts | 20510f9 | src/bot.ts (-132 lines) |
| 2 | Remove chart tests and mocks from bot-summarize.test.ts | feac793 | src/__tests__/bot-summarize.test.ts (-254 lines) |

## What Was Removed

**src/bot.ts:**
- `import { generateChartPng } from "./upload/chart.js"` (line 22)
- `sendPhotoMultipart` function + JSDoc (multipart FormData sendPhoto helper)
- `sendDocumentMultipart` function + JSDoc (PHOTO_INVALID_DIMENSIONS fallback helper)
- Chart try/catch block inside `handleSummarizeCommand` (quick-260519-ojk + quick-260519-p3g + quick-260519-s1z markers)

**src/__tests__/bot-summarize.test.ts:**
- `import { generateChartPng }` from chart.js
- `vi.mock("../upload/chart.js", ...)` block
- `mockedGenerateChartPng` variable
- `multipartCallsTo` helper function
- `mockedGenerateChartPng.mockResolvedValue(null)` in beforeEach
- Entire `describe("/summarize — chart (quick-260519-p3g multipart)", ...)` (5 tests)

## What Was Preserved

- `src/upload/chart.ts` — untouched (on shelf)
- `src/__tests__/upload-chart.test.ts` — untouched (on shelf)
- All 8 narrative-only tests across 6 describes in bot-summarize.test.ts
- `handleSummarizeCommand` outer narrative try/catch and `for (const part of parts)` sendMarkdown loop

## Verification

- `npx tsc --noEmit` — 0 errors
- `npx vitest run src/__tests__/bot-handlers.test.ts src/__tests__/bot-summarize.test.ts` — 619 passed, 0 failed
- `grep generateChartPng\|sendPhotoMultipart\|sendDocumentMultipart src/bot.ts` — empty
- `git diff --name-only -- src/upload/chart.ts src/__tests__/upload-chart.test.ts` — empty

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/bot.ts` exists and modified: FOUND
- `src/__tests__/bot-summarize.test.ts` exists and modified: FOUND
- commit 20510f9: FOUND
- commit feac793: FOUND
