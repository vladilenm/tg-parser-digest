---
phase: quick-260519-swc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/bot.ts
  - src/__tests__/bot-summarize.test.ts
autonomous: true
requirements:
  - QUICK-260519-SWC
must_haves:
  truths:
    - "После /summarize бот шлёт только narrative chunks (sendMessage parse_mode=Markdown), никаких sendPhoto/sendDocument вызовов из handleSummarizeCommand"
    - "Импорт generateChartPng из src/upload/chart.js удалён из src/bot.ts"
    - "Функции sendPhotoMultipart и sendDocumentMultipart полностью удалены из src/bot.ts (мёртвый код вне chart-блока)"
    - "src/upload/chart.ts и src/__tests__/upload-chart.test.ts не модифицированы"
    - "vitest зелёный: npx vitest run src/__tests__/bot-handlers.test.ts src/__tests__/bot-summarize.test.ts"
    - "tsc --noEmit зелёный (нет ошибок типов после удаления)"
  artifacts:
    - path: "src/bot.ts"
      provides: "handleSummarizeCommand без chart-блока, без sendPhoto/sendDocument helpers, без импорта generateChartPng"
      contains: "for (const part of parts)"
    - path: "src/__tests__/bot-summarize.test.ts"
      provides: "тесты на narrative-only flow (allowlist, no files, only one of pair, happy path, DeepSeek failure, suffix @botname); chart-related describe удалён"
      contains: "describe(\"/summarize"
  key_links:
    - from: "src/bot.ts handleSummarizeCommand"
      to: "buildLlmNarrative + sendMarkdown loop"
      via: "for (const part of parts) await sendMarkdown(...)"
      pattern: "for \\(const part of parts\\)"
---

<objective>
Удалить chart-блок из `/summarize` handler и весь мёртвый код, связанный исключительно с ним. Narrative-only flow: после `buildLlmNarrative` + `sendMarkdown` loop handler сразу завершается. Чарт всё равно не работает (quickchart 400 → error-PNG → PHOTO_INVALID_DIMENSIONS → fallback не помогает). Пользователь сказал «удаляй пока всё с чартом, позже разберёмся».

Purpose: Убрать сломанный путь доставки, оставить рабочий narrative. `src/upload/chart.ts` остаётся on the shelf — вернёмся позже.

Output:
- `src/bot.ts` без импорта `generateChartPng`, без функций `sendPhotoMultipart` / `sendDocumentMultipart`, без chart-блока (lines 585-631) в `handleSummarizeCommand`.
- `src/__tests__/bot-summarize.test.ts` без describe `/summarize — chart (quick-260519-p3g multipart)` и без импортов / моков, обслуживающих только этот блок.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

# Источник правды о текущей структуре файлов:
@src/bot.ts
@src/__tests__/bot-summarize.test.ts

# НЕ модифицируем (на полке):
# - src/upload/chart.ts
# - src/__tests__/upload-chart.test.ts

<interfaces>
<!-- Контекст вызывающего кода в bot.ts: outer try/catch handleSummarizeCommand
     должен сохраниться без изменений. Удаляется ТОЛЬКО внутренний chart try/catch. -->

Структура handleSummarizeCommand (упрощённая, lines 570-641 в src/bot.ts):

```typescript
// Сценарий 3: пара собрана → analyze + LLM narrative.
try {
  await sendPlain(token, chatId, "🤖 Готовлю LLM-сводку…");
  const dict = loadRefineries();
  const pricesRows = await reparseFromDisk(week, "birzha_prices", dict);
  const fcaRows = await reparseFromDisk(week, "fca", dict);
  const volumeRows = status.hasVolumes
    ? await reparseFromDisk(week, "birzha_volumes", dict)
    : [];
  const result = analyze(pricesRows, fcaRows, volumeRows, dict);
  const parts = await buildLlmNarrative(result);
  for (const part of parts) {
    await sendMarkdown(token, chatId, part);
  }

  // <УДАЛИТЬ ВСЁ ЭТО (lines 585-631) — комментарии + try { generateChartPng + sendPhoto + sendDocument fallback } + catch (chartErr)>
} catch (err) {
  const errMsg = (err as Error).message ?? String(err);
  log.error(`[bot] /summarize error: ${errMsg}`);
  await sendPlain(...);
}
```

После удаления handler заканчивается на закрывающей `}` цикла `for (const part of parts)` → пустая строка → `} catch (err) { ... }`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Удалить chart-блок и dead helpers из src/bot.ts</name>
  <files>src/bot.ts</files>
  <action>
Произвести три удаления в `src/bot.ts` (в любом порядке, но финальный файл должен быть валидным TS):

1. **Импорт** (line 22) — удалить строку:
   ```typescript
   import { generateChartPng } from "./upload/chart.js";
   ```
   Соседние импорты (line 21 `buildLlmNarrative`, line 23 `path`) оставить. После удаления line 22 пропадает; нумерация ниже сдвигается.

