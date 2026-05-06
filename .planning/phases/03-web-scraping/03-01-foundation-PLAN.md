---
phase: 03-web-scraping
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - websites.json
  - src/schema.ts
  - src/types.ts
  - src/archive.ts
autonomous: true
requirements:
  - WEB-01
  - WEB-04
tags:
  - foundation
  - scraping
  - schema

must_haves:
  truths:
    - "package.json содержит cheerio как 5-ю runtime-зависимость"
    - "websites.json существует в корне репо с минимум 5 валидными URL"
    - "WebsitesFileSchema валидирует {websites:[{url,name?}]} с z.string().url()"
    - "Тип WebRunSummary экспортирован из src/types.ts"
    - "writeRawWeb и writeOutputWeb пишут data/raw/YYYY-MM-DD-web.json и data/output/YYYY-MM-DD-web.md атомарно"
  artifacts:
    - path: "websites.json"
      provides: "Список 5–15 публичных нефтегазовых сайтов"
      contains: '"websites"'
    - path: "src/schema.ts"
      provides: "WebsitesFileSchema export"
      exports: ["WebsitesFileSchema"]
    - path: "src/types.ts"
      provides: "WebRunSummary interface"
      exports: ["WebRunSummary"]
    - path: "src/archive.ts"
      provides: "writeRawWeb/writeOutputWeb functions"
      exports: ["writeRawWeb", "writeOutputWeb"]
    - path: "package.json"
      provides: "cheerio dependency"
      contains: '"cheerio"'
  key_links:
    - from: "package.json"
      to: "node_modules/cheerio"
      via: "npm install"
      pattern: '"cheerio":\s*"\^1'
    - from: "src/types.ts"
      to: "WebRunSummary"
      via: "export interface"
      pattern: "export interface WebRunSummary"
---

<objective>
Заложить основы Phase 3: добавить `cheerio` в runtime-deps, создать seed-файл `websites.json`,
расширить `src/schema.ts` Zod-схемой `WebsitesFileSchema`, добавить тип `WebRunSummary` в
`src/types.ts`, и расширить `src/archive.ts` функциями `writeRawWeb`/`writeOutputWeb` с суффиксом
`-web` (D-20, D-21, D-22, D-23).

Purpose: подготовить все типы, схемы и архивные функции, чтобы в Wave 2 (Plan 02) `web-scraper.ts`
мог импортировать готовые контракты без scavenger hunt по кодбазе.

Output: `package.json` (с cheerio), `websites.json` (seed), `src/schema.ts`
(WebsitesFileSchema), `src/types.ts` (WebRunSummary), `src/archive.ts` (writeRawWeb/writeOutputWeb).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-web-scraping/03-CONTEXT.md
@.planning/REQUIREMENTS.md
@CLAUDE.md
@channels.json
@src/schema.ts
@src/types.ts
@src/archive.ts
@src/channels-store.ts
@package.json

<interfaces>
<!-- Существующие типы и сигнатуры, к которым обращается этот плана. -->

From src/types.ts (existing — extend with WebRunSummary):
```typescript
export interface Post {
  channelUsername: string;
  messageId: number;
  postedAt: string;
  text: string;
  url: string;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  channelsTotal: number;
  channelsSucceeded: number;
  channelsSkipped: number;
  postsCollected: number;
  postsDeduped: number;
  postsDropped: number;
  digestDelivered: boolean;
  errors: string[];
}
```

From src/archive.ts (existing — module-level helpers to reuse):
```typescript
const RAW_DIR = "./data/raw";
const OUTPUT_DIR = "./data/output";
function todayMsk(): string;             // private, returns "YYYY-MM-DD" in Europe/Moscow
function ensureDir(dir: string): void;   // private
function atomicWriteText(path: string, content: string): void;  // private
export function writeRaw(posts: Post[], runId: string): void;
export function writeOutput(html: string, runId: string): void;
```

From src/schema.ts (existing — extend with WebsitesFileSchema):
```typescript
import { z } from "zod";
export const CATEGORIES = ["bunker", "oil", "kerosene", "petrochem", "bitumen"] as const;
export const MENTIONS = ["rosneft", "lukoil", "gazprom"] as const;
// ... existing DigestItemSchema, DigestJsonSchema, ClassificationResponseSchema, CategoryItemsResponseSchema
```

