---
status: partial
phase: 02-bot-commands
source: [02-VERIFICATION.md]
started: 2026-05-06T12:50:00Z
updated: 2026-05-06T12:50:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 409 Conflict регрессия при `pm2 restart`
expected: После `pm2 restart tg-parser` daemon стартует без 409 Conflict, очередь команд за время рестарта не теряется (deleteWebhook drop_pending_updates: false)
result: [pending]

### 2. Реальный /channels от allowlist-пользователя
expected: Бот возвращает в личке текущий список каналов из channels.json с нумерацией и счётчиком
result: [pending]

### 3. Реальный /add_channel @newchannel + следующий прогон 20:15 MSK
expected: Бот отвечает «Добавлен @newchannel...», в channels.json появляется запись, в следующем прогоне 20:15 MSK канал участвует в pipeline
result: [pending]

### 4. Реальный /remove_channel @ch — confirm flow
expected: Бот показывает inline-кнопки «Удалить»/«Отмена»; нажатие «Удалить» убирает кнопки, текст меняется на «Удалён @ch», запись пропадает из channels.json
result: [pending]

### 5. Реальный /remove_channel @ch — cancel flow
expected: Нажатие «Отмена» убирает кнопки, текст меняется на «Отмена удаления @ch», channels.json не меняется
result: [pending]

### 6. Не-allowlist пользователь — silent ignore
expected: Бот молча игнорирует (никакого ответа), в логах daemon появляется `[bot] denied: from=<id> cmd=/channels`
result: [pending]

### 7. Graceful shutdown через SIGINT
expected: После Ctrl+C daemon последовательно: останавливает cron, останавливает bot polling (≤35s), ждёт активный pipeline-tick, exit 0
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
