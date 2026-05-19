---
phase: 260519-ojk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/upload/chart.ts
  - src/__tests__/upload-chart.test.ts
  - src/bot.ts
  - src/__tests__/bot-summarize.test.ts
autonomous: true
requirements:
  - D-01-combo-chart-config
  - D-02-quickchart-delivery
  - D-03-volumes-optional
  - D-04-trigger-after-narrative
  - D-05-no-new-deps

must_haves:
  truths:
    - "После /summarize narrative chunks доставляются пользователю как и раньше (поведение не сломано)."
    - "После последнего narrative chunk бот ОТПРАВЛЯЕТ в тот же DM Photo с комбо-чартом через TG sendPhoto, photo=quickchart short URL."
    - "В чарте: top-10 НПЗ по abs(birzhaDelta + fcaDelta) desc; grouped bars для Δ биржа и Δ FCA; line для объёма биржи (если volumes есть)."
    - "Цвета баров per-bar по знаку: биржа ПОЗИТИВ #2ecc71 / НЕГАТИВ #e74c3c; FCA ПОЗИТИВ #f1c40f / НЕГАТИВ #e67e22."
    - "Если volumes отсутствуют в AnalysisResult — чарт рендерится без правой оси и без line dataset (только bars)."
    - "Если суммарно <3 НПЗ с ненулевыми дельтами — chart skip без сообщения (narrative уже доставлен)."
    - "На fail quickchart (HTTP error, timeout >10s, success=false) — бот шлёт отдельным сообщением «❌ График не удалось построить: <reason>», handler НЕ падает."
    - "Если buildLlmNarrative бросил — chart НЕ отправляется (логика в catch'е handler'а; до chart-блока выполнение не доходит)."
    - "Никаких новых npm-зависимостей: используется только встроенный fetch и AbortController для timeout."
  artifacts:
    - path: "src/upload/chart.ts"
      provides: "buildChartConfig(result) → ChartConfig, postToQuickchart(config, opts?) → Promise<string>, generateChartUrl(result, opts?) → Promise<string | null>"
      exports: ["buildChartConfig", "postToQuickchart", "generateChartUrl"]
    - path: "src/__tests__/upload-chart.test.ts"
      provides: "buildChartConfig structure tests + postToQuickchart mock-fetch tests + generateChartUrl top-10/skip-<3 tests"
    - path: "src/bot.ts"
      provides: "handleSummarizeCommand — после цикла sendMarkdown(part) добавлен try { url = generateChartUrl(result); if (url) sendPhoto } catch { sendPlain('❌ График не удалось построить...') }"
    - path: "src/__tests__/bot-summarize.test.ts"
      provides: "новые describe-блоки: chart sendPhoto после narrative, chart skip при <3 НПЗ, chart fail → error message, chart НЕ зовётся при LLM fail"
  key_links:
    - from: "src/bot.ts handleSummarizeCommand"
      to: "src/upload/chart.ts generateChartUrl"
      via: "import + await call ПОСЛЕ цикла sendMarkdown(part)"
      pattern: "generateChartUrl\\(result"
    - from: "src/bot.ts handleSummarizeCommand"
      to: "Telegram Bot API sendPhoto"
      via: "tgFetch(token, \"sendPhoto\", { chat_id, photo: shortUrl, caption: title })"
      pattern: "sendPhoto"
    - from: "src/upload/chart.ts postToQuickchart"
      to: "quickchart.io /chart/create"
      via: "fetch POST application/json, body { chart, backgroundColor: 'white', width: 1000, height: 500 }, AbortController 10s"
      pattern: "quickchart\\.io/chart/create"
---

<objective>
Добавить генерацию комбо-чарта (mixed bar+line) после доставки LLM narrative в /summarize. Чарт POST'ится в quickchart.io /chart/create, полученный short URL отправляется в DM через TG sendPhoto. На любой fail quickchart — отдельное сообщение об ошибке, handler НЕ падает; narrative уже у пользователя.