From src/channels-store.ts (style reference for Zod):
```typescript
const ChannelEntrySchema = z.object({ username: z.string().min(1) });
const ChannelsFileSchema = z.object({ channels: z.array(ChannelEntrySchema).min(1) });
export type ChannelEntry = z.infer<typeof ChannelEntrySchema>;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Добавить cheerio в package.json и создать websites.json seed</name>
  <files>package.json, websites.json</files>
  <read_first>
    - package.json (текущие 4 runtime-deps: telegram, openai, node-cron, zod)
    - channels.json (формат-референс минимизма для websites.json — D-22)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-22 schema, D-23 root location)
    - CLAUDE.md (runtime-deps cap = 4 → 5 с cheerio, утверждено в STATE.md)
  </read_first>
  <action>
1) В `package.json` в поле `dependencies` добавить `"cheerio": "^1.0.0"` (отсортировать ключи по алфавиту: cheerio, node-cron, openai, telegram, zod). Не менять `devDependencies`, `scripts`, `engines`.

2) Создать `websites.json` в корне репо со следующей структурой (формат — D-22):
```json
{
  "websites": [
    { "url": "https://oilcapital.ru/" },
    { "url": "https://neftegaz.ru/news/", "name": "neftegaz" },
    { "url": "https://www.rupec.ru/news/" },
    { "url": "https://oilexp.ru/news" },
    { "url": "https://www.angi.ru/news/" }
  ]
}
```
Это seed-список из 5 публичных отраслевых сайтов. Оператор может позже редактировать вручную (D-24: нет ботовых команд для управления websites.json).

3) После правки запустить `npm install` чтобы получить `node_modules/cheerio` и обновить `package-lock.json`.
  </action>
  <acceptance_criteria>
    - `grep -q '"cheerio":' package.json` (статус 0)
    - `grep -E '"cheerio":\s*"\^1\.0\.0"' package.json` находит строку
    - `node -e 'const p=require("./package.json"); const k=Object.keys(p.dependencies); if(k.length!==5) throw new Error("expected 5 deps, got "+k.length); for(const dep of ["cheerio","node-cron","openai","telegram","zod"]) if(!k.includes(dep)) throw new Error("missing "+dep);'` (статус 0)
    - `test -f websites.json` (статус 0)
    - `node -e 'const w=require("./websites.json"); if(!Array.isArray(w.websites)||w.websites.length<5) throw new Error("need 5+ websites"); for(const s of w.websites){ new URL(s.url); }'` (статус 0)
    - `test -d node_modules/cheerio` (статус 0)
    - `test -f node_modules/cheerio/package.json` (статус 0)
  </acceptance_criteria>
  <verify>
    <automated>npm install && node -e 'require("cheerio").load("&lt;p&gt;hi&lt;/p&gt;")' && node -e 'const w=require("./websites.json"); for(const s of w.websites) new URL(s.url);'</automated>
  </verify>
  <done>
    `cheerio@^1.0.0` в dependencies (5-я runtime-dep), `node_modules/cheerio` существует, `websites.json` валидный JSON с минимум 5 валидными URL.
  </done>
</task>

<task type="auto">
  <name>Task 2: Расширить src/schema.ts (WebsitesFileSchema) и src/types.ts (WebRunSummary)</name>
  <files>src/schema.ts, src/types.ts</files>
  <read_first>
    - src/schema.ts (полный файл — стиль Zod-валидации, существующие экспорты CATEGORIES/MENTIONS/...)
    - src/types.ts (полный файл — Post и RunSummary как образец интерфейса)
    - src/channels-store.ts (lines 1-30 — паттерн ChannelEntrySchema/ChannelsFileSchema, z.infer)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-22 schema формат, Claude's Discretion §«WebRunSummary» — поля)
  </read_first>
  <action>
1) В `src/schema.ts` (в КОНЕЦ файла, после `CategoryItemsResponseSchema`) добавить экспорт `WebsitesFileSchema` (D-22, D-23):

```typescript
// ============================================================================
// WebsitesFileSchema (Phase 3 D-22) — валидация ./websites.json при чтении.
// Формат: { websites: [{ url, name? }] }. Минимум 1 запись (как ChannelsFileSchema).
// url: z.string().url() — защита от SSRF/URL-injection (security threat T-03-01).
// name: optional, используется как Post.channelUsername (fallback: hostname без www).
// ============================================================================
export const WebsiteEntrySchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).optional(),
});

export const WebsitesFileSchema = z.object({
  websites: z.array(WebsiteEntrySchema).min(1),
});

