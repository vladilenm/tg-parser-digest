---
phase: 03-web-scraping
plan: 02
type: execute
wave: 2
depends_on:
  - 03-01
files_modified:
  - src/web-scraper.ts
autonomous: true
requirements:
  - WEB-01
  - WEB-02
  - WEB-03
  - WEB-04
tags:
  - scraping
  - cheerio
  - pipeline

must_haves:
  truths:
    - "loadWebsites() читает и Zod-валидирует websites.json"
    - "fetchSite(url) возвращает HTML с 10s timeout, Chrome/120 UA, без retry"
    - "extractText($) применяет cleanup → cascade-select → text → normalize → cap 8000"
    - "siteToPost(...) фильтрует посты с text.length < 200"
    - "runWebPipeline(runId) использует Promise.allSettled для параллельного fetch'а"
    - "runWebPipeline возвращает WebRunSummary с websitesSucceeded/Skipped/digestDelivered"
    - "При 0 валидных сайтах из Y > 0 — placeholder + alert (D-13)"
    - "При relevant=0 после LLM — тишина в канале (D-14)"
    - "Web-сообщение начинается с '<b>🌐 Веб-источники — {date}</b>'"
    - "Субзаголовок '<i>X сайтов из Y обработано</i>'"
    - "composeWebDigest экспортируется отдельно для unit-тестируемости (избегаем silent breakage от внутренних изменений summarize.renderHtml)"
    - "Re-uses sendToChannel, summarize, verifyExtractiveness, escapeHtml, formatDateRu"
  artifacts:
    - path: "src/web-scraper.ts"
      provides: "Web pipeline (loadWebsites, fetchSite, extractText, siteToPost, composeWebDigest, runWebPipeline)"
      exports: ["runWebPipeline", "loadWebsites", "fetchSite", "extractText", "siteToPost", "composeWebDigest"]
      min_lines: 200
  key_links:
    - from: "src/web-scraper.ts"
      to: "websites.json"
      via: "readFileSync + WebsitesFileSchema.parse"
      pattern: "WebsitesFileSchema"
    - from: "src/web-scraper.ts"
      to: "src/summarize.ts"
      via: "import { summarize } — same two-pass DeepSeek"
      pattern: 'from\s+"\./summarize\.js"'
    - from: "src/web-scraper.ts"
      to: "src/deliver.ts"
      via: "import { sendToChannel } — separate web message"
      pattern: 'from\s+"\./deliver\.js"'
    - from: "src/web-scraper.ts"
      to: "src/archive.ts (writeRawWeb / writeOutputWeb)"
      via: "import — D-20"
      pattern: '\{\s*writeRawWeb,\s*writeOutputWeb\s*\}'
---

<objective>
Создать `src/web-scraper.ts` — единый модуль web-pipeline. Он:
1) загружает и валидирует `websites.json` через `WebsitesFileSchema` (D-22, D-23, D-24);
2) параллельно `fetch`'ит все сайты с 10s timeout и Chrome/120 UA через `Promise.allSettled` (D-15..D-18);
3) извлекает текст через `cheerio` cascade-селектор + cleanup + cap 8000 (D-01..D-04);
4) фильтрует невалидные сайты (text.length < 200, fetch fail, extract fail) с логированием (D-05);
5) мапит каждый сайт в один `Post` (D-03), прогоняет через существующий `summarize()` (D-19);
6) рендерит web-сообщение со специфичным заголовком 🌐 + субзаголовок «X из Y» (D-10..D-12);
7) обрабатывает edge cases: все сайты пропустились → placeholder + alert (D-13); relevant=0 → silence (D-14);
8) пишет архивы `data/raw/YYYY-MM-DD-web.json` и `data/output/YYYY-MM-DD-web.md` (D-20, D-21);
9) возвращает `WebRunSummary`.

Purpose: реализовать всю web-функциональность в одном модуле без модификации существующих TG-pipeline артефактов (additive, Phase 3 «can never break phases 1–2»).

Output: `src/web-scraper.ts` (~250 LOC, 6 экспортируемых функций).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-web-scraping/03-CONTEXT.md
@.planning/REQUIREMENTS.md
@CLAUDE.md
@src/types.ts
@src/schema.ts
@src/archive.ts
@src/summarize.ts
@src/deliver.ts
@src/alert.ts
@src/logger.ts
@src/channels-store.ts
@websites.json
@package.json

