---
quick_id: 260520-i5v
slug: reuse-dashboard-send-from-run-once-scrip
date: 2026-05-20
status: complete
---

# Quick 260520-i5v — Reuse dashboard send from run-once scripts

## Цель

Вынести dashboard build+send блок из `tick()` в переиспользуемый helper, чтобы ручные `npm run start:once` и `npm run start:once:web` тоже отправляли dashboard в канал, а не только daemon в 20:15 MSK.

## Что сделано

### Task 1 — `buildAndSendDashboard(runId)` helper (`4b9adff`)

В `src/dashboard.ts` добавлен экспорт `buildAndSendDashboard(runId: string): Promise<void>`:

- Внутренний try/catch: `buildDashboard()` → форматирует `dashboard-DD.MM.YYYY.html` через локальный `mskDateDmy()` (Intl.DateTimeFormat ru-RU, timeZone Europe/Moscow) → `sendDashboardDocument(path, fileName)`.
- На любую ошибку: `log.error` + `sendAlert(stage="dashboard", message, runId, stack)`. **Никогда не throw'ит** — caller может вызывать без обёртки.

### Task 2 — Wire в tick() + оба run-once (`a75f42d`)

- `src/run.ts`: inline dashboard-блок (~25 строк build+send+try/catch+sendAlert) заменён на `await buildAndSendDashboard(runId);`. Локальный `mskDateDmy()` удалён (теперь в `dashboard.ts`).
- `scripts/run-once.ts`: после `runPipeline(runId)` вызов `await buildAndSendDashboard(runId);` ДО `process.exit(0)`.
- `scripts/run-once-web.ts`: после `runWebPipeline(runId)` вызов `await buildAndSendDashboard(runId);` ДО `process.exit(0)`.

## Файлы

- `src/dashboard.ts` (+60 строк): `buildAndSendDashboard` + локальный `mskDateDmy`.
- `src/run.ts` (-47 → -2 строки в tick): импорт + один вызов.
- `scripts/run-once.ts` (+5 строк): импорт + вызов после pipeline.
- `scripts/run-once-web.ts` (+3 строки): импорт + вызов после pipeline.

## Verification

- `npx tsc --noEmit` — clean.
- `npm test --silent` — **2450/2450 passed** (130 files, 2.6s).
- `grep mskDateDmy src/run.ts` — пусто (хелпер переехал в `dashboard.ts`).
- `grep buildAndSendDashboard` — три точки вызова: `src/run.ts:103`, `scripts/run-once.ts:19`, `scripts/run-once-web.ts:19`.

## Эффект

Теперь и daemon-режим (`npm start` → cron 20:15 MSK), и ручные тестовые прогоны (`npm run start:once`, `npm run start:once:web`) отправляют dashboard файл-вложение в канал дайджеста следом за HTML-сообщениями.

## Commits

- `4b9adff` feat(quick-260520-i5v): add buildAndSendDashboard(runId) helper in src/dashboard.ts
- `a75f42d` feat(quick-260520-i5v): wire buildAndSendDashboard in tick + both run-once scripts

## Deviations

Нет. SUMMARY.md изначально был создан executor'ом внутри worktree и потерян при удалении worktree — восстановлен оркестратором по данным из executor-репорта и проверке кода.
