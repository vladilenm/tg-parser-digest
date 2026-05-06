---
phase: 03-web-scraping
verified: 2026-05-06T12:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 3: Web-Scraping — Verification Report

**Phase Goal:** Ежедневный прогон дополняется скрейпингом сайтов из `websites.json`; веб-контент проходит тот же DeepSeek-pipeline и доставляется отдельным сообщением в канал после TG-дайджеста.

**Verified:** 2026-05-06
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria из ROADMAP)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Два отдельных сообщения в канале: TG-дайджест и web-дайджест | VERIFIED | `src/run.ts:31` `await runPipeline(runId)` и `src/run.ts:51` `await runWebPipeline(runId)` — два независимых вызова. Доставка раздельная: TG через `pipeline.runPipeline → sendToChannel` (один call), web через `web-scraper.ts:296` `await sendToChannel(finalHtml)` отдельным сообщением с собственной шапкой `<b>🌐 Веб-источники</b>` (D-12). |
| 2 | Недоступный/пустой сайт (<200 символов) пропускается с логом — pipeline не падает | VERIFIED | `src/web-scraper.ts:22` `MIN_TEXT_CHARS = 200`; `:115` `if (text.length < MIN_TEXT_CHARS) { log.warn(...) ; return null }`; индивидуальные сайты обрабатываются через `Promise.allSettled` (см. raw-сохранение `:256`); failed/skipped сайты учитываются в `websitesSkipped`. На уровне tick — независимые try/catch (`run.ts:30-47` для TG, `:50-67` для web), которые гарантируют что падение одного pipeline не блокирует второй. |
| 3 | Цитаты в web-дайджесте дословно в HTML источника (extractive verify аналогично TG) | VERIFIED | `src/web-scraper.ts:283` `const { html, postsDropped } = await summarize(posts)` — переиспользуется тот же `summarize()` из `src/summarize.ts`, у которого внутри уже работает `verifyExtractiveness` (D-19). Web-посты идут через идентичный two-pass DeepSeek pipeline что и TG. |

