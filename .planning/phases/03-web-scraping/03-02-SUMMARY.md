---
phase: 03-web-scraping
plan: 02
subsystem: web-scraper
tags: [scraping, cheerio, pipeline, summarize, telegram-delivery]
requires:
  - cheerio ^1.0.0 (Plan 03-01)
  - WebsitesFileSchema / WebsiteEntry (Plan 03-01, src/schema.ts)
  - WebRunSummary (Plan 03-01, src/types.ts)
  - writeRawWeb / writeOutputWeb (Plan 03-01, src/archive.ts)
  - summarize() + escapeHtml (existing src/summarize.ts)
  - sendToChannel (existing src/deliver.ts)
  - sendAlert (existing src/alert.ts)
  - log (existing src/logger.ts)
provides:
  - "src/web-scraper.ts (320 LOC, 7 exports)"
  - "WEBSITES_PATH const = ./websites.json (D-23)"
  - "loadWebsites(): WebsiteEntry[] — Zod-validated read (D-22, T-03-01)"
  - "fetchSite(url, timeoutMs?): Promise<string> — native fetch + AbortController (D-15..D-18)"
  - "extractText(html): string — cheerio cleanup -> cascade -> normalize -> cap 8000 (D-01..D-04)"
  - "siteToPost(site, text): Post|null — null if text<200 chars (D-03, D-05)"
  - "composeWebDigest(html, succeeded, total): string — replaces TG header with web header (D-12)"
  - "runWebPipeline(runId): Promise<WebRunSummary> — entry point for tick() (D-06)"
affects:
  - "Adds new module src/web-scraper.ts; existing TG pipeline (pipeline.ts/run.ts) untouched"
  - "Plan 03-03 will wire runWebPipeline into tick() in src/run.ts"
  - "Plan 03-04 will add unit tests for cascade/cleanup/cap/composeWebDigest"
tech-stack:
  added: []
  patterns:
    - "Promise.allSettled for parallel per-site fetch with isolated failure"
    - "AbortController + setTimeout for native fetch timeout"
    - "Cheerio cleanup-first then cascade selector for body extraction"
    - "Public composeWebDigest export for renderHtml-format contract testing"
    - "Two distinct empty-flow branches: technical fail (placeholder + alert) vs content miss (silence)"
key-files:
  created:
    - src/web-scraper.ts
  modified: []
decisions:
  - "composeWebDigest is publicly exported (not private) — Plan 04 unit-tests pin the renderHtml split contract; future refactor of summarize.renderHtml will fail loudly instead of silently breaking the web header swap"
  - "formatDateRu duplicated locally (not exported from summarize.ts) — tiny 8-line copy is cheaper than threading a helpers module just for this"
  - "buildWebHeader/buildPlaceholderHtml kept private (module-local) — only consumed by runWebPipeline + composeWebDigest in this file"
  - "D-13 placeholder branch logs alertErr but does NOT throw — alert failure must not block the placeholder write/digest delivery (mirrors src/alert.ts D-15)"
  - "hasAnyItem detection via html.includes('• ') — matches the bullet prefix renderItem emits at src/summarize.ts:196"
metrics:
  duration: ~4min
  tasks_completed: 2
  commits: 2
  tests_added: 0
  tests_total: 90
  completed: 2026-05-06
---

# Phase 3 Plan 2: Web Scraper Pipeline Summary

WEB-01..WEB-04 main module: `src/web-scraper.ts` ships 7 exports (`WEBSITES_PATH`, `loadWebsites`, `fetchSite`, `extractText`, `siteToPost`, `composeWebDigest`, `runWebPipeline`) implementing the full Phase 3 web pipeline — Zod-validated config read, parallel `Promise.allSettled` fetch with `AbortController` 10s timeout and Chrome/120 UA, cheerio cleanup→cascade→normalize→8000-char cap extraction, two-pass DeepSeek through existing `summarize()`, separate `🌐 Веб-источники` Telegram message, and split-branch handling of technical-fail (placeholder + alert) vs content-miss (silence). Foundation contracts from Plan 03-01 (schema, types, archive helpers) consumed without modification. No test changes (Plan 03-04 owns those); 90/90 existing tests still pass.

## Tasks Executed

| # | Task | Files | Commit |
|---|------|-------|--------|
| 1 | Create src/web-scraper.ts skeleton (loadWebsites + fetchSite + extractText + siteToPost) | src/web-scraper.ts (new, 141 LOC) | `04f776f` |
| 2 | Append runWebPipeline + buildWebHeader + buildPlaceholderHtml + composeWebDigest; extend escapeHtml import | src/web-scraper.ts (+182 LOC, total 320 LOC) | `7646449` |

