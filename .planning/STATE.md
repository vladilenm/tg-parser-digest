---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Автоматизация + 50 каналов
status: active
last_updated: "2026-04-22T00:00:00.000Z"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State: tg-parser-demo

**Last updated:** 2026-04-22 — milestone v2.0 started

## Project Reference

See: `.planning/PROJECT.md` (обновлён 2026-04-22 с разделом Current Milestone v2.0)

**Core Value:** За один `npm start` получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

**Current Focus:** Перевод парсера из одноразового скрипта в daemon-режим на VPS (PM2 + node-cron, ежедневно 20:00 MSK) и расширение охвата до 50 каналов. Подробный спек изменений — [docs/phase-2.md](../docs/phase-2.md).

**Source of Truth:** `docs/phase-2.md` для v2.0; `spec-app.md` (§7/§8/§9/§11/§13) остаётся базой общих решений.

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-22 — Milestone v2.0 started

## Accumulated Context

### Key Decisions (validated in v1.0)

Полный лог с outcomes — в `PROJECT.md` → Key Decisions. Кратко:

- ✓ Ручной запуск без крона — пересматривается в v2.0: добавляем `node-cron` + PM2
- ✓ Только MVP, SPEC.md отложен — v2.0 берёт минимальный срез: автоматизация + 50 каналов без Postgres/pgvector/дедупа по эмбеддингам/классификатора
- ✓ GramJS user-session вместо Bot API для чтения
- ✓ DeepSeek как единственный LLM
- ⚠️ Экстрактивный промпт + серверная верификация через `includes()` — Unicode NFC vs NFD не учтён (IN-01, остаётся в backlog за рамками v2.0)
- ✓ Без тестов в MVP (ручной чек-лист §11) — v2.0 продолжает линию ручной приёмки + summary-лог как инструмент диагностики
- — Pending: Без персистентности (оценится по реальной частоте повторов, в v2.0 — только in-memory дедуп в рамках одного прогона)

### Decisions committed for v2.0

- `npm start` становится long-running daemon; старый одноразовый режим уходит.
- Cron `'0 20 * * *'` с `timezone: "Europe/Moscow"`.
- Прогон ТОЛЬКО по расписанию — без run-on-start; PM2-рестарт в любое время не триггерит дайджест.
- Список 38 новых каналов по нефтегазу РФ (нефтехимия/бункеровка/масла/битум/керосин) подбирает оператор, ревью перед мёржем.
- Клиент GramJS создаётся per-run и дисконнектится в `finally` — живую сессию между прогонами не держим.
- Новая runtime-dep `node-cron` (итого 4 вместо 3) — компромисс принят ради daemon-режима.

### Tech Debt (deferred, v1.0 backlog)

12 items из v1.0 audit (archived: `milestones/v1.0-MILESTONE-AUDIT.md`). Известны, не блокируют v2.0:

- 5 Warnings: chunkHtml edge cases × 3, `.gitignore` неполный glob, NaN env validation
- 6 Info: Unicode NFC, cast повторы, `process.exit` внутри main, silent skip медиа, magic constant 0.5, README troubleshooting
- 1 Integration INFO: `LOG_LEVEL` задокументирован в `.env.example`, нигде не читается

Примечание: при выделении `src/pipeline.ts` и рефакторе `src/run.ts` часть Info-пунктов (`process.exit` внутри main) закрывается попутно — проверить при execution фазы.

### Resolved Blockers

Нет.

### Open Blockers / Risks

- **Bot API `disconnect`/`TIMEOUT` в daemon**: текущий `fetchLast24h` не рассчитан на долгоживущий процесс; в v2.0 обязательно покрыть reconnect-логикой.
- **FloodWait на 50 каналах**: `CHANNEL_DELAY_MS` поднят до 1750 мс + jitter; оценится на первом прогоне.
- **Подписка оператора**: user-аккаунт должен быть подписан на все 50 каналов, иначе `ChannelPrivateError` и skip. Дисциплина оператора, не код.
- **PM2 на VPS не проверен до этого milestone** — smoke-проверка стартапа и `pm2 save/resurrect` обязательна в verification.

## Session Continuity

**Last session:** 2026-04-22 (milestone v2.0 started from `docs/phase-2.md`)

**Next action:** `/gsd-discuss-phase 2` (или `/gsd-plan-phase 2` чтобы пропустить обсуждение) после того как roadmap утверждён.

**Open questions:** Нет — все решения зафиксированы в `docs/phase-2.md` разделе «Решения».

---
*State updated: 2026-04-22 — milestone v2.0 «Автоматизация + 50 каналов» started*
