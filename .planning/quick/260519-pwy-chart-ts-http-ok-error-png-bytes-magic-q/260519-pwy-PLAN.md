---
phase: quick-260519-pwy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/upload/chart.ts
  - src/__tests__/upload-chart.test.ts
autonomous: true
requirements:
  - QUICK-260519-pwy

must_haves:
  truths:
    - "Когда quickchart возвращает HTTP !ok с PNG-телом (error-PNG), fetchQuickChartPng возвращает bytes (Uint8Array) вместо throw — пользователь увидит причину прямо на картинке через sendPhotoMultipart."
    - "Когда quickchart возвращает HTTP !ok с НЕ-PNG телом (JSON/HTML/text/empty), fetchQuickChartPng throw'ает с body excerpt (UTF-8 string, truncate 500ch + `…`)."
    - "Body читается из response РОВНО ОДИН РАЗ — через res.arrayBuffer(); никаких двойных await на одном ReadableStream."
    - "generateChartPng (caller) и handleSummarizeCommand НЕ меняются: они уже умеют слать Uint8Array через sendPhotoMultipart."
    - "Полный test suite src/__tests__/upload-chart.test.ts проходит (включая 2 новых теста и обновлённый 'throws on HTTP !ok')."
  artifacts:
    - path: "src/upload/chart.ts"
      provides: "fetchQuickChartPng — read body once via arrayBuffer, PNG-magic branch returns bytes, non-PNG branch throws with TextDecoder excerpt"
      contains: "res.arrayBuffer"
    - path: "src/__tests__/upload-chart.test.ts"
      provides: "updated 'throws on HTTP !ok' test + 2 new tests for PNG-magic / non-PNG branches"
      contains: "returns bytes when HTTP !ok body is valid PNG"
  key_links:
    - from: "fetchQuickChartPng (HTTP !ok branch)"
      to: "res.arrayBuffer()"
      via: "single await, then Uint8Array view + magic check on first 8 bytes"
      pattern: "res\\.arrayBuffer"
    - from: "non-PNG branch of !res.ok"
      to: "Error message with body excerpt"
      via: "TextDecoder('utf-8', {fatal:false}).decode(bytes) → truncate 500ch + '…'"
      pattern: "TextDecoder"
---

<objective>
Когда quickchart.io отдаёт HTTP !ok, тело может быть error-PNG (PNG magic в первых 8 байтах) — это фича quickchart: они рисуют красный текст ошибки на картинке. Сейчас код после quick-260519-pl2 на `!res.ok` слепо читает body как text и throw'ает, превращая бинарь в мусор. Нужно прочитать body как arrayBuffer, проверить PNG magic; если PNG — вернуть bytes (так пользователь увидит причину 400 прямо в TG через sendPhotoMultipart); если не PNG — throw как раньше, но decode'ить bytes через TextDecoder (не дёргать stream дважды).

Purpose: диагностика 400 у quickchart перестаёт быть «слепой» — текст ошибки попадает в Telegram как картинка. Caller (`generateChartPng` → `handleSummarizeCommand`) не меняется, потому что он уже умеет слать `Uint8Array`.

Output: обновлённый `src/upload/chart.ts` + 1 обновлённый и 2 новых теста в `src/__tests__/upload-chart.test.ts`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/upload/chart.ts
@src/__tests__/upload-chart.test.ts

<interfaces>
<!-- Текущая сигнатура fetchQuickChartPng сохраняется (Promise<Uint8Array>). -->
<!-- Меняется только внутренняя обработка !res.ok branch. -->

From src/upload/chart.ts:
```typescript
export async function fetchQuickChartPng(
  config: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Uint8Array>;
```

PNG magic (первые 8 байт):
```typescript
const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
```

Существующий happy-path для `res.ok` (НЕ менять):
```typescript
const buf = await res.arrayBuffer();
const bytes = new Uint8Array(buf);
if (bytes.length === 0) {
  throw new Error(`[chart] empty PNG body from quickchart`);
}
return bytes;
```

