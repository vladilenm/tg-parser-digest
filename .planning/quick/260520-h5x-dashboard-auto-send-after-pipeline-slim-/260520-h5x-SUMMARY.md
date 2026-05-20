---
phase: quick-260520-h5x
plan: 01
subsystem: dashboard
tags: [dashboard, deliver, run, payload-slim, refactor, auto-send]
dependency-graph:
  requires:
    - src/paths.ts
    - src/alert.ts
    - src/backup.ts (pattern reference)
  provides:
    - src/dashboard.ts (buildDashboard library module)
    - src/deliver.ts:sendDashboardDocument()
  affects:
    - scripts/build-dashboard.ts (now thin CLI shim)
    - src/run.ts:tick() (new ── Dashboard ── block)
tech-stack:
  added: []
  patterns:
    - "Library/CLI split: heavy logic in src/<module>.ts, scripts/<wrapper>.ts is a thin CLI shim (mirrors how src/backup.ts vs scripts/* relate)"
    - "Multipart sendDocument via FormData+Blob with [buf as unknown as ArrayBuffer] cast (same as src/backup.ts:tgSendDocument)"
    - "Soft-skip on missing creds (log.warn + return), throw only on HTTP !ok — same pattern as src/alert.ts:23-32"
key-files:
  created:
    - src/dashboard.ts (579 lines — buildDashboard() + all loaders/regex/STYLES/APP_JS/renderHtml moved from scripts/)
  modified:
    - scripts/build-dashboard.ts (582 → ~13 lines — thin CLI shim, imports buildDashboard from ../src/dashboard.js)
    - src/deliver.ts (+53 lines — sendDashboardDocument() with multipart sendDocument, env-soft-skip, throw-on-!ok)
    - src/run.ts (+46 lines — buildDashboard/sendDashboardDocument imports, mskDateDmy() helper, ── Dashboard ── block in tick())
decisions:
  - "Extract + slim in one commit (Task 1) — splitting would mean writing the RawPost interface twice with `text`, then immediately removing it. One logical change: 'extract slim buildDashboard'."
  - "Dashboard goes to TG_CHANNEL_ID (digest channel) via TG_BOT_TOKEN — same place users already see the HTML digest, not the backup/alert bot. Cumulative dashboard arrives right after today's digest."
  - "sendDashboardDocument soft-skips on missing creds (log.warn + return) — dashboard is a nice-to-have attachment; tick() must not be blocked by env config gaps."
  - "Dashboard block placed inside the outer try/catch but with its own inner try/catch — failure isolated from tick(), still caught by WR-09 in pathological cases."
  - "Did NOT thread activeAbort into buildDashboard — buildData() is fast (no jitter sleep) and an in-progress fetch on shutdown gets undici-aborted naturally; threading abort signal explicitly is out of scope."
metrics:
  duration_seconds: 259
  duration_human: "~4m 19s"
  tasks: 3
  commits: 3
  files_created: 1
  files_modified: 3
  lines_added: 683
  lines_removed: 572
  net_diff: 111
  payload_before_bytes: 3052282
  payload_after_bytes: 356741
  payload_reduction_factor: 8.5
  tests_total: 2600
  tests_passed: 2600
completed: 2026-05-20
---

# Quick Task 260520-h5x: Dashboard Auto-Send After Pipeline + Slim Summary

Auto-deliver a slim accumulated dashboard HTML file to the digest channel as a document attachment right after each daily pipeline tick (TG + web), and shrink its payload from ~2981 KB to ~348 KB by dropping the never-used `RawPost.text` field. `buildDashboard()` is now a library function — used by both `npm run dashboard` and `src/run.ts:tick()`.

## What Changed

1. **Extracted `buildDashboard()` into `src/dashboard.ts`** (H5X-01) — all dashboard logic (loaders, regex, STYLES, APP_JS, renderHtml) moved from `scripts/build-dashboard.ts` to a new library module. `scripts/build-dashboard.ts` is now a ~13-line CLI shim that imports `buildDashboard` and prints the result.

2. **Dropped `RawPost.text` from the payload** (H5X-02) — interface field, loader validation, and loader assignment all removed. APP_JS never read it (confirmed: it only aggregates by `p.fileDate`, `p.source`, `p.username`). Dashboard JSON shrank ~3 MB → ~348 KB (**8.5× reduction**).

3. **Added `sendDashboardDocument()` to `src/deliver.ts`** (H5X-03) — multipart `FormData + Blob` POST to `https://api.telegram.org/bot<token>/sendDocument` using `TG_BOT_TOKEN` + `TG_CHANNEL_ID` (the digest channel, not the alert bot). Soft-skip on missing creds (`log.warn` + return); throw on HTTP `!ok` so the caller can alert.

