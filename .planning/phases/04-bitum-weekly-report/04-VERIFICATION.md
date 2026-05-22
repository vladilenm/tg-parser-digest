---
phase: 04-bitum-weekly-report
verified: 2026-05-22T10:30:00Z
status: human_needed
score: 11/11 must-haves verified (programmatic) + 6 awaiting behavioural UAT
overrides_applied: 0
overrides:
  - must_have: "10 vitest test files for bitum-* modules (src/__tests__/bitum-*.test.ts)"
    reason: "User override 2026-05-22: «не пиши тесты пока, только функционал». Tests deliberately deferred per orchestrator note; all 19 BITUM-* requirements marked «Implementation complete, tests deferred» in REQUIREMENTS.md. Follow-up phase will add coverage."
    accepted_by: "user (mininvlad@gmail.com)"
    accepted_at: "2026-05-22T00:00:00Z"
human_verification:
  - test: "Загрузить «BITUM — таблица продавцы.xlsx» в DM боту, тапнуть кнопку «Битум таблица продавцы»"
    expected: "Бот отвечает inline-keyboard'ом из 5 кнопок (4 типа + Отмена), после тапа отвечает чек-листом «✅ Сохранено как fca_sellers.xlsx. Период: ... Распознано N строк, ошибок: K. Чек-лист недели: …»"
    why_human: "Inline-keyboard UX + реальная парсинг-семантика fca_sellers (D3 = end-of-period date) проверяются только в живом Telegram"
  - test: "Загрузить все 4 эталонных xlsx, выполнить /bitum_report, проверить превью в DM"
    expected: "DM получает дайджест с period header + плоский список движений (sort by |Δ| desc) + cross-check warning (если расхождения > 1%) + cell-trace footer; затем bot предлагает «📤 Опубликовать / ❌ Отмена»"
    why_human: "Структура HTML дайджеста, корректность чисел из xlsx, отсутствие галлюцинаций (extractive numbers), правильность плоского порядка"
  - test: "На превью /bitum_report нажать «📤 Опубликовать»"
    expected: "Тот же HTML контент уходит в TG_CHANNEL_ID, edit на исходном сообщении: «📤 Опубликовано в канал». Лог: [bitum] publish: userId=... hash=... chars=..."
    why_human: "Реальный TG_CHANNEL_ID delivery + audit trail в logs можно проверить только живым прогоном"
  - test: "/bitum_add Средняя цена БНД=28336 ₽/т, затем /bitum_report"
    expected: "В превью между period header и блоком объёмов появляется блок «<i>Контекст оператора:</i>» с «<b>Средняя цена БНД:</b> 28336 ₽/т»"
    why_human: "Position of manual numbers block в HTML (D-16) — проверяется визуально"
  - test: "/bitum_reset → «✅ Сбросить»"
    expected: "data/uploads/<ISO-week>/ удаляется целиком (4 xlsx + manual-numbers.json), бот edit'ит сообщение на «✅ Неделя ... сброшена. Удалено файлов: N»"
    why_human: "FS side-effect + UX подтверждения проверяется в живом боте"
  - test: "Подождать 15 минут после /bitum_report без нажатия кнопки, потом нажать «📤 Опубликовать»"
    expected: "Бот edit'ит сообщение: «⏳ Превью истёк (15 мин). Повторите /bitum_report.». В канал ничего не уходит."
    why_human: "REPORT_TTL_MS timeout — поведение требует прогона времени, не покрывается grep"
---

# Phase 4: bitum-weekly-report Verification Report

**Phase Goal:** Заказчик присылает 4 xlsx-файла в DM боту в произвольном порядке; на каждый файл бот спрашивает inline-keyboard'ом из 4 кнопок «что это»; накапливает недельный пакет; по `/bitum_report` бот строит programmatic-дайджест (period header + ручные числа из `/bitum_add` + плоский список движений с cell-trace footer + cross-check warnings) и публикует в `TG_CHANNEL_ID` только после подтверждения кнопкой «📤 Опубликовать».