Purpose: визуальное дополнение к текстовой сводке — трейдер за 1 взгляд видит, у каких НПЗ движение цены и как оно соотносится с объёмом, без чтения markdown'а.

Output:
- `src/upload/chart.ts` — pure-функция `buildChartConfig(result)` + I/O `postToQuickchart(config)` + composite `generateChartUrl(result)`.
- Тесты на структуру конфига + mock fetch для постинга.
- Интеграция в `handleSummarizeCommand` после narrative loop.
- Тесты на правильное место вызова и graceful-fail.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/upload/types.ts
@src/upload/llm.ts
@src/upload/analyzer.ts
@src/bot.ts
@src/__tests__/upload-llm.test.ts
@src/__tests__/bot-summarize.test.ts

<interfaces>
<!-- Контракты, которые executor должен использовать напрямую. Извлечено из codebase. -->

From src/upload/types.ts:
```typescript
export interface RefineryDelta {
  canonical: string;
  firstDate: Date;
  firstPrice: number;
  lastDate: Date;
  lastPrice: number;
  deltaAbs: number;
  deltaPct: number;
  source: "birzha" | "fca";
}

export interface VolumeTotals {
  totalT: number;
  perRefinery: { canonical: string; totalT: number }[];
}

export interface AnalysisResult {
  periodStart: Date;
  periodEnd: Date;
  weekFolder: string;
  runAt: Date;
  deltas: RefineryDelta[];
  byCompany: CompanyGroup[];
  volumes?: VolumeTotals;
}
```

From src/bot.ts (already imported helpers — НЕ нужно реимпортировать; используем
существующий tgFetch паттерн):
```typescript
// Существует:
async function tgFetch<T>(token: string, method: string, body: unknown): Promise<T>;
async function sendPlain(token: string, chatId: number, text: string): Promise<void>;

// handleSummarizeCommand — единственное место, куда встраиваем доставку чарта.
// После цикла `for (const part of parts) await sendMarkdown(...)` — пред concl. блок.
```

From src/upload/llm.ts (для справки — паттерн lazy fetch + retry):
```typescript
// Lazy client creation в buildLlmNarrative — мы повторяем стиль для chart.ts:
//   - функция без побочных эффектов на module init
//   - опции опциональны (тестам передают mock через opts)
//   - log.info на начало, log.error на fail с cause
```

From src/__tests__/bot-summarize.test.ts (паттерн mocks — уже всё есть, расширяем):
```typescript
// Существующие mocks: channels-store, upload/storage (listWeek), upload/llm
// (buildLlmNarrative), upload/parser (parseWorkbook), node:fs (readFileSync).
// vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: ..., text: ... })).
// fetchCallsTo(method) — хелпер для извлечения тел вызовов /method (sendMessage, sendPhoto).
```

From quickchart.io /chart/create (для буквальной реализации в коде):
```json
// POST https://quickchart.io/chart/create
// Body:
{
  "chart": { "type": "bar", "data": { ... }, "options": { ... } },
  "backgroundColor": "white",
  "width": 1000,
  "height": 500
}
// Response (success):
{ "success": true, "url": "https://quickchart.io/chart/render/zf-..." }
// Response (failure):
{ "success": false }  // или HTTP !ok
```
</interfaces>

<color_constants>
<!-- Зашиваются в chart.ts как const. Per-bar окраска — массив той же длины, что labels. -->
BIRZHA_POSITIVE = "#2ecc71"  // зелёный
BIRZHA_NEGATIVE = "#e74c3c"  // красный
FCA_POSITIVE    = "#f1c40f"  // жёлтый
FCA_NEGATIVE    = "#e67e22"  // оранжевый
VOLUME_LINE     = "#7f8c8d"  // серый

LABEL_MAX_LEN = 14            // если canonical длиннее — обрезать и добавить "…"
TOP_N = 10                    // top-10 НПЗ
MIN_REFINERIES = 3            // <3 НПЗ с ненулевыми дельтами → skip без сообщения
QUICKCHART_TIMEOUT_MS = 10_000
QUICKCHART_URL = "https://quickchart.io/chart/create"
CHART_WIDTH = 1000
CHART_HEIGHT = 500
</color_constants>

