---
phase: 03-web-scraping
plan: 03
subsystem: daemon-integration
tags: [integration, daemon, alerts, tick]
requires:
  - src/pipeline.ts (existing runPipeline; rewritten signature)
  - src/web-scraper.ts (Plan 03-02: runWebPipeline export)
  - src/alert.ts (sendAlert + AlertPayload, stage:string)
  - src/types.ts (RunSummary, WebRunSummary)
  - src/logger.ts (existing logRunSummary; extended)
provides:
  - "runPipeline(runId: string): Promise<RunSummary> — refactored signature (D-07)"
  - "tick() with two independent try/catch (D-08)"
  - "sendAlert(stage:'web') route on web failure (D-09)"
  - "logWebRunSummary(s: WebRunSummary): void — symmetrical to logRunSummary"
affects:
  - "src/pipeline.ts (signature change — runId now caller-provided)"
  - "src/run.ts (tick() rewritten; bot-supervisor untouched)"
  - "src/logger.ts (+1 export)"
  - "scripts/run-once.ts (Rule 3 fix — pass runId to runPipeline)"
tech-stack:
  added: []
  patterns:
    - "Outer try/finally + inner try/catch для каждого этапа — failure isolation"
    - "Shared runId per tick для cross-stage trace (один grep-фильтр в pm2 logs)"
    - "Stage-prefixed sendAlert (tick / web / bot) — оператор различает источник по тексту"
key-files:
  created: []
  modified:
    - src/pipeline.ts
    - src/run.ts
    - src/logger.ts
    - scripts/run-once.ts
decisions:
  - "Bot-supervisor (lines 63-81 from original run.ts) сохраняет свой `const alertId` — отдельная семантика (id алерта, не runId прогона). Не unifying с tick'овым runId."
  - "Rule 3 deviation: scripts/run-once.ts тоже зовёт runPipeline() — после смены сигнатуры этот call-site блокирует tsc. Поднят runId на уровень caller'а, симметрично tick()."
  - "Task 1 TDD: existing tests run as baseline (verifying refactor не задел соседние модули); явные unit-тесты для runPipeline отсутствуют — runPipeline жёстко связан с GramJS/DeepSeek/файловой системой, изолированный test bench не предусмотрен Phase 3 scope (Plan 03-04 owns dedicated tests)."
metrics:
  duration: ~4min
  tasks_completed: 3
  commits: 4
  tests_added: 0
  tests_total: 90
  completed: 2026-05-06
---

# Phase 3 Plan 3: Daemon Integration Summary

WEB-01..WEB-03 wiring: `runPipeline()` signature lifted to `runPipeline(runId)` (D-07), `tick()` in `src/run.ts` split into two independent try/catch blocks (D-08) sharing a single per-tick `runId`, web-failure routes through `sendAlert(stage:"web", ...)` (D-09), and `src/logger.ts` extended with parallel `logWebRunSummary` (`[web-summary]` prefix). Bot-supervisor block (lines 63-81 of original `run.ts`) and `shutdown()` left byte-identical. After Phase 3 Plan 3 the daemon delivers two HTML messages per tick — TG digest first, then web digest — with one shared `runId` for grep-trace, and a TG failure no longer blocks the web run.

## Tasks Executed

| # | Task | Files | Commit |
|---|------|-------|--------|
| 1 | Refactor `runPipeline()` → `runPipeline(runId: string)` (D-07) | `src/pipeline.ts` | `e876d41` |
| 2 | Rewrite `tick()` — two independent try/catch (D-06..D-09), shared `runId` | `src/run.ts` | `3126a01` |
| 3 | Add `logWebRunSummary` to `src/logger.ts` | `src/logger.ts` | `94ff192` |
| 3+ | Rule 3 deviation fix: `scripts/run-once.ts` passes runId to runPipeline | `scripts/run-once.ts` | `362cd1c` |

## Verification Outcomes