**Verified:** 2026-05-22T10:30:00Z
**Status:** human_needed — programmatic checks all PASS, but UX/Telegram behaviours require a live UAT pass
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Каждая загрузка xlsx в DM вызывает inline-keyboard с 4 кнопками типов + «❌ Отмена/Не битум»; никакой автоклассификации | ✓ VERIFIED | `bot-bitum.ts:124-137` строит keyboard из BITUM_TYPES + cancel; `classifier.ts`/`signatures.ts`/`learned-signatures.ts` отсутствуют (D-03/D-05) |
| 2 | После тапа кнопки файл сохраняется как `data/uploads/<ISO-week>/<type>.xlsx` и парсится; ответ содержит чек-лист 4 типов | ✓ VERIFIED | `bot-bitum.ts:489-560` (saveXlsx + 4-парсера switch + checklist build); `storage.ts:saveXlsx` (atomic .tmp+rename, per-week mutex) |
| 3 | /bitum_status показывает чек-лист текущей ISO-недели (4 boolean + список ручных чисел) | ✓ VERIFIED | `bot-bitum.ts:151-173` (build status lines из getWeekStatus); `storage.ts:154-193` (getWeekStatus возвращает present + manualNumbersCount + lastUpdatedAt) |
| 4 | /bitum_report строит programmatic-дайджест и шлёт превью в DM с кнопками «📤 Опубликовать / ❌ Отмена»; публикация в TG_CHANNEL_ID только после Опубликовать | ✓ VERIFIED | `bot-bitum.ts:226-285` (loadAndParseWeek → analyzeBitum → buildReport → chunkHtml → sendHtml DM + sendReplyWithKeyboard); `bot-bitum.ts:595-614` publish branch вызывает `sendToChannel(pending.html)` |
| 5 | /bitum_reset обнуляет текущую ISO-неделю (xlsx + manual-numbers.json) только после подтверждения | ✓ VERIFIED | `bot-bitum.ts:291-334` (preview с keyboard «✅ Сбросить / ❌ Отмена»); `bot-bitum.ts:633-656` brs:confirm вызывает `resetWeek(week) + clearManualNumbers(week)` |
| 6 | /bitum_add label=value добавляет запись в manual-numbers.json; ручные числа появляются в дайджесте отдельным блоком после period header | ✓ VERIFIED | `bot-bitum.ts:340-390` (split first `=`, addManualNumber); `reporter.ts:210-218` blocks list: period header → buildManualNumbersBlock → partial-render → ... |
| 7 | Дайджест не использует DeepSeek; все строки programmatic; src/bitum/llm.ts отсутствует | ✓ VERIFIED | `src/bitum/llm.ts` ABSENT (verified `test -f`); reporter.ts/analyzer.ts/bot-bitum.ts — нет imports `openai`/`DeepSeek`; D-10 honoured |
| 8 | Все парсеры идемпотентны, возвращают ParserResult<T> = { rows, errors }, не падают на битых строках | ✓ VERIFIED | Все 4 парсера обёрнуты в try/catch (push в errors, не throw); `BITUM_MAX_ROWS` pre-flight (T-04-02); Zod safeParse per-row с push errors при failure |
| 9 | Cell-trace footer присутствует в каждом дайджесте; partial-render warning при <4 типов | ✓ VERIFIED | `reporter.ts:144-154` buildTraceFooter (всегда добавляется, даже при traces=[]); `reporter.ts:72-84` buildPartialRenderBlock (returns null только когда все 4 present) |
| 10 | Cross-check между bitum_price_new и birzha_prices/fca_sellers выдаёт warning при расхождении > BITUM_CROSS_CHECK_THRESHOLD | ✓ VERIFIED | `analyzer.ts:183-241` crossCheck (bitum_price_new vs lastBirzha + lastFca per refinery, push CrossCheckIssue если pct > thresholdPct); env reading в `bot-bitum.ts:245-247` |
| 11 | Если оператор не нажал кнопку на превью /bitum_report за 15 минут — preview истекает; для публикации нужен повторный /bitum_report | ✓ VERIFIED | `bot-bitum.ts:78` REPORT_TTL_MS = 15*60*1000; `bot-bitum.ts:264-266` setTimeout(pendingReports.delete(hash)); `bot-bitum.ts:586-593` check pending → «⏳ Превью истёк (15 мин)...» |

