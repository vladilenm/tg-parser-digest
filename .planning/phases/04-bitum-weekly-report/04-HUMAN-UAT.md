---
status: partial
phase: 04-bitum-weekly-report
source: [04-VERIFICATION.md]
started: 2026-05-22T10:35:00Z
updated: 2026-05-22T10:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Upload UX (inline-keyboard на загрузку xlsx)
expected: Бот отвечает inline-keyboard'ом из 5 кнопок (4 типа + Отмена), после тапа отвечает чек-листом «✅ Сохранено как fca_sellers.xlsx. Период: ... Распознано N строк, ошибок: K. Чек-лист недели: …»
result: [pending]

### 2. /bitum_report — превью в DM
expected: DM получает дайджест с period header + плоский список движений (sort by |Δ| desc) + cross-check warning (если расхождения > 1%) + cell-trace footer; затем bot предлагает «📤 Опубликовать / ❌ Отмена»
result: [pending]

### 3. Публикация в TG_CHANNEL_ID
expected: Тот же HTML контент уходит в TG_CHANNEL_ID, edit на исходном сообщении: «📤 Опубликовано в канал». Лог: [bitum] publish: userId=... hash=... chars=...
result: [pending]

### 4. /bitum_add — позиция manual block в дайджесте
expected: В превью между period header и блоком объёмов появляется блок «<i>Контекст оператора:</i>» с «<b>Средняя цена БНД:</b> 28336 ₽/т»
result: [pending]

### 5. /bitum_reset — FS side-effect + подтверждение
expected: data/uploads/<ISO-week>/ удаляется целиком (4 xlsx + manual-numbers.json), бот edit'ит сообщение на «✅ Неделя ... сброшена. Удалено файлов: N»
result: [pending]

### 6. REPORT_TTL_MS — 15-минутный timeout превью
expected: Бот edit'ит сообщение: «⏳ Превью истёк (15 мин). Повторите /bitum_report.». В канал ничего не уходит.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