<interfaces>
<!-- Контракты, которые web-scraper.ts использует. -->

From src/types.ts (Phase 3 Plan 01 — already extended):
```typescript
export interface Post {
  channelUsername: string;
  messageId: number;
  postedAt: string;
  text: string;
  url: string;
}
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

From src/schema.ts (Phase 3 Plan 01 — already extended):
```typescript
export const WebsiteEntrySchema = z.object({ url: z.string().url(), name: z.string().min(1).optional() });
export const WebsitesFileSchema = z.object({ websites: z.array(WebsiteEntrySchema).min(1) });
export type WebsiteEntry = z.infer<typeof WebsiteEntrySchema>;
```

From src/archive.ts (Phase 3 Plan 01 — already extended):
```typescript
export function writeRawWeb(posts: Post[], runId: string): void;
export function writeOutputWeb(html: string, runId: string): void;
```

From src/summarize.ts (existing — re-used as-is per D-19):
```typescript
export async function summarize(posts: Post[], _channelStats?: ChannelStats): Promise<{ html: string; postsDropped: number }>;
export function escapeHtml(s: string): string;
// formatDateRu is private (line 90); we replicate the same Intl.DateTimeFormat pattern.
// renderHtml формат (lines 199-226): "<b>Нефтегаз — {date}</b>\n<i>{n} постов из {k} каналов за 24ч</i>\n\n<b>🚢 Бункер</b>..."
// composeWebDigest полагается на этот формат (split по первому "\n\n").
```

From src/deliver.ts (existing — re-used as-is):
```typescript
export async function sendToChannel(html: string): Promise<void>;
export function chunkHtml(html: string, max?: number): string[];
```

From src/alert.ts (existing — used for D-13 placeholder alert):
```typescript
export interface AlertPayload { stage: string; message: string; runId: string; stack?: string; }
export async function sendAlert(payload: AlertPayload): Promise<void>;
```

From src/logger.ts (existing — re-used):
```typescript
export const log = { info, warn, error };
```

External: cheerio (^1.0.0, добавлено Plan 01)
```typescript
import * as cheerio from "cheerio";
const $ = cheerio.load(html);
$("script, style").remove();
const text = $("body").text();
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Создать src/web-scraper.ts (loadWebsites + fetchSite + extractText + siteToPost)</name>
  <files>src/web-scraper.ts</files>
  <read_first>
    - src/channels-store.ts (lines 1-50 — стиль Zod-валидации + readFileSync паттерн для loadWebsites)
    - src/schema.ts (WebsitesFileSchema — добавлен в Plan 01)
    - src/types.ts (Post, WebRunSummary — добавлены в Plan 01)
    - src/summarize.ts (lines 199-226 — renderHtml формат для понимания split-pattern в Task 2)
    - src/archive.ts (writeRawWeb, writeOutputWeb — добавлены в Plan 01)
    - src/deliver.ts (sendToChannel, chunkHtml)
    - src/alert.ts (sendAlert + AlertPayload)
    - src/logger.ts (log.info/warn/error)
    - websites.json (формат, чтобы в `loadWebsites()` работал happy path)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-01..D-05 extraction strategy, D-15..D-18 fetch behavior, D-22 schema)
  </read_first>
  <action>
Создать новый файл `src/web-scraper.ts`. Структура — module-level helpers, ESM с `.js` импортами, никакого классового DI (carried-over Phase 1 pattern). **Важно: в Task 1 НЕ импортируем `escapeHtml` — он нужен только в Task 2 (для buildWebHeader). Проект использует `tsconfig.json` без `noUnusedLocals` (verified), но всё равно держим импорт чистым по принципу minimal-imports — добавим `escapeHtml` только когда он реально используется в Task 2.** Файл должен содержать:

