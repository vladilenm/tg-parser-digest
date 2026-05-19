---
phase: quick
plan: 260519-p3g
subsystem: bot/upload/chart
tags: [bot, telegram, sendPhoto, multipart, quickchart, hotfix]
dependency_graph:
  requires: [quick-260519-ojk]
  provides: [chart-delivery-multipart]
  affects: [src/bot.ts, src/upload/chart.ts]
tech_stack:
  added: []
  patterns: [FormData/Blob multipart upload, arrayBuffer response handling]
key_files:
  modified:
    - src/upload/chart.ts
    - src/bot.ts
    - src/__tests__/upload-chart.test.ts
    - src/__tests__/bot-summarize.test.ts
  created: []
decisions:
  - "Endpoint switch /chart/create → /chart: возвращает PNG bytes напрямую вместо JSON c URL"
  - "FormData + Blob + direct fetch (не tgFetch) — JSON.stringify в tgFetch несовместим c multipart"
  - "Default mock generateChartPng = null в bot-summarize.test.ts — backward compat для 8 существующих тестов /summarize"
  - "Copy bytes в фрешный ArrayBuffer для Blob() — TS5 lib.dom Uint8Array параметризован ArrayBufferLike (включая SharedArrayBuffer), BlobPart требует ArrayBuffer"
metrics:
  duration: ~12min
  completed_at: 2026-05-19
  tests_total: 286
  tests_passing: 286
---

# Phase quick Plan 260519-p3g: Fix sendPhoto multipart upload Summary

Перевод доставки chart top-10 НПЗ в /summarize с sendPhoto-by-URL на multipart PNG bytes upload — TG возвращал 400 на quickchart.io short URL.

## Was → Now

**Было:**
- `chart.ts` POST → `quickchart.io/chart/create` → JSON `{ success, url }` → возвращает короткий URL.
- `bot.ts` `sendPhoto(token, chatId, photoUrl, caption)` → `tgFetch` → JSON-body `{ photo: <URL>, ... }` → TG пытался скачать с quickchart.io.
- В прод-логах: `[bot] sendPhoto failed: 400` — TG отказывался работать с quickchart.io URL (либо content-type/redirect, либо infra-зависимость). Юзер видел только narrative, без чарта.

**Стало:**
- `chart.ts` POST → `quickchart.io/chart` (без `/create`) → PNG bytes напрямую (`content-type: image/png`) → `res.arrayBuffer()` → `Uint8Array`.
- `generateChartUrl` → `generateChartPng`. Возвращает `Uint8Array | null`. Null-семантика сохранена: <3 НПЗ или ошибка quickchart.
- `bot.ts` `sendPhoto` (URL-based) удалён → `sendPhotoMultipart(token, chatId, png, caption)`:
  - `FormData`: `chat_id` / `caption` / `photo` (Blob image/png) / `reply_markup`.
  - Прямой `fetch(${TG_API}/bot${token}/sendPhoto, { method:'POST', body: form })` — fetch сам выставит `multipart/form-data; boundary=...`. Если задать content-type явно — boundary потеряется и TG ответит 400.

## Pitfalls hit & resolved

1. **TS5 Blob([Uint8Array]) типы** — `Uint8Array` параметризован `ArrayBufferLike` (включая `SharedArrayBuffer`), `BlobPart` требует `ArrayBuffer`. Решено: копия bytes в фрешный `new Uint8Array(new ArrayBuffer(n))` перед передачей в `Blob()`. Без `as any`.

2. **tgFetch несовместим с multipart** — у него JSON.stringify + `content-type: application/json`. Прямой fetch без headers — единственный путь (fetch сам ставит multipart/form-data boundary).

3. **Default mock для backward compat** — `generateChartPng` mock дефолтит на `null`, чтобы 8 существующих /summarize-тестов (которые не про chart) не сломались добавлением sendPhoto-вызова в poll-handler.

## Verification

```bash
npm test
# Test Files  16 passed (16)
# Tests       286 passed (286)
# Duration    493ms
```

```bash
npx tsc --noEmit
# (clean — 0 errors)
```

## Manual smoke

После redeploy:
1. `/summarize` в личке боту с парой prices+fca в текущей неделе.
2. Ожидаемо: narrative-сообщения (Markdown) + PNG-чарт top-10 НПЗ.
3. Проверить логи: `[chart] ok bytes=<N>`, отсутствие `[bot] sendPhoto failed: 400`.

## Files Modified

| File | Description | Lines Changed |
|------|-------------|---------------|
| `src/upload/chart.ts` | `generateChartUrl` → `generateChartPng`, `fetchQuickChartUrl` → `fetchQuickChartPng`, endpoint `/chart`, arrayBuffer body | +27 / −24 |
| `src/bot.ts` | Removed dead `sendPhoto` URL helper, added `sendPhotoMultipart` (FormData+Blob+direct fetch), updated import, updated call-site | +33 / −16 |
| `src/__tests__/upload-chart.test.ts` | All mocks arrayBuffer-based, assertions `Uint8Array` instead of string url | +51 / −36 |
| `src/__tests__/bot-summarize.test.ts` | Default `generateChartPng` mock = null, new chart-block tests with FormData/Blob assertions, removed JSON-body asserts for sendPhoto | +49 / −37 |

## Deviations from Plan

None — plan executed exactly as written.

Single extra TS-fix surfaced during type-check (Uint8Array → ArrayBuffer copy for Blob()) — documented in "Pitfalls hit & resolved" / Decisions. Not a deviation, just a TS5 strict-mode edge.

## Commit

- `e6f3443` — fix(quick-260519-p3g): switch chart delivery to multipart PNG upload

## Self-Check: PASSED

- Files exist:
  - FOUND: src/upload/chart.ts (modified)
  - FOUND: src/bot.ts (modified)
  - FOUND: src/__tests__/upload-chart.test.ts (modified)
  - FOUND: src/__tests__/bot-summarize.test.ts (modified)
- Commits:
  - FOUND: e6f3443
- Tests: 286/286 passing
- Type-check: clean
