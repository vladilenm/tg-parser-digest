---
status: partial
phase: 04-bitum-weekly-report
source: [04-VERIFICATION.md]
started: 2026-05-21T00:00:00Z
updated: 2026-05-21T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end загрузка 5 типов xlsx через реального Telegram-бота
expected: На каждый файл бот шлёт TG-05 ответ (type+confidence+meta+parse+чек-лист) одним сообщением; чек-лист недели меняется ✅ по мере прихода файлов
result: [pending]

### 2. Classifier learning UX при unknown файле
expected: Бот шлёт inline-keyboard 6 вариантов; нажатие на тип создаёт data/bitum/signatures-learned.json и сохраняет файл; повторная загрузка того же файла → classify confidence=1
result: [pending]

### 3. /bitum_report publish flow
expected: Бот шлёт preview в DM + кнопки «📤 Опубликовать / ❌ Отмена»; нажатие «Опубликовать» → отчёт уходит в TG_CHANNEL_ID; нажатие «Отмена» → в канал ничего не идёт
result: [pending]

### 4. /bitum_reset confirm flow
expected: Бот шлёт inline-keyboard «✅ Сбросить / ❌ Отмена»; «Сбросить» → удаляет xlsx файлы текущей ISO-недели и отвечает списком удалённых; «Отмена» → файлы остаются
result: [pending]

### 5. Partial render warning при <5 типах
expected: /bitum_preview по неполной неделе (например, 2-3 файла) шлёт отчёт с warning-блоком «Доступно N/5 типов: …; Отсутствуют: …» и пропускает блоки без данных
result: [pending]

### 6. Cross-check warning между bitum_price_new snapshot и FCA
expected: При расхождении цены БНД snapshot vs FCA > 1% — отчёт содержит секцию «⚠️ Цены расходятся (REPORT-08)»
result: [pending]
notes: WR-02 — текущая реализация сравнивает по `canonical === 'БНД snapshot'` против FCA refinery names; matchей в проде не будет без фикса

### 7. Cell-trace footer соответствует реальным ячейкам xlsx
expected: Footer «Источники: <file>: N чисел» содержит реальные имена файлов; при ручном открытии xlsx и переходе на лист по trace.cell оператор находит то же число, что в отчёте
result: [pending]
notes: WR-05/WR-06 — trace.sheet хардкодит 'Sheet1', реальные имена 'исходник'/'свод' не пробрасываются

### 8. Deprecation алиасы /summarize и /upload_status
expected: Первая отправка /summarize → одноразовое сообщение «⚠️ Команда /summarize переименована в /bitum_preview…» + выполнение /bitum_preview; повторно — только /bitum_preview без deprecation msg
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
