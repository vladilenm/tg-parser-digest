---
phase: 03-web-scraping
plan: 04
type: execute
wave: 4
depends_on:
  - 03-03
files_modified:
  - src/__tests__/web-scraper.test.ts
  - README.md
autonomous: true
requirements:
  - WEB-01
  - WEB-04
tags:
  - tests
  - documentation

must_haves:
  truths:
    - "Vitest-тесты покрывают cascade-select, cleanup, 200-char validation, 8000-char cap, hostname-derivation, fetchSite mocked Promise.allSettled"
    - "composeWebDigest имеет dedicated test-block (3 проверки: web-header at start, body sections preserved, TG-header absent) — защита от silent-breakage от рефактора summarize.renderHtml"
    - "npx vitest run зелёный после всех Plan'ов"
    - "README.md содержит секцию «Парсинг веб-сайтов» с описанием websites.json и data/output/*-web.md"
  artifacts:
    - path: "src/__tests__/web-scraper.test.ts"
      provides: "Unit tests для loadWebsites/fetchSite/extractText/siteToPost/composeWebDigest"
      contains: "describe"
      min_lines: 180
    - path: "README.md"
      provides: "Documentation для оператора"
      contains: "Парсинг веб-сайтов"
  key_links:
    - from: "src/__tests__/web-scraper.test.ts"
      to: "src/web-scraper.ts"
      via: "imports + tests behavior"
      pattern: 'from\\s+"\\.\\./web-scraper\\.js"'
---

<objective>
Закрыть Phase 3 тестами и документацией:
1) Создать `src/__tests__/web-scraper.test.ts` с unit-тестами для всех экспортов `web-scraper.ts`:
   - `extractText`: cascade-select на fixture-HTML (article-only, main-only, body-only, empty)
   - `extractText`: cleanup удаляет `<script>`, `<nav>`, `<style>` ДО text-extraction
   - `extractText`: 8000-char cap срабатывает (D-04)
   - `siteToPost`: 200-char validation отбрасывает короткий текст (D-05)
   - `siteToPost`: channelUsername из `name` или из `hostname` без `www.` (D-22)
   - `loadWebsites`: throws на отсутствующий файл / невалидный JSON / Zod fail (T-03-01)
   - `fetchSite`: mocked `globalThis.fetch` для сценариев (200 OK, 404, 10s timeout)
   - `composeWebDigest`: фиксирует контракт split-по-`\n\n` (защита от silent breakage если summarize.renderHtml поменяет header формат)

2) Расширить `README.md` секцией «Парсинг веб-сайтов» с описанием формата `websites.json`,
   ссылкой на архивы `data/output/YYYY-MM-DD-web.md`, и форматом сообщения в канале.

Output: `src/__tests__/web-scraper.test.ts`, расширенный `README.md`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-web-scraping/03-CONTEXT.md
@CLAUDE.md
@src/web-scraper.ts
@src/types.ts
@src/schema.ts
@src/__tests__/channels-store.test.ts
@src/__tests__/summarize.test.ts
@README.md
@websites.json

<interfaces>
<!-- Контракты, которые тесты проверяют. -->

From src/web-scraper.ts (Plan 02):
```typescript
export const WEBSITES_PATH: string;
export function loadWebsites(): WebsiteEntry[];                // throws on missing/invalid
export async function fetchSite(url: string, timeoutMs?: number): Promise<string>;
export function extractText(html: string): string;            // returns "" if empty
export function siteToPost(site: WebsiteEntry, text: string): Post | null;  // null if < 200 chars
export function composeWebDigest(summarizedHtml: string, succeeded: number, total: number): string;  // exported for testability
export async function runWebPipeline(runId: string): Promise<WebRunSummary>;
```

From src/types.ts:
```typescript
export interface Post { channelUsername: string; messageId: number; postedAt: string; text: string; url: string; }
```

From src/schema.ts:
```typescript
export type WebsiteEntry = { url: string; name?: string };
```

