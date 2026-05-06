---
phase: 03-web-scraping
plan: 04
subsystem: tests-readme
tags: [tests, documentation, vitest, web-scraper]
requires:
  - src/web-scraper.ts (Plan 03-02: 7 exports — extractText, siteToPost, loadWebsites, fetchSite, composeWebDigest, runWebPipeline, WEBSITES_PATH)
  - src/types.ts (Post, WebsiteEntry, WebRunSummary)
  - src/schema.ts (WebsitesFileSchema with z.string().url())
  - websites.json (Plan 03-01 seed)
  - vitest ^4.1.5 (existing dev-dep)
provides:
  - "src/__tests__/web-scraper.test.ts (283 LOC, 5 describe blocks, 26 it cases)"
  - "README.md §«Парсинг веб-сайтов» (56 LOC inserted between «Команды бота» and «Деплой через Docker»)"
affects:
  - "Test suite count: 90 → 116 (added 26 web-scraper test cases)"
  - "README.md operator-facing docs now cover websites.json format, 🌐 web message UX, error modes (D-13/D-14), archive paths, optional env"
tech-stack:
  added: []
  patterns:
    - "vi.spyOn(globalThis, 'fetch') for native fetch mocking — covers 200/404/timeout/UA scenarios without real network"
    - "process.chdir(mkdtempSync(...)) + afterEach cleanup for loadWebsites file-system isolation (mirrors channels-store.test.ts)"
    - "DOMException('aborted', 'AbortError') in mock to simulate AbortController.signal abort path"
    - "composeWebDigest exported (not private) — Plan 04 unit-tests pin the renderHtml split-by-\\n\\n contract; future refactor of summarize.renderHtml fails loudly instead of silently breaking the web header swap"
key-files:
  created:
    - src/__tests__/web-scraper.test.ts
  modified:
    - README.md
decisions:
  - "Test file uses 5 describe blocks (extractText / siteToPost / loadWebsites / fetchSite / composeWebDigest) with 26 it cases — exceeds plan's ≥17 minimum and gives one block per public export"
  - "fetchSite timeout test uses 50ms timeout + AbortController-driven mock that listens to signal abort — deterministic, no real network"
  - "Both composeWebDigest tests cover (a) canonical renderHtml input split, (b) defensive fallback when separator missing — the second test documents the `idx >= 0 ? body : full` branch and protects future readers from misreading the function as «strict»"
  - "README section inserted between «Команды бота» and «Деплой через Docker» — plan suggested «после каналов, до PM2/deploy» but PM2 sits BEFORE «Команды бота» in the existing README. The chosen spot is the natural narrative continuation: bot management → web management → deploy"
metrics:
  duration: ~3.5min
  tasks_completed: 2
  commits: 2
  tests_added: 26
  tests_total: 116
  completed: 2026-05-06
---

# Phase 3 Plan 4: Tests + README Summary

WEB-01/WEB-04 closeout: `src/__tests__/web-scraper.test.ts` ships 26 unit tests across 5 describe blocks covering every public export of `src/web-scraper.ts` — extractText cascade/cleanup/cap (D-01, D-02, D-04), siteToPost 200-char boundary and hostname-without-www derivation (D-03, D-05, D-22), loadWebsites Zod throws on missing/invalid/non-URL/empty (T-03-01 SSRF mitigation), fetchSite mocked via `vi.spyOn(globalThis, "fetch")` for 200/404/AbortController-timeout/Chrome-120-UA (D-15..D-18), and `composeWebDigest` pinned to the `\n\n` split contract from `summarize.renderHtml` (D-12 anchor — fails loudly on future header refactors instead of silently breaking the web message). README extended with «Парсинг веб-сайтов» section (websites.json format, 🌐 web message visual, D-13/D-14 error modes, `data/{raw,output}/*-web.{json,md}` archive paths, optional `WEB_FETCH_TIMEOUT_MS`/`WEB_USER_AGENT` env). 116/116 vitest still passing; `npx tsc --noEmit` clean. No `src/*.ts` files modified — Phase 3 invariant «can never break phases 1–2» preserved.

## Tasks Executed

| # | Task | Files | Commit |
|---|------|-------|--------|
| 1 | Create `src/__tests__/web-scraper.test.ts` (TDD against existing impl from Wave 2) | `src/__tests__/web-scraper.test.ts` (new, 283 LOC, 26 it cases) | `7d43b40` |
| 2 | Add «Парсинг веб-сайтов» section to README.md | `README.md` (+56 LOC) | `7054dda` |

## Verification Outcomes