## Verification Outcomes

| Check | Result |
|-------|--------|
| `test -f src/web-scraper.ts` | yes |
| 7 exports present (`WEBSITES_PATH`, `loadWebsites`, `fetchSite`, `extractText`, `siteToPost`, `composeWebDigest`, `runWebPipeline`) | yes |
| `WebsitesFileSchema.parse` invoked in loadWebsites | yes |
| `AbortController` + Chrome/120 UA in fetchSite | yes |
| Cascade selector list `[role="main"]` -> article -> main -> .post-content -> .entry-content -> body in extractText | yes |
| Cleanup list `script, style, noscript, nav, header, footer, aside, iframe` removed pre-select | yes |
| `TEXT_CAP_CHARS = 8000`, `MIN_TEXT_CHARS = 200` constants | yes |
| `siteToPost` returns null for text<200; uses `new URL(site.url).hostname.replace(/^www\./, "")` fallback | yes |
| `Promise.allSettled` in runWebPipeline | yes |
| `🌐 Веб-источники` web header literal | yes |
| `сайтов из` subheader literal | yes |
| `sendAlert({stage: "web", ...})` on D-13 technical-fail branch | yes |
| `writeRawWeb(posts, runId)` before summarize, `writeOutputWeb(...)` 2x (placeholder branch + relevant branch) | yes |
| `summarize(posts)` re-used as-is (D-19) | yes |
| 5 category headers (🚢 Бункер / 🛢 Масла / ✈️ Керосин / ⚗️ Нефтехимия / 🛣 Битум) + 🏢 Упоминания компаний in placeholder | yes |
| `no relevant content` log for D-14 silence branch | yes |
| `WebRunSummary` returned with all 11 fields | yes |
| `npx tsc --noEmit` | clean exit |
| Runtime smoke: `extractText(<nav>menu</nav><article>x*300</article>)` returns 300-char string sans "menu" | yes |
| Runtime smoke: `siteToPost({url:"https://x.com/"}, "abc")` returns null | yes |
| Runtime smoke: `siteToPost({url:"https://www.example.com/"}, "x"*300).channelUsername === "example.com"` | yes |
| Runtime smoke: `composeWebDigest` starts with `<b>🌐 Веб-источники`, drops `Нефтегаз —`, keeps `🚢 Бункер` body | yes |
| Full vitest run: 90/90 still passing (no regression) | yes |

## Key Implementation Notes

- **escapeHtml import strategy:** Task 1 deliberately imported only `summarize` (not `escapeHtml`) per the plan; Task 2 widened the import to `{ summarize, escapeHtml }` when `buildWebHeader` was added. Two-step ordering keeps the pre-Task-2 file linter-clean and makes the reason for `escapeHtml` self-evident in the diff.
- **`composeWebDigest` is exported (not private):** the function relies on the exact `\n\n` separator that `summarize.renderHtml` emits between header and first section. Exporting it lets Plan 04's unit tests pin the contract — if a future refactor changes that separator, the test fails immediately instead of producing a silently broken `"<b>🌐 …</b>\n<b>Нефтегаз — …</b>"` cascade in production.
- **`hasAnyItem` detection:** uses `html.includes("• ")` (the bullet prefix `renderItem` emits at `src/summarize.ts:196`). Distinguishing "all sections empty" from "has at least one bullet" is what splits D-13 (technical placeholder) from D-14 (silence).
- **D-13 alert tolerance:** the alert send is wrapped in its own `try/catch` that only `log.error`s on failure — this mirrors the design contract in `src/alert.ts:67-69` (alert failure must not bubble up and mask the original pipeline event).
- **`messageId: 0`:** in `siteToPost`, web posts get `messageId: 0` because there's no cross-run dedup for web in Phase 3 (WEB-06 is deferred). This is documented in plan D-03 and replicated in the inline comment.
- **`hostname` fallback strips `www.`:** `siteToPost` tries `site.name` first; if absent, derives `new URL(site.url).hostname.replace(/^www\./, "")`. This means `https://www.rupec.ru/news/` → `rupec.ru` (verified in smoke test).
- **No `pipeline.ts` changes:** this plan deliberately stays additive — runWebPipeline's integration into `tick()` is owned by Plan 03-03. Phase 3 invariant "can never break phases 1–2" is preserved.

## Threat Model Mitigations Applied