**Score:** 11/11 truths verified programmatically.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/bitum/types.ts` | BitumType union (4 типа), ParsedRow*, ParserResult<T>, WeekStatus, AnalysisResult, ReportResult, NumberTrace (alias ReportTrace), ManualNumber | ✓ VERIFIED | 142 LOC, exports: BitumType, BITUM_TYPES, BITUM_BUTTON_LABELS, ParserError, ParserResult, ParsedVolumeRow, ParsedPriceRow, ParsedFcaRow, ParsedBitumPriceNewRow, ParsedByType, WeekStatus, ManualNumber, PriceMovement, CrossCheckIssue, VolumeAggregate, AnalysisResult, ReportTrace, ReportResult |
| `src/bitum/storage.ts` | isoWeekFolder, weekDir, saveXlsx, resetWeek, getWeekStatus, findLatestWeekWithUploads + per-week mutex | ✓ VERIFIED | 223 LOC; все exports присутствуют; atomic .tmp+rename + per-week Promise-chain mutex; T-04-03 type-assert |
| `src/bitum/manual-numbers.ts` | addManualNumber, listManualNumbers, clearManualNumbers (atomic + mutex) | ✓ VERIFIED | 135 LOC; sanitize (T-04-06 control chars + 200 cap); atomic .tmp+rename; локальный per-week mutex (NB: WR-03 — отдельный от storage.ts mutex; см. Anti-Patterns) |
| `src/bitum/refineries.ts` | loadRefineriesDict, normalizeRefinery, getCompany (pure, dict-arg) | ✓ VERIFIED | 90 LOC; Zod validation; case-insensitive lookup canonical+aliases; unknown → {canonical: trimmed, matched: false} (D-CLAUDE.md no throw) |
| `src/bitum/parsers/shared.ts` | BITUM_MAX_ROWS, loadFirstSheet, excelDateToIso, cellNumber, cellString, stripBndPrefix | ✓ VERIFIED | 127 LOC; все helper'ы exported и используются 4 парсерами |
| `src/bitum/parsers/birzha-volumes.ts` | parseBirzhaVolumes(buffer, dict) => ParserResult<ParsedVolumeRow> | ✓ VERIFIED | 133 LOC; row 3 headers, row 4..N data (col A date, B..T volumes); ×1000 множитель; Zod safeParse |
| `src/bitum/parsers/birzha-prices.ts` | parseBirzhaPrices(buffer, dict) => ParserResult<ParsedPriceRow>; idempotent strip «БНД-» | ✓ VERIFIED | 127 LOC; stripBndPrefix применяется к headers; ×1000 множитель; Zod safeParse |
| `src/bitum/parsers/fca-sellers.ts` | parseFcaSellers(buffer, dict) => ParserResult<ParsedFcaRow>; Date = D3; deltaWeek из E, fallback D-C | ✓ VERIFIED | 129 LOC; D3 = end-of-period date; delta = cellE, fallback priceCurr - pricePrev, default 0 |
| `src/bitum/parsers/bitum-price-new.ts` | parseBitumPriceNew(buffer, dict) => ParserResult<ParsedBitumPriceNewRow>; «не изм.» / «▲ (+N)» / «▼ (-N)» | ✓ VERIFIED | 158 LOC; parsePrice + parseDelta (▲/▼ → sign); company прямо из C-колонки |
| `src/bitum/parsers/index.ts` | barrel | ✓ VERIFIED | 8 LOC; экспортирует 4 парсера + BITUM_MAX_ROWS |
| `src/bitum/analyzer.ts` | analyzeBitum(parsed, dict, options) => AnalysisResult с плоским movements + cross-check | ✓ VERIFIED | 280 LOC; computePeriod + aggregateVolumes + 3 movement builders + crossCheck; sort by |Δ| desc, tiebreak refineryCanonical ASC |
| `src/bitum/reporter.ts` | buildReport(analysis, manualNumbers, weekStatus) => {html, trace}; escapeHtml | ✓ VERIFIED | 224 LOC; 6 buildBlock helpers; escapeHtml на всех динамических строках (T-04-06); MOVEMENTS_CAP=50; cell-trace footer per-file compact |
| `src/bitum/index.ts` | barrel | ✓ VERIFIED | 33 LOC; экспортирует все types + 6 storage + 3 manual-numbers + refineries + parsers + analyzer + reporter |
| `src/bot-bitum.ts` | handleBitumDocument, handleBitumStatus, handleBitumReport, handleBitumReset, handleBitumAdd, handleBitumCallback | ✓ VERIFIED | 665 LOC; все 6 exports; T-04-01 size check; pendingUploads + pendingReports state Maps; bu:/br:/brs: prefix routing |
| `data/refineries.json` | 29 НПЗ + company field покрытие 4 эталонных xlsx | ✓ VERIFIED | 29 entries; companies: Газпромнефть (3), Роснефть (10), ЛУКОЙЛ (2), Татнефть (1), независимые (13); v=2 |

**Deferred (override):** 10 test files in `src/__tests__/bitum-*.test.ts` — accepted per user override.

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/bot.ts:handleDocument` | `src/bot-bitum.ts:handleBitumDocument` | сразу после downloadTgFile | ✓ WIRED | `bot.ts:230` import + `bot.ts:314` call site (после downloadTgFile в строке 306) |
| `src/bot.ts:handleCommand` | `src/bot-bitum.ts:{handleBitumStatus,Report,Reset,Add}` | switch для 4 битум-команд | ✓ WIRED | `bot.ts:425,429,433,437` — 4 if-блока, каждый вызывает соответствующий handler |
| `src/bot.ts:handleCallbackQuery` | `src/bot-bitum.ts:handleBitumCallback` | prefix-routing bu:/br:/brs: | ✓ WIRED | `bot.ts:500-504` — regex `/^(bu\|br\|brs):/` + raised first перед remove-channel router |
| `src/bot-bitum.ts:handleBitumReport` | `src/bitum/reporter.ts:buildReport` | сборка previewHtml перед sendHtml в DM | ✓ WIRED | `bot-bitum.ts:251` const { html } = buildReport(analysis, manual, status); затем chunkHtml + sendHtml |
| `src/bot.ts:setMyCommands` | 4 битум-команды в меню Telegram | bitum_status/report/reset/add (без bitum_preview) | ✓ WIRED | `bot.ts:604-613` — 4 entry, никаких legacy bitum_preview/summarize/upload_status |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `bot-bitum.ts:handleBitumStatus` | `lines[]` HTML | `getWeekStatus(week)` → реальное FS-чтение `data/uploads/<week>/` | Yes — реальное FS-сканирование 4 xlsx + manual-numbers.json | ✓ FLOWING |
| `bot-bitum.ts:handleBitumReport` | `html` from buildReport | `loadAndParseWeek` (читает FS, парсит 4 xlsx) → `analyzeBitum` → `buildReport` | Yes — реальные данные xlsx → programmatic HTML | ✓ FLOWING |
| `bot-bitum.ts:handleBitumAdd` | `manual-numbers.json` entry | `addManualNumber(week, label, value)` атомарная запись | Yes — реальный write на FS | ✓ FLOWING |
| `bot-bitum.ts:handleBitumReset` confirm | `resetWeek` + `clearManualNumbers` | rmSync на dir + unlinkSync на manual-numbers.json | Yes — реальный FS-mutation | ✓ FLOWING |
| `bot-bitum.ts handleBitumCallback bu:type` | `saveXlsx + parseX(buffer)` | реальный write xlsx + парсер запускается на buffer | Yes — buffer из pendingUploads (real download from TG) | ✓ FLOWING |
| `reporter.ts:buildReport` | trace footer cellRange | analysis.available + meta (только known counts, но cellRange захардкожен как `B4:T?` etc) | ⚠️ STATIC — cellRange в footer фиксированный (`B4:T?`, `A4:E?`, `A2:I?`) — это компромисс default cell-trace формата | ⚠️ STATIC |

