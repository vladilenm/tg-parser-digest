# Roadmap: tg-parser-demo

**Created:** 2026-04-21
**Granularity:** coarse (compressed — пользователь явно запросил «сильно меньше»)
**Total phases:** 1
**Coverage:** 26/26 v1 requirements mapped

## Core Value

За один `npm start` получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

## Phases

- [ ] **Phase 1: MVP дайджест** — один скрипт, который от `npm install` до HTML-дайджеста в закрытом канале проходит полный путь GramJS → DeepSeek → Bot API и удовлетворяет 5 критериям приёмки из §11 spec-app.md

## Phase Details

### Phase 1: MVP дайджест

**Goal**: Оператор может за одну команду `npm start` получить в свой приватный Telegram-канал HTML-дайджест за последние 24 часа по 10–15 каналам российского нефтегаза, где каждая цитата дословно присутствует в исходном посте, а пустой день корректно обрабатывается без похода в LLM.

**Depends on**: Nothing (первая и единственная фаза MVP)

**Requirements** (26):
- CFG-01, CFG-02, CFG-03, CFG-04, CFG-05
- AUTH-01, AUTH-02
- FETCH-01, FETCH-02, FETCH-03, FETCH-04, FETCH-05, FETCH-06
- SUM-01, SUM-02, SUM-03, SUM-04
- DELIVER-01, DELIVER-02, DELIVER-03, DELIVER-04
- RUN-01, RUN-02, RUN-03
- OPS-01, OPS-02

**Success Criteria** (what must be TRUE — основаны на §11 spec-app.md):

1. **Сбор быстрый и без банов**: `npm start` на 15 каналах завершается за < 60 секунд и не выбрасывает `FloodWaitError` благодаря ограниченному окну, последовательности с jitter и правдоподобному клиенту *(поддерживают CFG-04, FETCH-01, FETCH-02, FETCH-04, FETCH-05, FETCH-06)*.

2. **Дословность цитат**: для выборки из 20 постов каждый `keyQuote` в пришедшем HTML-дайджесте дословно найден в исходном `text` поста — проверяется вручную *(поддерживают SUM-01, SUM-02, SUM-03)*.

3. **Корректная HTML-доставка**: в приватный канал приходит одно сообщение или корректно пронумерованные части `(i/N)`, `parse_mode: "HTML"` рендерится без ошибок, пользовательский текст экранирован *(поддерживают SUM-04, DELIVER-01, DELIVER-02, DELIVER-03, DELIVER-04)*.

4. **Пустой день обрабатывается**: если за 24 часа ни одного поста — скрипт логирует `No posts in window` и выходит с кодом 0, DeepSeek и Telegram не дёргаются *(поддерживают RUN-01, RUN-02)*.

5. **Запуск воспроизводится в 3 команды**: по README новый оператор проходит путь `npm install` → `npm run login` (разовая генерация `TG_SESSION`) → `npm start` и получает дайджест; дисциплина «не чаще одного прогона в 10–15 минут» зафиксирована в README *(поддерживают CFG-01, CFG-02, CFG-03, CFG-05, AUTH-01, AUTH-02, RUN-03, OPS-01, OPS-02)*.

**Plans**: 3 plans (созданы 2026-04-21)

- [ ] 01-01-PLAN.md — Каркас + сессия (package.json, tsconfig.json, .env.example, channels.yaml, .gitignore, scripts/login.ts)
- [ ] 01-02-PLAN.md — Пайплайн сбора и суммаризации (src/types.ts, src/telegram.ts, src/summarize.ts)
- [ ] 01-03-PLAN.md — Доставка, склейка, README + ручная приёмка (src/deliver.ts, src/run.ts, README.md)

## Suggested Plan Decomposition

Пользователь запросил 2–3 плана суммарно. Рекомендуемое разбиение внутри Phase 1 (детализируется через `/gsd-plan-phase 1`):

| Plan | Scope | Requirements | Maps to spec-app.md |
|------|-------|--------------|---------------------|
| 1. Каркас + сессия | `package.json`, `tsconfig.json`, `.env.example`, `channels.yaml`, `.gitignore`, `scripts/login.ts` | CFG-01…05, AUTH-01, AUTH-02 | §7.1, §7.2 |
| 2. Пайплайн сбора и суммаризации | `src/telegram.ts` (GramJS client + fetchLast24h + anti-ban), `src/summarize.ts` (DeepSeek + промпт + renderHtml) | FETCH-01…06, SUM-01…04 | §7.3, §7.4, §8, §9 |
| 3. Доставка, склейка, README | `src/deliver.ts` (chunk + sendMessage), `src/run.ts` (main + пустой день), `README.md` (3 команды + дисциплина), ручная приёмка | DELIVER-01…04, RUN-01…03, OPS-01, OPS-02 | §7.5, §7.6, §10, §11 |

Разбиение допускает параллельное выполнение Plan 1 и Plan 2 (`parallelization: true` в config.json), но Plan 3 зависит от обоих.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. MVP дайджест | 0/3 | Plans created, awaiting execution | — |

## Coverage Validation

**v1 requirements:** 26
**Mapped:** 26 (all to Phase 1)
**Orphaned:** 0
**Duplicates:** 0

Coverage by category:
- CFG: 5/5 → Phase 1
- AUTH: 2/2 → Phase 1
- FETCH: 6/6 → Phase 1
- SUM: 4/4 → Phase 1
- DELIVER: 4/4 → Phase 1
- RUN: 3/3 → Phase 1
- OPS: 2/2 → Phase 1

## Notes

- **Почему одна фаза?** Пользователь явно запросил «сильно меньше чем coarse». MVP — один скрипт на ~400 строк кода, три модуля, без БД/Docker/крона. Разбиение на 2+ фазы создало бы искусственные границы: все 26 требований связаны одной цепочкой `GramJS → DeepSeek → Bot API`, ни одно подмножество не даёт верифицируемую ценность без остальных. Проверяемая ценность появляется только когда весь пайплайн работает end-to-end.
- **Что делает границу фазы осмысленной?** Success Criteria = 5 критериев приёмки из §11 spec-app.md. Фаза закрыта, когда все 5 выполняются вручную оператором.
- **Гранулярность — через планы, не фазы.** Разбиение на 3 плана внутри Phase 1 даёт удобные чекпойнты для прогресса (каркас → пайплайн → доставка+приёмка), не раздувая структуру.
- **v2 явно отложен**: Postgres/pgvector/дедуп/крон/классификатор — следующий milestone (SPEC.md, см. §13 spec-app.md).

---
*Roadmap created: 2026-04-21 by gsd-roadmapper*
