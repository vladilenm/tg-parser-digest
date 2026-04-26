---
gsd_state_version: 1.0
milestone: v3.0
milestone_name: Structured digest + persistence + Stage 1 acceptance
status: defining_requirements
last_updated: "2026-04-26T00:00:00.000Z"
last_activity: 2026-04-26
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State: tg-parser-demo

**Last updated:** 2026-04-26 — Milestone v3.0 started

## Project Reference

See: `.planning/PROJECT.md` (обновлён 2026-04-26 с разделом Current Milestone v3.0)

**Core Value:** В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.

**Current Focus:** Defining requirements for milestone v3.0

**Source of Truth:** `docs/intent-v3.0.md` для v3.0 (16 REQ-IDs, 4 wave-группы, дедлайн 22.05.2026); `spec-app.md` остаётся базой общих решений (§7-§9 реализованы, §13 Postgres+pgvector намеренно игнорируется).

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-26 — Milestone v3.0 started, v2.0 artifacts archived to milestones/v2.0-*

## Accumulated Context

### Key Decisions (validated/superseded в v1.0/v2.0)

Полный лог с outcomes — в `PROJECT.md` → Key Decisions. Кратко:

- ✓ Superseded: ручной запуск без крона (v1.0) → daemon-режим под PM2 + node-cron (v2.0)
- ✓ Superseded: «только MVP, SPEC.md отложен» (v1.0) → v3.0 берёт критическую часть SPEC.md (структурированный JSON, дедуп, архивы), но без БД
- ✓ Carried v1.0+v2.0+v3.0: GramJS user-session + DeepSeek + экстрактивность `keyQuote`
- ✓ Closed: «без персистентности между запусками» (v1.0) → v3.0 закрывает дедуп через файловый SHA-256 hash-cache (rolling 14 дней)
- ⚠️ Revisit: Unicode NFC vs NFD в `keyQuote.includes()` (IN-01 backlog) — не блокирует v3.0
- — Pending v3.0: качество лексической дедупы vs семантическая через embeddings (оценится по 7-day smoke)

### Decisions committed for v3.0 (from intent-v3.0.md)

- Структурированный JSON по 5 жёстким направлениям (бункер/масла/керосин/нефтехимия/битум) + блок упоминаний (Роснефть/Лукойл/Газпром); пост вне 5 категорий — drop, не fallback в «прочее».
- Zod-валидация ответа DeepSeek + retry x1 при невалидной схеме; повторный fail → throw → alert-bot.
- Дедуп лексический (не семантический): SHA-256 от нормализованного текста (lowercase, без эмодзи/пунктуации, первые 200 символов); `data/hash-cache.json`, rolling 14 дней, фильтрация по timestamp при загрузке.
- Архивы на ФС (не в БД): `data/raw/YYYY-MM-DD.json` (все собранные сообщения за день) + `data/output/YYYY-MM-DD.md` (финальная сводка, идентична отправленной); атомарная запись через `.tmp + rename`.
- Alert-bot отдельный — `BOT_TOKEN_ALERTS` + `ALERTS_CHAT_ID`, не загрязняет канал Заказчика тех-ошибками.
- Документация Этапа 1: RUNBOOK.md (5 сценариев) + CHANNELS.md (lifecycle); существующий README остаётся базой.
- Acceptance-пакет: 7 суток непрерывных сводок + Приложение №2 + 7 скриншотов + лог-выписка с uptime + 3 markdown-файла.
- **Без ломки публичного контракта v2.0**: cron `0 20 * * *` Europe/Moscow, тот же канал доставки, daemon под PM2.
- **v3.0 закрывает runtime-gap v2.0**: 7-day uptime-acceptance (ACCEPT-01) валидирует SC1/SC2/SC5 v2.0 практически.

### Tech Debt (deferred)

**v1.0 backlog (12 items):** chunkHtml edge cases, NaN env validation, Unicode NFC, `.gitignore` глоб, `LOG_LEVEL` задокументирован но не читается. См. `milestones/v1.0-MILESTONE-AUDIT.md`.

**v2.0 backlog (5 items info, не блокируют v3.0):**
- `src/telegram.ts:134,139,149,152` — pre-existing `console.warn/error` (LOG-01 не покрывал; зачистить попутно если меняем `telegram.ts` для STRUCT-родственных задач)
- `ecosystem.config.cjs:1` — stale comment с `.js` именем
- `src/pipeline.ts:87` ↔ `src/telegram.ts:166` — double `username:` prefix в `errors[]`
- README §VPS не предупреждает про `npm ci --omit=dev` gotcha с tsx
- REQUIREMENTS.md DEPLOY-01/DOC-01 ссылаются на `.js` вместо `.cjs` (override accepted, не синхронизированы) — больше не актуально, файл архивирован в `milestones/v2.0-REQUIREMENTS.md`

**v2.0 runtime gap (carried into v3.0):**
- HUMAN-UAT smoke-test (npm start + временный cron + SIGINT exit 0) не подтверждён — закрывается ACCEPT-01 (7-day proof)
- 38 PLACEHOLDER каналов — operator должен заполнить реальными username перед 7-day smoke

### Resolved Blockers

Нет.

### Open Blockers / Risks (v3.0)

- **Дедлайн жёсткий**: 2 рабочих дня на код v3.0 + 7 суток acceptance до 22.05.2026. Любое скольжение по коду съедает acceptance-окно.
- **38 PLACEHOLDER каналов** — без реальных username 7-day smoke даст пустые сводки (операционный блокер ACCEPT-01).
- **DeepSeek схема**: переход с «free-form digest» на «строгий JSON по 5 направлениям» может дать высокий процент drop'ов на первых прогонах — оценится только в живом запуске.
- **PM2 на VPS** не валидирован живьём (v2.0 SC3 не подтверждён) — в v3.0 это часть acceptance.
- **Alert-bot** — нужен второй bot token; оператор должен создать `BotFather → /newbot` и заполнить `.env` перед стартом.
- **`docs/RUNBOOK.md` 5 сценариев сбоя**: «диск переполнен» / «network down» — реальные граничные случаи, требуют ручной симуляции для проверки runbook'а.

## Session Continuity

**Last session:** 2026-04-26T00:00:00.000Z

**Next action:** генерируется REQUIREMENTS.md → spawn `gsd-roadmapper` → approve ROADMAP.md → `/clear` → `/gsd-discuss-phase 1` либо `/gsd-plan-phase 1`

**Open questions:**
- Структура фаз v3.0 — одна YOLO-фаза (как v2.0) или 4 атомарных фазы по wave-группам? Решит roadmapper по составу REQ-IDs и блокирующим зависимостям (ACCEPT-01 точно отдельная фаза-checkpoint после кода).

---
*State updated: 2026-04-26 — Milestone v3.0 started; defining requirements*
