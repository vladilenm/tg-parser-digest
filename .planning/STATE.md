---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: milestone
status: planning
stopped_at: Phase 1 context gathered
last_updated: "2026-05-06T07:03:00.000Z"
last_activity: 2026-05-06 — Completed quick task 260506-dht: drop YAML completely + remove priority field
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State: tg-parser-demo

**Last updated:** 2026-05-05 — Roadmap created for v4.0

## Project Reference

See: `.planning/PROJECT.md` (обновлён 2026-05-05)

**Core Value:** В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.

**Current Focus:** Phase 1 — Storage Migration

## Current Position

Phase: 1 of 3 (Storage Migration)
Plan: — (not started)
Status: Ready to plan
Last activity: 2026-05-05 — Roadmap created, 12/12 requirements mapped

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Storage Migration | TBD | - | - |
| 2. Bot Commands | TBD | - | - |
| 3. Web Scraping | TBD | - | - |

*Updated after each plan completion*

## Accumulated Context

### Key Decisions (v4.0)

- **3-phase structure**: STORE (foundation) → BOT (depends on store) → WEB (independent, additive). Phase 3 can never break phases 1–2.
- **Raw fetch polling for bot**: no Telegraf/grammY; 3 commands do not justify framework overhead. See REQUIREMENTS.md Out of Scope.
- **cheerio for web scraping**: only new runtime dep (`cheerio ^1.0.0`); `@mozilla/readability` deferred to v4.x if selector fragility is observed.
- **In-process mutex for channels.json**: must be implemented in `channels-store.ts` before any other code touches the file (race condition at 20:00 MSK cron tick).
- Full decision log: `PROJECT.md` → Key Decisions table.

### Critical Pitfall (Phase 1)

Race condition: bot write overlaps pipeline read at 20:00 MSK → corrupted JSON → no digest. `channels-store.ts` mutex is a safety gate; implement before wiring any other v4.0 code.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260504-f5z | Vitest unit tests для summarize.ts | 2026-05-04 | f71266f | — |
| 260504-ew9 | Рефактор summarize.ts двухпроходная LLM-архитектура | 2026-05-04 | fc47b20 | — |
| 260504-eae | Заголовок дайджеста + per-category DeepSeek лимиты | 2026-05-04 | bb3544e | — |
| 260506-cad | Чанкование Pass 1 в classifyPosts (CLASSIFY_CHUNK_SIZE) — фикс ECONNRESET на 220+ постах | 2026-05-06 | 6d338e5 | [260506-cad-pass-1-src-summarize-ts-classifyposts-ll](./quick/260506-cad-pass-1-src-summarize-ts-classifyposts-ll/) |
| 260506-dht | Drop YAML completely + remove priority field — JSON-only storage, `yaml` dep removed, channels.yaml/prod-channels.yaml deleted | 2026-05-06 | 901b897 | [260506-dht-drop-yaml-completely-remove-priority-fie](./quick/260506-dht-drop-yaml-completely-remove-priority-fie/) |

## Session Continuity

**Last session:** 2026-05-05T12:30:08.501Z
**Stopped at:** Phase 1 context gathered
**Next action:** `/gsd-plan-phase 1`

---
*State updated: 2026-05-05 — v4.0 roadmap created, Phase 1 ready to plan*
