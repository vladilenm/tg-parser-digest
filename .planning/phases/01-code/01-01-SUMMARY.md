---
phase: 01-code
plan: 01
subsystem: digest-pipeline
tags: [structured-digest, dedup, archive, alert-bot, runbook, channels]
requires:
  - v2.0 daemon (PM2 + node-cron 0 20 * * * Europe/Moscow)
  - Node 20.6+ (для Intl en-CA YYYY-MM-DD и Unicode property regex)
provides:
  - 5-категорийный JSON-дайджест с inline-маркерами компаний и deep-link
  - кросс-прогонная SHA-256 дедупа через rolling 14d hash-cache
  - ФС-архивы data/raw/*.json (до dedup) + data/output/*.md (после доставки)
  - alert-bot в личку владельца на любую ошибку pipeline
  - оперативная документация RUNBOOK + CHANNELS
affects:
  - src/types.ts (DigestJson переписан с 5 фиксированных категорий)
  - src/summarize.ts (SYSTEM_PROMPT + Zod safeParse + retry x1 + категорийный renderHtml)
  - src/pipeline.ts (D-09 8-step order: writeRaw → dedup → summarize → sendToChannel → writeOutput → commitHashCache)
  - src/run.ts (await sendAlert в catch tick())
  - src/logger.ts (postsDropped в RunSummary блоке)
tech-stack:
  added:
    - zod ^3.23.0 (5-я runtime-dep, схема-валидация DeepSeek)
  patterns:
    - атомарная запись через .tmp + rename (общий приём для dedup и archive)
    - Zod safeParse + retry x1 на schema-mismatch
    - Intl.DateTimeFormat en-CA для MSK YYYY-MM-DD без dayjs-зависимости
key-files:
  created:
    - src/schema.ts (31 LOC) — Zod DigestJsonSchema + CATEGORIES/MENTIONS литералы
    - src/dedup.ts (140 LOC) — normalize + sha256 + load/save/dedup/commit hash-cache
    - src/archive.ts (68 LOC) — writeRaw + writeOutput атомарно по MSK-дате
    - src/alert.ts (70 LOC) — sendAlert через BOT_TOKEN_ALERTS
    - docs/RUNBOOK.md (126 LOC) — 5 сценариев сбоя оператора
    - docs/CHANNELS.md (117 LOC) — lifecycle канала
    - data/.gitkeep (директория archives сохраняется в git, содержимое — нет)
  modified:
    - src/types.ts (Category, Mention, переписан DigestItem/DigestJson, +postsDropped в RunSummary)
    - src/summarize.ts (5-категорийный prompt + Zod safeParse + retry x1 + категорийный renderHtml + inline-маркеры)
    - src/pipeline.ts (writeRaw → dedupAgainstCache → summarize → sendToChannel → writeOutput → commitHashCache)
    - src/run.ts (импорт sendAlert + await вызов в catch())
    - src/logger.ts (dropped=${s.postsDropped} в posts-строке)
    - .env.example (BOT_TOKEN_ALERTS + ALERTS_CHAT_ID секция)
    - .gitignore (data/* кроме data/.gitkeep)
    - package.json (zod ^3.23.0 в dependencies)
decisions:
  - "Phase 1 = один mega-plan на 16 задач (D-06): структура+рендер+дедуп+архив+алерт+доки в одном wave"
  - "verifyExtractiveness возвращает {digest, droppedCount} вместо void/exception — droppedCount учитывается в RunSummary.postsDropped"
  - "summarize() возвращает {html, postsDropped} — pipeline пишет dropped в RunSummary"
  - "hash-cache коммитится ТОЛЬКО после успешной sendToChannel — D-09: failed runs не съедают будущие посты"
  - "writeRaw — ДО dedup и LLM (инвариант: сырые данные за день уцелеют даже если pipeline упадёт)"
  - "writeOutput — ПОСЛЕ sendToChannel, байт-в-байт identical → audit-trail для acceptance-пакета"
  - "MSK-дата через Intl.DateTimeFormat en-CA — без новой зависимости dayjs"
  - "alert-bot отдельным BOT_TOKEN_ALERTS (D-14) — изолирует тех-ошибки от канала Заказчика"
metrics:
  duration_minutes: ~22
  tasks_completed: 16
  files_created: 7
  files_modified: 8
  loc_added: 814
  loc_deleted: 164
  completed_date: 2026-04-26
---

# Phase 01-code Plan 01 — Structured digest + persistence + alert + docs Summary

**One-liner:** v3.0 mega-plan закрыл 14 REQ за 16 task'ов: 5-категорийный JSON-дайджест с inline-маркерами компаний и deep-link, SHA-256 кросс-прогонная дедупа с rolling 14d cache, ФС-архивы raw/output с атомарной записью, alert-bot в личку владельца на любую ошибку pipeline, оперативная документация RUNBOOK+CHANNELS — Phase 1 готов к деплою на VPS и старту Phase 2 7-day smoke.

## Что сделано (по task'ам)

### Wave 1 — STRUCT-01..03 + RENDER-01..03 (T1–T7)

- **T1 (chore)** — `package.json`: добавлен `zod ^3.23.0` (5-я runtime-dep, alphabetical порядок). `npm install` обновил lock-файл и положил пакет в node_modules. Commit `baed0f4`.
- **T2 (feat)** — `src/types.ts`: переписан `DigestJson` под 5 фиксированных категорий (`bunker/oil/kerosene/petrochem/bitumen`) + блок `mentions[]` (orphans), добавлены литералы `Category | null` и `Mention`, `RunSummary.postsDropped: number` (STRUCT-03). Старый `DigestSection` удалён. Commit `fb55094`.
- **T3 (feat)** — `src/schema.ts` (новый): Zod `DigestJsonSchema` + экспортируемые `CATEGORIES`/`MENTIONS` литералы (D-16: schema живёт отдельно от prompt). Commit `320a2eb`.
- **T4 (feat)** — `src/summarize.ts`: переписан `SYSTEM_PROMPT` под 5-категорийную структуру v3.0 + правило orphan-mention (D-04) + правило drop постов вне 5 категорий (STRUCT-03). Старый ручной `validate()` удалён, заменяется Zod в T5. Commit `5f93953`.
- **T5 (feat)** — `src/summarize.ts`: `summarize(posts)` теперь делает `DigestJsonSchema.safeParse` → retry x1 при schema-mismatch → `throw "schema mismatch after retry"` при повторном fail (поднимется до tick() для ALERT-02). `verifyExtractiveness` адаптирован под 5 категорий + mentions, возвращает `{digest, droppedCount}` (Core Value сохранён: `post.text.includes(keyQuote.trim())`). Сигнатура `summarize` теперь `Promise<{html, postsDropped}>`. Commit `e1cfae7`.
- **T6 (feat)** — `src/summarize.ts`: переписан `renderHtml` под `SECTION_HEADERS` массив с фиксированным порядком D-03 (🚢 Бункер → 🛢 Масла → ✈️ Керосин → ⚗️ Нефтехимия → 🛣 Битум → 🏢 Упоминания компаний). Пустые секции помечены `<i>— нет упоминаний за сутки</i>`. Inline-маркеры `[РОСНЕФТЬ]/[ЛУКОЙЛ]/[ГАЗПРОМ]` для items с непустым `mentions[]`. `escapeHtml` на summary/keyQuote/channel (T-01-05 mitigation). Commit `b66bc42`.
- **T7 (feat)** — `src/logger.ts`: `dropped=${s.postsDropped}` добавлено в posts-строку summary-блока. Commit `6693196`.

### Wave 2 — DEDUP-01..02 + ARCH-01..02 (T8–T11)

- **T8 (feat)** — `src/dedup.ts` (новый): `normalize()` (lowercase, без `\p{Extended_Pictographic}`, без `\p{P}`, ≤200 chars), `hashText()` (SHA-256 hex), `loadHashCache()`/`saveHashCache()` через атомарный `.tmp + rename`, rolling 14 дней с env override (`HASH_CACHE_TTL_DAYS`), `dedupAgainstCache(posts, runId)` → `{fresh, hits, freshHashes}`, `commitHashCache(freshHashes, runId)`. Commit `4817d8d`.
- **T9 (feat)** — `src/archive.ts` (новый): `writeRaw(posts, runId)` (до dedup/LLM, ARCH-01) + `writeOutput(html, runId)` (после доставки, ARCH-02), MSK-дата через `Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Moscow"})` без dayjs, атомарная запись через `.tmp + rename`, директории создаются автоматически. Commit `0b90979`.
- **T10 (feat)** — `src/pipeline.ts`: D-09 8-step order: `fetch` → `writeRaw` → `dedupAgainstCache` → `summarize` → `sendToChannel` → `writeOutput` → `commitHashCache`. `postsDeduped += hashHits`, `postsDropped` прокинут из summarize в RunSummary. Empty-fresh branch не вызывает LLM. Commit `5b5cf7e`.
- **T11 (chore)** — `.gitignore` + `data/.gitkeep`: `data/*` исключён из git кроме `.gitkeep`; runtime-архивы и hash-cache не попадают в коммиты. Commit `1d97fb4`.

### Wave 3 — ALERT-01..02 + DOC-04..05 (T12–T15)

- **T12 (feat)** — `src/alert.ts` (новый) + `.env.example`: `sendAlert(payload)` через отдельный `BOT_TOKEN_ALERTS` Bot API (НЕ загрязняет канал Заказчика), plain-text формат (без parse_mode HTML — нет инъекции из stack/message), payload содержит только `{stage, message, runId, stack}` — `process.env` не сериализуется (T-01-02 mitigation), stack обрезается до 1500 chars, итоговый text — до 4000 (Telegram 4096 limit), на alert-fail → `log.error` без throw (D-15). `.env.example` пополнен секцией Alert-bot с пояснением как получить token+chatId. Commit `77e63fe`.
- **T13 (feat)** — `src/run.ts`: импорт `sendAlert`, в `tick()` catch — `await sendAlert({stage:"tick", message, runId: alertId, stack})` (D-13: await не fire-and-forget); внутренний try/catch вокруг sendAlert защищает от alert-on-alert-fail (D-15). Commit `6c8dc35`.
- **T14 (docs)** — `docs/RUNBOOK.md` (126 LOC): 5 сценариев сбоя — DeepSeek 5xx, TG FloodWait, парсер не видит канал, диск переполнен, network down. Каждый — Симптом → Диагностика → Действие → Восстановление (D-18) с конкретными командами `pm2 logs/restart/flush/list`, `df`, `du`, `find`. Commit `c8e5f84`.
- **T15 (docs)** — `docs/CHANNELS.md` (117 LOC): структура `channels.yaml`, 5 разделов lifecycle (добавление/проверка подписки/удаление/карантин/замена PLACEHOLDER_NN). Конкретные команды (vim, ssh, pm2 restart). Commit `4d39b5b`.

### Wave 4 — Final verify (T16)

- **T16 (verify)** — Финальная верификация без code-changes:
  - `npx tsc --noEmit` → exit 0 (Success Criteria #6) ✓
  - Smoke `runPipeline()` end-to-end **не выполнен в worktree** — отсутствует `.env` с `TG_SESSION`/`TG_BOT_TOKEN`/`DEEPSEEK_API_KEY`. Это известное и ожидаемое ограничение dev-машины; полный smoke выполняется на VPS перед стартом Phase 2 (7-day acceptance).
  - **Юнит-уровневые smoke выполнены** для не-сетевых модулей: `dedup.normalize/hashText/save/load` ходит туда-сюда корректно; `archive.writeRaw([], runId)` создаёт `./data/raw/YYYY-MM-DD.json` (тестовые артефакты удалены).

## Закрытые требования (14 REQ)

| REQ-ID | Закрыт где | Подтверждение |
| ------ | ---------- | ------------- |
| STRUCT-01 | T2, T3, T4 | `src/schema.ts:CATEGORIES = ["bunker","oil","kerosene","petrochem","bitumen"]`; `MENTIONS = ["rosneft","lukoil","gazprom"]`; SYSTEM_PROMPT инструктирует LLM по 5 ключам |
| STRUCT-02 | T3, T5 | `DigestJsonSchema.safeParse` × 2 в `summarize.ts` (initial + retry); throw `"DeepSeek schema mismatch after retry"` на повторном fail |
| STRUCT-03 | T2, T5, T7, T10 | `RunSummary.postsDropped: number`; `verifyExtractiveness → droppedCount`; `summarize() → {html, postsDropped}`; `pipeline.ts: postsDropped = dropped`; `logger.ts: dropped=${s.postsDropped}` |
| RENDER-01 | T6 | `SECTION_HEADERS[6]` фиксированный порядок D-03; `<i>— нет упоминаний за сутки</i>` для пустых секций; emoji + `<b>` в каждом заголовке |
| RENDER-02 | T6 | `new URL(item.url).toString()` validation; deep-link через `<a href="${safeUrl}">@${escapeHtml(item.channel)}</a>` |
| RENDER-03 | unchanged (carried v1.0) | `src/deliver.ts:chunkHtml` переиспользуется без изменений |
| DEDUP-01 | T8 | `createHash("sha256")` в `dedup.ts`; `normalize()` через Unicode property regex (`\p{Extended_Pictographic}`, `\p{P}`) и `slice(0,200)` |
| DEDUP-02 | T8, T10 | `TTL_DAYS = 14` (env override); `renameSync(tmp, path)` атомарная запись; `commitHashCache` вызывается ПОСЛЕ `sendToChannel` |
| ARCH-01 | T9, T10 | `writeRaw(allPosts, runId)` сразу после fetch, до dedup; `data/raw/YYYY-MM-DD.json` через атомарный `.tmp + rename` |
| ARCH-02 | T9, T10 | `writeOutput(html, runId)` сразу после `sendToChannel(html)` — один и тот же `html` объект, байт-в-байт идентично отправленному |
| ALERT-01 | T12 | `BOT_TOKEN_ALERTS` + `ALERTS_CHAT_ID` в `src/alert.ts` + `.env.example`; payload `{stage, message, runId, stack}` без сериализации `process.env` (T-01-02) |
| ALERT-02 | T13 | `await sendAlert(...)` в `tick()` catch с inner try/catch для D-15 (alert-on-alert-fail → log.error) |
| DOC-04 | T14 | `docs/RUNBOOK.md` 126 LOC, 5 H2-секций, 21 диагностический блок (≥80 LOC, ≥5 H2, ≥20 секций) |
| DOC-05 | T15 | `docs/CHANNELS.md` 117 LOC, 6 H2-секций (≥60 LOC, ≥5 H2) |

## Threat-mitigations верифицированы

| Threat ID | Mitigation | Статус |
| --------- | ---------- | ------ |
| T-01-01 | `.env` в `.gitignore` (carried) | `grep -E '^\.env$' .gitignore` exits 0 |
| T-01-02 | alert.ts не сериализует `process.env` | `grep -cE "JSON\.stringify\(process\.env\)" src/alert.ts` → 0; `grep -cE "process\.env\." src/alert.ts` → 2 (только чтения BOT_TOKEN_ALERTS/ALERTS_CHAT_ID) |
| T-01-03 | data/* в .gitignore (T11) | `git check-ignore data/raw/test.json` exits 0; `git check-ignore data/.gitkeep` exits 1 |
| T-01-04 | Zod safeParse + verifyExtractiveness | `safeParse` × 2 в summarize.ts; `post.text.includes(needle)` сохранён |
| T-01-05 | escapeHtml на user-content | `escapeHtml(item.summary)`, `escapeHtml(item.keyQuote)`, `escapeHtml(item.channel)` в renderItem; маркеры [РОСНЕФТЬ]/[ЛУКОЙЛ]/[ГАЗПРОМ] — литералы из MENTION_LABEL, не user input |
| T-01-09 | data/raw\|output paths из MSK-даты | `Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Moscow"})` детерминистично возвращает YYYY-MM-DD без user input |
| T-01-10 | zod pinned ^3.23.0 | `package.json:dependencies.zod = "^3.23.0"` |
| T-01-11 | data/output/*.md = audit-trail | `pipeline.ts` вызывает `writeOutput(html, runId)` после `sendToChannel(html)` — тот же `html` объект |

## Отклонения от плана

**1. [Rule 3 — Blocking] npm cache permission error на T1**
- **Найдено в:** Task 1 (`npm install` после правки package.json)
- **Симптом:** `npm error code EACCES ... /Users/vladilen/.npm/_cacache/index-v5/...` (root-owned cache files из предыдущего npm-запуска под sudo)
- **Фикс:** Использован альтернативный cache `npm install --cache /tmp/npm-cache-tg-parser` — установка прошла без эскалации привилегий и без модификации глобального npm-кэша
- **Файлы:** `package-lock.json` обновлён корректно, `node_modules/zod` установлен
- **Commit:** `baed0f4` (без отдельного фикс-коммита — отклонение в окружении, не в коде)

**2. [Rule 3 — Blocking] PLAN.md не было в worktree**
- **Найдено в:** на старте, перед T1
- **Симптом:** `cat .planning/phases/01-code/01-01-PLAN.md` выдал «file not found», тогда как git status показывал его как `??` untracked в основном репозитории
- **Фикс:** Скопировал `01-01-PLAN.md` из основного репозитория `/Users/vladilen/Documents/vscode/tg-parser-demo/.planning/phases/01-code/01-01-PLAN.md` в worktree. Это корректное поведение — оркестратор Phase планирования оставил артефакт в основном дереве, worktree-агент должен был получить его как readonly-артефакт.
- **Файлы:** `.planning/phases/01-code/01-01-PLAN.md` (114KB; всё ещё untracked в worktree, не коммитим — это артефакт планирования, владеется оркестратором)
- **Commit:** не требуется

## Известные ограничения (не deviation)

**End-to-end smoke на dev-машине НЕ выполнен** — это явно согласовано планом (T16 §«Если smoke невозможен ... фиксируем это явно в SUMMARY»). Причины:
- В worktree отсутствует `.env` с `TG_SESSION`, `TG_BOT_TOKEN`, `TG_CHANNEL_ID`, `DEEPSEEK_API_KEY`, `BOT_TOKEN_ALERTS`, `ALERTS_CHAT_ID` (секреты не должны попадать в worktree).
- Полный end-to-end smoke выполняется на VPS перед стартом Phase 2 (7-day acceptance). Это закрывает Success Criteria #1, #2, #3, #4, #5 в реальной среде.
- На dev-машине пройдены: `npx tsc --noEmit` (#6 ✓), unit-уровневый smoke `dedup.normalize/hashText/save/load` (создаёт корректный hash-cache.json с rolling 14d) и `archive.writeRaw([], runId)` (создаёт `./data/raw/YYYY-MM-DD.json` атомарно). Оба cleanup'нуты.

## Self-Check: PASSED

- [x] `src/schema.ts` exists (FOUND)
- [x] `src/dedup.ts` exists (FOUND)
- [x] `src/archive.ts` exists (FOUND)
- [x] `src/alert.ts` exists (FOUND)
- [x] `docs/RUNBOOK.md` exists (FOUND, 126 LOC)
- [x] `docs/CHANNELS.md` exists (FOUND, 117 LOC)
- [x] `data/.gitkeep` exists (FOUND)
- [x] Все 15 task-commit'ов в git log: baed0f4, fb55094, 320a2eb, 5f93953, e1cfae7, b66bc42, 6693196, 4817d8d, 0b90979, 5b5cf7e, 1d97fb4, 77e63fe, 6c8dc35, c8e5f84, 4d39b5b (T16 — verify-only без code-change)
- [x] `npx tsc --noEmit` exit 0
- [x] `package.json:dependencies.zod = "^3.23.0"`
- [x] `pipeline.ts` order: writeRaw(107) < dedupAgainstCache(112) < summarize(119) < sendToChannel(123) < writeOutput(129) < commitHashCache(132)
- [x] all 14 REQ-ID имеют грановое подтверждение (см. таблицу выше)