| Check | Result |
|-------|--------|
| `^export async function runPipeline\(runId: string\): Promise<RunSummary>` matches | yes |
| `const runId = crypto.randomUUID().slice(0, 8);` removed from `pipeline.ts` | yes |
| `pipeline.ts` still references `runId` 7 times (logs + writeRaw + summary) | yes |
| Existing 4 vitest files: 90/90 still passing after Task 1 | yes |
| `import { runWebPipeline } from "./web-scraper.js"` in `run.ts` | yes |
| `import { log, logRunSummary, logWebRunSummary } from "./logger.js"` | yes |
| `const runId = crypto.randomUUID().slice(0, 8);` count == 1 in run.ts (tick) | yes |
| `const alertId = crypto.randomUUID().slice(0, 8);` count == 1 (bot-supervisor only) | yes |
| `await runPipeline(runId)` count == 1 in run.ts | yes |
| `await runWebPipeline(runId)` count == 1 in run.ts | yes |
| `try {` count >= 4 in run.ts (got 7 — outer + TG + web + bot + their 3 alert-send try blocks) | yes |
| `stage: "tick"`, `stage: "web"`, `stage: "bot"` all present | yes |
| `logWebRunSummary(webSummary)` invocation in tick | yes |
| Comment with decision-id (`Web-pipeline стартует НЕЗАВИСИМО` / `D-08`) present | yes |
| Bot-supervisor `startBot()` and `shutdown()` untouched | yes |
| `^export function logWebRunSummary\(s: WebRunSummary\): void` in logger.ts | yes |
| `[web-summary]` prefix literal | yes |
| Logger fields: `websites: total=`, `items: collected=`, `delivered=${s.digestDelivered}` | yes |
| Original `logRunSummary` unmodified | yes |
| `npx tsc --noEmit` (after all 3 tasks + Rule 3 fix) | clean exit |
| `npx vitest run` (full suite) | 90/90 passing |
| `grep -c 'await runPipeline' src/run.ts` == 1 | yes |
| `grep -c 'await runWebPipeline' src/run.ts` == 1 | yes |

## Key Implementation Notes

