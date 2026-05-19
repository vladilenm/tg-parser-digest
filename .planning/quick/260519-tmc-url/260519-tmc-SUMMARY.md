---
phase: quick-260519-tmc
plan: 01
subsystem: web-scraper-digest
tags: [web-scraper, html-render, digest, ux-cleanup]
requires: []
provides:
  - buildFailedSitesBlock_url_only
affects:
  - src/web-scraper.ts::buildFailedSitesBlock
  - src/__tests__/web-scraper.test.ts::buildFailedSitesBlock_suite
tech_stack:
  added: []
  patterns:
    - URL-only-render
    - reason-kept-in-type-for-caller-compat
key_files:
  created: []
  modified:
    - src/web-scraper.ts
    - src/__tests__/web-scraper.test.ts
decisions:
  - "Reason остаётся в типе Array<{ url; reason }>, чтобы не трогать caller (runWebPipeline.failedSites.push), который собирает reason для логов."
  - "Полное удаление теста D (reason length cap) вместо переделки — REASON_MAX_CHARS убран, обрезка причины больше не существует."
  - "Тест C: оставлен fixture с reason: <script>...</script> + добавлены негативные assertions (не утёк ни сырым, ни escaped) — страховка от регрессии."
metrics:
  duration: "1m 25s"
  completed: 2026-05-19
  commits: 1
  tasks: 1
  files_modified: 2
  tests_total: 2600
  tests_passing: 2600
---

# Quick Task 260519-tmc: URL-only Failed Sites Block Summary

Убрать рендер причины ошибки из блока «⚠️ Не удалось распарсить» в web-дайджесте — оставить только URL, чтобы убрать визуальный шум (UND_ERR_CONNECT_TIMEOUT, fetch failed cause-цепочки). Reason всё ещё попадает в `failedSites` для логов/дебага, просто не отображается в Telegram-сообщении.

## What Changed

**`src/web-scraper.ts` — `buildFailedSitesBlock`:**

- Удалена константа `REASON_MAX_CHARS = 120`.
- Рендер `.map` упрощён до однострочника: `(f) => \`• <code>${escapeHtml(f.url)}</code>\``.
- Удалены: локальная переменная `reason`, тернарник с truncation, `escapeHtml(reason)`, ` — ${...}` суффикс.
- Сигнатура функции (`Array<{ url: string; reason: string }>`) сохранена — caller (`runWebPipeline` в ~line 445) продолжает передавать `reason` для логов.
- Header-комментарий обновлён: ссылка на quick-260519-tmc + пояснение «reason остаётся в типе для совместимости».

**`src/__tests__/web-scraper.test.ts` — describe «buildFailedSitesBlock (quick-260519-k6c)»:**

- **Test A** (non-empty): обновлён под URL-only формат.
  - Удалены ` — HTTP 500` / ` — fetch failed` из позитивных `toContain`.
  - Добавлены негативные assertions: `not.toContain("— HTTP 500")` и `not.toContain("— fetch failed")` — гарантия, что reason не утекает.
- **Test B** (empty input): без изменений, `buildFailedSitesBlock([]) === ""`.
- **Test C** (HTML escape): переименован «url экранируется, reason не рендерится».
  - Fixture сохранён (reason: `<script>alert(1)</script>`) — эмулирует продакшен (reason приходит upstream).
  - Удалён `expect(result).toContain("&lt;script&gt;")` (escaped reason больше не появляется в выводе).
  - Оставлен `not.toContain("<script>")` (сырой не утёк) + добавлен `not.toContain("&lt;script&gt;")` (escaped тоже не утёк).
- **Test D** (reason length cap): удалён полностью — `REASON_MAX_CHARS` больше нет.

## Verification

- `npm test` — **2600/2600 passed (137 test files)**.
- `npx tsc --noEmit` — clean (нет dangling references на `REASON_MAX_CHARS`).
- `grep -rn "REASON_MAX_CHARS" src/` — пусто.
- RED был подтверждён: до правки `web-scraper.ts` тесты A и C падали с правильными assertion-сообщениями (видели старый формат `— HTTP 500` / `&lt;script&gt;`).

## Commits

| Hash    | Type | Message                                                                |
| ------- | ---- | ---------------------------------------------------------------------- |
| 43d04fc | feat | render only URL in failed sites block, drop reason                     |

## Deviations from Plan

None — plan executed exactly as written. RED/GREEN были выполнены последовательно в рамках одного task (TDD, оба файла в одном feat-коммите по аналогии с прецедентом 5f67c10 в истории проекта).

## Key Decisions

1. **Тип параметра `Array<{ url; reason }>` сохранён** — caller (`runWebPipeline.failedSites.push`) не трогается, reason всё ещё нужен для логов в другом месте стека. Убрали только рендер.
2. **Test D удалён, не переделан** — `REASON_MAX_CHARS` концепт больше не существует, переделывать тест в no-op некорректно.
3. **Test C: fixture с reason оставлен** — эмулирует продакшен (reason приходит upstream, но не используется), и пара негативных assertions защищает от регрессии «случайно вернули reason обратно».

## Out of Scope (не трогали)

- `runWebPipeline` (`src/web-scraper.ts:~445`) — `failedSites.push({ url, reason })` остаётся как есть.
- `formatErrCause` и логика populate `failedSites` выше по стеку.
- `sendHtml` / `composeWebDigest` / `buildWebHeader` / `buildPlaceholderHtml`.
- Markdown upload-pipeline (`handleDocument` в `bot.ts`).
- `console.log` / `logger.warn`, которые печатают reason в `data/run-*.log` — продолжают работать.

## Self-Check: PASSED

- src/web-scraper.ts: FOUND (modified, REASON_MAX_CHARS removed verified via grep)
- src/__tests__/web-scraper.test.ts: FOUND (modified, Test D removed, A/C updated)
- Commit 43d04fc: FOUND in git log
- 2600/2600 tests passing
- tsc --noEmit clean
