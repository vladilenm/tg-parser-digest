---
phase: 04
plan: 01
subsystem: bitum-weekly-report
tags:
  - milestone-v5.0
  - bitum
  - classifier
  - parsers
  - reporter
  - bot-commands
  - migration
dependency_graph:
  requires:
    - src/upload/* (legacy v4.0 base — deleted in wave 6)
    - src/bot.ts (v4.0 bot polling + commands)
    - src/deliver.ts (chunkHtml helper)
    - src/channels-store.ts (mutex pattern reference)
    - data/refineries.json (v2 dictionary — extended)
  provides:
    - src/bitum/* (10 modules + parsers/ subdir)
    - src/bot-bitum.ts (6 handlers)
    - data/bitum/ (signatures-learned.json append-only)
    - 4 new bot commands (/bitum_status, /bitum_preview, /bitum_report, /bitum_reset)
    - TG-05 single-message upload response
    - classifier learning UX (D-14)
    - publish confirm flow (D-11)
    - reset confirm flow (D-12)
    - cross-check warnings (REPORT-08)
    - cell-trace footer (REPORT-07)
    - partial-render (D-10)
    - hybrid LLM scope (D-08)
  affects:
    - src/bot.ts (handleDocument now dispatches to handleBitumDocument; 4 new commands; bs:/bp:/br: callback routing; setMyCommands updated)
    - CLAUDE.md (Stack/Conventions/Architecture sections populated)
    - .env.example (BITUM_CROSS_CHECK_THRESHOLD, BITUM_VOLUMES_TOP_N)
tech_stack:
  added:
    - zod (already in package.json — Zod-validation reused for ParserResult)
  patterns:
    - stepped confidence model (A1+A3=1.0 / A1=0.7 / partial=0.4 / sheet-only=0.7)
    - hybrid LLM scope (numbers programmatic, framing LLM)
    - fixed holding order (Роснефть → Газпромнефть → ЛУКОЙЛ → Прочие)
    - in-memory pending Maps for confirm flows (publish, reset, learning)
    - one-time deprecation messaging per-user via Set
    - cell-trace via real Excel A1 addresses (per checker W4)
key_files:
  created:
    - src/bitum/types.ts
    - src/bitum/signatures.ts
    - src/bitum/classifier.ts
    - src/bitum/learned-signatures.ts
    - src/bitum/refineries.ts
    - src/bitum/storage.ts
    - src/bitum/analyzer.ts
    - src/bitum/reporter.ts
    - src/bitum/llm.ts
    - src/bitum/index.ts
    - src/bitum/parsers/shared.ts
    - src/bitum/parsers/birzha-prices.ts
    - src/bitum/parsers/birzha-volumes.ts
    - src/bitum/parsers/fca-sellers.ts
    - src/bitum/parsers/all-prices.ts
    - src/bitum/parsers/bitum-price-new.ts
    - src/bitum/parsers/index.ts
    - src/bot-bitum.ts
    - data/bitum/.gitkeep
    - src/__tests__/bitum-types.test.ts
    - src/__tests__/bitum-signatures.test.ts
    - src/__tests__/bitum-classifier.test.ts
    - src/__tests__/bitum-learned-signatures.test.ts
    - src/__tests__/bitum-refineries.test.ts
    - src/__tests__/bitum-storage.test.ts
    - src/__tests__/bitum-parser-birzha-prices.test.ts
    - src/__tests__/bitum-parser-birzha-volumes.test.ts
    - src/__tests__/bitum-parser-fca-sellers.test.ts
    - src/__tests__/bitum-parser-all-prices.test.ts
    - src/__tests__/bitum-parser-bitum-price-new.test.ts
    - src/__tests__/bitum-analyzer.test.ts
    - src/__tests__/bitum-reporter.test.ts
    - src/__tests__/bitum-reporter-trace.test.ts
    - src/__tests__/bitum-reporter-order.test.ts
    - src/__tests__/bitum-llm.test.ts
    - src/__tests__/bitum-bot-commands.test.ts
    - src/__tests__/bitum-bot-learning.test.ts
  modified:
    - src/bot.ts (handler exports, routing to bitum, deprecation messaging)
    - src/__tests__/bot-handlers.test.ts (adapted for new bitum routing)
    - data/refineries.json (extended 25 → 28 canonical entries with full aliases)
    - .env.example (BITUM_* env vars)
    - .gitignore (allow data/bitum/.gitkeep)
    - CLAUDE.md (Stack/Conventions/Architecture populated)
    - vitest.config.ts (exclude .claude/worktrees from scan)
  deleted:
    - src/upload/ (9 files: analyzer, chart, detect, llm, parser, refineries, renderer, storage, types)
    - src/__tests__/upload-*.test.ts (8 files)
    - src/__tests__/bot-summarize.test.ts (legacy /summarize handler tests)
decisions:
  - "Stepped confidence model: A1+A3=1.0, A1=0.7, A3||B3=0.4, sheetName-only fallback 0.7 (per checker B2)"
  - "all_prices parser reads 'исходник' sheet with dynamic column detection (header on row 1-3), falls back to worksheets[0]"
  - "cross-check threshold via env BITUM_CROSS_CHECK_THRESHOLD (default 0.01); per-call override via opts.crossCheckThreshold"
  - "signatures-learned.json — flat array of LearnedSignature (not grouped by type)"
  - "Fixed holding order Роснефть → Газпромнефть → ЛУКОЙЛ → Прочие; Татнефть into Прочие with special-case line"
  - "Reporter trace cells: per checker W4, real Excel A1 addresses (single 'F12' or range 'B4..T18'), no '?' placeholders"
  - "Hybrid LLM scope D-08: system prompt JAIL forbids numbers; response_format=json_object returns 5-field {topSummary, rosneft, gazpromneft, lukoil, others}"
  - "renderer.ts vs reporter.ts: reporter.ts is the only HTML renderer in v5.0; legacy renderer.ts deleted with upload/"
  - "Migration last (wave 6) so /summarize and /upload_status work during waves 1-5; final deletion atomic"
metrics:
  duration: ~3 hours (single Claude session, sequential execution)
  completed_date: 2026-05-21
  tests_added: 14 new test files (bitum-*.test.ts)
  tests_total: 291 (down from 407 because upload-*.test.ts removed — coverage migrated)
  commits: 24 task commits + this final docs commit
  lines_added: ~4500
  lines_deleted: ~3700 (mostly src/upload + legacy tests)
---

# Phase 04 Plan 01: Битумный недельный отчёт (milestone v5.0) Summary

Milestone v5.0 «Битумный недельный отчёт» implemented end-to-end in single plan with 6 internal waves: xlsx-классификатор по содержимому (6 типов, learning-loop), 5 идемпотентных парсеров с Zod-валидацией, расширение dictionary НПЗ, структурный HTML-отчёт по `docs/bitum/algoritm.md` §6 с cell-trace (REPORT-07) и cross-check (REPORT-08), гибридный LLM scope (D-08), 4 битум-команды бота с inline-keyboard публикации/подтверждения, миграция `src/upload/` → `src/bitum/`.

## Outcome

Все 28 BITUM-* requirements реализованы. `src/upload/` удалён, весь битум-pipeline живёт в `src/bitum/*` (10 модулей + parsers/ subdir). Bot имеет 9 команд (включая 4 новых битум + legacy aliases с одноразовым deprecation msg). Тесты: 291 passing (14 новых bitum-*.test.ts файлов с 100+ unit-тестами; 8 legacy upload-*.test.ts удалены; coverage перенесён).

## Wave Summaries

### Wave 1: Foundation
- `types.ts` (13 type exports: BitumType, ClassifyResult, ParsedRow* x5, ParserResult<T>, NumberTrace, ReportResult, WeekStatusV5, LearnedSignature, RefineryEntry, KnownBitumType, ParsedBitumPriceNewSnapshot)
- `signatures.ts` (BUILT_IN_SIGNATURES: 5 entries, first 3 backward-compat with src/upload/detect.ts MARKERS)
- `learned-signatures.ts` (loadLearned + appendLearned with atomic .tmp+rename + in-process mutex)
- `classifier.ts` (classifyFile с stepped confidence A1+A3=1.0/A1=0.7/partial=0.4/sheet-only=0.7)
- `data/refineries.json` расширен 25 → 28 entries: РН-Битум, НК Роснефть, Газпромнефть-Битумные материалы + extended aliases (АНПЗ ВНК, АНХК, РНПК, МНПЗ, ОНПЗ)

### Wave 2: Parsers (5 parsers)
- `parsers/shared.ts` (cellToDate/Number/String + loadWorkbook + colLetter/cellAddress for W4 trace)
- `parseBirzhaPrices`: ×1000 multiplier, "БНД-" prefix stripped
- `parseBirzhaVolumes`: ×1000 multiplier, column B "Объем итого" skipped
- `parseFcaSellers`: literal source="fca", A=point + B=region + C+ dates
- `parseAllPrices`: 'исходник' sheet (or worksheets[0]), dynamic column detection, BND fuel filter
- `parseBitumPriceNew`: snapshot {date, bnd, pbv} from F/G columns, deltaPct calculated

### Wave 3: Analyzer + Reporter
- `storage.ts` (WeekStatusV5 with 5 boolean flags + resetWeek + MIGRATE-03 fca.xlsx legacy fallback)
- `analyzer.ts`: deltasFor + volumeTotals + **byCompanyFixedOrder** (Роснефть → Газпромнефть → ЛУКОЙЛ → Прочие) + crossCheck (REPORT-08)
- `reporter.ts` (~430 lines): structural HTML per algoritm.md §6, partial-render (D-10), cell-trace footer (D-09), cross-check warnings (REPORT-08), HTML whitelist enforcement
- `.env.example` extended: BITUM_CROSS_CHECK_THRESHOLD, BITUM_VOLUMES_TOP_N

### Wave 4: LLM narrative (hybrid scope D-08)
- `llm.ts`: BITUM_NARRATIVE_SYSTEM_PROMPT with HARD jail "ЗАПРЕЩЕНО упоминать конкретные числа"
- response_format: json_object → {topSummary, rosneft, gazpromneft, lukoil, others}
- encodeReportForLlm sends ONLY direction (up/down/flat), NO numbers

### Wave 5: Bot commands
- Task 5.1: `src/bot.ts` helpers + interfaces получили `export` (6 functions + 3 interfaces)
- Task 5.2: `src/bot-bitum.ts` (6 handlers: handleBitumStatus/Preview/Report/Reset/Document/Callback)
- Task 5.3: bot.ts routing rewired — handleDocument delegates to handleBitumDocument; 4 битум-команды + aliases; setMyCommands updated (9 commands)
- Inline keyboards: LEARNING (6 buttons), publish (📤/❌), reset (✅/❌)
- In-memory pending Maps: publish, reset, learning

### Wave 6: Migration
- Task 6.1: `src/bitum/refineries.ts` created; all bitum imports updated
- Task 6.2: `src/bitum/index.ts` barrel + BITUM-MIGRATE-02 deprecation messaging per-user via Set
- Task 6.3: **src/upload/ deleted completely**, 8 upload-*.test.ts removed
- Task 6.4: CLAUDE.md updated (Stack/Conventions/Architecture)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest.config.ts: exclude .claude/worktrees**
- **Found during:** Task 1.1 baseline test
- **Issue:** Vitest scanned legacy worktree copies in `.claude/worktrees/`, ran 2844 tests (including stale duplicates), causing 15 false failures.
- **Fix:** Added `include: ["src/**/*.{test,spec}.*"]` + `exclude: [".claude/**"]` to vitest.config.ts
- **Files modified:** vitest.config.ts
- **Commit:** f666481

**2. [Rule 3 - Blocking] Adapted bot-handlers.test.ts for Phase 4 routing**
- **Found during:** Task 5.3 full test run
- **Issue:** 3 tests in bot-handlers.test.ts asserted legacy /summarize ("Папка ...", "файлов не загружено" via single sendMessage) — broke when wave 5 rewired to bitum_status/preview.
- **Fix:** Updated test expectations to match new bitum semantics (Битум-неделя, multi-sendMessage progress + warning). Adjusted vi.mock to add bitum/storage.js alongside existing upload/storage.js mock.
- **Files modified:** src/__tests__/bot-handlers.test.ts
- **Commit:** 54d410a (rolled into task 5.3)

**3. [Rule 3 - Blocking] Deleted bot-summarize.test.ts (legacy)**
- **Found during:** Task 5.3 full test run
- **Issue:** src/__tests__/bot-summarize.test.ts tested ONLY legacy /summarize handler that wave 5 removed (handleSummarizeCommand replaced by handleBitumPreview alias). 9 tests irrelevant to new semantics.
- **Fix:** Deleted file — coverage migrated to src/__tests__/bitum-bot-commands.test.ts + src/__tests__/bitum-bot-learning.test.ts (18 new tests).
- **Commit:** 54d410a

### Auto-added Critical Functionality

**4. [Rule 2 - Critical] colLetter/cellAddress helpers**
- **Added in:** Task 2.1
- **Reason:** Per checker W4, REPORT-07 requires real Excel A1 addresses in NumberTrace.cell (no "?" or "F?" placeholders). Plan referenced cellAddress/colLetter but they were not in src/upload — added to shared.ts.

**5. [Rule 1 - Bug fix] scoreSignature: empty `a3: ""` should not match (classifier.ts)**
- **Found during:** Task 1.4 (initial test design)
- **Issue:** Plan's signatures table had `a3: ""` for birzha_prices/birzha_volumes. With naive startsWith("") any A3 would match → confidence=1.0 falsely.
- **Fix:** scoreSignature checks `sig.a3 && sig.a3.length > 0` before startsWith. Plan's a3:"" treated as "no constraint" (the intended semantic).

**6. [Rule 1 - Bug fix] cls.type === "unknown" comparison after early return**
- **Found during:** Task 5.2 tsc
- **Issue:** Plan had `if (cls.type === "unknown") return; // type-narrow` AFTER `if (cls.confidence < 1 || cls.type === "unknown") return` — TypeScript complained: type already narrowed to KnownBitumType.
- **Fix:** Removed unreachable check, kept comment.

**7. [Rule 1 - Bug fix] framingSentences type**
- **Found during:** Task 5.2 tsc
- **Issue:** `let framingSentences: Record<string, string> | undefined` doesn't match NarrativeResult (5 specific keys).
- **Fix:** Type as `NarrativeResult | undefined` — structurally compatible with ReporterOptions.framingSentences.

## Known Stubs

None. All wired data flows produce real values from parsed xlsx → analyzer → reporter HTML.

## Self-Check: PASSED

### Files exist
- FOUND: src/bitum/types.ts
- FOUND: src/bitum/signatures.ts
- FOUND: src/bitum/classifier.ts
- FOUND: src/bitum/learned-signatures.ts
- FOUND: src/bitum/refineries.ts
- FOUND: src/bitum/storage.ts
- FOUND: src/bitum/analyzer.ts
- FOUND: src/bitum/reporter.ts
- FOUND: src/bitum/llm.ts
- FOUND: src/bitum/index.ts
- FOUND: src/bitum/parsers/{shared,birzha-prices,birzha-volumes,fca-sellers,all-prices,bitum-price-new,index}.ts (7 files)
- FOUND: src/bot-bitum.ts
- FOUND: data/bitum/.gitkeep

### Tests + tsc
- `npm test`: 291 passing across 25 test files
- `npx tsc --noEmit`: 0 errors

### Verification commands
- `test -d src/upload` → OK (does NOT exist)
- `grep -rn "from \"./upload\"" src/` → 0 matches
- `grep -F "В v6.0 будет удалена" src/bot.ts` → 1 match (MIGRATE-02 messaging)
- `node -e "console.log(JSON.parse(require('fs').readFileSync('data/refineries.json','utf8')).refineries.length)"` → 28

### Commits (chronological, all on main)
- f666481 chore(04): exclude .claude/worktrees from vitest scan
- 4f8b331 Task 1.1: types.ts
- f13cec4 Task 1.2: signatures.ts
- 46cde3d Task 1.3: learned-signatures.ts
- 60bdd18 Task 1.4: classifier.ts
- 60635da Task 1.5: data/refineries.json extension
- 69f6dcf Task 2.1: parsers/shared.ts
- fe9c445 Task 2.2: parsers/birzha-prices.ts
- af1fdd3 Task 2.3: parsers/birzha-volumes.ts
- 55f3ba3 Task 2.4: parsers/fca-sellers.ts
- f4b42b3 Task 2.5: parsers/all-prices.ts
- 194c3e0 Task 2.6: parsers/bitum-price-new.ts
- 9be2fca Task 2.7: parsers/index.ts barrel
- a0e7b99 Task 3.1: storage.ts
- 123b227 Task 3.2: analyzer.ts
- 7d3c1ec Task 3.3: reporter.ts
- a8bc90b Task 3.4: .env.example BITUM_* vars
- 46bdf2b Task 4.1: llm.ts hybrid scope
- f2afdc7 Task 5.1: bot.ts exports
- ce5a4e6 Task 5.2: bot-bitum.ts
- 54d410a Task 5.3: bot.ts wire-up
- dfe43c4 Task 6.1: bitum/refineries.ts migration
- a693c69 Task 6.2: bitum/index.ts + deprecation aliases
- 16cc578 Task 6.3: src/upload deletion
- 975b53f Task 6.4: CLAUDE.md update