</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: src/upload/chart.ts + vitest (buildChartConfig + postToQuickchart + generateChartUrl)</name>
  <files>src/upload/chart.ts, src/__tests__/upload-chart.test.ts</files>
  <behavior>
    Pure-function tests for buildChartConfig (no fetch, no I/O):
    - Test 1.1 (top-10 sort & truncation): даём AnalysisResult с 15 НПЗ (mix Δ биржи и Δ FCA на разные canonical, некоторые на одни и те же); buildChartConfig возвращает config с labels.length ≤ 10 и labels отсортированы по abs(sum delta) desc. НПЗ с длинным именем (>14 chars) обрезан до 14 chars + "…".
    - Test 1.2 (per-bar colors by sign): для НПЗ с положительной Δ биржа bar 'Δ биржа' окрашен в #2ecc71; отрицательная — #e74c3c. То же для FCA: #f1c40f / #e67e22. Проверяем datasets[0].backgroundColor — массив той же длины, что labels.
    - Test 1.3 (volumes optional - no volumes): если result.volumes === undefined → datasets имеет ровно 2 элемента (Δ биржа + Δ FCA), options.scales.y1 отсутствует, нет line dataset.
    - Test 1.4 (volumes present): если result.volumes.perRefinery содержит данные для НПЗ из top-10 → 3-й dataset с type='line', borderColor='#7f8c8d', yAxisID='y1'; options.scales.y1 присутствует с position:'right'. Точки массива объёмов совпадают по порядку с labels (топ-10 НПЗ); если для НПЗ в top-10 нет записи в perRefinery — точка = 0.
    - Test 1.5 (title): options.plugins.title.text содержит "Битум: Δ цен и объёмы за " и даты (формат YYYY-MM-DD).
    - Test 1.6 (skip threshold): если AnalysisResult содержит <3 НПЗ с НЕНУЛЕВЫМИ дельтами (Σ |Δ| > 0) → buildChartConfig возвращает null. generateChartUrl, получив этот null, тоже возвращает null (без вызова fetch).
    - Test 1.7 (mixed: birzha + fca на один canonical): для НПЗ X есть и birzha delta, и fca delta; в labels X фигурирует один раз; bar 'Δ биржа' для X имеет значение birzhaDelta, bar 'Δ FCA' — fcaDelta. Сортировка по abs(birzhaDelta + fcaDelta).

    Mock-fetch tests for postToQuickchart + generateChartUrl:
    - Test 2.1 (success path): vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, url: 'https://quickchart.io/chart/render/zf-abc' }) })). Вызываем generateChartUrl(result) → возвращает 'https://quickchart.io/chart/render/zf-abc'. Проверяем что fetch был вызван с URL='https://quickchart.io/chart/create', method='POST', headers.content-type='application/json', body имеет { chart, backgroundColor: 'white', width: 1000, height: 500 }.
    - Test 2.2 (HTTP error): fetch resolved with { ok: false, status: 500, text: async () => 'oops' } → generateChartUrl throws Error с message содержащим "500" или "quickchart". (postToQuickchart throws, generateChartUrl re-throws.)
    - Test 2.3 (success=false in body): fetch resolved with { ok: true, json: async () => ({ success: false }) } → generateChartUrl throws Error с "quickchart" в message.
    - Test 2.4 (timeout via AbortController): vi.useFakeTimers(); fetch implementation hangs (returns a promise that resolves after 20s). Через vi.advanceTimersByTime(10_001) — AbortController срабатывает, fetch reject'ится AbortError, generateChartUrl throws с "timeout" или "abort" в message. (Альтернатива если fake timers не работают с AbortSignal.timeout: явный мок fetch который отвергается с AbortError — проверяем что Error содержит сигнал об отмене.)
    - Test 2.5 (skip <3 refineries): result с 2 ненулевыми Δ → generateChartUrl resolves to null, fetch НЕ вызывается.
  </behavior>
  <action>
