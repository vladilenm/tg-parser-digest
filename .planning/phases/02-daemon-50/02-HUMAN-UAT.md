---
status: partial
phase: 02-daemon-50
source: [02-VERIFICATION.md]
started: 2026-04-22T08:05:42Z
updated: 2026-04-22T08:05:42Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Замена 38 PLACEHOLDER_NN в channels.yaml (SCALE-01, non-blocking)
expected: каждая из 38 записей `- username: "PLACEHOLDER_NN"` заменена на реальный публичный username канала нефтегаза/нефтехимии РФ. После замены: `grep -c "PLACEHOLDER_" channels.yaml` → `0`, `grep -c "^  - username:" channels.yaml` → `50`. User-аккаунт из `TG_SESSION` должен быть подписан на каждый добавленный канал.
result: [pending]

### 2. Smoke-тест daemon: startup + SIGINT (SC1 из plan 02-05)
expected: `npm start` печатает `[<ISO>] [info] daemon started, schedule: 0 20 * * * Europe/Moscow` и висит; `Ctrl+C` печатает `[<ISO>] [info] received SIGINT, stopping cron` и завершается с `echo $?` == `0`.
result: [pending]

### 3. Smoke-тест daemon: mutex + summary-лог (SC2 + SC5)
expected: временно подменить cron-паттерн в `src/run.ts` на `"*/2 * * * *"`, `npm start`, дождаться тика → `logRunSummary` печатает блок с `channels: total=50 ...`, `delivered=<true|false>`, `duration=Ns`; при `delivered=true` дайджест приходит в закрытый канал; второй тик во время активного прогона → `[warn] prev run still in progress — skipping tick`; `Ctrl+C` во время прогона → daemon ждёт завершения → exit 0.
result: [pending]

### 4. Восстановление cron-паттерна после smoke-теста (обязательно)
expected: `grep -q 'cron.schedule("0 20 \* \* \*"' src/run.ts` exits 0 и `! grep -qE '"\*/[0-9]+ \* \* \* \*"' src/run.ts` exits 0.
result: [pending]

### 5. Smoke-тест reconnect (SC4, optional)
expected: при запущенном daemon со smoke-паттерном `*/2 * * * *` и выключенном Wi-Fi на 10 сек — `[<ISO>] [warn] reconnect attempt 1/3 for <username>, waiting 1000ms`; прогон продолжается после восстановления связи. Можно пропустить (реальный VPS-деплой закрывает сценарий).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
