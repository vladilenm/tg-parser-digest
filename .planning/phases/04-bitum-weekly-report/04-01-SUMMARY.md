---
phase: 4
plan: 1
subsystem: bitum-weekly-report
tags: [bitum, telegram-bot, xlsx-pipeline, programmatic-report, v5.1-rewrite]
dependency_graph:
  requires: [Phase 3 — Web Scraping complete (independent)]
  provides:
    - "Programmatic битум-pipeline (4 типа xlsx, always-ask UX, manual numbers, плоский отчёт)"
    - "Cross-check «Битум прайс» vs birzha_prices/fca_sellers (threshold 1.0%, env)"
    - "Cell-trace footer per-file для аудита extractive-чисел"
  affects:
    - "src/bot.ts (handleDocument → handleBitumDocument, handleCommand routes 4 bitum-команды, handleCallback bu/br/brs prefix routing, setMyCommands updated)"
    - ".planning/REQUIREMENTS.md (9 cancelled IDs из v5.0, 10 переписаны, 1 новый BITUM-TG-08)"
    - ".planning/ROADMAP.md (Phase 4 Goal + Requirements line обновлены под v5.1)"
tech_stack:
  added: []  # ExcelJS, zod, openai, telegram уже были — никаких новых deps
  patterns:
    - "Pure-функции + dict-аргументом (D-CLAUDE.md): normalizeRefinery, analyzeBitum, buildReport"
    - "Per-week in-process Promise-chain mutex (storage.ts, manual-numbers.ts) — изоляция concurrent uploads разных недель"
    - "Atomic .tmp + rename для всех state файлов (saveXlsx, addManualNumber)"
    - "Zod-валидация per-row в парсерах с errors collection — парсер не падает на битых строках"
    - "Module-level state Maps для pendingUploads / pendingReports + setTimeout TTL"
    - "Telegram HTML whitelist (<b>, <i>, <code>, <a>) — escapeHtml для всех динамических строк (T-04-06)"
    - "Cell-trace per-file compact (одна строка per file, склейка `; `) — T-04-07 без token/cwd"
key_files:
  created:
    - "src/bitum/types.ts (14 types + 2 const)"
    - "src/bitum/storage.ts (isoWeekFolder, weekDir, saveXlsx, resetWeek, getWeekStatus, findLatestWeekWithUploads + per-week mutex)"
    - "src/bitum/manual-numbers.ts (addManualNumber, listManualNumbers, clearManualNumbers + sanitize)"
    - "src/bitum/refineries.ts (loadRefineriesDict, normalizeRefinery, getCompany)"
    - "src/bitum/parsers/shared.ts (BITUM_MAX_ROWS, loadFirstSheet, excelDateToIso, cellNumber/String, stripBndPrefix)"
    - "src/bitum/parsers/birzha-volumes.ts (parseBirzhaVolumes)"
    - "src/bitum/parsers/birzha-prices.ts (parseBirzhaPrices, idempotent strip «БНД-»)"
    - "src/bitum/parsers/fca-sellers.ts (parseFcaSellers)"
    - "src/bitum/parsers/bitum-price-new.ts (parseBitumPriceNew, parsePrice/parseDelta)"
    - "src/bitum/parsers/index.ts (barrel)"
    - "src/bitum/analyzer.ts (analyzeBitum)"
    - "src/bitum/reporter.ts (buildReport, escapeHtml, fmtDateRu, signed)"
    - "src/bitum/index.ts (barrel)"
    - "src/bot-bitum.ts (~660 строк: handleBitumDocument, Status, Report, Reset, Add, Callback)"
  modified:
    - "src/bot.ts (clean rewrite — handleDocument bridge, 4 битум-команды, callback prefix routing, setMyCommands, MAIN_KEYBOARD, EMOJI_BUTTON_MAP)"
    - "src/__tests__/bot-handlers.test.ts (удалены тесты на bitum routing, fix keyboard expectation, удалены vi.mock на upload/bitum/storage)"
    - ".planning/REQUIREMENTS.md (v5.1 scope)"
    - ".planning/ROADMAP.md (Phase 4 секция)"
  deleted:
    - "src/bitum/ (старая реализация: classifier.ts, signatures.ts, learned-signatures.ts, llm.ts, 5 парсеров включая all-prices, analyzer.ts, reporter.ts, storage.ts, types.ts, index.ts)"
    - "src/bot-bitum.ts (старая реализация)"
    - "src/__tests__/bitum-*.test.ts (18 файлов)"
    - "data/bitum/.gitkeep"
    - "5 obsolete xlsx из docs/examples (цены битум все 30.04-08.05 — тип all_prices отменён D-02)"