- **Single `runId` declaration in tick (D-07):** lifted to the very top of the function body, BEFORE the outer `try`, so the `finally` block doesn't reference an undefined symbol. Both inner try-blocks (TG, web) close over it. The `jitter`-log line, the `runPipeline(runId)` call, both inner catch logs, and both `sendAlert(payload)` blocks all reference the same identifier — one `grep runId=abc12345` filters the entire tick across PM2 logs (T-03-11 mitigation).
- **Outer try/finally vs inner try/catch (D-08):** the outer block exists ONLY to guarantee `isRunning = false` on every path. The two pipelines live inside their own try/catch — a TG throw is caught locally, alerted, and execution falls through to the web block. There is NO outer catch — by construction, every error path inside is already handled, so a thrown alert-on-alert (which is also locally swallowed via inner-most try/catch) cannot escape to the cron-scheduler.
- **Bot-supervisor not unified with tick'овым runId:** decided to keep `const alertId` distinct rather than synthesizing a third identifier scope. The bot-supervisor IIFE is a one-shot fire (kicked off at module load), not a per-tick recurring construct — semantically it's «id алерта», not «id прогона». Renaming to `runId` would create false symmetry with the daemon-tick contract that `runId` = a single 24h tick.
- **Rule 3 deviation — `scripts/run-once.ts`:** the plan's `files_modified` listed only `src/pipeline.ts`, `src/run.ts`, `src/logger.ts` — but `scripts/run-once.ts:11` also calls `runPipeline()`. After Task 1 changed the signature, this call-site became a tsc error. Plan's Task 3 verify is `npx tsc --noEmit && npx vitest run` — without fixing run-once we'd fail Task 3's done-state. Applied minimal symmetric fix: generate `runId` at caller, pass to `runPipeline(runId)`. Mirrors the pattern in the rewritten `tick()`.
- **Bot-supervisor and `shutdown()` are byte-identical:** verified by `grep -F 'startBot()'` and `grep -F 'process.on("SIGINT"'` matching, and the diff for `src/run.ts` shows changes confined to lines 14-48 of the original file.
- **`logWebRunSummary` prefix `[web-summary]` (vs TG's `[summary]`):** chosen so an operator scanning PM2 logs can filter web-only summaries with `grep '\[web-summary\]'`. Symmetrical to TG's existing `[summary]` prefix.

## Threat Model Mitigations Applied

| Threat | Disposition | Action Taken |
|--------|-------------|--------------|
| T-03-09 (DoS / cascading failure) | mitigate | TG and web wrapped in **separate** inner try/catch blocks; one's failure does not cascade to the other. Outer try is finally-only — no cross-stage catch. Verified: `try {` count == 7 in run.ts (outer + TG inner + web inner + 2× alert-send + bot-supervisor + bot alert-send). |
| T-03-10 (Information disclosure via alerts) | mitigate | `sendAlert` payload built from `{stage, message, runId, stack}` only (existing src/alert.ts T-01-02 contract). No `process.env`, no scraped content, no URL of failing site. Stack truncated to 1500 chars in `src/alert.ts:36`. Routes to `ALERTS_CHAT_ID` (operator DM), not customer channel. |
| T-03-11 (Repudiation: who initiated run) | mitigate | One `runId` per tick (D-07): `grep runId=abc12345` shows EVERY event of the prgona — TG fetch, web fetch, both summarize calls, both writeRaw/Output writes, both alerts. Old code generated runIds at three call-sites (pipeline.ts internal, alertId in tick catch, alertId in bot-supervisor) — ambiguity removed for the tick-flow. |
| T-03-12 (Race condition: concurrent tick) | accept | Existing `let isRunning = false` (run.ts:12) mutex preserved verbatim. Phase 3 introduces no new shared mutable state — the change is intra-tick (split try/catch), no cross-tick concurrency surface. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `scripts/run-once.ts` calls `runPipeline()` without runId argument**

- **Found during:** End of Task 3, when `npx tsc --noEmit` was run for the verification step
- **Issue:** Plan's Task 1 changed `runPipeline()` to `runPipeline(runId)`. Plan's `files_modified` listed `src/pipeline.ts`, `src/run.ts`, `src/logger.ts`, but missed `scripts/run-once.ts:11` which also invokes `runPipeline()`. After Task 1, this call-site produced `error TS2554: Expected 1 arguments, but got 0.`, blocking `npx tsc --noEmit` clean (Task 3 done-state).
- **Fix:** Generated `const runId = crypto.randomUUID().slice(0, 8);` at the caller (mirroring the new pattern in `tick()`), passed `runId` to `runPipeline(runId)`. Added inline comment with D-07 reference.
- **Files modified:** `scripts/run-once.ts`
- **Commit:** `362cd1c`

Apart from this Rule 3 deviation, the plan executed exactly as written. No Rule 1 (bug) or Rule 2 (missing critical) auto-fixes triggered.

## Authentication Gates

None. Plan is fully offline — all changes are intra-source code edits; verification is `npx tsc --noEmit` + `npx vitest run`. No DeepSeek / Telegram / network calls were made during execution.

## Known Stubs

None. All three tasks ship complete behavior:
- `runPipeline(runId)` is a real refactor — same business logic, just one identifier moved up the call-stack.
- `tick()` two-block control flow is the production behavior — both pipelines run, both fail-modes alert, both successes log a summary.
- `logWebRunSummary` is a real formatter (8 lines of structured output, identical shape to the TG counterpart) — not a placeholder console.log.

## Threat Flags

None. Every security-relevant surface introduced/modified (alert routing for new `stage:"web"` value, shared runId across pipelines, refactored try/catch tree) was anticipated in the plan's `<threat_model>` (T-03-09..T-03-12) and dispositions are honored — see "Threat Model Mitigations Applied" above.

## Self-Check: PASSED

- `src/pipeline.ts` modified — FOUND
- `src/run.ts` modified — FOUND
- `src/logger.ts` modified — FOUND
- `scripts/run-once.ts` modified (Rule 3 fix) — FOUND
- Commit `e876d41` (Task 1) — FOUND in `git log`
- Commit `3126a01` (Task 2) — FOUND in `git log`
- Commit `94ff192` (Task 3) — FOUND in `git log`
- Commit `362cd1c` (Rule 3 fix) — FOUND in `git log`
- `npx tsc --noEmit` — clean exit verified
- `npx vitest run` — 90/90 passing verified
- `grep -c 'await runPipeline' src/run.ts` == 1 — verified
- `grep -c 'await runWebPipeline' src/run.ts` == 1 — verified
- Bot-supervisor `alertId` count == 1 in run.ts — verified
- Single `const runId` in tick — verified