**Comment on STATIC cellRange:** Per Default #5 в SUMMARY, формат footer — "per-file compact, одна строка `{fileType}.xlsx: {N} чисел из {range}`". Реальный `meta.cellRange` из ParserResult ВЫЧИСЛЯЕТСЯ в парсерах (`birzha-volumes.ts:118`, etc), но в reporter передаётся не ParserResult а только analysis result (без meta). Это ограничение текущего контракта `buildReport(analysis, manualNumbers, weekStatus)` — meta пропадает между парсером и reporter. Cell-trace footer показывает только тип файла + ленивые "?" в диапазоне — это удовлетворяет REPORT-07 на букве (cell-trace footer присутствует), но fidelity ниже чем мог бы быть. Не блокирует goal достижение, потенциальный improvement для follow-up phase.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compilation passes | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Existing tests still green | `npx vitest run` | Test Files 7 passed, Tests 160 passed (160) — 405ms | ✓ PASS |
| src/bitum/llm.ts absent (no LLM in bitum-flow) | `test -f src/bitum/llm.ts` | not found (correct per D-10) | ✓ PASS |
| classifier.ts / signatures.ts deleted | `test -f src/bitum/{classifier,signatures}.ts` | both absent (correct per D-03/D-05) | ✓ PASS |
| src/upload/ legacy gone | `ls src/upload` | No such file or directory (correct per BITUM-MIGRATE-01) | ✓ PASS |
| data/bitum/ legacy gone | `ls data/bitum` | No such file or directory (correct per BITUM-MIGRATE-03) | ✓ PASS |
| No legacy command names in bot.ts | `grep -E "bitum_preview\|/summarize\|/upload_status\|sendMarkdown"` in bot.ts | 0 matches (correct per BITUM-MIGRATE-02) | ✓ PASS |
| 4 bitum commands in setMyCommands | `grep "command: \"bitum_" src/bot.ts` | 4 commands (status, report, reset, add) | ✓ PASS |
| TG_CHANNEL_ID delivery wired | `grep "TG_CHANNEL_ID" src/deliver.ts` | `sendToChannel` reads `process.env.TG_CHANNEL_ID` | ✓ PASS |
| Bot polling alive | needs running bot | (not started — agents must not start services) | ? SKIP — requires live UAT |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| BITUM-PARSE-01 | parseBirzhaPrices — row 3 headers, row 4..N, ×1000, Zod, no-fail | ✓ SATISFIED | `parsers/birzha-prices.ts` — все условия выполнены |
| BITUM-PARSE-02 | parseBirzhaVolumes — row 3, ×1000, Zod | ✓ SATISFIED | `parsers/birzha-volumes.ts` |
| BITUM-PARSE-03 | parseFcaSellers — A..E, Date=D3, delta из E + fallback D-C | ✓ SATISFIED | `parsers/fca-sellers.ts` |
| BITUM-PARSE-05 | parseBitumPriceNew — F price string, G «не изм.»/▲▼, источник истины cross-check | ✓ SATISFIED | `parsers/bitum-price-new.ts` |
| BITUM-PARSE-06 | Идемпотентность + Zod + BITUM_MAX_ROWS pre-flight | ✓ SATISFIED | Все 4 парсера: try/catch + rowCount > MAX → early-return + safeParse |
| BITUM-REFINERY-01 | data/refineries.json содержит все НПЗ + company; 29 entries v5.1 | ? NEEDS HUMAN | 29 entries присутствуют, но coverage-test deferred (см. SUMMARY Task 5); реальное покрытие проверится при первом UAT через `matched:false` |
| BITUM-REFINERY-02 | normalizeRefinery pure, dict-arg, case-insensitive, no-throw; getCompany unknown→«независимые» | ✓ SATISFIED | `refineries.ts:62-90` — все условия |
| BITUM-REPORT-01 | Period header + manual numbers block после периода | ✓ SATISFIED | `reporter.ts:57-70` + blocks-array order |
| BITUM-REPORT-06 | Плоский список movements, sort |Δ| desc, source label | ✓ SATISFIED | `analyzer.ts:258-263` sort + `reporter.ts:106-128` plain list with source |
| BITUM-REPORT-07 | Cell-trace footer per-file; extractive numbers | ✓ SATISFIED (with caveat) | Footer всегда добавляется (reporter.ts:144-154); cellRange в footer статичен `B4:T?` — см. Data-Flow STATIC comment |
| BITUM-REPORT-08 | Cross-check bitum_price_new vs birzha + fca, BITUM_CROSS_CHECK_THRESHOLD env (default 1.0) | ✓ SATISFIED | `analyzer.ts:183-241` + env reading `bot-bitum.ts:245-247` |
| BITUM-TG-01 | /bitum_status — HTML checklist + manualCount + lastUpdatedAt | ✓ SATISFIED | `bot-bitum.ts:151-173` |
| BITUM-TG-03 | /bitum_report — preview в DM, publish после подтверждения, TTL 15 min | ✓ SATISFIED | `bot-bitum.ts:226-285` + REPORT_TTL_MS |
| BITUM-TG-04 | /bitum_reset — inline-подтверждение + удаление xlsx + manual | ✓ SATISFIED | `bot-bitum.ts:291-334` + 633-656 |
| BITUM-TG-05 | Always-ask UX: 4 кнопки типов + Отмена; никакой автоклассификации | ✓ SATISFIED | `bot-bitum.ts:124-145` |
| BITUM-TG-08 | /bitum_add <label>=<value> — sanitize control chars, length cap 200, atomic + mutex, pass-through | ✓ SATISFIED | `bot-bitum.ts:340-390` + `manual-numbers.ts:43-48` |
| BITUM-MIGRATE-01 | src/bitum/* написан с нуля; src/upload/* и старая бит-реализация удалены | ✓ SATISFIED | src/upload absent; новая структура src/bitum/ 8 модулей + parsers/ 6 файлов |
| BITUM-MIGRATE-02 | Алиасы старых команд удалены; setMyCommands содержит только новые | ✓ SATISFIED | 0 матчей legacy в bot.ts; 4 битум + 3 канал + start/help |
| BITUM-MIGRATE-03 | data/uploads/<week>/ — ровно 4 xlsx по фиксированным именам + manual-numbers.json; data/bitum/ удалён | ✓ SATISFIED | data/bitum absent; имена файлов используются в storage.ts (`${type}.xlsx` где type ∈ BITUM_TYPES) |

**All 19 requirements implementation-complete (tests deferred — accepted override).**

### Anti-Patterns Found

Findings copied from 04-REVIEW.md (not re-discovered, but referenced for tracking). Severities updated to reflect what's blocking goal vs informational.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/bitum/parsers/bitum-price-new.ts` | 48-78 | WR-01: `replace(",", ".")` искажает «31,250» → 31.25 (thousands→decimal) | ⚠️ Warning | Не блокирует goal (текущий xlsx использует «31250» без запятой), но порча данных если формат когда-либо изменится |
| `src/bot-bitum.ts` | 68, 118, 469 | WR-02: pendingUploads key = msg.message_id без chatId | ⚠️ Warning | Коллизии только при multi-chat allowlist; сейчас 1 оператор — практически не выстрелит |
| `src/bitum/manual-numbers.ts:22` + `storage.ts:54` | n/a | WR-03: отдельные locks Map'ы — race между addManualNumber и resetWeek | ⚠️ Warning | Race при одновременных /bitum_reset + /bitum_add (один пользователь — маловероятно) |
| `src/bot-bitum.ts` | 118, 491 | WR-04: currentWeek вычисляется дважды (upload vs callback) | ⚠️ Warning | Сценарий «загрузил в 23:59 вс, подтвердил в 00:01 пн» → файл в другой неделе |
| `src/bitum/parsers/birzha-prices.ts` | 93 | WR-05: молча пропускает price === 0 | ℹ️ Info | Data-loss «торгов не было» vs пустая ячейка; недокументировано |
| `src/bitum/storage.ts` | 199-222 | WR-06: findLatestWeekWithUploads игнорирует недели с только manual-numbers | ℹ️ Info | Латентный (функция exported но не вызывается) |
| `src/bitum/reporter.ts:22-27`, `bot-bitum.ts:439-444` | n/a | IN-01: дубликат escapeHtml | ℹ️ Info | Дев-долг — фуктория |
| `src/bot-bitum.ts` | 68-75, 118 | IN-02: pendingUploads без TTL/cleanup | ℹ️ Info | Memory leak при 10 неподтверждённых загрузках = 100MB Buffer |
| `src/bitum/storage.ts` + `manual-numbers.ts` | n/a | IN-03: locks Map не очищается → ~52 entries/год | ℹ️ Info | Технический долг |
| `src/bitum/refineries.ts` | 35-52 | IN-04: loadRefineriesDict без кеширования — повторная I/O на каждый /bitum_report | ℹ️ Info | ~5-20 ms latency на handler-path |
| `src/bitum/parsers/birzha-volumes.ts` + `birzha-prices.ts` | n/a | IN-05: cellRange = "B4:T3" если данных нет (off-by-one) | ℹ️ Info | Косметика в footer |
| `src/bitum/parsers/bitum-price-new.ts` | 48-66 | IN-06: parseDelta accepts `+-N` / `-+N` (undefined behaviour) | ℹ️ Info | Невозможно в реальных данных |
| `src/bot-bitum.ts` | 87-92 | IN-07: currentWeek принимает msg но игнорирует (void msg;) | ℹ️ Info | Обманчивая сигнатура |

**Blockers (🛑):** 0
**Warnings (⚠️):** 4
**Info (ℹ️):** 9

No blocker-level anti-patterns. Warnings are documented in 04-REVIEW.md and accepted by user as known issues for follow-up; none break the phase goal.

### Human Verification Required

6 UAT items listed in YAML frontmatter `human_verification:` block. These cover:

1. **Upload UX** — inline-keyboard with 4 buttons + cancel, after-tap response with checklist
2. **Report flow** — programmatic digest structure, extractive numbers, cross-check warnings
3. **Publish path** — TG_CHANNEL_ID delivery + audit log
4. **Manual numbers block** — position after period header
5. **Reset flow** — confirmation + actual FS-mutation
6. **TTL timeout** — 15-min preview expiry

Live UAT can be performed via 04-HUMAN-UAT.md (already exists per phase history) once the operator has 4 эталонных xlsx and a test TG_CHANNEL_ID.

### Gaps Summary

**No code-level gaps blocking goal achievement.** All 11 observable truths and 19 requirements have implementation evidence. Programmatic checks (tsc, vitest) all pass. Legacy code (classifier, signatures, llm, upload/, bitum_preview, summarize, upload_status) verified absent.

**Known accepted limitations:**

1. **Tests deferred (override)** — 10 test files `src/__tests__/bitum-*.test.ts` deliberately not written per user instruction «не пиши тесты пока, только функционал» (2026-05-22). 19 BITUM-* requirements marked «Implementation complete, tests deferred» in REQUIREMENTS.md. **Follow-up phase MUST add coverage** — without it, regressions from the 4 documented warnings (WR-01 number parsing, WR-02 chatId collision, WR-03 cross-module race, WR-04 week-boundary race) cannot be caught automatically.

2. **REPORT-07 fidelity caveat** — cell-trace footer показывает фиксированные cellRange placeholders (`B4:T?` etc) вместо реальных meta.cellRange из ParserResult. Контракт `buildReport(analysis, manualNumbers, weekStatus)` не пробрасывает per-parser meta. REPORT-07 satisfied на букве (footer присутствует, fileType + numbersCount корректны), но fidelity ниже потенциального. Improvement opportunity for follow-up.

3. **BITUM-REFINERY-01 coverage validation deferred** — coverage-test между `data/refineries.json` (29 entries) и реальными НПЗ в 4 эталонных xlsx не проводился (test-only helper `extractRefineryNamesFromXlsx` не написан). При первом UAT-прогоне unmatched НПЗ всплывут как `matched: false` в parsed rows и operator сможет добавить ручью в JSON.

4. **Warnings from 04-REVIEW.md** — 4 ⚠️ severities (WR-01..04) известны и задокументированы. Каждый имеет тривиальный фикс (≤10 LOC) и предложен в REVIEW; не блокируют v5.1 goal но желательны до прод-релиза.

**Status: human_needed** because the phase goal is fundamentally about Telegram UX behaviour — inline keyboards, callback flow, /bitum_report preview→publish gate, /bitum_reset confirmation, 15-min TTL, real TG_CHANNEL_ID delivery. These cannot be verified by static analysis or unit-test-less code review; they require a single live UAT pass with actual Telegram and real xlsx fixtures.

---

_Verified: 2026-05-22T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