```typescript
// src/web-scraper.ts — web-scraping pipeline для Phase 3 (v4.0).
// Параллельный аналог src/pipeline.ts: вместо GramJS читает websites.json и делает fetch+cheerio.
// Тот же two-pass DeepSeek pipeline через summarize(), отдельная доставка через sendToChannel.
// Архивы пишутся в data/raw/YYYY-MM-DD-web.json и data/output/YYYY-MM-DD-web.md.

import { readFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";
import type { Post, WebRunSummary } from "./types.js";
import { WebsitesFileSchema, type WebsiteEntry } from "./schema.js";
import { summarize } from "./summarize.js";
import { sendToChannel } from "./deliver.js";
import { writeRawWeb, writeOutputWeb } from "./archive.js";
import { sendAlert } from "./alert.js";
import { log } from "./logger.js";
// NOTE: escapeHtml НЕ импортируем здесь — он добавится в Task 2 при добавлении buildWebHeader.

// D-23: путь захардкожен как константа, не из env.
export const WEBSITES_PATH = "./websites.json";

// D-04: hard cap на размер cleaned text перед отдачей в LLM.
const TEXT_CAP_CHARS = 8000;
// D-05: minimum для валидного сайта — на нормализованном тексте до cap'а.
const MIN_TEXT_CHARS = 200;
// D-16: timeout fetch (env override опционально).
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
// D-17: Chrome/120 UA для обхода bot-blockers на отраслевых сайтах.
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// =============================================================================
// loadWebsites — D-22, D-23: читать ./websites.json и Zod-валидировать.
// На invalid JSON / Zod fail → throw (ловится в runWebPipeline / tick()).
// =============================================================================
export function loadWebsites(): WebsiteEntry[] {
  if (!existsSync(WEBSITES_PATH)) {
    throw new Error(`[web-scraper] websites.json not found at ${WEBSITES_PATH}`);
  }
  const raw = readFileSync(WEBSITES_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[web-scraper] failed to parse ${WEBSITES_PATH}: ${(err as Error).message}`);
  }
  const validated = WebsitesFileSchema.parse(parsed);
  return validated.websites;
}

// =============================================================================
// fetchSite — D-15..D-18: native fetch с AbortController timeout, Chrome/120 UA, без retry.
// На любой fail (network, abort, non-2xx) → throw, ловится Promise.allSettled в runWebPipeline.
// =============================================================================
export async function fetchSite(url: string, timeoutMs?: number): Promise<string> {
  const ms = timeoutMs ?? Number(process.env.WEB_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS);
  const userAgent = process.env.WEB_USER_AGENT ?? DEFAULT_USER_AGENT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "user-agent": userAgent, "accept": "text/html,*/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// extractText — D-01, D-02, D-04: cheerio cleanup → cascade-select → .text() → normalize → cap.
// Cascade selectors (по порядку, берём первый непустой): [role=main] → article → main →
// .post-content → .entry-content → body.
// =============================================================================
export function extractText(html: string): string {
  const $ = cheerio.load(html);
  // D-02: cleanup ДО select. Удаляем меню/футеры/JS-мусор.
  $("script, style, noscript, nav, header, footer, aside, iframe").remove();

  // D-01: cascade-селектор.
  const selectors = ['[role="main"]', "article", "main", ".post-content", ".entry-content", "body"];
  let raw = "";
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    const t = el.text();
    if (t && t.trim().length > 0) {
      raw = t;
      break;
    }
  }

  // Normalize: collapse all whitespace to single spaces.
  const normalized = raw.replace(/\s+/g, " ").trim();

  // D-04: hard cap 8000 chars.
  if (normalized.length > TEXT_CAP_CHARS) {
    log.info(
      `[web-scraper] text capped from ${normalized.length} to ${TEXT_CAP_CHARS} chars`
    );
    return normalized.slice(0, TEXT_CAP_CHARS);
  }
  return normalized;
}

// =============================================================================
// siteToPost — D-03, D-05: один сайт = один Post; null если text.length < 200.
// channelUsername: name (если задан) или hostname без префикса www.
// messageId: 0 (нет cross-run dedup для web в Phase 3, WEB-06 deferred).
// =============================================================================
export function siteToPost(site: WebsiteEntry, text: string): Post | null {
  if (text.length < MIN_TEXT_CHARS) {
    log.warn(
      `[web-scraper] ${site.url}: text too short (${text.length} < ${MIN_TEXT_CHARS} chars) — skipping`
    );
    return null;
  }
  let channelUsername: string;
  if (site.name) {
    channelUsername = site.name;
  } else {
    try {
      channelUsername = new URL(site.url).hostname.replace(/^www\./, "");
    } catch {
      channelUsername = site.url;
    }
  }
  return {
    channelUsername,
    messageId: 0,
    postedAt: new Date().toISOString(),
    text,
    url: site.url,
  };
}

