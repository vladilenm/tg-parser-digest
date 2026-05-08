---
phase: quick-260508-ktu
plan: 01
type: quick
tags: [bug-fix, prompt-engineering, mentions, recall]
key-files:
  modified:
    - src/summarize.ts
decisions:
  - "Дублируем keyword-списки в Pass 2 вместо инжекта mentions из Pass 1 в input — минимальный диф, минимум риска регрессии"
  - "Правила в Pass 2 нумерованы 4a/4b/4c (после правила 4 о mentions), не 3a/3b/3c — чтобы не путать с порядком правил Pass 1"
metrics:
  completed_date: "2026-05-08"
  tasks: 1
  files_modified: 1
commits:
  - 1f389c1: "fix(quick-260508-ktu): duplicate Pass 1 keyword lists into Pass 2 buildSummarizeCategoryPrompt"
---

# Quick 260508-ktu — Pass 2 Mentions Recall Fix Summary

**One-liner:** Pass 2 (`buildSummarizeCategoryPrompt`) теперь содержит те же authoritative keyword-списки subsidiaries, что и Pass 1, — `item.mentions` больше не теряется для постов про NIS, Славнефть-ЯНОС, Башнефть, НОРСИ, Litasco.

## Problem

Заказчик прислал реальный дайджест с двумя постами без inline-префиксов:
- «Сербия недовольна предложением MOL по сделке с NIS» — ожидался `[ГПН]`
- «Сообщается о возгорании на НПЗ "Славнефть-ЯНОС"» — ожидался `[РОСНЕФТЬ]`

Оба попали в `#Компании` bucket (Pass 1 их распознал как orphan-mentions), но финальный рендер не показал префикс.

## Root Cause

Двухпроходная архитектура:

1. **Pass 1** (`CLASSIFY_SYSTEM_PROMPT`) — после квик-таска `260508-k8w` содержит полные keyword-списки правил 3a/3b/3c (NIS, ЯНОС, Башнефть и т.д.) → правильно классифицирует mentions на уровне поста.
2. **Pass 2** (`buildSummarizeCategoryPrompt`) — **перегенерирует** `item.mentions` для каждой извлечённой новости. До фикса было только: *«mentions[] — список компаний {rosneft,lukoil,gazpromneft} из text»* — без подсписка дочерних структур. LLM не знал, что NIS=ГПН и ЯНОС=Роснефть, и возвращал `mentions: []`.

Pass 2 mentions перезаписывает Pass 1 — поэтому посты в bucket'е есть, но в render их префикс пуст.

## Fix

Добавлены правила 4a/4b/4c в `buildSummarizeCategoryPrompt` после правила 4. Текст и keyword-списки идентичны Pass 1 (рулы 3a/3b/3c). Exclusion clause «не назначай 'gazpromneft' если только Газпром БЕЗ нефть» сохранён внутри 4b.

## Files Modified

### src/summarize.ts (commit 1f389c1)

`buildSummarizeCategoryPrompt` — после строки `"4) mentions[] — список компаний {rosneft,lukoil,gazpromneft} из text. Может быть пустым.",` вставлено 18 новых строк, реализующих 4a/4b/4c с полными списками subsidiaries.

## Verification

| Check | Result |
|-------|--------|
| `npm test` | 1054/1054 passed (50 files) |
| `npx vitest run src/__tests__/summarize.test.ts` | 376/376 passed (16 files) |
| `npx tsc --noEmit` | 0 errors |
| `grep -c "NIS\|Башнефть\|ЯНОС\|Litasco\|НОРСИ"` | каждое keyword = 2 (Pass 1 + Pass 2) |
| `grep -E "(3a\|3b\|3c\|4a\|4b\|4c)\)"` rule labels | 6 (3 в Pass 1 + 3 в Pass 2) |

## Discretion Captured

- **Дубликация vs инжект**: альтернатива — передавать в Pass 2 input структурированные mentions из Pass 1 (`{url, channelUsername, text, mentions: [...]}`) и сказать LLM «mentions готовый, бери из input». Это чище архитектурно, но требует:
  - Изменения интерфейса между bucketing и Pass 2.
  - Логики merge mentions при объединении нескольких постов в один item (rule 7).
  - Риск регрессии в существующих тестах.

  Дубликация keyword-списков — меньше кода, не трогает контракт между фазами, не ломает тесты. Trade-off: Pass 1 и Pass 2 теперь нужно держать в синке вручную. Комментарий в коде явно отмечает это (см. inline комментарий в `buildSummarizeCategoryPrompt`).

- **Нумерация 4a/4b/4c, не 3a/3b/3c**: в Pass 2 правила mentions это #4 (после summary/keyQuote/category-rules), поэтому подправила нумеруются 4a/4b/4c — соответствует естественному порядку правил Pass 2. Семантически идентичны Pass 1 правилам 3a/3b/3c.

## Out of Scope

- TG-pipeline (`fetchLast24h`) — не трогается; mentions определяются только в LLM passes.
- Web-pipeline `applyDateFilter: true` — не задеваем; date-фильтр работает поверх mentions.
- Backfill старых дайджестов — невозможно (LLM прогон не воспроизводим без тех же постов).