export type WebsiteEntry = z.infer<typeof WebsiteEntrySchema>;
```

Не трогать существующие схемы (DigestJsonSchema, ClassificationResponseSchema и т.п.). Импорт `z` из `"zod"` уже есть на line 4.

2) В `src/types.ts` (в КОНЕЦ файла, после интерфейса `RunSummary`) добавить экспорт `WebRunSummary`:

```typescript
/**
 * Phase 3 (D-06): итог одного запуска web-pipeline.
 * Параллельный аналог RunSummary, поля специфичные для web-сценария.
 * websitesTotal — total из websites.json.
 * websitesSucceeded — fetch ok + extract ok + text >= 200 chars.
 * websitesSkipped — невалидные/недоступные/пустые сайты (D-05, D-15..D-18).
 * itemsCollected — посты, переданные в summarize() (== websitesSucceeded).
 * itemsDropped — отброшено LLM по STRUCT-03 (вне 5 категорий и без mentions).
 * digestDelivered — true если sendToChannel успешно отработал (включая placeholder D-13).
 */
export interface WebRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  websitesTotal: number;
  websitesSucceeded: number;
  websitesSkipped: number;
  itemsCollected: number;
  itemsDropped: number;
  digestDelivered: boolean;
  errors: string[];
}
```

Не трогать `Post`, `Category`, `Mention`, `DigestItem`, `DigestJson`, `RunSummary` (D-03: Post НЕ меняется — web-сайт мапится в существующий Post).

3) Запустить `npx tsc --noEmit` чтобы убедиться, что добавления компилируются с `strict: true`.
  </action>
  <acceptance_criteria>
    - `grep -E "^export const WebsitesFileSchema" src/schema.ts` находит строку
    - `grep -E "^export const WebsiteEntrySchema" src/schema.ts` находит строку
    - `grep -E "^export type WebsiteEntry" src/schema.ts` находит строку
    - `grep -E "z\.string\(\)\.url\(\)" src/schema.ts` находит как минимум одно вхождение (URL validation для SSRF mitigation)
    - `grep -E "^export interface WebRunSummary" src/types.ts` находит строку
    - `grep -E "websitesTotal:\s*number" src/types.ts` находит поле
    - `grep -E "websitesSucceeded:\s*number" src/types.ts` находит поле
    - `grep -E "websitesSkipped:\s*number" src/types.ts` находит поле
    - `grep -E "itemsCollected:\s*number" src/types.ts` находит поле
    - `grep -E "itemsDropped:\s*number" src/types.ts` находит поле
    - `grep -E "digestDelivered:\s*boolean" src/types.ts` находит поле
    - `grep -E "errors:\s*string\[\]" src/types.ts` находит поле
    - `npx tsc --noEmit` (статус 0)
    - Существующий тип `Post` остался без изменений: `grep -E "channelUsername:\s*string" src/types.ts` находит точно одну строку (Post.channelUsername — без новых полей)
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && node --import tsx -e 'import("./src/schema.ts").then(m=>{m.WebsitesFileSchema.parse({websites:[{url:"https://x.com/"}]});console.log("schema ok")})'</automated>
  </verify>
  <done>
    `WebsitesFileSchema` валидирует `{websites:[{url,name?}]}` с обязательным `z.string().url()`, `WebRunSummary` интерфейс экспортирован со всеми 11 полями, `npx tsc --noEmit` чистый, существующий `Post` не изменён.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Расширить src/archive.ts функциями writeRawWeb/writeOutputWeb (D-20, D-21)</name>
  <files>src/archive.ts, src/__tests__/archive-web.test.ts</files>
  <behavior>
    - Test 1: `writeRawWeb([], "abc12345")` создаёт `data/raw/YYYY-MM-DD-web.json` с содержимым `[]` (пустой массив, валидный JSON)
    - Test 2: `writeRawWeb([{channelUsername:"x",messageId:0,postedAt:"2026-05-06T17:15:00.000Z",text:"hello",url:"https://x.com/"}], "abc12345")` пишет файл с тем же payload-форматом, что и `writeRaw` (поля: username, messageId, text, date, url)
    - Test 3: `writeOutputWeb("&lt;b&gt;hello&lt;/b&gt;", "abc12345")` создаёт `data/output/YYYY-MM-DD-web.md` byte-for-byte с переданным html
    - Test 4: повторный вызов `writeRawWeb` за тот же день перезаписывает файл (D-11 carried)
    - Test 5: путь содержит `-web.json` суффикс (не путаем с TG-архивом `YYYY-MM-DD.json`)
  </behavior>
  <read_first>
    - src/archive.ts (полный файл — копировать паттерн writeRaw/writeOutput, переиспользовать atomicWriteText/todayMsk/ensureDir)
    - src/__tests__/channels-store.test.ts (style reference для vitest-теста с tmpdir)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-20: суффикс `-web`, D-21: повторное использование atomicWriteText)
  </read_first>
  <action>
1) Открыть `src/archive.ts`. После функции `writeOutput` (line 64-68) добавить две новые экспортируемые функции:

```typescript
/**
 * Phase 3 D-20: записать массив web-Post'ов после fetch+extraction в data/raw/YYYY-MM-DD-web.json.
 * Параллельный аналог writeRaw, отличается только суффиксом `-web` в имени файла.
 * Вызывается ДО dedup/LLM (инвариант: «сырое сохранено даже если остаток упал»).
 * D-11: re-run за тот же день перезаписывает файл.
 */