// (продолжение — runWebPipeline + buildWebHeader + composeWebDigest в Task 2)
```

Не реализовывать `runWebPipeline` / helpers'ы для composing'а в этом task — это в Task 2. Запустить `npx tsc --noEmit` чтобы убедиться, что 4 функции компилируются.
  </action>
  <acceptance_criteria>
    - `test -f src/web-scraper.ts` (статус 0)
    - `grep -E '^export const WEBSITES_PATH = "\./websites\.json"' src/web-scraper.ts` (D-23)
    - `grep -E '^export function loadWebsites' src/web-scraper.ts` (D-22)
    - `grep -E '^export async function fetchSite' src/web-scraper.ts` (D-15..D-18)
    - `grep -E '^export function extractText' src/web-scraper.ts` (D-01, D-02, D-04)
    - `grep -E '^export function siteToPost' src/web-scraper.ts` (D-03, D-05)
    - `grep -E "WebsitesFileSchema\.parse" src/web-scraper.ts` (Zod-валидация для T-03-01)
    - `grep -E "AbortController" src/web-scraper.ts` (D-16 timeout)
    - `grep -E "Chrome/120" src/web-scraper.ts` (D-17 UA)
    - `grep -F '[role="main"]' src/web-scraper.ts` (D-01 первый cascade-селектор — fixed-string match)
    - `grep -F 'script, style, noscript, nav, header, footer, aside, iframe' src/web-scraper.ts` (D-02 cleanup-список)
    - `grep -E "TEXT_CAP_CHARS\s*=\s*8000" src/web-scraper.ts` (D-04 cap)
    - `grep -E "MIN_TEXT_CHARS\s*=\s*200" src/web-scraper.ts` (D-05 validation)
    - `grep -E "messageId:\s*0" src/web-scraper.ts` (D-03 один сайт = один Post)
    - `grep -F 'new URL(site.url).hostname' src/web-scraper.ts` (D-22 hostname extraction)
    - `grep -F 'replace(/^www' src/web-scraper.ts` (D-22 www-prefix strip — fixed-string match для проверки литерала)
    - `! grep -F 'escapeHtml' src/web-scraper.ts` (Task 1 НЕ импортирует escapeHtml — он будет добавлен в Task 2)
    - `npx tsc --noEmit` (статус 0 — 4 функции компилируются с strict:true)
    - `grep -c '^import ' src/web-scraper.ts` >= 7 (cheerio + node:fs + types + schema + summarize + deliver + archive + alert + logger)
    - `grep -E '^import \* as cheerio from "cheerio"' src/web-scraper.ts` (D-01: cheerio import)
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && node --import tsx -e 'import("./src/web-scraper.ts").then(m=>{const t=m.extractText("<html><body><nav>menu</nav><article>"+"x".repeat(300)+"</article></body></html>");if(t.length<200||t.length>8000)throw new Error("extractText broken: "+t.length);console.log("ok",t.length)})'</automated>
  </verify>
  <done>
    `src/web-scraper.ts` существует с экспортами `WEBSITES_PATH`, `loadWebsites`, `fetchSite`, `extractText`, `siteToPost`. Все 4 функции работают согласно D-01..D-05, D-15..D-18, D-22. `escapeHtml` ещё не импортирован (добавится в Task 2). `npx tsc --noEmit` чистый.
  </done>
</task>

<task type="auto">
  <name>Task 2: Реализовать runWebPipeline + buildWebHeader + composeWebDigest в src/web-scraper.ts (D-06..D-14, D-19, D-20)</name>
  <files>src/web-scraper.ts</files>
  <read_first>
    - src/web-scraper.ts (свой текущий файл — продолжение из Task 1)
    - src/pipeline.ts (полный файл — образец оркестрации: archive → dedup → summarize → deliver → archive)
    - src/summarize.ts (lines 487-598 — summarize() сигнатура; lines 199-226 — renderHtml формат body — критично для composeWebDigest split-логики)
    - src/deliver.ts (sendToChannel)
    - src/archive.ts (writeRawWeb, writeOutputWeb)
    - src/alert.ts (sendAlert для D-13 placeholder + alert)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-06 entrypoint, D-10..D-14 message format, D-15 Promise.allSettled, D-19 verifyExtractiveness as-is, D-20 archives)
  </read_first>
  <action>
**Шаг 0: Расширить импорт в src/web-scraper.ts** — теперь `escapeHtml` нужен для `buildWebHeader`. Изменить существующую строку импорта summarize:

ДО (Task 1):
```typescript
import { summarize } from "./summarize.js";
```

ПОСЛЕ (Task 2):
```typescript
import { summarize, escapeHtml } from "./summarize.js";
```

**Шаг 1: В КОНЕЦ файла `src/web-scraper.ts`** (после `siteToPost`) дописать функцию `runWebPipeline` плюс **публичный** `composeWebDigest` (экспортируется для unit-testability — иначе хрупкая зависимость на внутренний формат summarize.renderHtml пройдёт незаметно при будущем рефакторе) и приватные helper'ы для построения web-сообщения. Структура:

```typescript
// =============================================================================
// formatDateRu — D-10: тот же формат «6 мая 2026 г.» что в TG-сводке.
// Дублируем (не импортируем) — formatDateRu в summarize.ts private (line 90).
// Вынос в общий helper отложен — tiny-копия проще, чем модулировать ради 8 строк.
// =============================================================================
function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

