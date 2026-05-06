---
phase: 03-web-scraping
plan: 01
subsystem: foundation
tags: [foundation, scraping, schema, archive]
requires:
  - channels-store.ts patterns (Zod min(1), atomic write)
  - src/archive.ts (atomicWriteText, todayMsk, RAW_DIR, OUTPUT_DIR)
  - src/types.ts (Post, RunSummary)
  - src/schema.ts (z import, existing CATEGORIES/MENTIONS)
provides:
  - cheerio ^1.0.0 (5th runtime dep)
  - websites.json seed (5 oil/gas industry sites)
  - WebsiteEntrySchema / WebsitesFileSchema / WebsiteEntry type (z.string().url())
  - WebRunSummary interface (11 fields)
  - writeRawWeb / writeOutputWeb archive functions (-web suffix)
affects:
  - package.json (5 runtime deps; STATE.md v4.0 Key Decisions records cheerio approval)
  - package-lock.json (cheerio + 172 transitive deps locked)
tech-stack:
  added:
    - cheerio ^1.0.0
  patterns:
    - "Zod with min(1) + z.string().url() for operator-edited config files"
    - "Parallel archive functions reusing atomicWriteText/todayMsk via -web suffix"
    - "TDD red-green for new archive helpers (5 behaviors covered)"
key-files:
  created:
    - websites.json
    - src/__tests__/archive-web.test.ts
  modified:
    - package.json
    - package-lock.json
    - src/schema.ts
    - src/types.ts
    - src/archive.ts
decisions:
  - "WebsitesFileSchema added at end of src/schema.ts (D-22) — 1:1 schema mirror of file format, no version wrapper, no audit fields, no category-hints"
  - "WebRunSummary placed alongside RunSummary in src/types.ts (Claude's discretion field set, all 11 fields present)"
  - "writeRawWeb/writeOutputWeb implemented as parallel functions (not via suffix-parameter overload) — keeps existing call sites untouched and signatures explicit"
  - "Test file uses process.chdir(tmpdir()) isolation pattern from channels-store.test.ts — keeps RAW_DIR/OUTPUT_DIR constants private without DI seam"
metrics:
  duration: ~4min
  tasks_completed: 3
  commits: 4
  tests_added: 5
  tests_total: 90
  completed: 2026-05-06
---

# Phase 3 Plan 1: Foundation Summary

WEB-01/WEB-04 foundation: cheerio ^1.0.0 added as 5th runtime dep, `websites.json` seed (5 industry URLs) committed, `WebsitesFileSchema` (with `z.string().url()` SSRF mitigation) plus `WebRunSummary` (11 fields) exported, and `src/archive.ts` extended with `writeRawWeb`/`writeOutputWeb` (`-web` suffix). All Phase 3 type/schema/archive contracts are now ready for `web-scraper.ts` to import in Plan 2 without scavenger hunts.

## Tasks Executed

| # | Task | Files | Commit |
|---|------|-------|--------|
| 1 | Add cheerio + websites.json seed | package.json, package-lock.json, websites.json | `cbcbe18` |
| 2 | WebsitesFileSchema + WebRunSummary | src/schema.ts, src/types.ts | `6b02817` |
| 3a | TDD RED: archive-web tests | src/__tests__/archive-web.test.ts | `39d8c72` |
| 3b | TDD GREEN: writeRawWeb/writeOutputWeb impl | src/archive.ts | `a838cec` |

## Verification Outcomes

| Check | Result |
|-------|--------|
| `grep -E '"cheerio":\s*"\^1\.0\.0"' package.json` | matches |
| `node_modules/cheerio` present, `cheerio.load("<p>hi</p>")` returns a working `$` | yes |
| `package.json` deps count == 5, exact set: `cheerio, node-cron, openai, telegram, zod` | yes |
| `websites.json` valid JSON with 5 URLs, all parsed by `new URL()` | yes |
| `WebsitesFileSchema.parse({websites:[{url:"https://x.com/"}]})` succeeds | yes |
| `WebsitesFileSchema.parse({websites:[{url:"not-a-url"}]})` rejects | yes |
| `WebRunSummary` literal sample with 11 fields type-checks under `strict: true` | yes |
| `writeRawWeb/writeOutputWeb` exported, both write `-web` suffixed files | yes |
| `archive-web.test.ts`: 5/5 passed | yes |
| Full vitest run: 90/90 passed (4 test files) | yes |
| `npx tsc --noEmit` | clean exit |

## Key Implementation Notes