Vitest config: `vitest.config.ts` — environment: "node", без setup-файла. Использовать `vi.fn()` / `vi.spyOn()` для mock'а `globalThis.fetch`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Создать src/__tests__/web-scraper.test.ts с unit-тестами</name>
  <files>src/__tests__/web-scraper.test.ts</files>
  <behavior>
    - extractText cascade: HTML с `<article>` возвращает текст из article (не body)
    - extractText cascade: HTML только с `<body>` (без article/main) возвращает текст body
    - extractText cleanup: `<script>alert("x")</script><body>content</body>` НЕ содержит "alert"
    - extractText cleanup: `<body><nav>menu</nav>real content here</body>` НЕ содержит "menu"
    - extractText cap: 10000-символьный article обрезается до 8000 (D-04)
    - extractText empty: `<html></html>` возвращает пустую строку
    - siteToPost short: text.length=199 → возвращает null (D-05 граница)
    - siteToPost valid: text.length>=200 → возвращает Post с corrected channelUsername
    - siteToPost name: site.name="custom" → channelUsername="custom"
    - siteToPost hostname: site без name, url=https://www.example.com/ → channelUsername="example.com" (D-22 strip www)
    - loadWebsites missing: WEBSITES_PATH не существует → throw
    - loadWebsites invalid JSON: невалидный JSON → throw
    - loadWebsites zod fail: `{websites:[{url:"not-a-url"}]}` → throw (T-03-01)
    - fetchSite mock 200: глобальный fetch mock возвращает 200+body → fetchSite возвращает body
    - fetchSite mock 404: глобальный fetch mock возвращает 404 → fetchSite throws
    - fetchSite timeout: фейкнутый fetch который никогда не резолвится → AbortError через timeout
    - composeWebDigest replaces TG-header: на mock-input `<b>Нефтегаз — X</b>\n<i>Y постов</i>\n\n<b>🚢 Бункер</b>...` (1) результат начинается с `<b>🌐 Веб-источники`, (2) содержит `<b>🚢 Бункер</b>`, (3) НЕ содержит `<b>Нефтегаз —`
  </behavior>
  <read_first>
    - src/__tests__/channels-store.test.ts (полный — образец vitest + tmpdir + process.chdir для loadWebsites теста)
    - src/__tests__/summarize.test.ts (lines 1-50 — образец vi.mock / vi.fn для DeepSeek mock)
    - src/web-scraper.ts (полный файл — все экспорты, которые тестируются, включая composeWebDigest)
    - src/types.ts (Post, WebsiteEntry — types для test fixtures)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-01..D-05, D-15..D-18 — то, что тесты должны verify)
    - vitest.config.ts (environment: "node")
  </read_first>
  <action>
Создать файл `src/__tests__/web-scraper.test.ts`. Структура — пять `describe` блоков: `extractText`, `siteToPost`, `loadWebsites`, `fetchSite`, `composeWebDigest` (5 описаний, ≥17 тестов). Использовать `vi.spyOn(globalThis, "fetch")` для fetchSite-тестов (vitest v4+ поддерживает `vi`).

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractText, siteToPost, loadWebsites, fetchSite, composeWebDigest } from "../web-scraper.js";

// =============================================================================
// extractText — D-01 (cascade), D-02 (cleanup), D-04 (cap)
// =============================================================================
describe("extractText (D-01, D-02, D-04)", () => {
  it("cascade: <article> takes precedence over <body>", () => {
    const html = `<html><body><article>article text here</article><div>body div text</div></body></html>`;
    const text = extractText(html);
    expect(text).toContain("article text here");
    expect(text).not.toContain("body div text");
  });

  it("cascade: falls back to <body> when no article/main/role=main", () => {
    const html = `<html><body>plain body content</body></html>`;
    expect(extractText(html)).toContain("plain body content");
  });

  it("cascade: [role=main] has highest priority", () => {
    const html = `<html><body><div role="main">main content</div><article>article text</article></body></html>`;
    const text = extractText(html);
    expect(text).toContain("main content");
    expect(text).not.toContain("article text");
  });

  it("cleanup: <script> removed before text extraction (security T-03-02)", () => {
    const html = `<html><body><script>alert("xss")</script>real content</body></html>`;
    const text = extractText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("xss");
    expect(text).toContain("real content");
  });

  it("cleanup: <nav>, <header>, <footer>, <aside> removed", () => {
    const html = `<html><body><nav>menu link</nav><header>logo</header>main story<footer>copyright</footer><aside>ads</aside></body></html>`;
    const text = extractText(html);
    expect(text).not.toContain("menu link");
    expect(text).not.toContain("logo");
    expect(text).not.toContain("copyright");
    expect(text).not.toContain("ads");
    expect(text).toContain("main story");
  });

  it("cap: text > 8000 chars sliced to 8000 (D-04)", () => {
    const longText = "x".repeat(10_000);
    const html = `<html><body><article>${longText}</article></body></html>`;
    const text = extractText(html);
    expect(text.length).toBe(8000);
  });

  it("normalize: whitespace collapsed to single spaces", () => {
    const html = `<html><body><article>line1\n\n\n   line2\t\tline3</article></body></html>`;
    const text = extractText(html);
    expect(text).toBe("line1 line2 line3");
  });

  it("empty: returns empty string for empty body", () => {
    expect(extractText("<html><body></body></html>")).toBe("");
  });
});

