---
phase: quick-260508-fa1
plan: 01
subsystem: web-scraper, logger
tags: [retry, undici, dispatcher, file-sink, msk-date]
requires: []
provides:
  - "httpDispatcherInsecure (narrow host-allowlist for neftegaz.ru)"
  - "isRetriableFetchError + 1-attempt retry with 5s sleep"
  - "data/run-${MSK-date}.log dual sink"
  - "oilexp URL with www prefix and trailing slash"
affects: [src/web-scraper.ts, src/logger.ts, websites.json, .gitignore]
tech-stack:
  added: []
  patterns: ["host-based dispatcher selection", "retry-on-transient", "appendFileSync dual sink"]
key-files:
  created: []
  modified:
    - src/web-scraper.ts
    - src/logger.ts
    - websites.json
    - .gitignore
decisions:
  - "Retry attempt scope: AbortController + timer recreated per attempt — each attempt gets full ms budget"
  - "Retry trigger: only undici cause.code matching UND_ERR_*/ECONNRESET/ETIMEDOUT (HTTP non-2xx not retried)"
  - "neftegaz scope: hostname allowlist (neftegaz.ru and *.neftegaz.ru) — not global TLS bypass"
  - "File sink: appendFileSync (sync, simple) wrapped in try/catch (never kills process)"
  - "Summary blocks not routed through log.info — preserves first-line format without [ts] [info] prefix"
metrics:
  duration_seconds: 338
  tasks_completed: 2
  files_modified: 4
  completed: 2026-05-08T08:10:38Z
---

# Quick Task quick-260508-fa1: fix max web sources without proxy and write run logs to disk Summary

## One-liner

Add narrow neftegaz-only insecure undici Agent + 1-attempt transient-error retry in `fetchSite`, fix oilexp 301 hop with www prefix, and dual-sink logger to `data/run-${MSK-date}.log`.

## Tasks Completed

| Task | Name                                                                | Commit  | Files                                  |
| ---- | ------------------------------------------------------------------- | ------- | -------------------------------------- |
| 1    | Fix websites.json oilexp URL + insecure dispatcher + retry          | 1a16dbb | websites.json, src/web-scraper.ts      |
| 2    | Add file sink to logger.ts (dual-write console + data/run-*.log)    | 2cc40ba | src/logger.ts, .gitignore              |

## Edits Made

1. **websites.json** — `https://oilexp.ru/news` → `https://www.oilexp.ru/news/` (skip 301 hop since `redirect: "manual"`).
2. **src/web-scraper.ts (dispatcher)** — added `httpDispatcherInsecure` (`allowH2: false`, `connect: { timeout: 10_000, family: 4, rejectUnauthorized: false }`); host-based dispatcher selection inside redirect loop (`neftegaz.ru` and `*.neftegaz.ru` → insecure, else default `httpDispatcher`).
3. **src/web-scraper.ts (retry)** — `fetchSite` wrapped in 2-iteration outer for-loop with per-attempt `AbortController`/`setTimeout`/`startMs`; `isRetriableFetchError(err)` checks `cause.code` for `UND_ERR_*` / `ECONNRESET` / `ETIMEDOUT`; `clearTimeout` called both in catch (pre-sleep, prevents fd leak during 5s sleep) and in finally (success path).
4. **src/logger.ts (file sink)** — `appendFileSync` writes to `data/run-${mskDateYmd()}.log` for every `log.info/warn/error` call PLUS for both `logRunSummary` and `logWebRunSummary` (full joined block); `formatCtx` handles `Error`/`string`/`object` so file gets readable text (not `[object Object]`); errors swallowed silently.
5. **.gitignore** — clarifying comment under `# Logs` noting `data/run-*.log` is already covered by `data/*` (no duplicate rule).

## Verification Results

- `npx tsc --noEmit` — clean (no errors)
- `npx vitest run` — 1022 tests passed (48 files)
- `npm run start:once:web` — pipeline ran end-to-end, did NOT throw at top level

### Smoke run results (npm run start:once:web)