1) Создать `src/upload/chart.ts`:

   ```ts
   // src/upload/chart.ts — quickchart.io комбо bar+line чарт для /summarize (quick-260519-ojk).
   // Никаких npm deps; только встроенный fetch + AbortController.
   //
   // Public API:
   //   buildChartConfig(result) → ChartConfig | null  — pure-функция; null если <3 НПЗ.
   //   postToQuickchart(config, opts?) → Promise<string>  — POST /chart/create, возвращает short URL.
   //   generateChartUrl(result, opts?) → Promise<string | null>  — composite: build + post; null если skip.

   import type { AnalysisResult, RefineryDelta } from "./types.js";
   import { log } from "../logger.js";

   const BIRZHA_POSITIVE = "#2ecc71";
   const BIRZHA_NEGATIVE = "#e74c3c";
   const FCA_POSITIVE    = "#f1c40f";
   const FCA_NEGATIVE    = "#e67e22";
   const VOLUME_LINE     = "#7f8c8d";

   const LABEL_MAX_LEN = 14;
   const TOP_N = 10;
   const MIN_REFINERIES = 3;
   const QUICKCHART_TIMEOUT_MS = 10_000;
   const QUICKCHART_URL = "https://quickchart.io/chart/create";
   const CHART_WIDTH = 1000;
   const CHART_HEIGHT = 500;
   ```

2) `buildChartConfig(result: AnalysisResult): ChartConfig | null`:
   - Собрать Map<canonical, { birzha: number; fca: number }> по result.deltas (для каждой записи кладём deltaAbs в правильный slot по d.source).
   - Отфильтровать canonical'ы, где birzha === 0 && fca === 0 (это пустые/без-движения НПЗ).
   - Если оставшихся <`MIN_REFINERIES` → return null.
   - Отсортировать по `Math.abs(entry.birzha + entry.fca)` desc, взять первые TOP_N → массив `top`.
   - Labels: для каждого top.canonical → если canonical.length > LABEL_MAX_LEN → `canonical.slice(0, LABEL_MAX_LEN) + "…"`, иначе canonical.
   - Datasets:
     - `birzhaData = top.map(t => t.birzha)`, `birzhaColors = top.map(t => t.birzha >= 0 ? BIRZHA_POSITIVE : BIRZHA_NEGATIVE)`.
     - `fcaData = top.map(t => t.fca)`, `fcaColors = top.map(t => t.fca >= 0 ? FCA_POSITIVE : FCA_NEGATIVE)`.
   - Volumes branch:
     - Если `result.volumes && result.volumes.perRefinery.length > 0`:
       - Построить Map<canonical, totalT> из result.volumes.perRefinery.
       - `volumeData = top.map(t => volumesMap.get(t.canonical) ?? 0)` (порядок — как labels).
       - Добавить 3-й dataset: `{ type: 'line', label: 'Объём (биржа)', data: volumeData, borderColor: VOLUME_LINE, backgroundColor: VOLUME_LINE, yAxisID: 'y1', pointRadius: 4, fill: false }`.
       - Включить options.scales.y1: `{ position: 'right', title: { display: true, text: 'т' }, grid: { drawOnChartArea: false }, beginAtZero: true }`.
     - Иначе — без 3-го dataset и без y1.
   - Title: `Битум: Δ цен и объёмы за ${fmtDate(result.periodStart)} – ${fmtDate(result.periodEnd)}` (где fmtDate — локальная функция YYYY-MM-DD по UTC, как в llm.ts).
   - Возвращаемый объект — { type: 'bar', data: { labels, datasets }, options: { scales: { y: {...}, [y1: {...}]? }, plugins: { title: { display: true, text: title } } } }.