// =============================================================================
// buildWebHeader — D-10, D-11: web-специфичные заголовок и субзаголовок.
// header: <b>🌐 Веб-источники — {date}</b>
// subheader: <i>X сайтов из Y обработано</i>
// =============================================================================
function buildWebHeader(succeeded: number, total: number): string {
  const date = formatDateRu(new Date().toISOString());
  return (
    `<b>🌐 Веб-источники — ${escapeHtml(date)}</b>\n` +
    `<i>${succeeded} сайтов из ${total} обработано</i>\n\n`
  );
}

// =============================================================================
// buildPlaceholderHtml — D-13: technical-fail placeholder.
// Шлём в канал даже при 0 валидных сайтах, чтобы Заказчик видел «прогон был».
// 5 пустых секций + блок mentions, симметрично пустой TG-сводке.
// =============================================================================
function buildPlaceholderHtml(total: number): string {
  const header = buildWebHeader(0, total);
  const sections = [
    "<b>🚢 Бункер</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>🛢 Масла</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>✈️ Керосин</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>⚗️ Нефтехимия</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>🛣 Битум</b>\n<i>— нет упоминаний за сутки</i>",
    "<b>🏢 Упоминания компаний</b>\n<i>— нет упоминаний за сутки</i>",
  ];
  return header + sections.join("\n\n");
}

// =============================================================================
// composeWebDigest — D-12: вставить web-заголовок (D-10/D-11) в начало body
// от summarize().html, заменив TG-заголовок «Нефтегаз — {date}» который рендерит renderHtml().
// summarize() возвращает полный HTML с шапкой; нам нужен body без неё, плюс свой web-header.
// Стратегия: split по первому `\n\n` (граница header→body в renderHtml), отбрасываем первую часть.
//
// EXPORTED (не private) — чтобы Plan 04 unit-тестами зафиксировал контракт:
//   (1) результат начинается с web-header,
//   (2) body секций сохраняется,
//   (3) TG-заголовок «Нефтегаз —» НЕ присутствует.
// Если будущий рефактор summarize.renderHtml изменит структуру — тест поломается заметно
// (а не silent breakage в проде).
// =============================================================================
export function composeWebDigest(summarizedHtml: string, succeeded: number, total: number): string {
  // renderHtml формат (summarize.ts:199-226): "<b>...</b>\n<i>...</i>\n\n<b>🚢 Бункер</b>..." — отделяем body после первого `\n\n`.
  const sep = "\n\n";
  const idx = summarizedHtml.indexOf(sep);
  const body = idx >= 0 ? summarizedHtml.slice(idx + sep.length) : summarizedHtml;
  return buildWebHeader(succeeded, total) + body;
}

