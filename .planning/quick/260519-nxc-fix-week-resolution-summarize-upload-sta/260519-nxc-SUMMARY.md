---
phase: quick-260519-nxc
plan: 01
subsystem: bot/upload
tags: [bug-fix, upload, week-resolution, summarize, upload_status]
requires:
  - src/upload/storage.ts (existed)
  - src/bot.ts (existed)
provides:
  - findLatestWeekWithUploads() — scans data/uploads/ для latest week с xlsx
  - bot.ts: /summarize и /upload_status теперь читают latest-week-with-data, не just MSK-now
key_files:
  created: []
  modified:
    - src/upload/storage.ts
    - src/bot.ts
    - src/__tests__/upload-storage.test.ts
decisions:
  - fallback: findLatestWeekWithUploads() ?? currentMskWeek() — обратная совместимость + UX для empty state
  - lex-sort YYYY-Www корректен благодаря padded двузначной неделе (W01..W52)
  - read-time scan дешевле (ms на десяток папок) — не требует state/cache
metrics:
  duration: ~15 min
  completed: 2026-05-19
  commits: 2
---

# quick-260519-nxc: Bug fix — week resolution mismatch (/summarize / /upload_status) Summary

## One-liner

`/summarize` и `/upload_status` теперь резолвят неделю через сканирование latest-папки на диске с xlsx-файлами, а не через текущую MSK-неделю — fixes "файлов не загружено" после rollover ISO-недели.

## Problem Recap

`handleDocument` сохраняет xlsx в папку недели **latest-даты данных** (`isoWeekFolder(latest)` — например, `data/uploads/2026-W19/`). А `/summarize` и `/upload_status` использовали `currentMskWeek()` — текущую MSK-неделю (`2026-W21`). При запуске `/summarize` после конца ISO-недели юзер получал «❓ За эту неделю файлов не загружено» — хотя данные физически лежали в `2026-W19/`.

**Корневая причина:** asymmetric «week source» — save-путь читал latest-дату данных, read-путь читал `now()`.

## Fix

### 1. `src/upload/storage.ts` — new helper `findLatestWeekWithUploads()`

```ts
export function findLatestWeekWithUploads(): string | null {
  // 1. Если ${DATA_DIR}/uploads/ нет → null
  // 2. Listdir uploads/, фильтр по ^\d{4}-W\d{2}$
  // 3. Для каждой матчующей папки проверка: есть ли в ней файл .xlsx
  //    (.last-run.json / .DS_Store / non-xlsx не считаются)
  // 4. Lex-max из кандидатов (padded YYYY-Www → корректный sort)
  // 5. null если ни одного кандидата
}
```

**Почему lex-sort работает:** формат `YYYY-Www` с padded двузначной неделей (`isoWeekFolder` уже делает `padStart(2, "0")`). `"2025-W52" < "2026-W01"` лексикографически и хронологически. Year-boundary edge case проверен тестом.

### 2. `src/bot.ts` — wire fallback в двух call-sites

```ts
// handleSummarizeCommand (line ~456):
const week = findLatestWeekWithUploads() ?? currentMskWeek();

// /upload_status handler (line ~674):
const week = findLatestWeekWithUploads() ?? currentMskWeek();
```

**`currentMskWeek()` сохранён** как fallback — нужен, когда `uploads/` пустой (юзер ещё не грузил ни одного файла). Тогда сообщение «За эту неделю (W-now) файлов не загружено» останется осмысленным.

**`handleDocument` НЕ изменён** — его save-логика корректна: данные привязаны к latest-дате файла, а не к моменту upload'а.

### 3. Tests — `src/__tests__/upload-storage.test.ts` (+8 cases)

| # | Case                                            | Expected         |
| - | ----------------------------------------------- | ---------------- |
| 1 | `uploads/` does not exist                       | `null`           |
| 2 | `uploads/` empty                                | `null`           |
| 3 | Only `.last-run.json` in week folder (no xlsx)  | `null`           |
| 4 | Single week with xlsx                           | that week        |
| 5 | Multiple weeks with xlsx → lex-max              | latest           |
| 6 | Invalid folder names (`tmp`, `2026-W`, `foo`) ignored | matching week |
| 7 | `.DS_Store` / `.last-run.json` / `notes.txt` — no xlsx → `null` | `null` |
| 8 | Year boundary: `2025-W52` vs `2026-W01`         | `2026-W01`       |

Total tests: **264 (256 baseline + 8 new), all green.**

## Commits

| Hash      | Message                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| `2fdaf06` | `fix(quick-260519-nxc): add findLatestWeekWithUploads helper + tests`                         |
| `b050373` | `fix(quick-260519-nxc): resolve summarize/upload_status to latest week with uploads`          |

## Production Verification

После деплоя юзер должен:
1. Открыть бота в Telegram.
2. Нажать **«🧠 Сделать сводку»** (или `/summarize`).
3. **Ожидаемо:** бот пришлёт «🤖 Готовлю LLM-сводку…» → markdown-отчёт (структурный analyze + LLM narrative).
4. **НЕ ожидаемо:** «❓ За эту неделю файлов не загружено» — это означало бы, что папка `data/uploads/` пуста ИЛИ нет xlsx в latest week. Проверить:
   ```bash
   docker exec <container> ls -la /app/data/uploads/
   docker exec <container> ls -la /app/data/uploads/2026-W19/   # пример
   ```

Дополнительно:
- **«📊 Статус загрузок»** (`/upload_status`) должен показать ту же неделю и флаги prices/fca/volumes.
- Если показывает не ту неделю — значит на диске latest-неделя действительно другая (новый файл с более поздней датой данных «победил»).

## Deviations from Plan

None — plan executed exactly as written (Task 1 + Task 2 + Summary).

## Self-Check: PASSED

- [x] `src/upload/storage.ts` — функция `findLatestWeekWithUploads` экспортируется (grep ok)
- [x] `src/bot.ts` — `findLatestWeekWithUploads` импортирован и используется в 2 call-sites (line 456, 674)
- [x] `src/bot.ts` — `currentMskWeek()` всё ещё определена (line 266) и используется как fallback
- [x] `src/__tests__/upload-storage.test.ts` — 8 новых case (describe-блок `findLatestWeekWithUploads`)
- [x] `npm test` → 264 tests green
- [x] `npx tsc --noEmit` → clean (no TS errors)
- [x] Commits `2fdaf06` + `b050373` существуют в `git log`
- [x] handleDocument save-логика НЕ изменена (grep `saveUpload` показывает один call-site внутри handleDocument)