// =============================================================================
// siteToPost — D-03 (one site = one Post), D-05 (200-char validation), D-22 (hostname fallback)
// =============================================================================
describe("siteToPost (D-03, D-05, D-22)", () => {
  it("returns null for text < 200 chars (D-05)", () => {
    expect(siteToPost({ url: "https://x.com/" }, "x".repeat(199))).toBeNull();
  });

  it("returns Post for text >= 200 chars (D-05 boundary)", () => {
    const post = siteToPost({ url: "https://x.com/" }, "x".repeat(200));
    expect(post).not.toBeNull();
    expect(post!.text.length).toBe(200);
  });

  it("uses site.name as channelUsername if provided (D-22)", () => {
    const post = siteToPost({ url: "https://x.com/", name: "custom-name" }, "x".repeat(300));
    expect(post!.channelUsername).toBe("custom-name");
  });

  it("derives channelUsername from hostname without www (D-22)", () => {
    const post = siteToPost({ url: "https://www.example.com/news/" }, "x".repeat(300));
    expect(post!.channelUsername).toBe("example.com");
  });

  it("derives channelUsername from hostname for non-www URL", () => {
    const post = siteToPost({ url: "https://oilcapital.ru/" }, "x".repeat(300));
    expect(post!.channelUsername).toBe("oilcapital.ru");
  });

  it("returns Post with messageId=0 (D-03 — no cross-run dedup for web)", () => {
    const post = siteToPost({ url: "https://x.com/" }, "x".repeat(300));
    expect(post!.messageId).toBe(0);
  });

  it("Post.url matches site.url (verifyExtractiveness contract)", () => {
    const url = "https://neftegaz.ru/news/123";
    const post = siteToPost({ url }, "x".repeat(300));
    expect(post!.url).toBe(url);
  });
});

// =============================================================================
// loadWebsites — D-22, D-23, T-03-01 (Zod validation as SSRF mitigation)
// =============================================================================
describe("loadWebsites (D-22, D-23, T-03-01)", () => {
  let workDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), "loadweb-"));
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("throws when websites.json missing", () => {
    expect(() => loadWebsites()).toThrow(/websites\.json not found/);
  });

  it("throws on invalid JSON", () => {
    writeFileSync("websites.json", "{not-valid-json", "utf8");
    expect(() => loadWebsites()).toThrow(/failed to parse/);
  });

  it("throws on Zod fail: non-URL string (T-03-01 SSRF mitigation)", () => {
    writeFileSync("websites.json", JSON.stringify({ websites: [{ url: "not-a-url" }] }), "utf8");
    expect(() => loadWebsites()).toThrow();
  });

  it("throws on empty websites array (Zod min(1))", () => {
    writeFileSync("websites.json", JSON.stringify({ websites: [] }), "utf8");
    expect(() => loadWebsites()).toThrow();
  });

  it("returns parsed array on valid input", () => {
    writeFileSync(
      "websites.json",
      JSON.stringify({ websites: [{ url: "https://x.com/" }, { url: "https://y.com/", name: "y" }] }),
      "utf8"
    );
    const result = loadWebsites();
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe("https://x.com/");
    expect(result[1]!.name).toBe("y");
  });
});

// =============================================================================
// fetchSite — D-15..D-18 (mocked globalThis.fetch)
// =============================================================================
describe("fetchSite (D-15..D-18)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  it("returns body on 200 OK", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>ok</body></html>", { status: 200 })
    );
    const html = await fetchSite("https://x.com/");
    expect(html).toBe("<html><body>ok</body></html>");
  });

  it("throws on non-2xx (D-18 no retry)", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 })
    );
    await expect(fetchSite("https://x.com/")).rejects.toThrow(/HTTP 404/);
  });

  it("aborts on timeout (D-16)", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const sig = (init as RequestInit | undefined)?.signal;
        if (sig) {
          sig.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }
      });
    });
    // 50ms timeout — мгновенно abort'нется
    await expect(fetchSite("https://x.com/", 50)).rejects.toThrow();
  }, 5000);

  it("sends Chrome/120 User-Agent (D-17)", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      capturedHeaders = (init as RequestInit | undefined)?.headers as Record<string, string>;
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    await fetchSite("https://x.com/");
    expect(capturedHeaders?.["user-agent"]).toMatch(/Chrome\/120/);
  });
});