// =============================================================================
// runWebPipeline — D-06: точка входа для tick(). Возвращает WebRunSummary.
// Контракт: НЕ throw на per-site fail (Promise.allSettled), throw только на катастрофу
// (broken websites.json, summarize() crash). tick() обернёт в try/catch (см. Plan 03).
// =============================================================================
export async function runWebPipeline(runId: string): Promise<WebRunSummary> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const errors: string[] = [];

  const websites = loadWebsites();
  log.info(`[web-scraper] runId=${runId} websites=${websites.length}`);

  // D-15: параллельный fetch через Promise.allSettled — изолирует одиночные падения.
  const results = await Promise.allSettled(
    websites.map(async (site) => {
      const html = await fetchSite(site.url);
      const text = extractText(html);
      return { site, text };
    })
  );

  const posts: Post[] = [];
  let websitesSkipped = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const site = websites[i]!;
    if (r.status === "rejected") {
      // D-18: no retry — log + skip + counter.
      const msg = (r.reason as Error)?.message ?? String(r.reason);
      log.warn(`[web-scraper] ${site.url}: ${msg}`);
      errors.push(`${site.url}: ${msg}`);
      websitesSkipped++;
      continue;
    }
    const post = siteToPost(site, r.value.text);
    if (post === null) {
      // D-05: text too short — already logged inside siteToPost.
      websitesSkipped++;
      continue;
    }
    posts.push(post);
  }

  const websitesSucceeded = posts.length;
  log.info(
    `[web-scraper] runId=${runId} succeeded=${websitesSucceeded} skipped=${websitesSkipped}`
  );

  // D-20 step 1: пишем raw СРАЗУ, ДО summarize/dedup/LLM (инвариант «сырое сохранено»).
  writeRawWeb(posts, runId);

  let digestDelivered = false;
  let itemsDropped = 0;

  // D-13 (technical fail): все сайты пропустились — placeholder + alert.
  if (websitesSucceeded === 0 && websites.length > 0) {
    const placeholder = buildPlaceholderHtml(websites.length);
    log.warn(
      `[web-scraper] runId=${runId} all ${websites.length} sites skipped or failed — sending placeholder`
    );
    await sendToChannel(placeholder);
    writeOutputWeb(placeholder, runId);
    digestDelivered = true;
    // Параллельный alert оператору в личку.
    try {
      await sendAlert({
        stage: "web",
        message: `all ${websites.length} sites skipped or failed`,
        runId,
      });
    } catch (alertErr) {
      log.error("[web-scraper] alert send failed", alertErr);
    }
  } else if (websitesSucceeded > 0) {
    // D-19: summarize() переиспользуется как есть, verifyExtractiveness внутри.
    const { html, postsDropped } = await summarize(posts);
    itemsDropped = postsDropped;

    // D-14 (content miss): LLM ничего не нашёл — silence в канале.
    // summarize() возвращает HTML с пустыми секциями всегда; нам нужно отличить
    // «есть items» от «все пустые». Проверяем наличие `• ` в html (буллет item'а).
    const hasAnyItem = html.includes("• ");
    if (!hasAnyItem) {
      log.info(
        `[web-scraper] runId=${runId} no relevant content — silence in channel (D-14)`
      );
    } else {
      const finalHtml = composeWebDigest(html, websitesSucceeded, websites.length);
      await sendToChannel(finalHtml);
      writeOutputWeb(finalHtml, runId);
      digestDelivered = true;
      log.info(`[web-scraper] runId=${runId} web-digest delivered`);
    }
  } else {
    // websites.length === 0 — schema gate (.min(1)) этого не допускает, но для безопасности.
    log.info(`[web-scraper] runId=${runId} no websites configured — skipping`);
  }

  const finishedAt = new Date().toISOString();
  return {
    runId,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    websitesTotal: websites.length,
    websitesSucceeded,
    websitesSkipped,
    itemsCollected: websitesSucceeded,
    itemsDropped,
    digestDelivered,
    errors,
  };
}
```

После добавления — `npx tsc --noEmit` чистый.
  </action>
  <acceptance_criteria>
    - `grep -E '^import \{ summarize, escapeHtml \} from "\./summarize\.js"' src/web-scraper.ts` (impport extended в Task 2)
    - `grep -E '^export async function runWebPipeline\(runId: string\): Promise<WebRunSummary>' src/web-scraper.ts` (D-06 точная сигнатура)
    - `grep -E '^export function composeWebDigest' src/web-scraper.ts` (publicly exported для Plan 04 тестов — защита от silent breakage от рефактора renderHtml)
    - `grep -E "Promise\.allSettled" src/web-scraper.ts` (D-15 параллельный fetch)
    - `grep -F '🌐 Веб-источники' src/web-scraper.ts` (D-10 заголовок)
    - `grep -F 'сайтов из' src/web-scraper.ts` (D-11 субзаголовок)
    - `grep -E 'sendAlert\(' src/web-scraper.ts` (D-13 alert при placeholder)
    - `grep -F 'stage: "web"' src/web-scraper.ts` (D-09: alert stage="web")
    - `grep -F 'all' src/web-scraper.ts | grep -F 'sites skipped or failed'` (D-13 alert message)
    - `grep -E 'writeRawWeb\(posts, runId\)' src/web-scraper.ts` (D-20 step 1)
    - `grep -E 'writeOutputWeb\(' src/web-scraper.ts` найдено как минимум 2 раза (D-20 step 8: placeholder branch + relevant branch)
    - `grep -E 'summarize\(posts\)' src/web-scraper.ts` (D-19 verifyExtractiveness re-use)
    - `grep -F '🚢 Бункер' src/web-scraper.ts` (placeholder секции D-13)
    - `grep -F '🛢 Масла' src/web-scraper.ts`
    - `grep -F '✈️ Керосин' src/web-scraper.ts`
    - `grep -F '⚗️ Нефтехимия' src/web-scraper.ts`
    - `grep -F '🛣 Битум' src/web-scraper.ts`
    - `grep -F '🏢 Упоминания компаний' src/web-scraper.ts`
    - `grep -E 'no relevant content' src/web-scraper.ts` (D-14 silence)
    - `grep -E 'websitesTotal:\s*websites\.length' src/web-scraper.ts` (WebRunSummary возврат)
    - `grep -E 'digestDelivered,?\s*$|digestDelivered,' src/web-scraper.ts` (поле возврата)
    - `grep -E 'durationMs:\s*Date\.now\(\) - startMs' src/web-scraper.ts`
    - `npx tsc --noEmit` (статус 0)
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && node --import tsx -e 'import("./src/web-scraper.ts").then(m=>{if(typeof m.runWebPipeline!=="function")throw new Error("runWebPipeline not exported");if(typeof m.composeWebDigest!=="function")throw new Error("composeWebDigest not exported");console.log("runWebPipeline + composeWebDigest ok")})'</automated>
  </verify>
  <done>
    `runWebPipeline(runId)` экспортирована, корректно реализует D-06..D-14, D-19, D-20: Promise.allSettled fetch, web-заголовок 🌐, placeholder при 0 валидных + alert stage="web", silence при relevant=0, архивы writeRawWeb/writeOutputWeb. `composeWebDigest` экспортирована публично для unit-testability. `escapeHtml` импортирован совместно с `summarize`. `npx tsc --noEmit` чистый.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| websites.json → fetch() | URL валидируется Zod → передаётся в `fetch`. SSRF risk если URL контролируется злоумышленником |
| HTML response → cheerio.load | Внешний HTML парсится cheerio (dom-tree), потенциал prototype pollution |
| cleaned text → summarize() (DeepSeek) | Скрейпленый текст уходит в LLM-prompt; potential prompt injection |
| cleaned text → keyQuote → renderHtml → sendToChannel | Текст из источника попадает в HTML-сообщение Telegram через escapeHtml |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01 | SSRF / URL injection | fetchSite(url) | mitigate | `WebsitesFileSchema.url = z.string().url()` (Plan 01) — отсекает `file://`, `gopher://`, malformed. URL источник — operator-edited file, не runtime-input. fetch использует `redirect: "follow"` (default) — возможен redirect на internal IP, но websites.json контролируется оператором |
| T-03-02 | Prototype pollution / XSS in cheerio | cheerio.load(html) | mitigate | cheerio v1+ поставляется с безопасными defaults (`xmlMode: false`, `decodeEntities: true`); не используем `parse5` low-level. Cleanup `script, style, noscript, iframe` ДО `.text()` (D-02) — JS не выполняется |
| T-03-03 | HTML injection в дайджесте Telegram | composeWebDigest, summarize().html | mitigate | `summarize()` использует `escapeHtml()` (`src/summarize.ts:82`) для всех user-content полей (summary, keyQuote, channel) — carry-over от Phase 1-code D-13. Web-заголовок `composeWebDigest` тоже использует `escapeHtml(formatDateRu(...))`. Inline-маркеры `<b>...</b>` — захардкоженные строки |
| T-03-04 | Prompt injection через scraped content | summarize() Pass 1 / Pass 2 prompts | mitigate | DeepSeek prompts требуют JSON-output (`response_format: json_object`) — text-instruction injection в free-form ответ невозможен. `verifyExtractiveness` (D-19) — последний gate: `Post.text.includes(keyQuote)` отбросит галлюцинации. Если LLM соврёт URL/keyQuote — verifyExtractiveness отбросит item |
| T-03-05 | Resource exhaustion (giant page) | extractText, fetchSite | mitigate | D-04: hard cap `slice(0, 8000)` chars; D-16: 10s `AbortController` timeout. Защищает от страниц-архивов и бесконечных streaming responses |
| T-03-06 | Logged secrets | log.info/warn (web-scraper) | mitigate | Логируются только site.url и счётчики; никаких токенов (TG_BOT_TOKEN/DEEPSEEK_API_KEY) в этом code path |
| T-03-07 | Information Disclosure через AbortController | fetchSite | accept | На abort `fetch` бросает `AbortError` с url'ом сайта — не секрет, идёт в `log.warn` |
| T-03-08 | DNS rebinding attack | fetchSite | accept | В Phase 3 нет аутентифицированных internal endpoints, к которым могла бы привести DNS-перепривязка. Принимаем |
</threat_model>