- **CLAUDE.md vs STATE.md cap conflict (resolved):** `CLAUDE.md` constraint text states "Runtime-зависимости ровно три"; STATE.md v4.0 Key Decisions explicitly approves cheerio as "the only new runtime dep" (4 → 5). The plan's `must_haves.truths` line "package.json содержит cheerio как 5-ю runtime-зависимость" makes this an approved exception. No deviation taken — plan is authoritative.
- **websites.json schema (D-22):** mirrored channels.json minimalism — no version wrapper, no audit fields, only `url` (required, `z.string().url()`) and optional `name`. `min(1)` matches `ChannelsFileSchema`.
- **WebRunSummary field set (Claude's Discretion in 03-CONTEXT.md):** chose 11 fields parallel to RunSummary semantics: identity (`runId`/`startedAt`/`finishedAt`/`durationMs`), counters (`websitesTotal`/`websitesSucceeded`/`websitesSkipped`/`itemsCollected`/`itemsDropped`), terminal status (`digestDelivered`), error sink (`errors[]`). Matches the field set sketched in 03-01 plan §interfaces.
- **`writeRawWeb`/`writeOutputWeb`:** chose parallel-function design (not suffix-parameter overload of existing `writeRaw`/`writeOutput`) so callers in Plan 2 (`web-scraper.ts`) get an explicit, non-stringly-typed signature and existing TG callers stay byte-identical.
- **Test isolation:** reused the `process.chdir(mkdtempSync(...))` + `afterEach` cleanup pattern established in `channels-store.test.ts` so we don't need to expose `RAW_DIR`/`OUTPUT_DIR` as DI seams.

## Threat Model Mitigations Applied

| Threat | Disposition | Action Taken |
|--------|-------------|--------------|
| T-03-01 (Tampering / SSRF via websites.json) | mitigate | `WebsiteEntrySchema.url = z.string().url()` blocks `file://`/`gopher://`/malformed strings before any `fetch()` call |
| T-03-03 (DoS via supply-chain on cheerio) | accept | `cheerio ^1.0.0` pinned, `package-lock.json` locks transitive set (172 packages); `npm install` reports 1 moderate vuln, accepted per plan §threat_model |
| T-03-04 (Tampering / path injection in atomicWriteText) | mitigate | `RAW_DIR`/`OUTPUT_DIR` remain hardcoded module-level constants; `todayMsk()` returns strict `YYYY-MM-DD` from `Intl.DateTimeFormat` |
| T-03-05 (Repudiation in archive logs) | mitigate | `writeRawWeb`/`writeOutputWeb` log `runId=...` via `log.info` — operator can `grep runId=` for cross-stage trace |

## Deviations from Plan

**[Worktree base correction]** Initial worktree was based on `20214a3` (a stale branch from before Phase 1/2 work) — `channels.json`, `channels-store.ts`, `bot.ts` were absent. Per the worktree_branch_check protocol, executed `git reset --hard d1db54cc...` to align with the expected base before any task work. Plan file `03-01-foundation-PLAN.md` (untracked in main) was copied from the parent repo into the worktree to preserve plan context. No code-level deviations.

Apart from the worktree alignment above, the plan executed exactly as written. No Rule 1/2/3 auto-fixes triggered.

## Authentication Gates

None. Plan is fully offline (file-system + npm install only).

## Known Stubs

None. `websites.json` ships with 5 real public oil/gas industry URLs (oilcapital.ru, neftegaz.ru, rupec.ru, oilexp.ru, angi.ru) — not placeholders. The 4 task implementations (cheerio install, schema/type exports, archive functions) all have real behavior verified by automated tests.

## Threat Flags

None. All security-relevant surface introduced (URL validation entry point, new file paths under `data/`) was anticipated in the plan's `<threat_model>` and dispositions are honored.

## Self-Check: PASSED

- `package.json` modified (cheerio dep) — FOUND
- `package-lock.json` modified — FOUND
- `websites.json` created at repo root — FOUND
- `src/schema.ts` modified (WebsitesFileSchema/WebsiteEntrySchema/WebsiteEntry) — FOUND
- `src/types.ts` modified (WebRunSummary) — FOUND
- `src/archive.ts` modified (writeRawWeb/writeOutputWeb) — FOUND
- `src/__tests__/archive-web.test.ts` created — FOUND
- Commit `cbcbe18` (Task 1) — FOUND in `git log`
- Commit `6b02817` (Task 2) — FOUND in `git log`
- Commit `39d8c72` (Task 3 RED) — FOUND in `git log`
- Commit `a838cec` (Task 3 GREEN) — FOUND in `git log`
- 5/5 archive-web tests pass — VERIFIED
- 90/90 total tests pass — VERIFIED
- `npx tsc --noEmit` clean — VERIFIED