decisions:
  - "user-override-2026-05-22: «не пиши тесты пока, только функционал» — все 10 *.test.ts из plan.files_modified НЕ созданы; статус requirements: «Implementation complete, tests deferred»"
  - "D-05 (always-ask UX): inline-keyboard на каждую загрузку, 4 кнопки типов + Отмена; никакой автоклассификации"
  - "D-10 (no LLM): дайджест полностью programmatic; src/bitum/llm.ts удалён, OpenAI не вызывается из bitum-flow"
  - "D-11 (плоский отчёт): movements sorted by |Δ| desc, БЕЗ группировки по холдингам"
  - "D-18 cross-check: bitum_price_new (источник истины) vs birzha_prices/fca_sellers, threshold env BITUM_CROSS_CHECK_THRESHOLD (default 1.0%)"
  - "Default — нужно подтверждение оператора на execute-phase (9 items, см. ниже)"
metrics:
  duration_estimate: ~90 минут (без тестов)
  tasks_completed: 14 (Task 1-11, with 6a-6d split)
  files_created: 14
  files_modified: 4
  files_deleted: 24
  completed_date: 2026-05-22
---

# Phase 4 Plan 1: Битумный недельный отчёт — упрощённый pipeline (v5.1 full rewrite) Summary

**One-liner:** Полный rewrite битум-pipeline под always-ask UX (4 типа xlsx, без автоклассификации), плоский programmatic-дайджест без LLM, /bitum_add для ручных чисел, cross-check vs «Битум прайс».

## ⚠️ Tests deferred per user override

**КРИТИЧНО:** Пользователь явно сказал: «не пиши тесты пока, только функционал». Поэтому:

- **НЕ создано** ни одного нового `src/__tests__/bitum-*.test.ts` (хотя в `plan.files_modified` они перечислены — 10 файлов).
- **TDD red→green flow пропущен** в каждой задаче с `tdd="true"`: только production source files, без preceding failing tests.
- **Все 19 BITUM-* requirements в Traceability table помечены статусом** «Implementation complete, tests deferred».
- **Старые `src/__tests__/bitum-*.test.ts` (18 файлов) удалены в Task 1** — это часть существующего scope plan'а (cleanup), не нарушение user override.
- **Phase-level verification (`/gsd-verify-phase`) будет ожидаемо ругаться** на отсутствие тестов — это acceptable, тесты добавятся в follow-up phase.

**Commit messages** содержат строку `Tests deferred per user override (no new *.test.ts files added).` для аудита.

## Tasks Outcomes

| Task | Name | Commit | Status | Files |
|------|------|--------|--------|-------|
| 1 | Cleanup — удаление старой битум-реализации | af77dcd | ✅ | -24 files (src/bitum/, src/bot-bitum.ts, 18 tests, data/bitum, 5 obsolete xlsx, bitum-ветки в bot.ts) |
| 2 | src/bitum/types.ts — все контракты | 6d1f95b | ✅ | +1 (141 lines) |
| 3 | src/bitum/storage.ts — ISO-week + per-week mutex | e7502e7 | ✅ | +1 (222 lines) |
| 4 | src/bitum/manual-numbers.ts — /bitum_add storage | 282e400 | ✅ | +1 (134 lines) |
| 5 | src/bitum/refineries.ts — словарь НПЗ + normalize | 2785e54 | ✅ | +1 (90 lines) |
| 6a | parsers/shared.ts + parsers/birzha-volumes.ts | 1317961 | ✅ | +2 (258 lines) |
| 6b | parsers/birzha-prices.ts | fe29757 | ✅ | +1 (126 lines) |
| 6c | parsers/fca-sellers.ts | f12445e | ✅ | +1 (128 lines) |
| 6d | parsers/bitum-price-new.ts + parsers/index.ts | a24d542 | ✅ | +2 (164 lines) |
| 7 | src/bitum/analyzer.ts | 9291651 | ✅ | +1 (279 lines) |
| 8 | src/bitum/reporter.ts | 477bc08 | ✅ | +1 (224 lines) |
| 9 | src/bot-bitum.ts + src/bitum/index.ts | f8b2de0 | ✅ | +2 (697 lines total — 661 + 36) |
| 10 | src/bot.ts wiring | 49000f3 | ✅ | M (100 ins / 53 del) |
| 11 | REQUIREMENTS.md + ROADMAP.md sync | 8c5ad03 | ✅ | M (78 ins / 93 del) |

**Total**: 14 commits, 0 failures, 0 checkpoints reached.

## Deviations from Plan

### From user override

1. **All `tdd="true"` test creation skipped** (10 tests in plan): Task 3 (storage), Task 4 (manual-numbers), Task 5 (refineries), Tasks 6a-6d (4 parsers), Task 7 (analyzer), Task 8 (reporter), Task 9 (bot-bitum). Source files implemented directly from `<behavior>` specs.
2. **Task 5 coverage test omitted**: `extractRefineryNamesFromXlsx` helper не написан (это test-only). Поэтому coverage gap проверки (29 НПЗ в dict vs все НПЗ в 4 эталонных xlsx) — отложен. На UAT оператор увидит unmatched НПЗ в `refineryCanonical` (будет `=== refineryRaw`, matched=false) и сможет ручной командой добавить в `data/refineries.json`.

