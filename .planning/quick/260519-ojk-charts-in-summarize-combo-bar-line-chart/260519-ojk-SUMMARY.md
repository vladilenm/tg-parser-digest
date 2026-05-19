---
quick_id: 260519-ojk
type: summary
status: complete
completed_at: 2026-05-19
commits:
  - 638e3bc: feat(quick-260519-ojk) add chart.ts (combo bar+line config + quickchart client)
  - 279b574: feat(quick-260519-ojk) integrate generateChartUrl + sendPhoto into /summarize
files_created:
  - src/upload/chart.ts
  - src/__tests__/upload-chart.test.ts
files_modified:
  - src/bot.ts
  - src/__tests__/bot-summarize.test.ts
tests:
  baseline: 264
  final: 286
  delta: +22
tsc_clean: true
---

# Quick 260519-ojk: Charts в /summarize (combo bar+line через quickchart.io + sendPhoto) — Summary

## One-liner

Добавлен PNG-чарт top-10 НПЗ (combo bar |Δ цены| + line объёмы) через quickchart.io,
прикладывается к `/summarize` сразу после LLM-narrative; на любую chart-ошибку
handler НЕ ломается — narrative уже доставлен.

## Что сделано

### Task 1 — `src/upload/chart.ts` (commit 638e3bc)

Новый модуль с тремя экспортами + 18 unit-тестов:

1. **`buildChartConfig(result)`** — Chart.js v3 mixed config:
   - `bar` dataset: top-10 (или меньше, если уникальных НПЗ <10) по `|deltaAbs|` desc;
     `backgroundColor` — массив per-bar (emerald `+`, red `−`, gray `0`); `yAxisID: 'y'` (левая ось)
   - `line` dataset (только если есть `result.volumes` и хотя бы одна НПЗ из top
     имеет positive `totalT`): объёмы для тех же canonical; `yAxisID: 'y1'`,
     `grid: { drawOnChartArea: false }` (правая ось)
   - labels truncate до 14 chars с `…`, период в title: `DD.MM.YYYY – DD.MM.YYYY`
   - dedup canonical: если один НПЗ в `result.deltas` дважды (birzha + fca),
     берётся тот, у которого `|deltaAbs|` больше

2. **`fetchQuickChartUrl(config, fetchImpl, timeoutMs)`** — POST на
   `https://quickchart.io/chart/create` с `{ chart, backgroundColor: 'white',
   width: 1000, height: 500, format: 'png' }`. `AbortController` timeout 10s
   (`finally clearTimeout`). Throw'ает на HTTP !ok, `success: false`, JSON ошибки.

