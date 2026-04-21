---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Roadmap created, awaiting plan decomposition
last_updated: "2026-04-21T06:48:46.635Z"
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# State: tg-parser-demo

**Last updated:** 2026-04-21 after roadmap creation

## Project Reference

**Core Value:** За один `npm start` получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

**Current Focus:** Phase 1 — MVP дайджест (единственная фаза MVP). Пройти от `npm install` до работающего дайджеста в приватном канале за 3 плана: каркас+сессия → пайплайн сбора и LLM → доставка+склейка+README.

**Source of Truth:** `spec-app.md` (§7 шаги реализации, §8 промпт, §9 anti-ban, §11 приёмка)

## Current Position

- **Milestone:** MVP
- **Phase:** 1 (MVP дайджест)
- **Plan:** — (not yet decomposed; next step — `/gsd-plan-phase 1`)
- **Status:** Roadmap created, awaiting plan decomposition
- **Progress:**
  - Phases: `[░] 0/1 complete`
  - Plans: `[░] 0/— complete` (планы ещё не созданы)
  - Requirements: `[░░░░░░░░░░] 0/26 shipped`

## Performance Metrics

| Metric | Value |
|--------|-------|
| v1 requirements | 26 |
| Requirements mapped | 26/26 (100%) |
| Phases | 1 |
| Planned parallelization | Plan 1 || Plan 2 (Plan 3 depends on both) |
| Target completion signal | 5/5 критериев §11 spec-app.md вручную |

## Accumulated Context

### Key Decisions (from PROJECT.md)

- Ручной запуск, без крона — самая дешёвая проверка связки
- Только MVP, SPEC.md (Postgres+pgvector+BullMQ+классификатор+крон) отложен до следующего milestone
- GramJS user-session вместо Bot API для чтения (Bot API не видит произвольные каналы)
- DeepSeek как единственный LLM, без `LLMProvider` абстракции
- Экстрактивный промпт с обязательной дословностью `keyQuote`
- Без тестов в MVP — ручной чек-лист §11
- Без персистентности между запусками — повтор постов в дайджестах допустим

### Roadmap Decision

- **Одна фаза вместо 3–5**: по явному запросу пользователя («сильно меньше чем coarse»). MVP — один скрипт, все 26 требований связаны одним пайплайном `GramJS → DeepSeek → Bot API`, ни одно подмножество не даёт верифицируемую ценность без остальных.
- **Разбиение на 3 плана внутри Phase 1** (рекомендация для `/gsd-plan-phase 1`): каркас+сессия / пайплайн сбора и LLM / доставка+склейка+README.

### Todos (project-level)

- [ ] Декомпозировать Phase 1 на планы через `/gsd-plan-phase 1`
- [ ] Перед запуском: оператору подписаться user-аккаунтом на все 10–15 каналов из `channels.yaml` (иначе `ChannelPrivateError`)
- [ ] Перед запуском: создать приватный канал, добавить бота админом, получить `TG_CHANNEL_ID` (например, через `@username_to_id_bot`)

### Blockers

Нет.

### Risks / Watchlist

- **FloodWait на первом прогоне**: если user-аккаунт не подписан на часть каналов, GramJS будет бросать `ChannelPrivateError` — не FloodWait, но прогон всё равно потеряет эти каналы. Дисциплина оператора, не код.
- **Дословность `keyQuote`**: проверка только ручная по выборке из 20 постов. Если DeepSeek начнёт «перефразировать» цитаты — это и есть провал success criterion 2, промпт придётся ужесточать.
- **Лимит 4096 символов Bot API**: режем по ~4000 с запасом, но `chunkHtml` обязан резать по закрывающим тегам, иначе Telegram вернёт ошибку parse_mode.

## Session Continuity

**Last session:** 2026-04-21T06:48:46.632Z

**Next action:** `/gsd-plan-phase 1` — декомпозировать MVP дайджест на 3 плана согласно `Suggested Plan Decomposition` в ROADMAP.md.

**Open questions:** Нет. Spec-app.md покрывает все архитектурные решения.

---
*State initialized: 2026-04-21 by gsd-roadmapper*