Существующая структура non-ok branch (заменить):
```typescript
if (!res.ok) {
  let bodyExcerpt = "<body unavailable>";
  try {
    const body = await res.text();
    bodyExcerpt = body.length > 500 ? body.slice(0, 500) + "…" : body;
  } catch { /* ... */ }
  throw new Error(`[chart] HTTP ${res.status} ${res.statusText} body=${bodyExcerpt}`);
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: PNG-magic branch in fetchQuickChartPng + tests</name>
  <files>src/upload/chart.ts, src/__tests__/upload-chart.test.ts</files>
  <behavior>
    Test expectations (vitest, ONLY `npx vitest run src/__tests__/upload-chart.test.ts`):

    UPDATE existing test "throws on HTTP !ok" (line ~215):
    - Mock fetch resolves с `{ ok:false, status:500, statusText:"Internal Server Error", arrayBuffer: async () => <bytes of JSON `{"success":false,"message":"Invalid chart config: scales.y1 is malformed"}` as UTF-8> }`.
    - (Удалить `text:` field из mock — теперь body читается через arrayBuffer.)
    - Assert throw matches /HTTP 500.*Invalid chart config/.

    UPDATE existing test "truncates response body to 500 chars and appends ellipsis":
    - Mock arrayBuffer: 600 байт `'x'.charCodeAt(0)` → UTF-8 не PNG.
    - Assert: message contains `"x".repeat(500)` + `"…"`, NOT `"x".repeat(501)`.

    UPDATE existing test "does NOT mask HTTP error when res.text() itself throws":
    - Переписать как "does NOT mask HTTP error when arrayBuffer() itself throws".
    - Mock: `arrayBuffer: async () => { throw new Error("body read failed"); }`.
    - Assert throw matches /HTTP 400/ AND message contains `"<body unavailable>"`, NOT `"body read failed"`.

    NEW test "returns bytes when HTTP !ok body is valid PNG (quickchart error-image)":
    - Mock fetch: `{ ok:false, status:400, statusText:"Bad Request", arrayBuffer: async () => PNG_BYTES.buffer.slice(...) }` (используя existing PNG_BYTES константу из тест-файла).
    - Call `fetchQuickChartPng(cfg, fetchImpl)`.
    - Assert: returns Uint8Array, `.length > 0`, first 8 bytes === PNG magic.
    - Assert: НЕ throw.

    NEW test "throws when HTTP !ok body is non-PNG (HTML)":
    - Mock arrayBuffer: bytes of `"<html><body>500 Internal Server Error</body></html>"` as UTF-8 (через `new TextEncoder().encode(...)`).
    - Assert throw matches /HTTP 500/ AND message contains substring `"<html>"`.

    NEW test "throws when HTTP !ok body is shorter than 8 bytes (treated as non-PNG)":
    - Mock arrayBuffer: 4 bytes `new Uint8Array([0x89, 0x50, 0x4E, 0x47])` (PNG magic prefix но короче 8).
    - Assert throw matches /HTTP/ (NOT returns).

    Edge: test "throws when response body is empty (zero bytes)" (line ~271) — НЕ менять. Это `res.ok=true` ветка, на ней проверка `bytes.length === 0` уже работает.
  </behavior>
  <action>
    Step 1 — Modify `src/upload/chart.ts` `fetchQuickChartPng` (lines ~205-249):

    a) Добавить module-level константу выше функции:
    ```typescript
    // quick-260519-pwy: PNG magic — первые 8 байт PNG-файла.
    // quickchart.io на 400/500 может вернуть error-PNG (картинку с красным текстом
    // ошибки) вместо JSON — мы детектим это по magic и возвращаем bytes как обычно,
    // чтобы handleSummarizeCommand доставил картинку в TG (sendPhotoMultipart).
    const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

    function hasPngMagic(bytes: Uint8Array): boolean {
      if (bytes.length < PNG_MAGIC.length) return false;
      for (let i = 0; i < PNG_MAGIC.length; i++) {
        if (bytes[i] !== PNG_MAGIC[i]) return false;
      }
      return true;
    }
    ```

    b) Заменить `if (!res.ok) { ... }` блок на:
    ```typescript
    // quick-260519-pwy: quickchart на HTTP !ok может вернуть error-PNG (картинка
    // с текстом ошибки) вместо JSON/HTML. Читаем body ОДИН раз через arrayBuffer,
    // проверяем PNG magic. Если PNG — возвращаем bytes (caller отправит как обычно
    // через sendPhotoMultipart, пользователь увидит причину 400 прямо на картинке).
    // Если не PNG — throw как и раньше (quick-260519-pl2), decode'я bytes через
    // TextDecoder (НЕ res.text() — стрим уже прочитан arrayBuffer'ом).
    if (!res.ok) {
      let bytes: Uint8Array;
      try {
        const buf = await res.arrayBuffer();
        bytes = new Uint8Array(buf);
      } catch {
        // arrayBuffer() сам упал — не маскируем оригинальный HTTP-статус.
        throw new Error(`[chart] HTTP ${res.status} ${res.statusText} body=<body unavailable>`);
      }
      if (hasPngMagic(bytes)) {
        log.warn(`[chart] HTTP ${res.status} ${res.statusText} but body is PNG (quickchart error-image), returning bytes=${bytes.length}`);
        return bytes;
      }
      // Non-PNG body: decode как UTF-8 (lossy, не throw'ает на невалидных байтах),
      // truncate 500ch + '…' (как было после quick-260519-pl2).
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const bodyExcerpt = text.length > 500 ? text.slice(0, 500) + "…" : (text.length === 0 ? "<body unavailable>" : text);
      throw new Error(`[chart] HTTP ${res.status} ${res.statusText} body=${bodyExcerpt}`);
    }
    ```

    c) Оставить happy-path (`res.ok`) ниже как есть — он уже корректно делает `res.arrayBuffer()` + `bytes.length === 0` check.

    Step 2 — Modify `src/__tests__/upload-chart.test.ts`:

    a) UPDATE existing "throws on HTTP !ok" (line ~215): убрать `text:`, заменить на `arrayBuffer: async () => new TextEncoder().encode('{"success":false,"message":"Invalid chart config: scales.y1 is malformed"}').buffer`.

    b) UPDATE existing "truncates response body to 500 chars and appends ellipsis" (line ~227): убрать `text:`, заменить `arrayBuffer: async () => new TextEncoder().encode("x".repeat(600)).buffer`.

    c) UPDATE existing "does NOT mask HTTP error when res.text() itself throws" (line ~250): переименовать в "does NOT mask HTTP error when arrayBuffer() itself throws", убрать `text:`, поставить `arrayBuffer: async () => { throw new Error("body read failed"); }`. Assert: message contains `"<body unavailable>"`, NOT `"body read failed"`.

    d) ADD 3 new tests в describe("fetchQuickChartPng") (после existing tests, перед закрывающей `})`):
    - "returns bytes when HTTP !ok body is valid PNG (quickchart error-image)" — использует existing `PNG_BYTES`, mock `ok:false, status:400`, assert returns bytes (НЕ throw).
    - "throws when HTTP !ok body is non-PNG HTML" — mock arrayBuffer возвращает `new TextEncoder().encode("<html><body>500 Internal Server Error</body></html>").buffer`, assert throw + msg содержит `"<html>"`.
    - "throws when HTTP !ok body is shorter than 8 bytes" — mock arrayBuffer возвращает `new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer`, assert throw matches /HTTP/.

    Step 3 — Verify generateChartPng tests still pass: тест "returns null on quickchart HTTP error (does NOT throw)" (line ~330) — у него `ok:false, status:503, arrayBuffer: async () => new ArrayBuffer(0)`. После изменений: 0 байт → не PNG → throw с body=`<body unavailable>` (поскольку TextDecoder на пустых bytes даёт `""`, → fallback к `<body unavailable>` через `text.length === 0 ? "<body unavailable>"`) → caught в generateChartPng → returns null. Тест продолжит проходить.

    Constraints (повтор):
    - body читается РОВНО ОДИН раз через `arrayBuffer()` — никаких `res.text()`.
    - magic check: первые 8 байт байт-в-байт === `PNG_MAGIC`.
    - <8 байт ИЛИ не-PNG → throw с excerpt через `TextDecoder("utf-8", {fatal:false})`.
    - truncate 500ch + `…`, empty/`<body unavailable>` для нулевой длины.
    - НИКАКИХ новых runtime-deps (`TextDecoder`, `TextEncoder` — глобалы Node 20.6+).
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo && npx vitest run src/__tests__/upload-chart.test.ts</automated>
  </verify>
  <done>
    - `src/upload/chart.ts` содержит `PNG_MAGIC` константу + `hasPngMagic` хелпер.
    - `fetchQuickChartPng` `!res.ok` branch читает body через `arrayBuffer()` ровно один раз.
    - Если bytes начинаются с PNG magic → `log.warn` + `return bytes` (НЕ throw).
    - Если bytes не PNG → throw с body excerpt через `TextDecoder` (truncate 500ch + `…`).
    - 3 новых теста в `upload-chart.test.ts` (PNG body на !ok, HTML body на !ok, <8 байт body на !ok).
    - 3 updated теста (`throws on HTTP !ok` / `truncates body` / `does NOT mask` теперь mock'ают `arrayBuffer` вместо `text`).
    - `npx vitest run src/__tests__/upload-chart.test.ts` — все тесты pass.
    - Никаких других файлов не тронуто (`generateChartPng`, `handleSummarizeCommand` без изменений).
  </done>
</task>

</tasks>

<verification>
- `npx vitest run src/__tests__/upload-chart.test.ts` — все existing + 3 новых теста зелёные.
- `git diff --stat` — изменены РОВНО 2 файла: `src/upload/chart.ts`, `src/__tests__/upload-chart.test.ts`.
- `grep -n "res.text()" src/upload/chart.ts` — пусто (все чтения тела через `arrayBuffer`).
- `grep -n "PNG_MAGIC\|hasPngMagic" src/upload/chart.ts` — обе сущности присутствуют.
- Caller-side файлы (`bot.ts`, `handleSummarizeCommand`, `sendPhotoMultipart`) НЕ изменены.
</verification>

<success_criteria>
- HTTP !ok + PNG body: fetchQuickChartPng возвращает Uint8Array (lengths > 0, magic совпадает), НЕ throw.
- HTTP !ok + не-PNG body (HTML/JSON/text/<8 байт/empty): throw с message формата `[chart] HTTP <status> <statusText> body=<excerpt up to 500ch>…`.
- HTTP ok + body: без регрессии — happy path работает как раньше.
- arrayBuffer() читается ровно один раз на response — никаких "stream already consumed" runtime ошибок.
- Все тесты `upload-chart.test.ts` зелёные.
</success_criteria>

<output>
After completion, create `.planning/quick/260519-pwy-chart-ts-http-ok-error-png-bytes-magic-q/260519-pwy-SUMMARY.md` summarizing:
- Что изменено в `fetchQuickChartPng` (PNG magic branch, single arrayBuffer read, TextDecoder for non-PNG).
- Какие тесты updated (3) / added (3).
- Один следующий шаг: попробовать `/summarize` в проде — если quickchart снова отдаст 400, теперь в TG прилетит error-PNG с человекочитаемой причиной.
</output>