### Auto-fixes (Rule 1-3)

1. **[Rule 3 — Blocking]** `src/__tests__/bot-handlers.test.ts` ссылался на удалённые модули `../upload/storage.js` и `../bitum/storage.js` через `vi.mock(...)` — это блокировало vitest. Удалил vi.mock'и + два теста, ссылающиеся на удалённые EMOJI кнопки/команды. Также fix MAIN_KEYBOARD expectation (`🧠 Сделать сводку` → `🧠 Отчёт битум`) и /help expectation (xlsx → /channels).
2. **[Rule 2 — Critical functionality]** В `src/bot.ts:handleDocument` добавил pre-check `doc.file_size > BITUM_MAX_XLSX_BYTES` ДО `downloadTgFile` — это первый уровень T-04-01 (защита от трат TG bandwidth на гигантские файлы); второй уровень — в `handleBitumDocument` (после download, для случая если file_size был ложным).

## Authentication Gates

None encountered.

## Claude's Discretion Defaults (9 items)

Все 9 default'ов помечены в коде комментариями `# Default — нужно подтверждение оператора на execute-phase`:

| # | Decision | Default | Where |
|---|----------|---------|-------|
| 1 | Cross-check threshold | 1.0% (env `BITUM_CROSS_CHECK_THRESHOLD`) | `bot-bitum.ts:handleBitumReport`, `analyzer.ts options.thresholdPct` |
| 2 | Cross-check direction | `bitum_price_new` (источник истины) vs `birzha_prices`/`fca_sellers` | `analyzer.ts:crossCheck` |
| 3 | /bitum_add syntax | split first `=` (e.g. `Средняя цена БНД=28336 ₽/т`) | `bot-bitum.ts:handleBitumAdd` |
| 4 | Sort movements | `|Δ|` desc, tiebreak `refineryCanonical` ASC | `analyzer.ts` final sort |
| 5 | Cell-trace footer format | per-file compact, одна строка `{fileType}.xlsx: {N} чисел из {range}` склейка `; ` | `reporter.ts:buildTraceFooter` |
| 6 | Pending preview timeout | 15 min (`REPORT_TTL_MS = 15 * 60 * 1000`) | `bot-bitum.ts` |
| 7 | Overwrite xlsx behavior | silent overwrite + `log.info("[bitum-storage] overwrite: ...")` | `storage.ts:saveXlsx` |
| 8 | manual-numbers.json format | плоский массив `ManualNumber[]` (для возможной /bitum_remove в будущем — refactor) | `manual-numbers.ts` |
| 9 | volumesTopN / movements cap | TopN=7 (analyzer options default), MOVEMENTS_CAP=50 (reporter overflow) | `analyzer.ts`, `reporter.ts` |
| 10 (bonus) | BITUM_MAX_XLSX_BYTES | 10 MB (env override) | `bot-bitum.ts`, `bot.ts:handleDocument` |
| 11 (bonus) | BITUM_MAX_ROWS | 2000 (env override) | `parsers/shared.ts` |

## Fixture files used as ground truth

- `docs/examples/birzha — суточная по НПЗ_rev.xlsx` (verified row 3 = headers C..N, data row 4..N)
- `docs/examples/birzha — цены НПЗ_rev.xlsx` (verified row 3 = headers B..M, BNDпрефикс)
- `docs/examples/BITUM — таблица продавцы_rev.xlsx` (verified: A "Пункт отгрузки", B "Регион", C/D price prev/curr, E delta formula, D3 = end-of-period date; rowCount=26)
- `docs/examples/bitum_price — Сводная таблица_new.xlsx` (verified: A "Дата", B "Пункт отгрузки", C "Компания", F "БНД - Цена недели" (string!), G "БНД - Изменение" ("не изм." / "▲ (+N)" / "▼ (-N)"); rowCount=36)

Координаты для парсеров зафиксированы константами; helper `dumpSheet*.tmp.mjs` (использовался во время разработки для верификации, удалён после).