// =============================================================================
// composeWebDigest — D-12: фиксирует контракт split-по-`\n\n`.
// Цель теста: ЕСЛИ кто-то в будущем изменит формат summarize.renderHtml header'а
// (например, добавит ещё одну строку перед body, или поменяет separator),
// этот тест должен поломаться ЯВНО, а не молча сломать прод-сообщение.
// =============================================================================
describe("composeWebDigest (D-12 — contract anchor)", () => {
  it("replaces TG-header with web-header on canonical renderHtml output", () => {
    // Mock-input соответствует текущему формату summarize.renderHtml (lines 199-226):
    // "<b>Нефтегаз — {date}</b>\n<i>{n} постов из {k} каналов за 24ч</i>\n\n<b>🚢 Бункер</b>..."
    const tgInput =
      `<b>Нефтегаз — 6 мая 2026 г.</b>\n` +
      `<i>10 постов из 5 каналов за 24ч</i>\n\n` +
      `<b>🚢 Бункер</b>\n• item one\n\n<b>🛢 Масла</b>\n<i>— нет упоминаний за сутки</i>`;

    const result = composeWebDigest(tgInput, 3, 5);

    // (1) результат начинается с web-header:
    expect(result.startsWith("<b>🌐 Веб-источники")).toBe(true);
    // (2) субзаголовок D-11 присутствует с правильными числами:
    expect(result).toContain("<i>3 сайтов из 5 обработано</i>");
    // (3) body секций сохраняется (буллеты + section headers):
    expect(result).toContain("<b>🚢 Бункер</b>");
    expect(result).toContain("• item one");
    expect(result).toContain("<b>🛢 Масла</b>");
    // (4) старый TG-заголовок «Нефтегаз —» НЕ присутствует (split сработал):
    expect(result).not.toContain("<b>Нефтегаз —");
    expect(result).not.toContain("постов из");
    expect(result).not.toContain("каналов за 24ч");
  });

  it("falls back to full input when separator not found (defensive)", () => {
    // Если formatu summarize.renderHtml сломается (нет `\n\n`), composeWebDigest
    // не упадёт — просто prepend'ит web-header перед всем входом.
    // Тест документирует defensive fallback (idx >= 0 ? ... : summarizedHtml).
    const broken = `<b>some content without separator</b>`;
    const result = composeWebDigest(broken, 1, 1);
    expect(result.startsWith("<b>🌐 Веб-источники")).toBe(true);
    expect(result).toContain("some content without separator");
  });
});
```

После создания: `npx vitest run src/__tests__/web-scraper.test.ts` — все тесты должны быть зелёными.
  </action>
  <acceptance_criteria>
    - `test -f src/__tests__/web-scraper.test.ts` (статус 0)
    - `grep -c "describe\(" src/__tests__/web-scraper.test.ts` >= 5 (extractText, siteToPost, loadWebsites, fetchSite, composeWebDigest)
    - `grep -c "it\(" src/__tests__/web-scraper.test.ts` >= 17 (минимум 17 it-блоков из behavior)
    - `grep -F 'role="main"' src/__tests__/web-scraper.test.ts` (тест cascade-priority)
    - `grep -F 'x.repeat(10_000)' src/__tests__/web-scraper.test.ts || grep -F 'x.repeat(10000)' src/__tests__/web-scraper.test.ts` (тест cap 8000 — D-04)
    - `grep -F 'x.repeat(199)' src/__tests__/web-scraper.test.ts` (тест 200-char boundary — D-05)
    - `grep -F 'www.example.com' src/__tests__/web-scraper.test.ts` (тест hostname stripping — D-22)
    - `grep -F 'not-a-url' src/__tests__/web-scraper.test.ts` (тест Zod fail — T-03-01)
    - `grep -E "vi\.spyOn\(globalThis, .fetch.\)" src/__tests__/web-scraper.test.ts` (mocked fetch для fetchSite-тестов)
    - `grep -F 'Chrome/120' src/__tests__/web-scraper.test.ts` (тест UA — D-17)
    - `grep -E "AbortError|aborted" src/__tests__/web-scraper.test.ts` (тест timeout — D-16)
    - `grep -F 'composeWebDigest' src/__tests__/web-scraper.test.ts` (импорт + тесты)
    - `grep -F '<b>Нефтегаз —' src/__tests__/web-scraper.test.ts` (mock TG-header в composeWebDigest тесте)
    - `grep -F '<b>🌐 Веб-источники' src/__tests__/web-scraper.test.ts` (web-header assertion)
    - `grep -F '<b>🚢 Бункер</b>' src/__tests__/web-scraper.test.ts` (body-preservation assertion)
    - `npx vitest run src/__tests__/web-scraper.test.ts 2>&1 | grep -E "passed"` (все тесты зелёные)
    - `npx vitest run` (все тесты репозитория зелёные — рефактор не задел чужие модули)
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/__tests__/web-scraper.test.ts && npx vitest run</automated>
  </verify>
  <done>
    `src/__tests__/web-scraper.test.ts` содержит ≥17 тестов в 5 describe-блоках, покрывающих cascade/cleanup/cap/200-validation/hostname/Zod/fetch-mock/timeout/UA/composeWebDigest. Все тесты зелёные. `npx vitest run` (весь репозиторий) тоже зелёный.
  </done>
</task>

<task type="auto">
  <name>Task 2: Расширить README.md секцией «Парсинг веб-сайтов»</name>
  <files>README.md</files>
  <read_first>
    - README.md (текущий файл — где вставлять секцию: после секции про каналы, до секции про PM2/deploy если есть)
    - websites.json (формат для документации)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-10/D-11/D-13/D-14 — что Заказчик увидит, D-23 — где файл живёт)
    - CLAUDE.md (project instructions: response_language=russian для документации)
  </read_first>
  <action>
Добавить в `README.md` секцию **«Парсинг веб-сайтов»**. Если в README уже есть секция про каналы (`/channels` бот / `channels.json`) — вставить НОВУЮ секцию ПОСЛЕ неё. Если есть секция «Запуск на VPS / PM2» — вставить ПЕРЕД ней.

Текст секции (на русском, согласно response_language):

```markdown
## Парсинг веб-сайтов