**Score:** 3/3 success criteria verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/web-scraper.ts` | Public API: `extractText`, `siteToPost`, `loadWebsites`, `fetchSite`, `composeWebDigest`, `runWebPipeline`, `WEBSITES_PATH` | VERIFIED | Все 7 export'ов присутствуют (`web-scraper.ts:17,33,52,78,114,199,212`). Импортирует `summarize`, `sendToChannel`, `sendAlert`. |
| `src/run.ts` | Параллельный вызов TG + web pipeline в tick(), независимые try/catch | VERIFIED | `runPipeline` (line 31) и `runWebPipeline` (line 51), каждый в своём try/catch с `sendAlert` (D-08, D-09, D-13). |
| `src/logger.ts` | `logWebRunSummary` export | VERIFIED | `logger.ts:49 export function logWebRunSummary(s: WebRunSummary): void`. Импортируется в `run.ts:8`. |
| `src/__tests__/web-scraper.test.ts` | ≥17 тестов покрывающих все public API | VERIFIED | 26 it-кейсов в 5 describe-блоках (extractText / siteToPost / loadWebsites / fetchSite / composeWebDigest). Mocked `vi.spyOn(globalThis, "fetch")` — без реальной сети. |
| `websites.json` | Seed 5 сайтов | VERIFIED | 5 entries: oilcapital.ru, neftegaz.ru, rupec.ru, oilexp.ru, angi.ru. Каждый объект соответствует `WebsiteEntry` schema (`url` обязательный, валидируется Zod). |
| `README.md §«Парсинг веб-сайтов»` | Operator-facing docs | VERIFIED | Section добавлен (Plan 04 Task 2, commit `7054dda`). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|------|--------|---------|
| `run.ts:tick()` | `runWebPipeline` | `await runWebPipeline(runId)` в independent try/catch | WIRED | `run.ts:51`. Failure ловится `:53`, отдельный `sendAlert(stage:"web")`. |
| `runWebPipeline` | `summarize()` | `const { html, postsDropped } = await summarize(posts)` | WIRED | `web-scraper.ts:283`. Переиспользует TG-pipeline including extractive verify. |
| `runWebPipeline` | `sendToChannel` | `await sendToChannel(finalHtml)` отдельным сообщением | WIRED | `web-scraper.ts:296`. Отдельная доставка после TG (TG отправляется в `pipeline.ts`). |
| `extractText` | `MIN_TEXT_CHARS=200` | `if (text.length < MIN_TEXT_CHARS) return null` | WIRED | `web-scraper.ts:115`. Skip + log; null отфильтровывается перед `posts.push`. |
| Per-site failure | Continue pipeline | `Promise.allSettled` + null filter | WIRED | Один сайт fail → `errors[]` accumulates, прочие сайты продолжают обработку. TG-pipeline failure → web-pipeline всё равно стартует (`run.ts:50` отдельный try). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WEB-01 | 03-01, 03-02, 03-03 | Daemon скрейпит список сайтов из `websites.json` (fetch+cheerio) в рамках ежедневного прогона | SATISFIED | `loadWebsites()` читает websites.json (Zod валидация); `fetchSite()` использует native fetch; `extractText()` использует cheerio (D-01..D-04); вызов из `run.ts:51` в составе ежедневного cron tick. |
| WEB-02 | 03-02 | Извлечённый контент проходит тот же DeepSeek pipeline (classify по 5 направлениям) | SATISFIED | `summarize(posts)` в `web-scraper.ts:283` — идентичный two-pass pipeline; same 5-section renderHtml. Web-посты упакованы в `Post` через `siteToPost()` (D-03). |
| WEB-03 | 03-02, 03-03 | Web-дайджест отправляется отдельным сообщением в канал | SATISFIED | `composeWebDigest()` swap'ает TG-шапку на web-шапку (`🌐 Веб-источники`); `sendToChannel(finalHtml)` отдельным вызовом после TG-pipeline. Не объединяется с TG-сообщением. |
| WEB-04 | 03-02, 03-04 | Валидация контента (минимум 200 символов); невалидные страницы пропускаются с логом | SATISFIED | `MIN_TEXT_CHARS=200` константа; `siteToPost()` возвращает null + `log.warn` для коротких страниц; pipeline не падает. Test `.repeat(199)` фиксирует 200-char boundary. |

Все 4 WEB-XX из REQUIREMENTS.md покрыты. ORPHAN check: `grep "Phase 3" .planning/REQUIREMENTS.md` → совпадает только с WEB-01..04, других orphan ID нет.

### Anti-Patterns Found

Не найдено блокеров. Test-mocks существуют как ожидается (vi.spyOn для fetch — единственный безопасный паттерн для unit-тестов сети). Нет `TODO/FIXME/PLACEHOLDER` в `src/web-scraper.ts` или `src/run.ts`.

### Behavioral Spot-Checks

Полный suite (602/602) и `tsc --noEmit` уже проверены оркестратором — повторно не запускаем (per prompt instructions).

### Human Verification Required

Не требуется — все success criteria структурно покрыты в коде; реальная end-to-end доставка в канал это smoke-test, который оператор делает руками через `npm start` (out of scope для статической верификации).

### Gaps Summary

Гэпов нет. Все 4 WEB-XX requirements покрыты, все 3 success criteria из ROADMAP подтверждены кодом, обе ключевые связи (TG/web independence в `run.ts`, summarize() reuse, отдельная доставка) проверены grep'ом. Архитектурный инвариант «Phase 3 не ломает Phases 1–2» подтверждён в SUMMARY (no `src/*.ts` modifications кроме нового web-scraper.ts и патча run.ts/logger.ts).

---

_Verified: 2026-05-06_
_Verifier: Claude (gsd-verifier)_