## STRIDE Threat Mitigation Status

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-04-01 (xlsx > 10 MB) | ✅ Two-level: `bot.ts:handleDocument` pre-check via `doc.file_size` + `bot-bitum.ts:handleBitumDocument` post-download `buffer.length` check |
| T-04-02 (too many rows / zip-bomb) | ✅ `BITUM_MAX_ROWS` (env, default 2000) checked после `workbook.xlsx.load` во всех 4 парсерах |
| T-04-03 (path traversal через type) | ✅ `storage.ts:saveXlsx` assert `BITUM_TYPES.includes(type)` перед `path.join` |
| T-04-04 (concurrent /bitum_add race) | ✅ `manual-numbers.ts` per-week Promise-chain mutex |
| T-04-05 (concurrent upload + reset race) | ✅ `storage.ts` per-week mutex (saveXlsx + resetWeek через тот же `withWeekLock`) |
| T-04-06 (XSS via /bitum_add → reporter) | ✅ `manual-numbers.ts` strips control chars + length cap 200; `reporter.ts:escapeHtml` для всех динамических строк |
| T-04-07 (token в error reply) | ✅ Все handlers используют `(err.message ?? String(err)).slice(0, 300)`; `tgFetch` уже не логирует body request'а; cell-trace footer содержит только `fileType.xlsx` (без cwd / token) |
| T-04-08 (callback spoof) | ✅ Already mitigated by `handleCallbackQuery` allowlist-check (см. `src/bot.ts:handleCallbackQuery`) — никаких изменений в этой проверке |
| T-04-09 (flood) | accept — allowlist trust model |
| T-04-10 (publish repudiation) | ✅ `log.info("[bitum] publish: userId=%s hash=%s chars=%d")` в `handleBitumCallback br:publish` — audit trail в `data/logs/run-*.log` |

## Known Stubs

**None.** Все стабы либо реализованы, либо документированы как Future scope в REQUIREMENTS.md (BITUM-OCR-01, BITUM-TG-06, BITUM-TG-07, BITUM-AUTOSEND-01).

## Threat Flags

**None.** Все обнаруженные surfaces покрыты STRIDE register T-04-01..10.

## Deferred Issues

1. **All vitest tests** (BITUM-PARSE/STORAGE/REFINERIES/MANUAL-NUMBERS/ANALYZER/REPORTER/BOT-BITUM coverage) — отложены до follow-up phase per user override.
2. **Task 5 coverage test** — `extractRefineryNamesFromXlsx` не написан (test-only helper). Coverage gap проверки 29 НПЗ vs 4 эталонных xlsx — будет проверена при первом UAT-прогоне через `matched: false` в parsed rows.
3. **CLAUDE.md sync** — отложен в отдельный `/gsd-quick` после execute-phase verify (см. Task 11 NOTE). CLAUDE.md содержит project-instructions с пометкой OVERRIDES default behavior — модификация должна быть deliberate, отдельным GSD-flow.
4. **`/bitum_remove`** — для удаления одной пары label+value (не отдельной фазы) — пока через `/bitum_reset` (обнуляет всё) + добавить заново.

## Verification Status

- ✅ `npx tsc --noEmit` — exit 0
- ✅ `npx vitest run` — 160/160 passing (7 test files)
- ✅ `src/bitum/` содержит 8 модулей (types, storage, manual-numbers, refineries, parsers/, analyzer, reporter, index) + parsers/ subdir (6 файлов: 4 парсера + shared + index)
- ✅ `src/bot-bitum.ts` — 6 exports (handleBitumDocument, Status, Report, Reset, Add, Callback)
- ✅ `src/bot.ts` — 4 bitum-команды wired, callback prefix `(bu|br|brs):` routed первым
- ✅ Никаких `/bitum_preview`, `/summarize`, `/upload_status`, `deprecationShownByUser`, `sendMarkdown` в `src/bot.ts`
- ✅ `.planning/REQUIREMENTS.md` — 9 cancelled IDs удалены, BITUM-TG-08 добавлен, 19 IDs в traceability
- ✅ `.planning/ROADMAP.md` — Phase 4 Goal обновлён, Requirements line — 19 IDs
- ⏳ Phase-level vitest verification ожидаемо ругнётся на отсутствие новых битум-тестов — acceptable per user override

## Self-Check: PASSED

**Files created/modified verified:**
- `src/bitum/types.ts` FOUND
- `src/bitum/storage.ts` FOUND
- `src/bitum/manual-numbers.ts` FOUND
- `src/bitum/refineries.ts` FOUND
- `src/bitum/parsers/{shared,birzha-volumes,birzha-prices,fca-sellers,bitum-price-new,index}.ts` FOUND (6 файлов)
- `src/bitum/analyzer.ts` FOUND
- `src/bitum/reporter.ts` FOUND
- `src/bitum/index.ts` FOUND
- `src/bot-bitum.ts` FOUND
- `src/bot.ts` modified (verified diff)
- `.planning/REQUIREMENTS.md` modified
- `.planning/ROADMAP.md` modified

**Commits verified (14 task commits + final summary commit pending):**
- af77dcd, 6d1f95b, e7502e7, 282e400, 2785e54, 1317961, fe29757, f12445e, a24d542, 9291651, 477bc08, f8b2de0, 49000f3, 8c5ad03 — все в `git log --oneline -15`
