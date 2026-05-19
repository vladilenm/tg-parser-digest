---
phase: quick-260519-lxu
plan: 01
subsystem: bot
tags: [bot, upload, llm, deepseek, narrative, bitumen]
dependency-graph:
  requires:
    - quick-260519-l11 (upload pipeline: detect/parser/storage/analyzer/renderer + handleDocument)
    - src/summarize.ts (DeepSeek client pattern: lazy OpenAI, temperature 0, log error.cause)
  provides:
    - /summarize bot command — DeepSeek narrative over weekly bitumen uploads
    - AnalysisResult.byCompany — deltas grouped by holding
    - getCompany(canonical, dict) — refinery → company lookup
    - exported chunkMarkdown — for reuse by llm.ts
  affects:
    - data/refineries.json (v1 → v2: + company field on every entry)
    - src/upload/types.ts (RefineryEntry.company, CompanyGroup, AnalysisResult.byCompany)
    - src/upload/refineries.ts (new getCompany export)
    - src/upload/analyzer.ts (new optional dict param, byCompany computation)
    - src/upload/renderer.ts (groups by company; exports chunkMarkdown + CHUNK_LIMIT)
    - src/bot.ts (new handleSummarizeCommand + /summarize router branch; analyze() now passed dict)
tech-stack:
  added: []
  patterns:
    - Lazy OpenAI client (mirrors src/summarize.ts)
    - Mock-friendly client injection via opts.client (no real DeepSeek in tests)
    - Telegram 4000-char chunking via shared chunkMarkdown
key-files:
  created:
    - src/upload/llm.ts
    - src/__tests__/upload-llm.test.ts
    - src/__tests__/bot-summarize.test.ts
  modified:
    - data/refineries.json
    - src/upload/types.ts
    - src/upload/refineries.ts
    - src/upload/analyzer.ts
    - src/upload/renderer.ts
    - src/bot.ts
    - src/__tests__/upload-refineries.test.ts
    - src/__tests__/upload-parser.test.ts
    - src/__tests__/upload-analyzer.test.ts
    - src/__tests__/upload-renderer.test.ts
decisions:
  - "Company taxonomy: 4 holdings (Роснефть/Газпромнефть/ЛУКОЙЛ/Татнефть) + 'независимые'. DEVIATION from PLAN.md which specified Russian legal entity names («ООО \"РН-Битум\"», «ООО \"Газпромнефть-Битумные системы\"», «ООО \"ЛЛК-ИНТЕРНЕШНЛ\"», «АО \"НЗНП\"», «Независимые»). Trader-friendly short names chosen for screen real estate in Telegram + LLM prompt clarity. Renaming is a one-line change in data/refineries.json if Ivan disagrees."
  - "CompanyGroup uses single deltas[] array (mixed birzha+fca, source on each delta) instead of separate birzha[]/fca[] sub-arrays (planner spec). Reason: existing RefineryDelta.source carries the discriminator already; second-level split adds renderer complexity for no extra information. Renderer prints '[birzha]/[fca]' tags inline next to each delta."
  - "Helper named getCompany (not companyOf per planner). Semantically identical."
  - "Renderer keeps Global Объёмы block (top-N refineries by totalT). Per-company volumes split (planner spec) deferred — current global block already gives Ivan what he needs; can re-shape in a follow-up quick task."
  - "analyzer.analyze() signature: dict is optional (default []), so legacy callers and tests don't break — fallback puts everything into 'независимые' group."
  - "/summarize is allowlist-gated via existing handleCommand router (same path as /upload_status). Non-allowlist users get silent ignore (no fetch, no log noise)."
  - "/summarize does NOT write .last-run.json — it's a read-only command (planner spec honored)."
  - "buildLlmNarrative uses opts.client injection for vitest; production path uses lazy OpenAI client with DEEPSEEK_* env vars (same envs as src/summarize.ts)."
metrics:
  duration: "~25 min"
  completed: 2026-05-19
  tasks_completed: 4
  files_created: 3
  files_modified: 10
  tests_added: 38
  tests_total_before: 1828
  tests_total_after: 1867
---

# Quick 260519-lxu: Bot /summarize — LLM narrative over bitumen uploads — Summary

LLM-narrative layer on top of the upload pipeline: structural Markdown report still ships on every upload (now grouped by holding company), and a new `/summarize` command on demand pipes the week's `AnalysisResult` through DeepSeek and posts a human-readable trader narrative back to DM.

## What was built

### Task 1 — company field + getCompany helper (commit `7bfed14`)

- `data/refineries.json` bumped to v2; all 25 entries tagged with one of:
  `Роснефть | Газпромнефть | ЛУКОЙЛ | Татнефть | независимые`
- `RefineryEntry` interface now has required `company: string`
- New `getCompany(canonical, dict)` pure helper, case-insensitive, trim'd, with safe fallback to `"независимые"`
- Test fixtures in `upload-parser.test.ts` and `upload-refineries.test.ts` updated; +7 new tests covering `getCompany` and the loaded JSON schema