4. **Wired auto-send into `src/run.ts:tick()`** (H5X-04) — new `── Dashboard ──` block placed AFTER the web-pipeline `catch`, BEFORE the WR-09 outer catch. Wraps `buildDashboard()` + `sendDashboardDocument(path, "dashboard-DD.MM.YYYY.html")` in try/catch → on error: `log.error` + `sendAlert({ stage: "dashboard", ... })`. **Never throws** — digest is already delivered, dashboard is a nice-to-have. Added `mskDateDmy()` helper (DD.MM.YYYY in Europe/Moscow, strips NBSP defensively).

## Files Modified

| File                          | Action   | Lines (+/-)     |
|-------------------------------|----------|-----------------|
| `src/dashboard.ts`            | created  | +579 / 0        |
| `scripts/build-dashboard.ts`  | rewritten| +12 / -572 (≈)  |
| `src/deliver.ts`              | modified | +53 / 0         |
| `src/run.ts`                  | modified | +46 / 0         |
| **Total**                     |          | **+683 / -572** |

Net diff: +111 lines (large positive because dashboard logic moved + new helpers, but slim-by-default payload).

## Observed Payload Size

- **Before** (current production-ish data, with `RawPost.text`): `3052282` bytes ≈ **2981 KB ≈ 3.0 MB**
- **After** (Task 1 commit, same `data/raw/*.json` and `data/output/*.md` corpus): `356741` bytes ≈ **348.4 KB**
- **Reduction factor**: **8.5×** (well under Telegram's 50 MB sendDocument ceiling indefinitely).

Smoke check captured:
```
[dashboard] posts=1652 events=148 range=2026-04-27..2026-05-19
[dashboard] wrote /Users/vladilen/Documents/vscode/tg-parser-demo/data/dashboard/index.html (348.4 KB)
```

Both `grep -c '"text":"' data/dashboard/index.html` → `0` (confirmed payload no longer carries post text) and `p.fileDate / p.source / p.username` references still present in APP_JS.

## Commits

| # | Hash      | Type     | Description                                                                |
|---|-----------|----------|----------------------------------------------------------------------------|
| 1 | `84a53db` | refactor | Extract `buildDashboard()` to `src/dashboard.ts` + drop `RawPost.text`     |
| 2 | `2fa43f9` | feat     | Add `sendDashboardDocument()` to `src/deliver.ts` (multipart `sendDocument`)|
| 3 | `ee459a6` | feat     | Auto-build + send dashboard after TG+web pipelines in `tick()`             |

## Verification Status

- `npx tsc --noEmit` — **clean** (after each task, and final).
- `npm test` — **2600/2600 passed** (137 test files), no regressions.
- `npm run dashboard` — **success**, file size **348.4 KB** (down from ~3 MB), `"text":"` count = 0.
- `grep "p\.fileDate|p\.source|p\.username"` on generated HTML — all three present.
- `src/run.ts` — imports landed; dashboard block placement confirmed: AFTER `─── Web pipeline ───`, BEFORE WR-09 outer catch.

## Deviations from Plan

None — plan executed exactly as written. The two regex/parsing comments inside `loadAllEvents()` were preserved from the original `scripts/build-dashboard.ts` (they describe pre-existing Rule 1 fixes from a previous task — not from this plan).

## Deferred Items

- **Abort signal threading into `buildDashboard()`**: explicitly out of scope per Task 3 notes. `buildData()` is fast (no jitter sleep); a SIGINT mid-fetch to Telegram will be caught by undici → our try/catch → alert. Threading `activeAbort.signal` through `buildDashboard()`/`sendDashboardDocument()` is a future micro-optimization, not a correctness gap.
- **Unit tests for `sendDashboardDocument()` and `buildDashboard()`**: no test file existed for `src/deliver.ts` before this plan (consistent with the codebase pattern of testing storage/parsing layers, not pure-HTTP shims). Adding tests was not in the plan's tasks and is out of scope for this quick task.

## Self-Check: PASSED

- `src/dashboard.ts` — exists, exports `buildDashboard()`.
- `scripts/build-dashboard.ts` — exists, is a thin CLI shim (~13 lines).
- `src/deliver.ts` — exports `sendDashboardDocument` (verified via grep).
- `src/run.ts` — contains `── Dashboard ──` block between Web pipeline and WR-09.
- Commits `84a53db`, `2fa43f9`, `ee459a6` all present in `git log`.
- `data/dashboard/index.html` exists at 356741 bytes (348.4 KB) with zero `"text":"` occurrences.
