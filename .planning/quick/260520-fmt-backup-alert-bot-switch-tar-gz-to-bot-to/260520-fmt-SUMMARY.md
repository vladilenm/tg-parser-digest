---
phase: 260520-fmt
plan: 01
subsystem: infra
tags: [backup, telegram, alert-bot, env-config]

# Dependency graph
requires:
  - phase: 260509-k9l
    provides: tar.gz daily backup via bot.sendDocument + 7-day rolling retention
provides:
  - Daily tar.gz backup routed to operator DM via alert-bot (BOT_TOKEN_ALERTS + ALERTS_CHAT_ID)
  - TG_CHANNEL_ID (digest channel) no longer receives backup archives
  - Skip-on-missing-env guard mirrors src/alert.ts pattern (log.warn + return, never throw)
affects: [backup, deploy, env-config, alert-bot]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Alert-bot creds shared between alert.ts and backup.ts — single Bot Token + chat_id for all non-digest operator traffic"

key-files:
  created: []
  modified:
    - src/backup.ts
    - .env.example

key-decisions:
  - "Полностью убрать fallback на TG_BACKUP_CHANNEL_ID/TG_CHANNEL_ID — backup и дайджест больше не делят канал"
  - "Reuse alert-bot creds (BOT_TOKEN_ALERTS/ALERTS_CHAT_ID) вместо отдельной пары для backup — единый non-digest канал для оператора"
  - "Skip-on-missing-env через log.warn + return (как в alert.ts), а не throw — backup опционален, daemon не должен падать"

patterns-established:
  - "Operator-private traffic (alerts, backups) идёт через BOT_TOKEN_ALERTS → ALERTS_CHAT_ID; TG_CHANNEL_ID зарезервирован под публичный дайджест"

requirements-completed: [QUICK-260520-fmt]

# Metrics
duration: 2min
completed: 2026-05-20
---

# Phase 260520-fmt Plan 01: Switch daily tar.gz backup to alert-bot creds Summary

**Daily tar.gz backup в src/backup.ts переключён с delivery-бота (TG_BOT_TOKEN + TG_CHANNEL_ID) на alert-бота (BOT_TOKEN_ALERTS + ALERTS_CHAT_ID), архивы теперь идут в личку оператору и не загрязняют публичный канал дайджеста**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-20T08:18:45Z
- **Completed:** 2026-05-20T08:20:09Z
- **Tasks:** 3 (2 code + 1 verification-only)
- **Files modified:** 2

## Accomplishments

- `backupAndSend()` теперь читает `BOT_TOKEN_ALERTS` и `ALERTS_CHAT_ID` (вместо `TG_BOT_TOKEN` + `TG_BACKUP_CHANNEL_ID`/`TG_CHANNEL_ID`).
- Fallback-цепочка на `TG_BACKUP_CHANNEL_ID` и `TG_CHANNEL_ID` полностью удалена из `src/backup.ts` (нет ни в коде, ни в лог-сообщениях).
- Guard-блок повторяет паттерн `src/alert.ts:20-33`: `if (!token || !chatId) { log.warn(...); return; }` — без throw, daemon продолжает работать при неконфигурированных кредах.
- `.env.example` в блоке Alert-bot явно сообщает, что эти же креды используются для daily tar.gz backup (cron 03:15 MSK, архив config/+state/ идёт в `ALERTS_CHAT_ID`).
- TypeScript строгая компиляция проходит, все 2736 тестов в 146 файлах зелёные.

## Task Commits

Each task was committed atomically:

1. **Task 1: Переключить backup.ts на BOT_TOKEN_ALERTS + ALERTS_CHAT_ID** - `0142bd7` (feat)
2. **Task 2: Обновить .env.example — отметить, что backup идёт через alert-бота** - `55179e6` (docs)
3. **Task 3: Прогнать существующие тесты** - verification-only, no commit (2736/2736 passed)

**Plan metadata:** orchestrator handles docs commit (PLAN.md + SUMMARY.md + STATE.md).

## Files Created/Modified