3. **`generateChartUrl(result, opts?)`** — public entry. Возвращает `Promise<string | null>`:
   - `null` если `unique(canonical) < 3` (`MIN_BARS`)
   - `null` + `log.warn` на любую ошибку quickchart (НЕ throw'ает)
   - `string` URL вида `https://quickchart.io/chart/render/<hash>` на happy path

**Без новых runtime-зависимостей**: только global `fetch` + `AbortController`.

### Task 2 — Интеграция в /summarize (commit 279b574)

`src/bot.ts`:
- Импорт `generateChartUrl` из `./upload/chart.js`
- Новый helper `sendPhoto(token, chatId, photoUrl, caption)` — обёртка над
  `tgFetch<{ok}>(token, "sendPhoto", { chat_id, photo: <url>, caption, reply_markup: MAIN_KEYBOARD })`
- `handleSummarizeCommand`: после цикла отправки narrative-частей — isolated
  `try/catch` блок:
  ```ts
  try {
    const chartUrl = await generateChartUrl(result);
    if (chartUrl) await sendPhoto(token, chatId, chartUrl, "Δ цены и объёмы по НПЗ (top-10)");
  } catch (chartErr) {
    log.warn(`[bot] /summarize chart failed (narrative was delivered): ...`);
  }
  ```
  Изоляция критична: chart-fail не должен вызвать «❌ Не удалось получить LLM-сводку»
  — narrative уже доставлен sendMarkdown'ом выше.

`src/__tests__/bot-summarize.test.ts`:
- `vi.mock("../upload/chart.js", () => ({ generateChartUrl: vi.fn() }))`
- В `beforeEach`: `mockedGenerateChartUrl.mockResolvedValue(null)` → старые 8 тестов
  остаются зелёными (chart-step просто пропускается)
- Новый `describe("/summarize — chart")` с 4 тестами:
  1. URL → `sendPhoto` вызывается с `photo: <url>` и нужным caption
  2. `null` → `sendPhoto` НЕ вызывается, narrative доставлен
  3. `generateChartUrl` throws → handler не падает, narrative доставлен
  4. tgFetch `sendPhoto` возвращает HTTP 400 (TG не смогла скачать URL) →
     handler не падает, narrative доставлен

## Ключевые файлы

- `src/upload/chart.ts:1` — модуль целиком (chart-config builder + quickchart client + entry)
- `src/upload/chart.ts:182` — `generateChartUrl` (public entry, threshold + try/catch + null-on-error)
- `src/bot.ts:21` — импорт `generateChartUrl`
- `src/bot.ts:259` — новый `sendPhoto` helper
- `src/bot.ts:518` — интеграция в `handleSummarizeCommand` (после narrative, isolated try/catch)
- `src/__tests__/upload-chart.test.ts:1` — 18 unit-тестов
- `src/__tests__/bot-summarize.test.ts:34` — mock chart.js
- `src/__tests__/bot-summarize.test.ts:316` — новый describe с 4 chart-тестами

## Verification

- **npm test**: 286 passed (16 files). Baseline 264 → +18 chart unit + +4
  bot-summarize chart = +22 теста.
- **npx tsc --noEmit**: clean (без ошибок).
- **Сценарий бага → фикс**:
  - До: после `/summarize` юзер видит только текстовый narrative.
  - После: narrative + PNG-чарт top-10 НПЗ (bar + опциональная line по объёмам)
    в одном thread'е.

## Manual smoke (для пользователя)

1. `npm start` (или PM2-режим)
2. В Telegram DM боту: загрузить `birzha_prices.xlsx` + `fca.xlsx` (опционально
   `birzha_volumes.xlsx`) с данными ≥3 НПЗ за период
3. Нажать «🧠 Сделать сводку» (или `/summarize`)
4. Ожидание:
   - Progress «🤖 Готовлю LLM-сводку…»
   - Narrative-части (Markdown)
   - **PNG-чарт**: bar (зелёные/красные столбики |Δ| по НПЗ) + line (синий, объёмы
     по правой оси) с подписью «Δ цены и объёмы по НПЗ (top-10)»
5. Если уникальных НПЗ <3 (например, загружены только два рынка с одинаковым
   НПЗ X) — чарт не отправляется (skip silently); narrative приходит как обычно.
6. Если quickchart.io недоступен (offline / firewall) — в логе `[chart]
   generateChartUrl failed: ...`, юзеру только narrative.

## Что НЕ изменено

- `src/upload/types.ts`, `analyzer.ts`, `llm.ts`, `renderer.ts` — pipeline до
  чарта не тронут
- `handleDocument` — структурный отчёт после /upload остаётся текстовым
  (чарт только в /summarize по плану)
- Runtime dependencies: всё через global fetch, новые npm-пакеты НЕ добавлены

## Self-Check: PASSED

- src/upload/chart.ts — FOUND
- src/__tests__/upload-chart.test.ts — FOUND
- src/bot.ts — MODIFIED (verified by `git show 279b574 --stat`)
- src/__tests__/bot-summarize.test.ts — MODIFIED
- commit 638e3bc — FOUND (`git log | grep 638e3bc`)
- commit 279b574 — FOUND (`git log | grep 279b574`)
- npm test: 286 passed (verified)
- npx tsc --noEmit: clean (verified)