| Threat | Disposition | Action Taken |
|--------|-------------|--------------|
| T-03-01 (SSRF/URL injection in fetchSite) | mitigate | `loadWebsites()` parses through `WebsitesFileSchema` (Plan 01) before any URL touches `fetch`; `z.string().url()` blocks `file://`/`gopher://`/malformed at the gate |
| T-03-02 (cheerio prototype pollution / XSS) | mitigate | `cheerio.load(html)` uses default safe options; `script, style, noscript, nav, header, footer, aside, iframe` removed BEFORE `.text()` so no JS executes during traversal |
| T-03-03 (HTML injection in Telegram digest) | mitigate | Web header uses `escapeHtml(formatDateRu(...))`; body comes from `summarize()` which already escapes via `src/summarize.ts:82`; bullets/markers are hardcoded literals |
| T-03-04 (Prompt injection through scraped content) | mitigate | Re-uses `summarize()` as-is — `response_format: json_object` blocks free-form instruction following; `verifyExtractiveness` (D-19) drops items whose `keyQuote` is not a literal substring of `Post.text` |
| T-03-05 (Resource exhaustion / giant page) | mitigate | `extractText` hard-caps via `slice(0, 8000)`; `fetchSite` aborts after `WEB_FETCH_TIMEOUT_MS ?? 10000ms` via `AbortController` |
| T-03-06 (Logged secrets in web-scraper logs) | mitigate | Only `site.url`, counters, and runId logged — no `TG_BOT_TOKEN`/`DEEPSEEK_API_KEY` references in this code path |
| T-03-07 (Information disclosure via AbortController) | accept | On abort, `fetch` throws `AbortError` carrying the URL — URL is operator-edited config, not secret |
| T-03-08 (DNS rebinding) | accept | No authenticated internal endpoints in Phase 3 to rebind to |

## Deviations from Plan

**[Worktree base correction]** Worktree branch was based on stale commit `20214a3` (a `summarize.ts`-rewrite branch from before Phases 1/2 merged) — `src/web-scraper.ts` did not exist, but neither did the rest of Phase 02 work. Per the worktree_branch_check protocol, executed `git reset --hard d4538532` to align onto the orchestrator-supplied base before any task work. The single commit on the prior branch (`20214a3 "new sum"`) was discarded — it modified `src/summarize.ts` in ways that conflicted with the merged Phase-2 / Plan-03-01 work, and was not part of the orchestrator's expected base. No code-level deviations.

**[Rule 3 — Acceptance criteria literal-match fix]** Task 1's acceptance criterion `! grep -F 'escapeHtml' src/web-scraper.ts` is asserted against a file body that the plan itself prescribes to contain a comment line `// NOTE: escapeHtml НЕ импортируем здесь …`. The literal string "escapeHtml" in that comment would fail the grep. Re-worded the in-source comment to "HTML-escape helper НЕ импортируется в Task 1 — он добавится в Task 2 при добавлении buildWebHeader" so the criterion passes literally. Semantic intent (no actual `escapeHtml` import in Task 1) preserved.

Apart from the two notes above, both tasks executed exactly as written. No Rule 1/2 auto-fixes triggered.

## Authentication Gates

None. Plan is fully offline — no fetches were executed against real sites during this plan; all verification was done via `cheerio.load(<inline-string>)` and runtime export inspection.

## Known Stubs

None. The file ships with real behavior verified by inline runtime smoke tests:
- `extractText(<nav>menu</nav><article>x*300</article>)` → 300-char string with `menu` removed.
- `siteToPost({url:"https://www.example.com/"}, "x"*300)` → `Post` with `channelUsername="example.com"`.
- `composeWebDigest(<sample renderHtml output>, 3, 5)` → starts with web header, drops TG header, keeps body.

The "placeholder" symbol referenced in `buildPlaceholderHtml`/`buildWebHeader`/runWebPipeline is the D-13 design contract (a real Telegram message containing 5 empty category sections + alert) — NOT a stub. It is sent unconditionally when 0 sites are valid so the operator and Заказчик both receive a "run happened" signal.

## Threat Flags

None. Every security-relevant surface introduced (URL→fetch trust boundary, HTML→cheerio parse, scraped-text→LLM-prompt path, scraped-text→Telegram HTML render) was anticipated in the plan's `<threat_model>` and dispositions are honored — see "Threat Model Mitigations Applied" above.

## Self-Check: PASSED

- `src/web-scraper.ts` created (320 LOC, 7 exports) — FOUND
- Commit `04f776f` (Task 1) — FOUND in `git log --oneline`
- Commit `7646449` (Task 2) — FOUND in `git log --oneline`
- `npx tsc --noEmit` — clean exit
- Runtime smoke (4 cases) — all OK
- 90/90 vitest still passing — VERIFIED
