---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Автоматизация + 50 каналов
status: executing
last_updated: "2026-04-22T07:41:00.160Z"
last_activity: 2026-04-22
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 7
  completed_plans: 4
  percent: 57
---

# State: tg-parser-demo

**Last updated:** 2026-04-22 — Roadmap created

## Project Reference

See: `.planning/PROJECT.md` (обновлён 2026-04-22 с разделом Current Milestone v2.0)

**Core Value:** За один `npm start` получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

**Current Focus:** Phase 02 — daemon-50

**Source of Truth:** `docs/phase-2.md` для v2.0; `spec-app.md` (§7/§8/§9/§11/§13) остаётся базой общих решений.

## Current Position

Phase: 02 (daemon-50) — EXECUTING
Plan: 5 of 7
Status: Ready to execute
Last activity: 2026-04-22

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
- YOLO-режим: вся фаза v2.0 — одна атомарная Phase 2 (20 требований), без разбивки на подфазы.
- Plan 02-03: SCALE-01 закрыт структурно через 38 PLACEHOLDER_NN-стабов (safe-skip pattern); замена на реальные username — non-blocking checkpoint оператора.
- Plan 02-03: CHANNEL_DELAY_MS поднят 1000→1750 (SCALE-02); avg ~2000мс с jitter, запас против FloodWait на 50 каналах.

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

**Last session:** 2026-04-22T07:41:00.158Z

**Next action:** `/gsd-plan-phase 2` — спланировать и выполнить Phase 2

**Open questions:** Нет — все решения зафиксированы в `docs/phase-2.md` разделе «Решения».

---
*State updated: 2026-04-22 — Roadmap created, Phase 2 pending plan*
