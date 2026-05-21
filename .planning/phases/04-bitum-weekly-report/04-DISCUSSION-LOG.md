# Phase 4: bitum-weekly-report - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 04-bitum-weekly-report
**Areas discussed:** Декомпозиция плана, Формат отчёта + LLM scope
**Areas deferred (Claude's Discretion):** Парсинг all_prices.xlsx, Classifier confidence + learning UX

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Декомпозиция плана | 28 REQ: один большой план vs wave-структура vs 5-7 атомарных PLAN.md | ✓ |
| Парсинг all_prices.xlsx | algoritm.md §5 сложная трансформация: raw парсинг vs «свод»-вкладка | |
| Classifier confidence + learning UX | confidence ∈ [0,1] схема + inline-keyboard на confidence<1 | |
| Формат отчёта + LLM scope | Markdown vs HTML, REPORT-07 trace, LLM scope (1-2 sentence vs multi-paragraph) | ✓ |

**User's choice:** Декомпозиция плана + Формат отчёта + LLM scope.

---

## Декомпозиция плана

### Q1: Сколько PLAN.md файлов и какая структура?

| Option | Description | Selected |
|--------|-------------|----------|
| 5-7 атомарных планов (рекомендую) | По фичам: 04-01 signatures+classifier, 04-02 5 parsers + REFINERY, 04-03 analyzer+reporter, 04-04 bot-команды, 04-05 миграция+алиасы | |
| 3 средних wave-группы | 04-01 «ingest», 04-02 «report», 04-03 «bot» | |
| 1 мега-план | 04-01 всё-в-одном | ✓ |

**User's choice:** 1 мега-план.

### Q2: Что идёт в first plan (foundation)?

| Option | Description | Selected |
|--------|-------------|----------|
| Signatures + classifier shell + types | 04-01 = src/bitum/signatures.ts + classifier.ts + bitum/types.ts | |
| Refineries.json + REFINERY-01..02 | 04-01 = расширить data/refineries.json + getCompany unit-tests | |
| Claude решит при planning | /gsd-plan-phase сам выберет foundation из dependency-graph | ✓ |

**User's choice:** Claude решит при planning.

### Q3: Когда делать миграцию src/upload/ → src/bitum/?

| Option | Description | Selected |
|--------|-------------|----------|
| Последним планом (рекомендую) | Сначала пишем новый src/bitum/* рядом со старым src/upload/*, потом 04-N = move + delete | ✓ |
| Первым планом | 04-01 = git mv src/upload/ → src/bitum/ сразу | |
| src/upload/ остаётся shim'ом | src/upload/*.ts переписывается в re-export shim'ы до v5.x release | |

**User's choice:** Последним планом (рекомендую).

### Q4: Как делаем 5 парсеров (BITUM-PARSE-01..05)?

| Option | Description | Selected |
|--------|-------------|----------|
| Все 5 в одном плане (рекомендую) | Однородная логика (ExcelJS + cellToDate/Number + long-table) | ✓ |
| 2 плана: existing 3 + new 2 | 04-A: refactor 3 existing, 04-B: 2 new (all_prices + bitum_price_new) | |
| 5 отдельных планов | Каждый parser — свой PLAN.md | |

**User's choice:** Все 5 в одном плане (рекомендую).

### Clarification: Противоречие между Q1 (1 мега-план) и Q3/Q4 (которые подразумевали >1)

| Option | Description | Selected |
|--------|-------------|----------|
| 1 PLAN.md с внутренней wave-структурой | Один файл 04-01-PLAN.md, внутри нумерованные wave-секции (signatures → parsers → reporter → bot → migrate), executor проходит wave-блоки внутри | ✓ |
| Насамом деле 5-7 атомарных планов | Ошибся при клике. Делим на 04-01..04-NN файлы | |

**User's choice:** 1 PLAN.md с внутренней wave-структурой.

**Notes:** Финальная декомпозиция: один файл `04-01-PLAN.md` с 6 нумерованными wave-секциями. Atomic-commit на каждую wave. Точные имена wave-секций и foundation-список Claude уточнит при `/gsd-plan-phase`.

---

## Формат отчёта + LLM scope

### Q1: Формат отчёта (Telegram parse_mode)?

| Option | Description | Selected |
|--------|-------------|----------|
| HTML (рекомендую) | parse_mode=HTML, теги <b>/<i>/<code>/<a>. Стабильный escape (паттерн из src/telegram.ts + sendHtml), в v3.0 уже работает | ✓ |
| Markdown V1 | parse_mode=Markdown, *bold*/_italic_. Текущий renderer.ts уже пишет MD, но в v1.0 были проблемы со спецсимволами | |
| MarkdownV2 | parse_mode=MarkdownV2 (жёсткий escape). Нет существующего escape-хелпера в проекте | |

**User's choice:** HTML (рекомендую).

### Q2: LLM scope в отчёте (REPORT-01)?

| Option | Description | Selected |
|--------|-------------|----------|
| Только summary 1-2 предложения (спека) | LLM пишет только вводный абзац. Внутри блоков — детерминированный рендер из цифр | |
| Summary + narrative на каждую группу | Сверху summary, внутри каждого блока — 1-2 LLM-предложения с контекстом «Ключевые движения...» | |
| Multi-параграф (текущий /summarize) | Оставить логику llm.ts без изменений (LLM пишет весь отчёт как narrative) | |

**User's choice (free text):** Пользователь приложил полный эталонный формат отчёта из `docs/bitum/algoritm.md` §6 (период 30 апреля – 8 мая 2026 г., с разделами «### Объёмы биржевых торгов», «### Роснефть (Σ|Δ| = 3 795 тыс.т)», «### Газпромнефть», «### ЛУКОЙЛ», «### Прочие и независимые»).

**Reflected back to user:** Гибрид — numbers programmatic, narrative-предложения LLM (top summary 1-3 предложения + framing внутри каждого блока + closing «остальные позиции остались на уровне начала периода»). Reporter подставляет все числа из ParsedRow, LLM пишет только framing-предложения с жёстким запретом выдумывать цифры.

### Q2-confirm: Правильно ли я понял LLM scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Да, хибрид: numbers programmatic, narrative LLM | LLM пишет только framing, числа НПЗ/цены/Δ/объёмы из ParsedRow | ✓ |
| Нет, только top summary, всё остальное детерминированно | LLM только вводный абзац, внутри блоков — буллеты без framing | |

**User's choice:** Да, гибрид.

### Q3: REQ-REPORT-07 «extractive trace» — где хранится cell-ref для каждого числа?

| Option | Description | Selected |
|--------|-------------|----------|
| Структура внутри ReportResult (не в выводе) | Reporter возвращает { html, trace: NumberTrace[] }. Trace только в unit-тестах + логе | |
| Footer-блок в конце отчёта | <code>Источники:</code> + список файлов/диапазонов в конце сообщения | ✓ |
| Inline footnote-маркеры [1], [2]... | Каждое число с маркером, в конце развёрнутые ссылки | |

**User's choice:** Footer-блок в конце отчёта.

### Q3-followup: Trace footer — в каком виде?

| Option | Description | Selected |
|--------|-------------|----------|
| <code>blockquote</code> в конце, по файлу | Свёрнутая сводка: «birzha_prices.xlsx: 70 чисел из row 4..18 cols B..T», «bitum_price_new.xlsx: bnd 28000 ← B4, pbv 30000 ← D4» | ✓ |
| Полный список всех чисел | Каждое число — отдельная строка в footer'е | |

**User's choice:** Компактный свод по файлу.

### Q4: /bitum_preview когда загружены не все 5 типов?

| Option | Description | Selected |
|--------|-------------|----------|
| Render partial + checklist раздел | Рендерим то что есть, в начале warning «Доступно 3/5: ..., Отсутствуют: ...» | ✓ |
| Блокировать до всех 5 | Ответ «Дозагрузите: ...», отчёт не строим | |
| Порог minimum 2 типа (birzha_prices + fca) | Рендерим если есть минимум birzha+fca, иначе блокируем | |

**User's choice:** Render partial + checklist.

---

## Done?

| Option | Description | Selected |
|--------|-------------|----------|
| Готов к CONTEXT.md | Две пропущенные области → Claude's Discretion | ✓ |
| Разобрать пропущенные области | Парсинг all_prices.xlsx + classifier confidence | |
| Другие вопросы | Cross-check threshold, /bitum_reset semantics, /bitum_report confirmation UX, deprecation alias order | |

**User's choice:** Готов к CONTEXT.md.

---

## Claude's Discretion (deferred to planning)

- Foundation wave precise file list
- Парсинг all_prices.xlsx (raw vs «свод»-вкладка)
- Classifier confidence model (бинарная vs ступенчатая vs весовая)
- Cross-check threshold (REPORT-08, env var vs хардкод)
- Сохранение оригинальных имён файлов в meta
- signatures-learned.json schema
- /bitum_report cancel/timeout
- renderer.ts vs reporter.ts разделение

## Deferred Ideas (Future Requirements)

- BITUM-OCR-01 (распознавание Снимок экрана.jpg)
- BITUM-TG-06 (выбор недели)
- BITUM-TG-07 (/bitum_undo)
- BITUM-AUTOSEND-01 (автопостинг по cron)
- BITUM-REPORT-09 (RSS cross-check)
- BITUM-PARSE-07 (multi-sheet all_prices)