- `src/backup.ts` — `backupAndSend()` env-чтение и guard переключены на alert-бота, fallback на delivery-бот удалён (-4/+3 строки).
- `.env.example` — в блок Alert-bot (после `# Шлёт в личку владельца, НЕ загрязняет канал Заказчика.`) добавлены 2 строки про daily tar.gz backup → `ALERTS_CHAT_ID` (+2 строки).

## Decisions Made

- **Полное удаление delivery-бот fallback из backup.ts**: оставлять `TG_BOT_TOKEN`/`TG_CHANNEL_ID` как резервный путь нет смысла — задача в принципе развести каналы, fallback бы возвращал нас в исходную точку при отсутствии alert-кредов.
- **`log.warn` вместо `log.error` на missing env**: backup-skip — это не аварийная ситуация (бот может быть ещё не настроен), как и в `alert.ts`. Согласовано с существующим паттерном.
- **Не трогать `tgSendDocument`, `pruneOldBackups`, `BACKUP_RETAIN`, top-of-file комментарий**: они описывают механику (tar.gz + sendDocument + retention), не конкретного бота — изменения не требуются.

## Deviations from Plan

None — plan executed exactly as written. Точки автоматизации: `TG_BACKUP_CHANNEL_ID` в `.env.example` отсутствовал заранее (Task 2 шаг 1 был no-op, как и предполагал плановый «если отсутствует — пропустить шаг»).

## Issues Encountered

None.

## User Setup Required

None напрямую — переменные `BOT_TOKEN_ALERTS` и `ALERTS_CHAT_ID` уже были обязательны для alert-бота (ALERT-01). Если оператор уже сконфигурировал alert-блок, backup автоматически начнёт ходить в тот же чат после деплоя. Если креды не заданы — backup тихо пропускается с log.warn (daemon не падает).

**На проде после деплоя:** проверить, что в первый запуск `backupAndSend()` (cron 03:15 MSK) tar.gz пришёл в `ALERTS_CHAT_ID`, а не в `TG_CHANNEL_ID`.

## Next Phase Readiness

- Канал дайджеста (`TG_CHANNEL_ID`) теперь полностью отделён от operator-private трафика (alerts + backups).
- Паттерн «alert-bot креды = все non-digest сообщения оператору» зафиксирован; будущие фичи (например, error digest, status pings) могут переиспользовать тот же канал без новых env-переменных.
- Никаких блокеров для дальнейших фаз.

## Self-Check

**Files verified:**
- FOUND: src/backup.ts (modified, contains BOT_TOKEN_ALERTS + ALERTS_CHAT_ID, no TG_BOT_TOKEN/TG_BACKUP_CHANNEL_ID/TG_CHANNEL_ID)
- FOUND: .env.example (modified, alert-bot block mentions daily tar.gz backup)
- FOUND: .planning/quick/260520-fmt-backup-alert-bot-switch-tar-gz-to-bot-to/260520-fmt-SUMMARY.md (this file)

**Commits verified:**
- FOUND: 0142bd7 (feat(quick-260520-fmt): switch daily backup to alert-bot creds)
- FOUND: 55179e6 (docs(quick-260520-fmt): note backup uses alert-bot creds in .env.example)

**Verification commands replayed:**
- `npx tsc --noEmit` — OK (no output, exit 0)
- `grep -nE "TG_BOT_TOKEN|TG_BACKUP_CHANNEL_ID|TG_CHANNEL_ID" src/backup.ts` — none
- `grep -n "BOT_TOKEN_ALERTS" src/backup.ts` — line 112 + 116
- `grep -n "ALERTS_CHAT_ID" src/backup.ts` — line 113 + 116
- `grep -q "TG_BACKUP_CHANNEL_ID" .env.example` — absent
- `grep -q "BOT_TOKEN_ALERTS" .env.example` — present
- `grep -qi "backup" .env.example` — present (alert-bot block)
- `npm test --silent` — 2736/2736 passed in 146 files

## Self-Check: PASSED

---
*Phase: 260520-fmt*
*Completed: 2026-05-20*
