---
phase: quick-260519-s1z
plan: 01
subsystem: bot
tags: [bot, chart, fallback, sendDocument, PHOTO_INVALID_DIMENSIONS, telegram]
dependency_graph:
  requires: [quick-260519-pwy, quick-260519-p3g]
  provides: [sendDocument-fallback-for-chart]
  affects: [src/bot.ts, src/__tests__/bot-summarize.test.ts]
tech_stack:
  added: []
  patterns: [FormData-multipart-upload, inner-try-catch-fallback]
key_files:
  created: []
  modified:
    - src/bot.ts
    - src/__tests__/bot-summarize.test.ts
decisions:
  - "Inner try/catch around sendPhotoMultipart only — re-throws non-PHOTO_INVALID_DIMENSIONS errors to outer catch (backward-compat)"
  - "sendDocumentMultipart is a private function (not exported) — only used from handleSummarizeCommand chart-block"
  - "sendDocument failure propagates to outer catch which log.warns — handler always succeeds after narrative delivery"
metrics:
  duration: ~10min
  completed: 2026-05-19
  tasks_completed: 2
  files_modified: 2
---

# Phase quick-260519-s1z Plan 01: sendDocument fallback for PHOTO_INVALID_DIMENSIONS Summary

**One-liner:** sendDocumentMultipart fallback in handleSummarizeCommand — when TG rejects sendPhoto with PHOTO_INVALID_DIMENSIONS, same PNG is re-delivered as a document file.

## What Was Built

Two commits implementing a graceful fallback for Telegram's PHOTO_INVALID_DIMENSIONS rejection:

**Task 1 — `src/bot.ts`:**

- Added `sendDocumentMultipart(token, chatId, bytes, filename, caption)` immediately after `sendPhotoMultipart` — same FormData/Blob multipart pattern, but `document` field instead of `photo`, `filename` param, `/sendDocument` endpoint.
- In `handleSummarizeCommand` chart-block: wrapped existing `sendPhotoMultipart` call in inner try/catch. On `PHOTO_INVALID_DIMENSIONS` match: `log.warn` + fallback to `sendDocumentMultipart`. On any other error: re-throw to outer catch (existing `log.warn`, handler still succeeds).

**Task 2 — `src/__tests__/bot-summarize.test.ts`:**

- Replaced old "does NOT crash when sendPhoto returns 400" test with "falls back to sendDocument when sendPhoto returns PHOTO_INVALID_DIMENSIONS" — asserts sendDocument called 1x with correct `chat_id`, `caption`, `image/png` Blob of same size.
- Added "handler does NOT crash when both sendPhoto AND fallback sendDocument fail" — both endpoints return 400, handler resolves, narrative delivered.
- Added "does NOT fall back to sendDocument on non-PHOTO_INVALID_DIMENSIONS error" — sendPhoto 500 `internal server error`, sendDocument NOT called (0 calls).

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 | 311d645 | src/bot.ts (+67 lines, -6 lines) |
| 2 | b0c17f6 | src/__tests__/bot-summarize.test.ts (+111 lines, -13 lines) |

## Verification

- `npx tsc --noEmit` — clean (0 errors)
- `npx vitest run bot-handlers.test.ts upload-chart.test.ts bot-summarize.test.ts` — 668 tests passed
- `grep "sendDocumentMultipart" src/bot.ts` — 2 matches (definition + call)
- `grep "PHOTO_INVALID_DIMENSIONS" src/bot.ts` — regex at line 611 in inner catch
- `git diff 4c6f4d1..311d645 -- src/bot.ts` — sendPhotoMultipart body untouched

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints or auth paths introduced; `sendDocumentMultipart` is an internal helper using existing `fetch` + Bot API token pattern identical to `sendPhotoMultipart`.

## Self-Check: PASSED

- `src/bot.ts` — modified, committed at 311d645
- `src/__tests__/bot-summarize.test.ts` — modified, committed at b0c17f6
- Both commits confirmed in `git log --oneline -3`