3) `postToQuickchart(config, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<string>`:
   - `const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? QUICKCHART_TIMEOUT_MS);`
   - `try { const res = await (opts?.fetchImpl ?? globalThis.fetch)(QUICKCHART_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chart: config, backgroundColor: 'white', width: CHART_WIDTH, height: CHART_HEIGHT }), signal: ctrl.signal }); ... }`
   - `finally { clearTimeout(timer); }`.
   - Если `!res.ok` → throw `Error(\`[chart] quickchart HTTP ${res.status}: ${(await res.text()).slice(0, 200)}\`)`.
   - Если `body.success !== true || !body.url` → throw `Error(\`[chart] quickchart success=false\`)`.
   - Иначе return `body.url`.

4) `generateChartUrl(result, opts?)`:
   - `const cfg = buildChartConfig(result);`
   - `if (!cfg) { log.info('[chart] skip: <3 НПЗ с ненулевыми Δ'); return null; }`
   - `const startedAt = Date.now();`
   - `try { const url = await postToQuickchart(cfg, opts); log.info(\`[chart] ok in ${Date.now() - startedAt}ms\`); return url; } catch (err) { log.error(\`[chart] failed: ${(err as Error).message}\`); throw err; }`

5) Создать `src/__tests__/upload-chart.test.ts` со всеми тестами из <behavior>:
   - Используй helper'ы вроде `makeDelta(canonical, first, last, source)` и `makeResult(deltas, volumes?)` (паттерн из upload-llm.test.ts).
   - Для postToQuickchart/generateChartUrl: `vi.stubGlobal('fetch', vi.fn()...)` ИЛИ передавай `opts.fetchImpl` (предпочтительно — meньше глобального state).
   - Для timeout test 2.4: предпочти явный мок fetch который reject'ится с DOMException('AbortError') либо просто `new Error('AbortError')` — это проще, чем играть с fake timers + real AbortSignal. Проверяем что generateChartUrl throws.

6) Запустить `npm test -- upload-chart` (или `npx vitest run src/__tests__/upload-chart.test.ts`) — все 12 тестов должны пройти.

7) Запустить `npx tsc --noEmit` — никаких type errors.

8) Atomic commit:
   ```
   feat(quick-260519-ojk): add chart.ts (quickchart combo bar+line) + tests
   ```
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/upload-chart.test.ts</automated>
  </verify>
  <done>
- `src/upload/chart.ts` экспортирует `buildChartConfig`, `postToQuickchart`, `generateChartUrl`.
- `src/__tests__/upload-chart.test.ts` все describe'ы (12 тестов) проходят.
- `npx tsc --noEmit` — без ошибок.
- Никаких новых npm-зависимостей в package.json (diff на package.json пуст).
- Atomic commit создан.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: интеграция generateChartUrl в handleSummarizeCommand + bot-summarize.test.ts</name>
  <files>src/bot.ts, src/__tests__/bot-summarize.test.ts</files>
  <behavior>
    Новые тесты в bot-summarize.test.ts (расширяем существующий файл, добавляя describe'ы):

    - describe "chart delivery — happy path":
      - 3.1: пара prices+fca + LLM ok + chart ok (mock generateChartUrl → 'https://quickchart.io/chart/render/zf-xxx') → fetchCallsTo('sendPhoto').length === 1; body содержит chat_id=555, photo='https://quickchart.io/chart/render/zf-xxx', caption — строка содержащая 'Битум'.
      - 3.2: sendPhoto вызывается ПОСЛЕ всех sendMessage с narrative (порядок: progress → narrative1 → narrative2 → sendPhoto). Проверяем через индексы в fetchMock.mock.calls.

    - describe "chart delivery — skip":
      - 4.1: generateChartUrl resolves to null → fetchCallsTo('sendPhoto').length === 0; никаких сообщений об ошибке (только progress + narrative).

    - describe "chart delivery — fail path":
      - 5.1: generateChartUrl rejects с Error('quickchart HTTP 500: oops') → fetchCallsTo('sendPhoto').length === 0; fetchCallsTo('sendMessage') содержит сообщение с '❌ График не удалось построить' и фрагментом 'quickchart' или '500'. handleCommand НЕ throw'ает (await handleCommand резолвится без exception).
      - 5.2: generateChartUrl rejects с timeout-error → аналогично, error message содержит '❌ График не удалось построить'.

    - describe "chart delivery — НЕ зовётся при LLM fail":
      - 6.1: buildLlmNarrative rejects с Error('ECONNRESET'); даже если бы generateChartUrl был мокнут — он НЕ должен быть вызван. mockedGenerateChartUrl НЕ вызывался. Сообщение об LLM-сводке остаётся как раньше.

    Pattern: добавляем `vi.mock("../upload/chart.js", () => ({ generateChartUrl: vi.fn() }));` рядом с существующими mocks. `const mockedGenerateChartUrl = vi.mocked(generateChartUrl);` — настраивается per-test через `.mockResolvedValue(url)` / `.mockRejectedValue(err)` / `.mockResolvedValue(null)`.
  </behavior>
  <action>
1) Открыть `src/bot.ts`. После существующего блока handlers добавить тонкий wrapper для sendPhoto (рядом с sendPlain/sendMarkdown):

   ```ts
   /**
    * D-02 (quick-260519-ojk): доставляет chart как Photo по URL.
    * Telegram сам скачает картинку с quickchart.io и положит в чат — нам не надо
    * качать буфер. caption ≤1024 chars — наш title короткий, влезает.
    */
   async function sendPhoto(
     token: string,
     chatId: number,
     photoUrl: string,
     caption: string
   ): Promise<void> {
     await tgFetch<{ ok: boolean }>(token, "sendPhoto", {
       chat_id: chatId,
       photo: photoUrl,
       caption,
     });
   }
   ```