export function writeRawWeb(posts: Post[], runId: string): void {
  const path = `${RAW_DIR}/${todayMsk()}-web.json`;
  const payload = posts.map((p) => ({
    username: p.channelUsername,
    messageId: p.messageId,
    text: p.text,
    date: p.postedAt,
    url: p.url,
  }));
  atomicWriteText(path, JSON.stringify(payload, null, 2));
  log.info(`[archive] runId=${runId} wrote raw web: ${path} (${posts.length} posts)`);
}

/**
 * Phase 3 D-20: записать финальный HTML web-дайджеста в data/output/YYYY-MM-DD-web.md.
 * Параллельный аналог writeOutput, отличается только суффиксом `-web`.
 * Вызывается ПОСЛЕ успешного sendToChannel — содержание byte-for-byte идентично отправленному.
 * D-11: re-run за тот же день перезаписывает файл.
 */
export function writeOutputWeb(html: string, runId: string): void {
  const path = `${OUTPUT_DIR}/${todayMsk()}-web.md`;
  atomicWriteText(path, html);
  log.info(`[archive] runId=${runId} wrote output web: ${path} (${html.length} chars)`);
}
```

Не трогать существующие `writeRaw`, `writeOutput`, `atomicWriteText`, `todayMsk`, `ensureDir`, `RAW_DIR`, `OUTPUT_DIR`.

2) Создать `src/__tests__/archive-web.test.ts` с unit-тестами 5 поведений (см. behavior). Использовать `process.chdir(tmpdir())` или mock'ить `RAW_DIR`/`OUTPUT_DIR` через изоляцию `process.cwd()` (как в существующих тестах). Минимальный шаблон:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRawWeb, writeOutputWeb } from "../archive.js";
import type { Post } from "../types.js";

describe("archive-web (Phase 3 D-20, D-21)", () => {
  let workDir: string;
  let originalCwd: string;
  beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), "archive-web-"));
    process.chdir(workDir);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("writes empty array to data/raw/YYYY-MM-DD-web.json", () => {
    writeRawWeb([], "abc12345");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const path = join(workDir, "data", "raw", `${date}-web.json`);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([]);
  });

  it("writes posts with TG-compatible payload format", () => {
    const posts: Post[] = [{
      channelUsername: "neftegaz", messageId: 0, postedAt: "2026-05-06T17:15:00.000Z",
      text: "hello", url: "https://neftegaz.ru/news/",
    }];
    writeRawWeb(posts, "abc12345");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const parsed = JSON.parse(readFileSync(join(workDir, "data", "raw", `${date}-web.json`), "utf8"));
    expect(parsed).toEqual([{ username: "neftegaz", messageId: 0, text: "hello", date: "2026-05-06T17:15:00.000Z", url: "https://neftegaz.ru/news/" }]);
  });

  it("writeOutputWeb writes html byte-for-byte to YYYY-MM-DD-web.md", () => {
    writeOutputWeb("<b>hello</b>", "abc12345");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const path = join(workDir, "data", "output", `${date}-web.md`);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("<b>hello</b>");
  });

  it("re-run за тот же день перезаписывает файл (D-11)", () => {
    writeOutputWeb("<b>first</b>", "run-1");
    writeOutputWeb("<b>second</b>", "run-2");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const path = join(workDir, "data", "output", `${date}-web.md`);
    expect(readFileSync(path, "utf8")).toBe("<b>second</b>");
  });

  it("path содержит -web суффикс (не путается с TG-архивом)", () => {
    writeRawWeb([], "abc12345");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(existsSync(join(workDir, "data", "raw", `${date}-web.json`))).toBe(true);
    expect(existsSync(join(workDir, "data", "raw", `${date}.json`))).toBe(false);
  });
});
```

