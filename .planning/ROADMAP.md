# Roadmap: tg-parser-demo

**Last updated:** 2026-04-22 — v2.0 roadmap created

## Core Value

За один прогон получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

## Milestones

- ✅ **v1.0 MVP дайджест** — Phase 1 (shipped 2026-04-21) — [archive](milestones/v1.0-ROADMAP.md)
- 📋 **v2.0 Автоматизация + 50 каналов** — Phase 2 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP дайджест (Phase 1) — SHIPPED 2026-04-21</summary>

- [x] Phase 1: MVP дайджест (3/3 plans) — completed 2026-04-21
  - [x] 01-01: Каркас + сессия (package.json, tsconfig.json, .env.example, channels.yaml, .gitignore, scripts/login.ts)
  - [x] 01-02: Пайплайн сбора и суммаризации (src/types.ts, src/telegram.ts, src/summarize.ts)
  - [x] 01-03: Доставка, склейка, README + ручная приёмка (src/deliver.ts, src/run.ts, README.md)

Требования: 26/26 shipped (CFG×5, AUTH×2, FETCH×6, SUM×4, DELIVER×4, RUN×3, OPS×2).
Success Criteria: 5/5 §11 spec-app.md passed (OPS-02 approved).
Full archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

### v2.0 Автоматизация + 50 каналов

- [ ] **Phase 2: Daemon + 50 каналов** — весь milestone одной атомарной фазой (YOLO)

## Phase Details

### Phase 2: Daemon + 50 каналов
**Goal**: Парсер работает как daemon на VPS: ежедневный дайджест в 20:00 MSK без участия оператора, 50 каналов, диагностируемые прогоны через summary-лог
**Depends on**: Phase 1 (shipped)
**Requirements**: DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-04, PIPE-01, PIPE-02, PIPE-03, RELI-01, RELI-02, RELI-03, LOG-01, LOG-02, LOG-03, SCALE-01, SCALE-02, DEPLOY-01, DEPLOY-02, DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. `npm start` не завершается после старта — процесс висит, лог показывает `daemon started, schedule: 0 20 * * * Europe/Moscow`; `Ctrl+C` вызывает `received SIGINT, stopping cron` и чистый `exit 0`
  2. В 20:00 MSK дайджест приходит в закрытый канал автоматически без запуска оператором; summary-лог в `pm2-out.log` содержит `channels: total=50`, `delivered=true` и `durationMs`
  3. PM2 smoke: `pm2 start ecosystem.config.js` → статус `online`; `pm2 kill && pm2 resurrect` восстанавливает daemon без ручного вмешательства
  4. Обрыв сети во время прогона (wifi off/on ~10 сек) → в логе `reconnect attempt 1/3` → прогон продолжается, дайджест уходит; пропавший канал отражён в `errors[]` после исчерпания 3 попыток
  5. Второй тик крона при активном прогоне пишет `prev run still in progress — skipping tick` и не запускает второй пайплайн
  6. `npx tsc --noEmit` выдаёт 0 ошибок после всех изменений
**Plans**: 7 plans
- [x] 02-01-PLAN.md — Pipeline extract + RunSummary + in-memory dedupe [wave 1]
- [x] 02-02-PLAN.md — Structured logger + logRunSummary [wave 1]
- [ ] 02-03-PLAN.md — channels.yaml → 50 + CHANNEL_DELAY_MS=1750 [wave 1, checkpoint]
- [ ] 02-04-PLAN.md — GramJS reconnect retry in fetchLast24h [wave 2]
- [ ] 02-05-PLAN.md — Daemon entrypoint + node-cron + mutex + SIGINT/SIGTERM + smoke-test [wave 3, checkpoint]
- [ ] 02-06-PLAN.md — PM2 ecosystem.config.js + kill_timeout [wave 3]
- [ ] 02-07-PLAN.md — README: VPS/PM2 + daemon-режим + summary-лог + удалить старую дисциплину [wave 4]

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. MVP дайджест | v1.0 | 3/3 | ✅ Complete | 2026-04-21 |
| 2. Daemon + 50 каналов | v2.0 | 0/7 | Plans ready | — |

---
*Roadmap updated: 2026-04-22 — Phase 2 planned (7 plans, 4 waves)*