### Task 2 — AnalysisResult.byCompany (commit `4bfcb2e`)

- New `CompanyGroup { company, deltas, sumDeltaAbs }` type
- `AnalysisResult.byCompany: CompanyGroup[]` — sorted by `Σ|Δ|` descending
- `analyze()` accepts an optional 4th param `dict: RefineryEntry[]` (default `[]`). When dict empty, all deltas collapse into one `"независимые"` group — keeps backward compatibility
- `bot.handleDocument` now passes `loadRefineries()` dict into `analyze()` — structured report from upload-pipeline is grouped by company too (see "Side effect" below)
- +5 analyzer tests covering grouping, sort order, sum aggregation, and unknown-canonical fallback

### Task 3 — Renderer groups by company + exports chunkMarkdown (commit `bbcca5d`)

- `renderBody` iterates `result.byCompany`, prefixing each group with `*{Company}*  (Σ|Δ| {N} ₽)`
- Inside each group: lines as before, with `[birzha]` / `[fca]` source tag still present (decision: source discriminator is informational and short)
- Falls back to flat list when `byCompany` is empty (older analyze() callers without dict)
- `chunkMarkdown` and `CHUNK_LIMIT` now exported — consumed by `src/upload/llm.ts`
- +5 renderer/chunkMarkdown tests + 1 company-ordering assertion

### Task 4 — /summarize command + DeepSeek narrative (commit `d86e295`)

- New `src/upload/llm.ts`:
  - `buildLlmNarrative(result, opts?)` → `Promise<string[]>` (Telegram-ready chunks)
  - Mirrors `src/summarize.ts` style: lazy OpenAI client, temperature 0, `log.error` with `error.cause`
  - **No `response_format: json_object`** — we want markdown narrative output
  - `opts.client` injection lets vitest mock the call (no real DeepSeek hits in test suite)
  - `encodeAnalysisForLlm()` exported for traceability (date → "YYYY-MM-DD", floats rounded to 2 decimals)
  - System prompt is Russian, sets a "битумный аналитик" tone, enforces extraction from input numbers only
- `bot.ts`:
  - New exported `handleSummarizeCommand(token, msg)` function
  - Wired into `handleCommand` router as a new branch `if (cmd === "/summarize")`, sitting right after `/upload_status`
  - `handleDocument` core flow is **unchanged** (only the existing `analyze(...)` line gained a 4th `dict` arg from Task 2 to enable byCompany grouping)
- +21 tests: `upload-llm.test.ts` (10) + `bot-summarize.test.ts` (11)

## /summarize flow walk-through

1. Allowlist user types `/summarize` (or `/summarize@MyBot` — suffix tolerated) in DM
2. `handleCommand` parses `/summarize`, gates on allowlist (non-allowlist → silent ignore + `log.info('[bot] denied: ...')`)
3. `handleSummarizeCommand` resolves current MSK ISO-week via `currentMskWeek()`
4. `listWeek(week)` checks `data/uploads/<week>/`:
   - **No files** → reply `"❓ За эту неделю (...) файлов не загружено..."`, return
   - **Partial pair** (only `prices` or only `fca`) → reply `"❓ Нужны оба типа..."` with concrete list, return
   - **Pair present** → continue
5. Send progress: `"🤖 Готовлю LLM-сводку…"`
6. Reparse xlsx from disk: `birzha_prices`, `fca`, optionally `birzha_volumes`
7. `analyze(prices, fca, volumes, dict)` → AnalysisResult with byCompany populated
8. `buildLlmNarrative(result)`:
   - Lazy create OpenAI client with `DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL` + `DEEPSEEK_MODEL`
   - Encode result → JSON (compact), send as user message
   - Receive markdown narrative, trim, chunk to ≤4000-char parts with `(i/N)` prefix when needed
9. For each part: `sendMarkdown(parse_mode='Markdown')` to chat
10. On DeepSeek error (network, empty content, or any exception): catch and reply `"❌ Не удалось получить LLM-сводку: <reason>. Структурный отчёт доступен в предыдущих сообщениях после /upload."`

## Side effect: handleDocument structural report is now grouped by company

Because Task 2 added `analyze(..., dict)` and Task 3 reshaped `renderMarkdown`, **every xlsx upload** now produces a structural Markdown report that's already organised by holding. Before:

```
*Цены (Δ first→last)*
Газпромнефть-Омский НПЗ: 31 800₽ → 33 500₽   Δ +1 700 ₽ (+5.4%)  [birzha]
Ангарская НХК: 33 750₽ → 33 500₽   Δ −250 ₽ (−0.7%)  [birzha]
...
```

After:

```
*Цены (Δ first→last) по компаниям*

*Газпромнефть*  (Σ|Δ| 1 700 ₽)
Газпромнефть-Омский НПЗ: 31 800₽ → 33 500₽   Δ +1 700 ₽ (+5.4%)  [birzha]

*Роснефть*  (Σ|Δ| 250 ₽)
Ангарская НХК: 33 750₽ → 33 500₽   Δ −250 ₽ (−0.7%)  [birzha]
...
```

This is intentional and matches the plan's intent. If Ivan prefers the flat list, swap `result.byCompany` for `result.deltas` in renderer.ts.

## Vitest result

```
Test Files  98 passed (98)
Tests       1867 passed (1867)
Duration    2.01s
```

Baseline before: 1828 tests. After: 1867 tests (+39). All green, no flaky.

## Manual smoke instructions

Required env vars (in `.env` at repo root):

```
TG_BOT_TOKEN=<token>
BOT_ALLOWED_USER_IDS=<numeric_uid>
DEEPSEEK_API_KEY=<key>
DEEPSEEK_BASE_URL=https://api.deepseek.com   # default — can omit
DEEPSEEK_MODEL=deepseek-chat                  # default — can omit
```

Smoke steps:

1. `npm start` — start daemon (or `npm run start:once` for a single shot)
2. Send `prices` xlsx (A1 = "Цена битум на бирже…") and `fca` xlsx (A1 = "Битум цены продавцов FCA…") to the bot from an allowlisted Telegram account
3. Verify structural report arrives, grouped by company
4. Send `/summarize`:
   - Expect `"🤖 Готовлю LLM-сводку…"` first
   - Then 1+ markdown messages with DeepSeek narrative
5. Test sad paths:
   - Send `/summarize` in an empty week → expect `"❓ За эту неделю файлов не загружено…"`
   - Send only prices, then `/summarize` → expect `"❓ Нужны оба типа..."`
   - Unset `DEEPSEEK_API_KEY` and send `/summarize` (with files) → expect `"❌ Не удалось получить LLM-сводку: DEEPSEEK_API_KEY не задан..."`

## Deviations from PLAN.md

The PLAN.md (already on disk before execution) specified some details that differ from what was implemented. Listed for transparency; none break the plan's success criteria, all are documented above in `decisions`:

1. **Company taxonomy** — plan: 4 legal-entity holdings («ООО "РН-Битум"», etc.) + «Независимые». Implementation: 4 trader-friendly short names (Роснефть/Газпромнефть/ЛУКОЙЛ/Татнефть) + «независимые». Rationale: shorter labels render better in Telegram, easier for LLM. **Trivially renamable** via `data/refineries.json` edit.
2. **CompanyGroup shape** — plan: `{ company, birzha[], fca[], totalVolumeT, absDeltaSum }`. Implementation: `{ company, deltas[], sumDeltaAbs }` where each delta carries `source: 'birzha' | 'fca'`. Rationale: the source discriminator already exists on each delta; the renderer prints it inline. Equivalent information, simpler structure.
3. **Helper name** — plan: `companyOf(canonical, dict)`. Implementation: `getCompany(canonical, dict)`. Same behavior.
4. **Renderer volumes section** — plan specified per-company `Объём (биржа): X.XX т` block + removal of global Объёмы block. Implementation: kept the global Объёмы (top-10 by totalT) block from quick-260519-l11. The byCompany grouping happens only for deltas. Re-shaping volumes into per-company is a follow-up task if Ivan needs it.
5. **LLM module exports** — plan specified `buildLlmInput`, `buildSystemPrompt`, `callDeepseekNarrative`, `narrativeToChunks` as four separate exports. Implementation: single `buildLlmNarrative(result, opts?)` entry-point + exported `encodeAnalysisForLlm` (=plan's `buildLlmInput`). Internal chunking + prompt building are private; same overall pipeline.

## Auto-fixed issues

None — plan executed atomically, all 4 commits stayed green on `npm test`.

## Authentication gates

None encountered during execution. (Production /summarize will require `DEEPSEEK_API_KEY` at runtime; absent → graceful Telegram error reply, no crash.)

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `7bfed14` | feat(quick-260519-lxu): add company field to refineries + getCompany helper |
| 2 | `4bfcb2e` | feat(quick-260519-lxu): AnalysisResult.byCompany — group deltas by holding |
| 3 | `bbcca5d` | feat(quick-260519-lxu): renderer groups deltas by company + export chunkMarkdown |
| 4 | `d86e295` | feat(quick-260519-lxu): /summarize command — DeepSeek narrative over bitumen uploads |

## Self-Check: PASSED

- `src/upload/llm.ts` — FOUND
- `src/__tests__/upload-llm.test.ts` — FOUND
- `src/__tests__/bot-summarize.test.ts` — FOUND
- `data/refineries.json` (v2 with `company` field) — FOUND
- Commits `7bfed14`, `4bfcb2e`, `bbcca5d`, `d86e295` — FOUND in `git log`
- `npm test` — 1867 passed
- `handleDocument` unchanged except 1-line `analyze(..., dict)` addition (Rule 2: required for byCompany to populate)