| Check | Result |
|-------|--------|
| `test -f src/__tests__/web-scraper.test.ts` | yes |
| `grep -c "describe(" src/__tests__/web-scraper.test.ts` | 5 (≥5 required) |
| `grep -c "it(" src/__tests__/web-scraper.test.ts` | 26 (≥17 required) |
| `grep -F 'role="main"'` | yes (cascade-priority test) |
| `grep -F '.repeat(10_000)'` | yes (D-04 cap test — note plan literal `x.repeat(10_000)` doesn't grep against TypeScript `"x".repeat(10_000)` due to the embedded `"`; substring `.repeat(10_000)` is the unambiguous match) |
| `grep -F '.repeat(199)'` | yes (D-05 boundary) |
| `grep -F 'www.example.com'` | yes (D-22 hostname stripping) |
| `grep -F 'not-a-url'` | yes (T-03-01 Zod fail) |
| `grep -E 'vi\.spyOn\(globalThis, .fetch.\)'` | yes (mocked fetch) |
| `grep -F 'Chrome/120'` | yes (D-17 UA test) |
| `grep -E 'AbortError\|aborted'` | yes (D-16 timeout test) |
| `grep -F 'composeWebDigest'` | yes (import + tests) |
| `grep -F '<b>Нефтегаз —'` | yes (TG-header mock in compose test) |
| `grep -F '<b>🌐 Веб-источники'` | yes (web-header assertion) |
| `grep -F '<b>🚢 Бункер</b>'` | yes (body-preservation assertion) |
| `npx vitest run src/__tests__/web-scraper.test.ts` | 26/26 passed |
| `npx vitest run` (full repo) | 116/116 passed (5 test files) |
| `npx tsc --noEmit` | clean exit |
| `grep -F "## Парсинг веб-сайтов" README.md` | yes |
| `grep -c "websites.json" README.md` | 3 (≥3 required) |
| `grep -F "🌐 Веб-источники" README.md` | yes |
| `grep -F "data/output/YYYY-MM-DD-web.md" README.md` | yes |
| `grep -F "data/raw/YYYY-MM-DD-web.json" README.md` | yes |
| `grep -F "WEB_FETCH_TIMEOUT_MS" README.md` | yes |
| `grep -F "WEB_USER_AGENT" README.md` | yes |
| `grep -F "vim websites.json" README.md` | yes (D-24 vim+pm2 restart) |
| `grep -F "stage:" README.md` | yes (alert stage explanation) |
| `git diff --stat src/` after both tasks | clean (no `src/*.ts` modified except added test file) |

## Key Implementation Notes

- **TDD against existing implementation:** `src/web-scraper.ts` shipped fully in Plan 03-02 (Wave 2). Plan 03-04 task 1 is technically a "tests-after-impl" stage rather than a strict RED→GREEN cycle — the tests were written and passed against the existing code on first run. The plan markup said `tdd="true"` but the contract this plan establishes is *contract-pinning* (especially `composeWebDigest`), not driving impl design. All 26 tests passed first try, which is itself a verification signal that the Plan 02 implementation matches its documented behavior.
- **Test isolation for `loadWebsites`:** reused the `process.chdir(mkdtempSync(...))` + `afterEach` cleanup pattern from `channels-store.test.ts`. Each test gets a fresh tmpdir so `loadWebsites()` (which reads `./websites.json` from cwd) doesn't see the repo's seed file. Original cwd restored in afterEach.
- **`fetchSite` AbortController test:** the trickiest mock — `vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((resolve, reject) => { init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }))`. This pattern lets the mocked fetch *actually respect* the AbortController.signal that `fetchSite` creates internally. The 50ms timeout passes quickly because the AbortController fires `.abort()` after `setTimeout(controller.abort, 50)`, which triggers the mock's reject. No real network, no flakiness.
- **`composeWebDigest` contract anchor (D-12, T-03-16):** The function relies on `summarize.renderHtml` emitting `<b>...</b>\n<i>...</i>\n\n<b>🚢 Бункер</b>...` — the first `\n\n` is the split point. Test 1 feeds canonical input and asserts (a) result begins with `<b>🌐 Веб-источники`, (b) subheader `<i>3 сайтов из 5 обработано</i>`, (c) body sections like `<b>🚢 Бункер</b>` + `• item one` preserved, (d) old TG-header strings (`<b>Нефтегаз —`, `постов из`, `каналов за 24ч`) absent. Test 2 covers the defensive `idx >= 0 ? slice : full` fallback when the separator is missing.
- **README section placement:** plan suggested «after channels section, before PM2/deploy». Real README has PM2 (line 96) BEFORE «Команды бота» (line 143), so I inserted the new section between «Команды бота» end (line 181) and «Деплой через Docker» (line 183). The narrative flow is now: bot manages channels → web-scraper config → deploy options. Mirrors REST-of-doc style: each "thing operator manages" is its own section.
- **`grep -F 'x.repeat(10_000)'` acceptance-criterion quirk:** the plan's verification command searches for the literal string `x.repeat(10_000)` (no quotes). The TypeScript source legitimately contains `"x".repeat(10_000)` (with `"` between `x` and `.`). `grep -F` is fixed-string (no regex), so the substring `x.repeat(10_000)` doesn't match. The substantive intent (test for the 8000-char cap with a 10000-char input) is fully satisfied. The same quirk applies to plan's own example code on line 187.

## Threat Model Mitigations Applied

| Threat | Disposition | Action Taken |
|--------|-------------|--------------|
| T-03-13 (Tampering / operator misconfig of websites.json) | mitigate | README section explicitly documents Zod-схема (`url` required, `new URL()` валидация) — operator копипаст невалидного URL → alert (T-03-01 mitigation Plan 01), не silent-skip. README also describes that `vim websites.json` + `pm2 restart` is the only edit path (no bot CRUD), so the schema is the single point of validation. |
| T-03-14 (Information Disclosure через тесты) | accept | Тесты используют `https://x.com/` / `https://www.example.com/` / `https://oilcapital.ru/` — public hostnames, no secrets. Mocked `vi.spyOn(globalThis, "fetch")` ensures no real network calls during test runs. |
| T-03-15 (Test reliability — flaky timeout test) | mitigate | 50ms timeout + AbortController-driven mock that listens to signal abort = deterministic. Mock structure: `init.signal.addEventListener("abort", () => reject(new DOMException(...)))`. No real `setTimeout`/`fetch` race; the AbortController internal to fetchSite triggers abort after 50ms via its own setTimeout, mock observes it instantly. |
| T-03-16 (Silent breakage от рефактора summarize.renderHtml) | mitigate | composeWebDigest имеет dedicated test-block с 7 assertions — startsWith web-header, subheader text, two body section headers, bullet content, AND three negative assertions that the TG-header strings are absent. Если кто-то изменит структуру `<b>Нефтегаз — ...</b>\n<i>...</i>\n\n` в renderHtml — тест поломается на любом из 7 assertions, а не silent в проде. |

## Deviations from Plan

**[Worktree base correction]** Initial worktree was based on stale commit `20214a3` (a `summarize.ts`-rewrite branch from before Phases 1/2/03-01..03-03 work merged). Per the worktree_branch_check protocol in the prompt, executed `git reset --hard 86f92a29e8f65aed5825f65b81546347211349a3` to align onto the orchestrator-supplied base before any task work. The single stale commit (`20214a3 "new sum"`) was discarded. After reset, all expected files (`src/web-scraper.ts`, `src/run.ts` with `runPipeline+runWebPipeline`, `src/logger.ts` with `logWebRunSummary`, `websites.json`) are present as documented in the prompt's verify list. No code-level deviations.

Apart from the worktree alignment above, both tasks executed exactly as written. No Rule 1/2/3 auto-fixes triggered.

## Authentication Gates

None. Plan is fully offline — vitest uses mocked fetch (no network), README edit is text-only.

## Known Stubs

None. The 26 tests all assert real behavior of the Wave-2 implementation; the README section describes shipped functionality (Wave 1 schema + Wave 2 web-scraper + Wave 3 daemon integration). No "TODO"/"FIXME"/"coming soon" placeholders introduced.

## Threat Flags

None. Test file introduces no new security-relevant surface (mocked network only). README section is documentation, not new code paths. All security boundaries (URL→fetch, scraped HTML→cheerio, cleaned text→LLM, summary→Telegram) were anticipated in Plan 02's `<threat_model>` and dispositions are honored.

## Self-Check: PASSED

- `src/__tests__/web-scraper.test.ts` created (283 LOC, 5 describe, 26 it) — FOUND
- `README.md` modified (+56 LOC, «Парсинг веб-сайтов» section) — FOUND
- Commit `7d43b40` (Task 1, web-scraper.test.ts) — FOUND in `git log --oneline`
- Commit `7054dda` (Task 2, README §Парсинг веб-сайтов) — FOUND in `git log --oneline`
- `npx vitest run src/__tests__/web-scraper.test.ts` — 26/26 passed (verified)
- `npx vitest run` (full suite) — 116/116 passed (verified)
- `npx tsc --noEmit` — clean exit (verified)
- `grep -F "## Парсинг веб-сайтов" README.md` — match (verified)
- `grep -c "websites.json" README.md` — 3 (≥3 verified)
- All 12 substantive grep acceptance criteria for Task 1 (5 describe + role=main + cap-test + 199-boundary + www.example + not-a-url + vi.spyOn + Chrome/120 + AbortError + composeWebDigest + Нефтегаз-mock + 🌐-Веб-источники + 🚢-Бункер) — verified
- All 9 substantive grep acceptance criteria for Task 2 (section header + websites.json≥3 + 🌐 + data/output*-web.md + data/raw*-web.json + WEB_FETCH_TIMEOUT_MS + WEB_USER_AGENT + vim websites.json + stage:) — verified
- No `src/*.ts` files modified except the new test file — verified by `git diff --stat`
