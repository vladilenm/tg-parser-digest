---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: "Управление каналами + парсинг сайтов"
status: planning
stopped_at: Roadmap created — ready to plan Phase 1
last_updated: "2026-05-05T00:00:00.000Z"
last_activity: 2026-05-05 — Roadmap created for v4.0 (3 phases, 12 requirements)
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

| # | Description | Date | Commit |
|---|-------------|------|--------|
| 260504-f5z | Vitest unit tests для summarize.ts | 2026-05-04 | f71266f |
| 260504-ew9 | Рефактор summarize.ts двухпроходная LLM-архитектура | 2026-05-04 | fc47b20 |
| 260504-eae | Заголовок дайджеста + per-category DeepSeek лимиты | 2026-05-04 | bb3544e |

## Session Continuity

**Last session:** 2026-05-05
**Stopped at:** Roadmap created — 3 phases, 12 requirements mapped
**Next action:** `/gsd-plan-phase 1`

---
*State updated: 2026-05-05 — v4.0 roadmap created, Phase 1 ready to plan*