<verification>
1. `src/web-scraper.ts` существует и экспортирует 7 символов: `WEBSITES_PATH`, `loadWebsites`, `fetchSite`, `extractText`, `siteToPost`, `composeWebDigest`, `runWebPipeline`.
2. `loadWebsites()` валидирует через `WebsitesFileSchema.parse` (T-03-01 mitigation).
3. `fetchSite()` использует `AbortController` с 10s timeout (D-16) и Chrome/120 UA (D-17).
4. `extractText()` применяет cleanup → cascade → normalize → cap 8000 (D-01..D-04).
5. `siteToPost()` возвращает `null` при `text.length < 200` (D-05).
6. `runWebPipeline()` использует `Promise.allSettled` (D-15).
7. `runWebPipeline()` шлёт placeholder + `sendAlert(stage: "web")` при 0 succeeded (D-13).
8. `runWebPipeline()` возвращает silence при `!html.includes("• ")` (D-14).
9. Web-заголовок начинается с `🌐 Веб-источники` (D-10).
10. `composeWebDigest` экспортирована публично — Plan 04 покрывает её unit-тестами для защиты от silent-breakage от рефактора summarize.renderHtml.
11. `npx tsc --noEmit` чистый.
</verification>

<success_criteria>
- 7 экспортов в `src/web-scraper.ts`: `WEBSITES_PATH`, `loadWebsites`, `fetchSite`, `extractText`, `siteToPost`, `composeWebDigest`, `runWebPipeline`
- `loadWebsites()` rejects `{websites:[{url:"not-a-url"}]}` (Zod fail throws — T-03-01)
- `fetchSite("https://httpbin.org/delay/15")` aborts через 10s (можно через mock в Plan 04 тестах)
- `extractText("<html><body><nav>menu</nav><article>"+"x".repeat(300)+"</article></body></html>")` возвращает строку 300 символов без слова "menu"
- `siteToPost({url:"https://x.com/"}, "abc")` возвращает `null` (text.length < 200)
- `siteToPost({url:"https://www.example.com/"}, "x".repeat(300))` возвращает `Post` с `channelUsername: "example.com"` (D-22 hostname fallback)
- `runWebPipeline("test1234")` возвращает `WebRunSummary` со всеми 11 полями
- `composeWebDigest` экспортирована, тестируется в Plan 04
- `npx tsc --noEmit` чистый
</success_criteria>

<output>
After completion, create `.planning/phases/03-web-scraping/03-02-SUMMARY.md`.
</output>
