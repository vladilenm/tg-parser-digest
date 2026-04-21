# Roadmap: tg-parser-demo

**Last updated:** 2026-04-21 after v1.0 milestone shipped

## Core Value

За один `npm start` получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

## Milestones

- ✅ **v1.0 MVP дайджест** — Phase 1 (shipped 2026-04-21) — [archive](milestones/v1.0-ROADMAP.md)
- 📋 **v2.0** — не определён (кандидаты: Postgres/pgvector/дедуп, крон, классификатор направлений, абстракции `LLMProvider`)

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

### 📋 v2.0 (not yet planned)

Запустить через `/gsd-new-milestone` когда MVP-дайджест будет стабильно использоваться несколько дней и появится понимание реальной частоты повторов / ценности классификатора.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. MVP дайджест | v1.0 | 3/3 | ✅ Complete | 2026-04-21 |

---
*Roadmap reorganized: 2026-04-21 at v1.0 milestone completion*
