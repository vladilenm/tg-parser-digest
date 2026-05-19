---
quick_id: 260519-pwy
date: 2026-05-19
status: completed
---

# Quick 260519-pwy: PNG-magic branch in fetchQuickChartPng

## Goal

quickchart на невалидный Chart.js config возвращает **HTTP 400 + PNG-картинку с текстом ошибки**, а не JSON. Прошлая попытка дебага (quick-260519-pl2) читала body как UTF-8 — мусор в логах. Здесь — слать error-PNG в TG как есть, чтобы причина 400 была видна прямо на картинке в чате.

## Changes

**`src/upload/chart.ts`** — `fetchQuickChartPng` ветка `!res.ok`:

1. Module-level `PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]` + helper `hasPngMagic(bytes)`.
2. На `!res.ok` body читается **один раз** через `res.arrayBuffer()` (нельзя дёргать `text()` после — стрим расходуется).
3. Если первые 8 байт = PNG magic → `log.warn` + `return bytes`. Caller (`generateChartPng` → `handleSummarizeCommand` → `sendPhotoMultipart`) отправит error-PNG в TG без изменений.
4. Если не PNG → `TextDecoder("utf-8", { fatal: false })` decode (lossy, не throw на бинарных байтах), truncate 500ch + `…`, throw как раньше (поведение pl2).
5. Если сам `arrayBuffer()` упал → throw с `<body unavailable>` placeholder.

**`src/__tests__/upload-chart.test.ts`** — 3 теста update (мок переключён `text:` → `arrayBuffer:` через `new TextEncoder().encode(...).buffer`), 1 переименован (`res.text() throws` → `arrayBuffer() throws`), 3 добавлены:
- PNG body на !ok → returns bytes (не throw)
- HTML body на !ok → throws с excerpt
- body короче 8 байт → throws

## Tests

`npx vitest run src/__tests__/upload-chart.test.ts` → **66 passed (3 files)**. Полный suite не запускался (constraint от пользователя — ~2000 тестов слишком долго).

## Incident note

Первый прогон executor через worktree-isolation попал в битый базис: `git merge` сделал fast-forward на коммит, который удалил 60+ файлов (исходники, тесты, package.json, Dockerfile…). Откатили `git reset --hard abbfc4d`, забрали ТОЛЬКО `src/upload/chart.ts` и `src/__tests__/upload-chart.test.ts` через `git checkout e927092 -- <files>`, сделали чистый коммит `09704e0`. Проблемный worktree `agent-aae3af0f7c0311498` и его ветка снесены. Корневая причина — 25 устаревших worktree в `.claude/worktrees/`, нужно почистить в отдельной задаче.

## Commits

- `09704e0` — `fix(quick-260519-pwy): return PNG bytes on HTTP !ok when body is quickchart error-image`

## Next

Перезапусти `/summarize`. Бот пришлёт PNG-картинку с красным текстом ошибки от quickchart — на ней будет точная причина 400 (что не так с Chart.js config). Скинь скриншот — следующий fix починит сам config одним коммитом.