3) Запустить `npx vitest run src/__tests__/archive-web.test.ts` — все 5 тестов должны проходить.
  </action>
  <acceptance_criteria>
    - `grep -E "^export function writeRawWeb" src/archive.ts` находит строку
    - `grep -E "^export function writeOutputWeb" src/archive.ts` находит строку
    - `grep -E "-web\.json" src/archive.ts` находит как минимум одно вхождение
    - `grep -E "-web\.md" src/archive.ts` находит как минимум одно вхождение
    - `test -f src/__tests__/archive-web.test.ts` (статус 0)
    - `npx vitest run src/__tests__/archive-web.test.ts 2>&1 | grep -E "5 passed"` (все 5 тестов проходят)
    - `npx tsc --noEmit` (статус 0)
    - Существующие `writeRaw`/`writeOutput` остались без изменений: `grep -c "^export function writeRaw" src/archive.ts` возвращает `2` (writeRaw + writeRawWeb)
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/__tests__/archive-web.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
    `writeRawWeb`/`writeOutputWeb` экспортированы из `src/archive.ts`, пишут файлы с суффиксом `-web` через переиспользуемые `atomicWriteText`/`todayMsk`, vitest-тесты для 5 поведений проходят.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator → websites.json | Оператор-edited файл, валидируется Zod при чтении. Источник URL — операторская конфигурация, не пользовательский ввод runtime |
| websites.json → fetch() | URL передаётся в native `fetch` для скрейпинга — потенциал для SSRF при отсутствии валидации |
| package-lock.json → npm install | Новая runtime-dep `cheerio` — supply-chain risk |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01 | Tampering / SSRF | WebsitesFileSchema validation | mitigate | `WebsiteEntrySchema.url` использует `z.string().url()` — отсекает `file://`, `gopher://`, malformed строки до того, как URL попадёт в `fetch`. URL не пользовательский (operator-edited file), но защита от опечаток + supply-chain attack на repo-PR |
| T-03-02 | Information Disclosure | websites.json | accept | Файл коммитится в репо как list публичных URL — не секрет. Симметрично `channels.json` (публичные Telegram-каналы) |
| T-03-03 | Denial of Service | npm install cheerio | accept | `cheerio@^1.0.0` — широко используемая lib (>10M downloads/week), pinned на `^1.0.0`. `package-lock.json` зафиксирует exact version. Альтернативой был бы forking, но overkill для одного оператора |
| T-03-04 | Tampering | atomicWriteText path | mitigate | `RAW_DIR`/`OUTPUT_DIR` — захардкоженные константы (не env, не аргумент); `todayMsk()` возвращает строго `YYYY-MM-DD` из `Intl.DateTimeFormat`. Path injection невозможен |
| T-03-05 | Repudiation | runId logging | mitigate | Все три функции (`writeRawWeb`, `writeOutputWeb`) логируют `runId` через `log.info` — операторская trace через `grep runId=` (D-07 carried) |
</threat_model>

<verification>
1. `cheerio` в `package.json` deps как 5-я runtime-dep, `node_modules/cheerio` существует.
2. `websites.json` валидный JSON с минимум 5 URL'ами.
3. `WebsitesFileSchema` экспортирован, валидирует `{websites:[{url,name?}]}` с `z.string().url()`.
4. `WebRunSummary` интерфейс экспортирован со всеми 11 полями (`runId`, `startedAt`, `finishedAt`, `durationMs`, `websitesTotal`, `websitesSucceeded`, `websitesSkipped`, `itemsCollected`, `itemsDropped`, `digestDelivered`, `errors`).
5. `writeRawWeb`/`writeOutputWeb` экспортированы из `src/archive.ts`, vitest-тесты (5 шт.) проходят.
6. `npx tsc --noEmit` чистый, `npm test` зелёный.
</verification>

<success_criteria>
- 5-я runtime-dep `cheerio@^1.0.0` зафиксирована в `package.json` и `package-lock.json`
- `websites.json` существует с 5+ URL, валиден через `new URL()`
- `WebsitesFileSchema` валидирует и rejects `{websites:[{url:"not-a-url"}]}`
- `WebRunSummary` импортируется из `./types.js` без ошибок tsc
- `writeRawWeb([], "x")` создаёт `data/raw/YYYY-MM-DD-web.json` со строкой `[]`
- `writeOutputWeb("<b>x</b>", "y")` создаёт `data/output/YYYY-MM-DD-web.md` строго со строкой `<b>x</b>`
- Все 5 vitest-тестов в `archive-web.test.ts` зелёные
</success_criteria>

<output>
After completion, create `.planning/phases/03-web-scraping/03-01-SUMMARY.md`.
</output>