2. **Функции `sendPhotoMultipart` и `sendDocumentMultipart`** — удалить целиком вместе с JSDoc-комментариями выше них:
   - Блок от начала JSDoc `/**` для `sendPhotoMultipart` (примерно line 258 — найти по тексту `Используется в /summarize (quick-260519-ojk): combo bar+line chart top-10 НПЗ`) до закрывающей `}` функции `sendDocumentMultipart` (line 339).
   - Это весь диапазон между разделителем-комментарием выше (если есть) и следующим разделителем `// ===` (line 341 `Upload pipeline helpers`).
   - Точные якоря (поиск по подстрокам, не полагайся на номера строк после удаления импорта):
     - START: первая строка комментария `/**` непосредственно перед `async function sendPhotoMultipart(`.
     - END: закрывающая `}` функции `async function sendDocumentMultipart(...)` (последний `}` перед строкой-разделителем `// =====...===` секции `Upload pipeline helpers`).
   - Пустую строку-разделитель между удалённым блоком и `// ====` секции оставить ровно одну (для читаемости).

3. **Chart-блок в `handleSummarizeCommand`** — удалить lines 585-631 (полный диапазон от комментария до закрывающего `}` `catch (chartErr)`):
   - START: пустая строка перед комментарием `// quick-260519-ojk + quick-260519-p3g: визуальный чарт top-10 НПЗ` (line 584 или начало комментария на line 585 — удалить вместе с предшествующей пустой строкой если она там для отделения от `for`-loop, либо оставить ровно одну пустую строку между `}` for-loop'а и `} catch (err)`).
   - END: закрывающая `}` `catch (chartErr) { ... }` (line 631).
   - После удаления handler должен выглядеть так (пустая строка между `}` for-loop и `} catch (err)`):
     ```typescript
         for (const part of parts) {
           await sendMarkdown(token, chatId, part);
         }
       } catch (err) {
         const errMsg = (err as Error).message ?? String(err);
         ...
       }
     }
     ```
   - НЕ трогать outer `try { ... } catch (err) { ... }` — он остаётся ровно как был, обрабатывает ошибки narrative-flow.
   - НЕ трогать `await sendPlain(token, chatId, "🤖 Готовлю LLM-сводку…")`, `analyze`, `buildLlmNarrative`, `sendMarkdown` loop, `await sendPlain(...)` в catch.

После всех трёх удалений:
- `grep "generateChartPng" src/bot.ts` → пусто
- `grep "sendPhotoMultipart\\|sendDocumentMultipart" src/bot.ts` → пусто
- `grep "quick-260519-ojk\\|quick-260519-p3g\\|quick-260519-s1z" src/bot.ts` → пусто (комментарии-маркеры удалены вместе с блоком и хелперами)
- `npx tsc --noEmit` → 0 ошибок

Не пытаться «убрать неиспользуемые импорты» в соседних местах — есть только `generateChartPng`, остальное оставить как есть.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo &amp;&amp; npx tsc --noEmit 2>&amp;1 | head -30 &amp;&amp; echo "---grep checks---" &amp;&amp; ! grep -n "generateChartPng\|sendPhotoMultipart\|sendDocumentMultipart" src/bot.ts</automated>
  </verify>
  <done>
- `import { generateChartPng }` отсутствует в src/bot.ts.
- Функции `sendPhotoMultipart`, `sendDocumentMultipart` (с JSDoc) удалены полностью.
- Chart-блок (комментарии + outer chart try/catch) удалён из handleSummarizeCommand.
- Outer narrative try/catch и `for (const part of parts) await sendMarkdown(...)` сохранены.
- `npx tsc --noEmit` проходит без ошибок (предполагая, что bot-summarize.test.ts уже почищен или ещё не вызывает tsc-фейлы — strict-mode на test-файлы обычно не падает; см. Task 2).
  </done>
</task>

<task type="auto">
  <name>Task 2: Удалить chart-related тесты и моки из src/__tests__/bot-summarize.test.ts</name>
  <files>src/__tests__/bot-summarize.test.ts</files>
  <action>
Удалить из `src/__tests__/bot-summarize.test.ts` всё, что обслуживает удалённый chart-блок. ОСТАВИТЬ тесты narrative-only flow (allowlist gating, no files, only one of pair, happy path, DeepSeek failure, suffix @botname).

Точечные удаления:

1. **Import `generateChartPng`** (line 10):
   ```typescript
   import { generateChartPng } from "../upload/chart.js";
   ```
   → удалить.

2. **`vi.mock("../upload/chart.js", ...)`** (lines 35-41 — комментарий `quick-260519-ojk + quick-260519-p3g:` + сам `vi.mock`):
   ```typescript
   // quick-260519-ojk + quick-260519-p3g: Mock generateChartPng — никаких реальных
   // ... (комментарий)
   vi.mock("../upload/chart.js", () => ({
     generateChartPng: vi.fn(),
   }));
   ```
   → удалить весь блок включая комментарий перед ним.

3. **`const mockedGenerateChartPng = vi.mocked(generateChartPng);`** (line 70) → удалить строку.

4. **Helper `multipartCallsTo`** (lines 82-89) — он используется ТОЛЬКО chart-тестами:
   ```typescript
   // Helper: достать FormData из вызовов sendPhoto (quick-260519-p3g multipart upload).
   // body — FormData инстанс, а не JSON-строка.
   function multipartCallsTo(method: string): FormData[] {
     ...
   }
   ```
   → удалить весь блок с комментарием.

5. **В `beforeEach`** (lines 91-122) удалить строки, относящиеся к chart-моку:
   ```typescript
     // quick-260519-ojk + quick-260519-p3g: default null — chart-step пропускается,
     // существующие 8 тестов /summarize не упадут из-за лишнего sendPhoto-вызова.
     // Тесты chart-блока (внизу) явно перезаписывают через mockResolvedValueOnce.
     mockedGenerateChartPng.mockResolvedValue(null);
   ```
   → удалить 3 строки комментария + 1 строку `mockedGenerateChartPng.mockResolvedValue(null);`.
   Остальные части beforeEach (vi.clearAllMocks, vi.stubGlobal fetch, mockedParseWorkbook.mockResolvedValue) оставить.

6. **Весь `describe("/summarize — chart (quick-260519-p3g multipart)", ...)`** (lines 323-553):
   Включая разделительный комментарий выше:
   ```typescript
   // =============================================================================
   // quick-260519-ojk + quick-260519-p3g: chart-блок поверх narrative.
   // p3g: PNG bytes доставляются через multipart upload (FormData), а не URL.
   // =============================================================================
   describe("/summarize — chart (quick-260519-p3g multipart)", () => {
     ...
   });
   ```
   → удалить целиком (комментарий + describe со всеми 5 тестами внутри).

После удалений:
- `grep "generateChartPng\\|multipartCallsTo\\|chart" src/__tests__/bot-summarize.test.ts` → пусто (комментарии тоже).
- Все оставшиеся тесты ссылаются только на sendMessage (через `fetchCallsTo`), не на sendPhoto/sendDocument.
- Файл-уровневые описания (`describe`) остаются: allowlist gating, no files this week, only one of the pair, happy path, DeepSeek failure, suffix @botname.

Запустить vitest: `npx vitest run src/__tests__/bot-handlers.test.ts src/__tests__/bot-summarize.test.ts` — все тесты должны пройти.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo &amp;&amp; ! grep -n "generateChartPng\|multipartCallsTo\|sendPhoto\|sendDocument" src/__tests__/bot-summarize.test.ts &amp;&amp; npx vitest run src/__tests__/bot-handlers.test.ts src/__tests__/bot-summarize.test.ts 2>&amp;1 | tail -30</automated>
  </verify>
  <done>
- Импорт generateChartPng, vi.mock для chart.js, mockedGenerateChartPng, multipartCallsTo helper, beforeEach default-mock на chart, весь chart-describe со всеми 5 тестами — удалены.
- Narrative-only тесты (8 штук в первых 6 describe-блоках) сохранены без изменений.
- `npx vitest run src/__tests__/bot-handlers.test.ts src/__tests__/bot-summarize.test.ts` — зелёный, никаких failed/skipped из-за удаления.
  </done>
</task>

</tasks>

<verification>
После обеих задач:

```bash
# 1. TypeScript valid:
cd /Users/vladilen/Documents/vscode/tg-parser-demo && npx tsc --noEmit

# 2. Vitest зелёный на двух bot test-файлах:
npx vitest run src/__tests__/bot-handlers.test.ts src/__tests__/bot-summarize.test.ts

# 3. Никаких упоминаний удалённого API в bot.ts:
grep -n "generateChartPng\|sendPhotoMultipart\|sendDocumentMultipart" src/bot.ts
# → должно быть пусто (exit 1)

# 4. Chart.ts и его тесты НЕ затронуты:
git diff --name-only -- src/upload/chart.ts src/__tests__/upload-chart.test.ts
# → должно быть пусто

# 5. handleSummarizeCommand сохранил narrative-flow:
grep -n "for (const part of parts)" src/bot.ts
# → должна остаться 1 строка
```
</verification>

<success_criteria>
- `src/bot.ts`: `generateChartPng` import, `sendPhotoMultipart`, `sendDocumentMultipart`, chart-блок (с маркерами quick-260519-ojk/p3g/s1z) удалены полностью.
- `handleSummarizeCommand` корректно завершается после `for (const part of parts) await sendMarkdown(...)`, outer narrative try/catch сохранён.
- `src/__tests__/bot-summarize.test.ts`: chart-describe со всеми его тестами и связанными моками/хелперами удалён; narrative-only тесты остались без изменений и проходят.
- `src/upload/chart.ts` и `src/__tests__/upload-chart.test.ts` нетронуты (git diff пустой по этим путям).
- `npx tsc --noEmit` — 0 ошибок.
- `npx vitest run src/__tests__/bot-handlers.test.ts src/__tests__/bot-summarize.test.ts` — 0 failed.
</success_criteria>

<output>
After completion, create `.planning/quick/260519-swc-remove-chart-block-from-summarize-handle/260519-swc-SUMMARY.md`.
</output>