2) В topе файла добавить импорт:
   ```ts
   import { generateChartUrl } from "./upload/chart.js";
   ```

3) В `handleSummarizeCommand` (внутри существующего `try {` блока, СРАЗУ ПОСЛЕ цикла
   `for (const part of parts) { await sendMarkdown(token, chatId, part); }` и ДО
   закрытия try'я) добавить chart-блок:

   ```ts
   // D-04 (quick-260519-ojk): chart-доставка ПОСЛЕ narrative, в том же try.
   // КРИТИЧНО: chart НЕ должен валить handler. Если quickchart упал — narrative
   // уже доставлен, шлём отдельное сообщение об ошибке и идём дальше.
   try {
     const chartUrl = await generateChartUrl(result);
     if (chartUrl) {
       const caption = `Битум: Δ цен и объёмы за ${result.periodStart
         .toISOString()
         .slice(0, 10)} – ${result.periodEnd.toISOString().slice(0, 10)}`;
       await sendPhoto(token, chatId, chartUrl, caption);
     }
     // если null — skip без сообщения (D-01: <3 НПЗ)
   } catch (chartErr) {
     const errMsg = (chartErr as Error).message ?? String(chartErr);
     log.error(`[bot] /summarize chart failed: ${errMsg}`);
     try {
       await sendPlain(
         token,
         chatId,
         `❌ График не удалось построить: ${errMsg.slice(0, 200)}`
       );
     } catch {
       // если даже plain не уходит — outer catch handleSummarizeCommand'а поймает
     }
   }
   ```

   ВАЖНО: chart-try находится ВНУТРИ внешнего `try { ... } catch (err) { ... }`,
   который обрабатывает LLM-fail (см. строки ~487-509 src/bot.ts). Это значит:
   - LLM fail → outer catch → "❌ Не удалось получить LLM-сводку" (как сейчас); до chart-блока выполнение не доходит. ✓ D-04
   - Chart fail → inner catch → "❌ График не удалось построить"; handler продолжается. ✓ D-02

4) Расширить `src/__tests__/bot-summarize.test.ts`:

   - В блоке mocks добавить:
     ```ts
     import { generateChartUrl } from "../upload/chart.js";
     vi.mock("../upload/chart.js", () => ({
       generateChartUrl: vi.fn(),
     }));
     const mockedGenerateChartUrl = vi.mocked(generateChartUrl);
     ```

   - В существующем `beforeEach` добавить default mock:
     ```ts
     mockedGenerateChartUrl.mockResolvedValue(null); // по умолчанию chart skip — не мешаем существующим тестам
     ```

   - ВАЖНО: добавить новый helper рядом с `fetchCallsTo`:
     ```ts
     // Возвращает индексы fetch-вызовов с заданным method (для проверки порядка).
     function fetchCallIndicesTo(method: string): number[] {
       const fetchMock = vi.mocked(globalThis.fetch);
       return fetchMock.mock.calls
         .map(([url], i) => (typeof url === "string" && url.includes(`/${method}`) ? i : -1))
         .filter((i) => i >= 0);
     }
     ```

   - Добавить новые describe-блоки (3-6 как описано в <behavior>) в конце файла, ПЕРЕД последним
     describe "suffix @botname" (или после него — порядок не важен, но логично сгруппировать).