В тот же ежедневный прогон в 20:15 MSK после TG-дайджеста daemon скрейпит публичные веб-сайты из `websites.json` и доставляет отдельный веб-дайджест в канал Заказчика.

### Формат `websites.json`

Файл живёт в корне репо рядом с `channels.json`. Минимальная схема:

```json
{
  "websites": [
    { "url": "https://oilcapital.ru/" },
    { "url": "https://neftegaz.ru/news/", "name": "neftegaz" }
  ]
}
```

- `url` — обязательный, валидируется через `new URL()` (Zod-схема `WebsitesFileSchema` в `src/schema.ts`).
- `name` — опциональный. Используется как идентификатор сайта в дайджесте. Если не задан — берётся `hostname` без префикса `www.`.

Редактирование — вручную (`vim websites.json` + `pm2 restart tg-parser`). Команд бота для управления списком сайтов в текущей версии нет.

### Что Заказчик увидит в канале

После успешного прогона приходят **два сообщения** подряд:

1. **TG-дайджест** — `<b>Нефтегаз — 6 мая 2026 г.</b>` (как раньше, без изменений).
2. **Web-дайджест** — `<b>🌐 Веб-источники — 6 мая 2026 г.</b>` с субзаголовком `<i>X сайтов из Y обработано</i>` и теми же 5 секциями (Бункер / Масла / Керосин / Нефтехимия / Битум) + блок «Упоминания компаний».

Web-сообщение визуально отличается от TG за счёт emoji-маркера 🌐 и слова «Веб-источники».

### Поведение при ошибках

- **Один сайт упал** (network/timeout/<200 chars) — пропускается с записью в лог `[web-scraper] {url}: ...`. Остальные сайты обрабатываются.
- **Все сайты упали** — в канал приходит плейсхолдер «🌐 Веб-источники — {date}» с пустыми секциями + оператору приходит alert в личку (`stage: "web"`).
- **Сайты прошли валидацию, но LLM не нашёл нашей тематики** — веб-сообщение НЕ отправляется (как при пустом TG-прогоне).
- **TG-pipeline упал, web-pipeline не упал** — Заказчик получит только web-дайджест. Оператор получит alert по TG (`stage: "tick"`).

### Архивы

После каждого прогона создаются два дополнительных файла рядом с TG-архивами:

- `data/raw/YYYY-MM-DD-web.json` — массив скрейпленных постов (url + cleaned text) до dedup/LLM.
- `data/output/YYYY-MM-DD-web.md` — финальный HTML web-дайджеста, byte-for-byte идентичный отправленному в канал.

