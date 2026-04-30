---
phase: quick
plan: 260430-j1h
subsystem: docs
tags: [readme, documentation, v3.0, acceptance-package]
requirements: [DOC-05]

dependency_graph:
  requires: []
  provides: [README.md v3.0]
  affects: [acceptance-package ACCEPT-02]

tech_stack:
  added: []
  patterns: []

key_files:
  created: []
  modified:
    - README.md

decisions:
  - "README.md обновлён под v3.0 и готов как третий документ acceptance-пакета ACCEPT-02"
  - "Ссылки на docs/RUNBOOK.md и docs/CHANNELS.md добавлены — связность acceptance-пакета обеспечена"
  - "Раздел data/ описывает порядок записи (D-09): raw до dedup/LLM, output только после доставки"

metrics:
  duration: "5 min"
  completed: "2026-04-30T10:48:55Z"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
---

# Quick Task 260430-j1h: README.md v3.0 Summary

**One-liner:** README переписан под v3.0 с описанием 5-категорийного дайджеста, двухуровневой дедупликации, data/-архива, alert-системы и всех 8 обязательных env-переменных.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Переписать README.md под v3.0 | 4cc896b | README.md |

## Changes Summary

README.md полностью приведён к v3.0:

1. **Шапка** — убран `v2.0:` лейбл, заменён v3.0-формулировкой (daemon 20:15 MSK + jitter, 5 категорий, PM2/Docker).

2. **Зависимости** — счётчик «четыре» → «пять»; добавлен `zod` (schema-валидация ответа DeepSeek).

3. **Env-переменные** — перечислены все 8 обязательных: `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, `TG_BOT_TOKEN`, `TG_CHANNEL_ID`, `DEEPSEEK_API_KEY`, `BOT_TOKEN_ALERTS`, `ALERTS_CHAT_ID`. Пояснено назначение alert-бота (отдельный от delivery-бота, в личку владельца).

4. **tick() — описание** — добавлено:
   - Первая ступень dedup (in-memory `${username}:${messageId}`)
   - Вторая ступень dedup (SHA-256 hash-cache, rolling 14 дней)
   - Zod-валидация DigestJsonSchema перед доставкой
   - 5 секций дайджеста с emoji-заголовками + блок «Упоминания компаний» с orphan-логикой и inline-маркерами `[РОСНЕФТЬ]`/`[ЛУКОЙЛ]`/`[ГАЗПРОМ]`
   - Пустая секция явно помечается «— нет упоминаний за сутки»

5. **Новый раздел «Архив прогонов (data/)»** — описаны `data/raw/YYYY-MM-DD.json`, `data/output/YYYY-MM-DD.md`, `data/hash-cache.json` с объяснением порядка записи (D-09: raw атомарно до LLM, output только после успешной доставки).

6. **Новый раздел «Оперативная документация»** — ссылки на `docs/RUNBOOK.md` и `docs/CHANNELS.md`.

7. **Критерии приёмки** — обновлены: daemon startup log, `data/output/` файл, алерт при ошибке.

8. **Известные ограничения** — убран устаревший пункт про отсутствие персистентности (hash-cache решил); добавлен пункт про semantic dedup (отложен в v4.0+); ссылка `spec-app.md §12` заменена на `docs/RUNBOOK.md`.

9. **Структура проекта** — дерево обновлено: добавлены `schema.ts`, `dedup.ts`, `archive.ts`, `alert.ts`, `pipeline.ts`, `run.ts` (daemon), `data/raw/`, `data/output/`, `data/hash-cache.json`; `package.json` — «5 runtime-зависимостей».

## Deviations from Plan

None — план выполнен точно как описан.

## Known Stubs

None — README.md является документацией, не исполняемым кодом.

## Threat Flags

None — README содержит только публичную архитектурную информацию; секреты (.env) не коммитятся (covered by .gitignore).

## Self-Check: PASSED

- README.md изменён: `git log --oneline -1` → `4cc896b docs(260430-j1h): update README to v3.0`
- Нет строки `v2.0:` в шапке: подтверждено grep
- `zod` присутствует: строка 26
- `BOT_TOKEN_ALERTS` присутствует: строки 38, 158, 234
- `ALERTS_CHAT_ID` присутствует: строки 39, 158, 234
- `hash-cache` присутствует: строки 68, 92, 170, 202, 312, 331, 375, 384
- `RUNBOOK.md` присутствует: строки 291, 334, 370
- `CHANNELS.md` присутствует: строки 292, 371
- Все 5 категорий (Бункер/Масла/Керосин/Нефтехимия/Битум) присутствуют: строки 3, 72–76
