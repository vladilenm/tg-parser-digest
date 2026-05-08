---
phase: 260508-dde-temperature-0-deepseek
plan: 01
subsystem: summarization
tags: [deepseek, determinism, temperature, llm-params]
requires: []
provides:
  - quasi-deterministic Pass 1 (classifier) DeepSeek call
  - quasi-deterministic Pass 2 (per-category extraction) DeepSeek call
affects:
  - src/summarize.ts
tech_stack:
  added: []
  patterns:
    - "explicit temperature: 0 on all DeepSeek chat.completions.create calls"
key_files:
  created: []
  modified:
    - src/summarize.ts
decisions:
  - "Set temperature: 0 instead of a seed: DeepSeek does not support seed; temperature: 0 is the recommended deterministic-extraction setting per DeepSeek param docs."
  - "No new dependencies, no refactor: minimal +2 lines diff in a single file, exactly as scoped."
metrics:
  duration_minutes: 2
  tasks_completed: 1
  files_changed: 1
  lines_added: 2
  lines_removed: 0
  completed_at: 2026-05-08
requirements_completed:
  - QUICK-260508-dde-01
---

# Quick 260508-dde: temperature: 0 on DeepSeek calls Summary

One-liner: Added `temperature: 0` to both DeepSeek `chat.completions.create` calls in `src/summarize.ts` so Pass 1 classification and Pass 2 extraction become quasi-deterministic across runs on identical input.

## What Changed

Both DeepSeek calls in `src/summarize.ts` now pass an explicit `temperature: 0`. Previously the field was omitted, meaning the SDK fell back to DeepSeek's default of `1.0`, which made Pass 1 buckets and Pass 2 `keyQuote` selections vary noticeably between two consecutive `npm start` runs on the same 24h post window.

### Edits

1. `src/summarize.ts:417` — Pass 1 classifier (`classifyPosts` → inner `callLLM`):
   - Inserted `temperature: 0,` immediately after `model,` and before `response_format`.
2. `src/summarize.ts:558` — Pass 2 per-category extraction (`summarizeCategory` → `callLLM`):
   - Inserted `temperature: 0,` immediately after `model,` and before `response_format`.

Diff is exactly `+2/-0` on a single file. No prompt, schema, retry, logging, or parser changes. No new dependencies. No tests added (out of scope per plan constraints).

## Verification

- `grep -c "temperature: 0" src/summarize.ts` → `2` (lines 417 and 558).
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (clean under TS strict).
- `git diff --stat src/summarize.ts` → `1 file changed, 2 insertions(+)`.
- `CLAUDE.md` and `README.md` untouched (verified via `git diff`).

Smoke test (manual, optional, not blocking): two consecutive `npm run start:once` runs on the same 24h window are expected to produce identical or near-identical digests. Not executed in this quick task — left for the operator.

## Decisions Made

- **`temperature: 0` over `seed`**: DeepSeek's OpenAI-compatible API does not guarantee bit-exact reproducibility via `seed`. `temperature: 0` is the recommended setting for extractive tasks (DeepSeek parameter docs) and is sufficient for the digest use-case.
- **Field position right after `model`**: matches plan spec exactly and groups core sampling/model params before `response_format` and `messages`.

## Deviations from Plan

None — plan executed exactly as written. Two atomic edits, single commit, scope `260508-dde`.

## Commits

- `2635a52` — `quick-260508-dde: set temperature: 0 in both DeepSeek calls for quasi-deterministic runs`

## Self-Check: PASSED

- `src/summarize.ts:417` contains `temperature: 0,` — FOUND
- `src/summarize.ts:558` contains `temperature: 0,` — FOUND
- Commit `2635a52` exists in `git log` — FOUND
- `npx tsc --noEmit` exits 0 — VERIFIED
- `grep -c "temperature: 0" src/summarize.ts` = 2 — VERIFIED
- Only `src/summarize.ts` modified by this commit (`git show --stat 2635a52` shows 1 file, +2/-0) — VERIFIED