Re-run за тот же день перезаписывает оба файла.

### Конфигурация

Опциональные env-переменные (defaults в `src/web-scraper.ts`):

- `WEB_FETCH_TIMEOUT_MS=10000` — timeout одного fetch'а через AbortController.
- `WEB_USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"` — User-Agent для обхода bot-blockers.

Обязательных новых env-переменных нет.
```

После добавления — `cat README.md | grep -E "Парсинг|websites\.json"` должен находить секцию.
  </action>
  <acceptance_criteria>
    - `grep -F "## Парсинг веб-сайтов" README.md` (секция добавлена)
    - `grep -F "websites.json" README.md` находит как минимум 3 вхождения (Формат, путь, пример редактирования)
    - `grep -F "🌐 Веб-источники" README.md` (формат сообщения D-10)
    - `grep -F "data/output/YYYY-MM-DD-web.md" README.md` (архивы D-20)
    - `grep -F "data/raw/YYYY-MM-DD-web.json" README.md` (архивы D-20)
    - `grep -F "WEB_FETCH_TIMEOUT_MS" README.md` (опциональные env)
    - `grep -F "WEB_USER_AGENT" README.md`
    - `grep -F "vim websites.json" README.md` (D-24: оператор редактирует вручную)
    - `grep -F "stage:" README.md` (объяснение alert поведения)
  </acceptance_criteria>
  <verify>
    <automated>grep -F "## Парсинг веб-сайтов" README.md && grep -c "websites.json" README.md | awk '$1>=3{exit 0}{exit 1}'</automated>
  </verify>
  <done>
    Секция «Парсинг веб-сайтов» добавлена в README.md, описаны: формат websites.json (со ссылкой на channels.json как образец), формат web-сообщения (🌐 заголовок + 5 секций), поведение при ошибках (skipped/placeholder/silence), архивы `-web.json`/`-web.md`, опциональные env.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| README documentation → operator | Документация формата websites.json — направляет оператора к корректному формату |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-13 | Tampering (operator misconfiguration) | README websites.json docs | mitigate | README документирует Zod-схему (`url` required, `new URL()` валидация) — оператор знает, что копипаст невалидного URL приведёт к alert'у, а не silent-skip. Снижает риск операторской ошибки в продакшене |
| T-03-14 | Information Disclosure через тесты | web-scraper.test.ts | accept | Тесты используют `https://x.com/` / `https://example.com/` — не secrets. Mock'ed fetch не делает реальных сетевых запросов |
| T-03-15 | Test reliability (flaky timeout test) | fetchSite timeout test | mitigate | Используем 50ms timeout + AbortController (не реальный сетевой call) — детерминированный исход. Test wrapped в `vi.spyOn` чтобы изолировать от globalThis.fetch state |
| T-03-16 | Silent breakage от рефактора summarize.renderHtml | composeWebDigest | mitigate | composeWebDigest имеет dedicated unit-test (3+ assertions: web-header at start, body sections preserved, TG-header absent). Если кто-то в будущем изменит структуру header'а в renderHtml — тест поломается явно, а не silent в проде |
</threat_model>

<verification>
1. `npx vitest run` — все тесты репозитория зелёные (старые + Plan 01 archive-web + новый web-scraper.test.ts).
2. `src/__tests__/web-scraper.test.ts` имеет ≥17 it-блоков и ≥5 describe-блока.
3. `composeWebDigest` имеет dedicated test-block с проверками: (1) web-header at start, (2) body sections preserved, (3) TG-header absent.
4. `README.md` содержит секцию «Парсинг веб-сайтов» с примером websites.json и ссылками на архивы.
5. Никакие `src/*.ts` файлы не модифицированы (только тест + README).
</verification>

<success_criteria>
- `src/__tests__/web-scraper.test.ts` создан с тестами для extractText (cascade/cleanup/cap), siteToPost (200-char/hostname), loadWebsites (Zod throws), fetchSite (mocked 200/404/timeout/UA), composeWebDigest (split-contract anchor)
- `npx vitest run` зелёный (включая archive-web из Plan 01 и web-scraper из Plan 04)
- README.md содержит секцию «Парсинг веб-сайтов» с описанием формата websites.json, формата веб-сообщения, edge cases (skipped/placeholder/silence), архивов
- Нет правок в `src/*.ts` кроме тестового файла
</success_criteria>

<output>
After completion, create `.planning/phases/03-web-scraping/03-04-SUMMARY.md`.
</output>
