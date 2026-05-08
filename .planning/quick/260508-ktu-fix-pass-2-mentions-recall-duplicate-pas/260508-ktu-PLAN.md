---
phase: quick-260508-ktu
plan: 01
type: execute
wave: 1
depends_on: [260508-k8w]
files_modified:
  - src/summarize.ts
autonomous: true
must_haves:
  truths:
    - "buildSummarizeCategoryPrompt содержит правила 4a/4b/4c с keyword-списками"
    - "NIS, Башнефть, ЯНОС, Litasco, НОРСИ присутствуют в обеих функциях (Pass 1 и Pass 2)"
    - "Сохранён exclusion clause «Газпром БЕЗ нефть → не помечай»"
    - "npm test всё ещё зелёный"
    - "npx tsc --noEmit проходит без ошибок"
  artifacts:
    - path: "src/summarize.ts"
      provides: "Pass 2 buildSummarizeCategoryPrompt with full subsidiary keyword lists"
      contains: "4a) Литерал 'rosneft'"
---

# Quick 260508-ktu — Pass 2 Mentions Recall Fix

## Problem

Customer reported missing inline-префиксы в реальном дайджесте:

```
• Сербия недовольна предложением MOL по сделке с NIS...           ← должен быть [ГПН]
• Сообщается о возгорании на НПЗ «Славнефть-ЯНОС»...               ← должен быть [РОСНЕФТЬ]
```

Оба попали в `#Компании` bucket — значит **Pass 1** (CLASSIFY_SYSTEM_PROMPT с расширенными правилами 3a/3b/3c из k8w) их распознал как mentions. Но в финальном выводе префикса нет.

## Root Cause

Pass 2 (`buildSummarizeCategoryPrompt`) перегенерирует `item.mentions` уже без полного списка keywords. Текущее правило:

```
4) mentions[] — список компаний {rosneft,lukoil,gazpromneft} из text. Может быть пустым.
```

Без подсписка дочерних структур LLM в Pass 2 не знает, что NIS = ГПН, ЯНОС = Роснефть, и оставляет mentions=[].

## Fix

Добавить в `buildSummarizeCategoryPrompt` правила 4a/4b/4c с теми же keyword-списками, что в Pass 1 (CLASSIFY_SYSTEM_PROMPT, rules 3a/3b/3c). Сохранить exclusion clause для Газпрома-без-нефть.

## Tasks

### Task 1 — Edit buildSummarizeCategoryPrompt

**File:** `src/summarize.ts`

After `"4) mentions[] — список компаний {rosneft,lukoil,gazpromneft} из text. Может быть пустым.",`, insert 18 string elements that mirror Pass 1 rules 3a/3b/3c, but renumbered as 4a/4b/4c.

**Verify:**
- `grep -c "NIS|Башнефть|ЯНОС|Litasco|НОРСИ" src/summarize.ts` → каждое keyword=2 (Pass 1 + Pass 2)
- `grep -c "4a)\|4b)\|4c)" src/summarize.ts` → 3
- `npm test` → зелёный
- `npx tsc --noEmit` → 0 ошибок

**Commit:** `fix(quick-260508-ktu): duplicate Pass 1 keyword lists into Pass 2 buildSummarizeCategoryPrompt`

## Success Criteria

- [x] Pass 2 system prompt содержит правила 4a/4b/4c
- [x] Все 5 ключевых subsidiaries (NIS, Башнефть, ЯНОС, Litasco, НОРСИ) дублируются в обеих функциях
- [x] Exclusion clause для «Газпром БЕЗ нефть» сохранён
- [x] Tests зелёные, tsc clean
- [x] Один атомарный fix-коммит
