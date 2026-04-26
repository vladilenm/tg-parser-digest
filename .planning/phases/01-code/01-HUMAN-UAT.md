---
status: partial
phase: 01-code
source: [01-VERIFICATION.md]
started: 2026-04-26T11:50:00Z
updated: 2026-04-26T11:50:00Z
---

## Current Test

[awaiting human testing — Phase 2 7-day smoke acceptance на VPS]

## Tests

### 1. End-to-end smoke `npm start` на VPS с реальным `.env`
expected: Канал Заказчика получает 5-секционный дайджест с deep-link; `data/raw/YYYY-MM-DD.json` и `data/output/YYYY-MM-DD.md` появляются; `data/hash-cache.json` обновлён.
why_human: Требует операторских секретов (`TG_SESSION`, `DEEPSEEK_API_KEY`, `TG_BOT_TOKEN`, `BOT_TOKEN_ALERTS`, `ALERTS_CHAT_ID`), которые отсутствуют в среде верификации. Закрывает SC1, SC2, SC4 в реальной среде.
result: [pending]

### 2. Cross-run dedup после `pm2 restart`
expected: `data/hash-cache.json` пережил рестарт; повторно встретившиеся хеши отфильтрованы до LLM. Вчерашние посты не возвращаются в сегодняшнюю сводку.
why_human: Требует двух последовательных cron-тиков 20:00 MSK с реальным трафиком. SC3 verifiable только в Phase 2 acceptance.
result: [pending]

### 3. Симуляция unhandled error → alert в личку владельца
expected: При `TG_BOT_TOKEN=invalid` (или подобной симуляции) `alert-bot` шлёт `{stage, message, runId, stack}` в личку владельца за ≤60 секунд; в канал Заказчика тишина (`sendToChannel` не вызывался).
why_human: Требует реальных `BOT_TOKEN_ALERTS` + `ALERTS_CHAT_ID` и подтверждённого диалога с alert-ботом. SC5 verifiable только с операторскими credentials.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