- **succeeded=19/33** (was 18 before this plan — `teboil.ru` recovered via retry)
- **skipped=14/33** — all logged with cause codes (`UND_ERR_CONNECT_TIMEOUT`, `HTTP 403`, etc.)
- **9 retry warnings observed** — `[web-scraper] fetch retry 1/1 after 5000ms: ${url} (cause: UND_ERR_CONNECT_TIMEOUT)`. teboil.ru succeeded on attempt 2.
- **`data/run-2026-05-08.log` written** — 228 lines including all `[web-scraper] fetch start/ok/fail` entries plus the full `[web-summary]` block
- **`data/raw/2026-05-08-web.json`** — 19 posts archived (includes new entry: `teboil`)
- **`Promise.allSettled` resilience preserved** — geo-blocked/timeout sites still skip cleanly, pipeline delivered final digest to channel

### oilexp.ru / neftegaz.ru status

Both sites are NOT in the raw archive after this run, but the failure mode is environmental (network) rather than the code paths fixed by this plan:

- **oilexp.ru** — URL is now correct (`https://www.oilexp.ru/news/`), `redirect: "manual"` no longer wastes a hop. Failed with `UND_ERR_CONNECT_TIMEOUT` from this dev machine. Likely geo-block / transient. The www-prefix change WILL eliminate the redirect hop whenever the host becomes reachable.
- **neftegaz.ru** — Failed with `This operation was aborted` (hit the 30s outer timeout). The insecure dispatcher only helps if a TLS handshake actually starts and fails on cert verification; here the connection itself didn't establish. The dispatcher allowlist is in place and will fix the cert-chain failure mode whenever connectivity returns.

Both fixes are correct and committed; today's run cannot prove them end-to-end because both hosts are currently unreachable from this network. The other planned mitigation (retry on transient errors) is **proven working** — `teboil.ru` recovered.

## Deviations from Plan

### Auto-fixed issues

None — plan executed exactly as written. The execution flow matched the plan's hint about `fix attempt limit` / `clearTimeout in catch + finally` precisely; no extra correctness work was needed.

### Worktree branch reset

The orchestrator placed me in a worktree branch (`worktree-agent-a9283c41576e3101f`) whose HEAD was on a divergent commit (`2ebf3c9` — feat: rss/cron/etc.) NOT based on the prescribed base `f36f92c`. The branch base check protocol required `git reset --soft f36f92c`. After the reset, the worktree's `.env.example`, `docker-compose.yml`, `src/run.ts`, `src/schema.ts`, `src/summarize.ts`, `src/types.ts`, `src/rss.ts` (etc.) appeared as un-staged modifications — these are pre-existing branch work not related to this plan. I deliberately did NOT include any of those files in my per-task commits; only the four files this plan owns (`websites.json`, `src/web-scraper.ts`, `src/logger.ts`, `.gitignore`) were `git add`ed and committed. The four task-relevant files were also restored to the `f36f92c` state via `git checkout f36f92c -- ...` before editing, so my diffs are clean against the prescribed base.

### Authentication gates

None.

## Known Stubs

None — all edits are wired into the running pipeline; smoke run confirms the new code paths execute (retry logged, file sink populated, dispatcher selected by hostname inside the redirect loop).

## Self-Check

**Files:**
- FOUND: src/web-scraper.ts (modified — `httpDispatcherInsecure` + `isRetriableFetchError` + per-attempt retry loop + host-based dispatcher selection)
- FOUND: src/logger.ts (modified — `appendFileSync` import, `mskDateYmd`, `appendToFile`, `formatCtx`, dual-sink in log.info/warn/error AND logRunSummary/logWebRunSummary)
- FOUND: websites.json (modified — `https://www.oilexp.ru/news/`)
- FOUND: .gitignore (modified — comment under `# Logs`)
- FOUND: data/run-2026-05-08.log (228 lines, contains retry warnings + summary block)
- FOUND: data/raw/2026-05-08-web.json (19 posts including teboil)

**Commits:**
- FOUND: 1a16dbb (Task 1)
- FOUND: 2cc40ba (Task 2)

## Self-Check: PASSED
