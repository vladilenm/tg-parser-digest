---
phase: quick-260504-eae
plan: "01"
subsystem: summarize
tags: [digest-header, channel-stats, deepseek-prompt, per-category-limit]
dependency_graph:
  requires: []
  provides: [enriched-digest-header, per-category-deepseek-limits]
  affects: [src/summarize.ts, src/pipeline.ts]
tech_stack:
  added: []
  patterns: [optional-param-backward-compat, inline-object-passing]
key_files:
  created: []
  modified:
    - src/summarize.ts
    - src/pipeline.ts
decisions:
  - "ChannelStats exported as interface (not type alias) for extensibility"
  - "Subtitle built with if/else chain covering all 4 cases from spec"
  - "channelStats passed as inline object literal in pipeline (no import needed)"
metrics:
  duration: 97s
  completed: "2026-05-04"
  tasks_completed: 3
  files_modified: 2
---

# Quick Task 260504-eae: Fix-1 Fix-2 DeepSeek 15→3+5 Mentions Summary

**One-liner:** Enriched digest header with full channel statistics (total/active/empty/errors) + DeepSeek prompt switched from global 15-post cap to per-category limits (3 each, 5 mentions).

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add channelStats to renderHtml and update header format | d6f9d6b | src/summarize.ts |
| 2 | Pass channelStats from pipeline to summarize | b28f996 | src/pipeline.ts |
| 3 | Update SYSTEM_PROMPT rule 9 to per-category limits | bb3544e | src/summarize.ts |

## What Was Built

**Fix 1 — Channel statistics in digest header:**

- Added `export interface ChannelStats { total: number; skipped: number }` to `src/summarize.ts`
- `renderHtml` now accepts optional third param `channelStats?: ChannelStats`
- Header subtitle logic with 4 cases:
  - `empty > 0 && skipped > 0`: `N постов · K из T каналов (E без постов, S ошибок)`
  - `empty > 0 && skipped == 0`: `N постов · K из T каналов (E без постов за сутки)`
  - `empty == 0 && skipped > 0`: `N постов · K из T каналов (S ошибок при парсинге)`
  - `empty == 0 && skipped == 0` or no channelStats: `N постов из K каналов за 24ч` (unchanged)
- `summarize()` accepts optional `channelStats?: ChannelStats` and passes it through to `renderHtml`
- `pipeline.ts` passes `{ total: channels.length, skipped: channelsSkipped }` at call site

**Fix 2 — Per-category DeepSeek limits:**

- SYSTEM_PROMPT rule 9 changed from:
  `"9) Отбирай не более 15 самых содержательных постов в сумме по всем массивам."`
- To:
  `"9) Отбирай не более 3 самых содержательных постов на каждую из 5 категорий и не более 5 в массив mentions. Итого не более 20 записей."`

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/summarize.ts` modified: confirmed
- `src/pipeline.ts` modified: confirmed
- Commit d6f9d6b: confirmed
- Commit b28f996: confirmed
- Commit bb3544e: confirmed
- `npx tsc --noEmit`: no errors
- `grep "не более 3 самых содержательных"`: PASS
- `grep "не более 5 в массив mentions"`: PASS
- `renderHtml` import check: PASS
- `runPipeline` import check: PASS