5) ВНИМАНИЕ к существующим тестам: они НЕ должны сломаться, потому что мы default'им
   mockedGenerateChartUrl на `mockResolvedValue(null)` (skip). Это значит существующие
   тесты «happy path» / «only one of the pair» / «no files» / «DeepSeek failure» /
   «suffix @botname» продолжат работать как раньше — sendPhoto НЕ будет звана.

6) Запустить `npx vitest run src/__tests__/bot-summarize.test.ts` — старые тесты остаются зелёные, новые проходят.

7) Запустить весь test-suite + tsc:
   ```
   npx vitest run
   npx tsc --noEmit
   ```

8) Atomic commit:
   ```
   feat(quick-260519-ojk): wire generateChartUrl into /summarize + sendPhoto + tests
   ```
  </action>
  <verify>
    <automated>npx vitest run src/__tests__/bot-summarize.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
- `src/bot.ts`: импортирован generateChartUrl; добавлен sendPhoto хелпер; в handleSummarizeCommand после narrative loop добавлен try/catch блок c sendPhoto на success и sendPlain('❌ График не удалось построить...') на fail.
- `src/__tests__/bot-summarize.test.ts`: добавлен vi.mock для ../upload/chart.js; добавлены 5+ новых тестов (happy 3.1, order 3.2, skip 4.1, fail 5.1+5.2, llm-fail-no-chart 6.1); все старые тесты остаются зелёные.
- `npx vitest run` — весь suite green.
- `npx tsc --noEmit` — без ошибок.
- Никаких новых runtime deps (package.json diff пуст).
- Atomic commit создан.
  </done>
</task>

</tasks>

<verification>
- `npx vitest run` — весь suite green (включая 12 новых тестов в upload-chart + 5+ новых в bot-summarize; ни один существующий тест не сломан).
- `npx tsc --noEmit` — без type errors.
- `git diff package.json` — пустой (никаких новых deps).
- Manual smoke (опционально, не блокирует merge): `npm start`, в DM боту: загрузить пару prices+fca, нажать «🧠 Сделать сводку» → получить narrative + chart Photo в один поток.
</verification>

<success_criteria>
- После /summarize в DM приходит: progress message → 1..N narrative markdown messages → 1 Photo с комбо-чартом (или сообщение «❌ График не удалось построить: …» на fail / тишина на skip <3 НПЗ).
- Чарт — top-10 НПЗ по abs(Δ биржа + Δ FCA), grouped bars с per-bar окраской по знаку, line объёма биржи на правой оси (только если volumes есть).
- На любой fail quickchart (HTTP error, success=false, timeout 10s) — handler НЕ роняется, narrative уже у пользователя, отдельное сообщение об ошибке.
- При LLM fail (outer catch) — chart НЕ вызывается вообще.
- Никаких новых npm зависимостей.
- Все тесты зелёные.
</success_criteria>

<output>
After completion, create `.planning/quick/260519-ojk-charts-in-summarize-combo-bar-line-chart/260519-ojk-SUMMARY.md` describing:
- What was built (chart.ts module + bot.ts wiring)
- Decisions executed (D-01 to D-05)
- Test coverage stats
- Smoke-test result (если делался)
- Known limitations / follow-ups (none expected)
</output>
