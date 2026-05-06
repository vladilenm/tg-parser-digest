---
phase: 03-web-scraping
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - README.md
  - package.json
  - scripts/run-once.ts
  - src/__tests__/archive-web.test.ts
  - src/__tests__/web-scraper.test.ts
  - src/archive.ts
  - src/logger.ts
  - src/pipeline.ts
  - src/run.ts
  - src/schema.ts
  - src/types.ts
  - src/web-scraper.ts
  - websites.json
findings:
  critical: 1
  warning: 9
  info: 5
  total: 15
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 3 (web-scraping) добавил параллельный web-pipeline (`src/web-scraper.ts`),
архивные функции `writeRawWeb`/`writeOutputWeb`, `WebRunSummary` и `logWebRunSummary`,
и интегрировал всё в `tick()` (`src/run.ts`). Корневые принципы — изоляция web от TG
(независимые try/catch в tick), Promise.allSettled для per-site fail isolation, Zod-валидация
`websites.json` — реализованы корректно.

Найдено **1 критическая проблема (SSRF-риск)**, **9 warnings** (преимущественно: hard-coded
hrupkij контракт между web-scraper и summarize, документ-рассинхрон README с реальным кодом,
graceful shutdown не отменяет jitter-sleep) и **5 info-замечаний** (дублирование кода,
устаревшие комментарии).

Тесты (`web-scraper.test.ts`, `archive-web.test.ts`) хорошо покрывают unit-уровень:
extractText cascade/cleanup, siteToPost boundary, loadWebsites Zod-throws, fetchSite mock,
composeWebDigest split-contract, archive-web write/overwrite. Слабое место — нет теста
на silent-disable web-дайджеста (см. WR-04).

## Critical Issues

### CR-01: SSRF-вектор через `websites.json` — Zod валидирует только URL-формат, не protocol/host

**File:** `src/schema.ts:67-74`, `src/web-scraper.ts:33-46`
**Issue:** `WebsiteEntrySchema.url` использует `z.string().url()`, который пропускает любую
синтаксически валидную URL — в том числе `http://169.254.169.254/latest/meta-data/`
(AWS/GCP/Timeweb cloud metadata), `http://localhost:6379/`, `http://127.0.0.1/`,
`file:///etc/passwd`, `gopher://...` и т.п.

Комментарий в `schema.ts:65` прямо называет это «security threat T-03-01 SSRF», но текущая
проверка от SSRF не защищает — она блокирует только `"not-a-url"` строки. Атакующий с правом
редактировать `websites.json` (PR-merge, supply-chain, скомпрометированный VDS) может натравить
ежедневный fetch на внутренние ресурсы. На Timeweb VDS это особенно опасно — cloud
metadata-endpoint обычно доступен по `169.254.169.254` без аутентификации.

Дополнительно: `fetchSite` использует `redirect: "follow"` (line 62), значит даже валидный
public URL может перенаправить на private-network адрес (open-redirect chain).

**Fix:** Добавить allowlist protocol + denylist private-network в Zod refinement:

```typescript
// src/schema.ts
const PRIVATE_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd00:/i,
];

export const WebsiteEntrySchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
          if (PRIVATE_HOSTS.some((re) => re.test(parsed.hostname))) return false;
          return true;
        } catch {
          return false;
        }
      },
      { message: "url must be http(s) and not private-network" }
    ),
  name: z.string().min(1).optional(),
});
```

И сменить `redirect: "follow"` на `redirect: "manual"` в `fetchSite` либо после редиректа
повторно валидировать `Location` через ту же функцию.

## Warnings

### WR-01: Graceful shutdown не abort'ит jitter-sleep — daemon может висеть до 30 мин после SIGINT

**File:** `src/run.ts:25-27`, `src/run.ts:107-125`
**Issue:** В `tick()` jitter-окно реализовано как `await new Promise((r) => setTimeout(r, jitterMs))`
длительностью 0-30 минут. `setTimeout` не abort'ится при `task.stop()`. Если SIGINT прилетит
во время jitter-сна, `isRunning=true` (выставлено на line 20), shutdown-loop (line 121-123)
будет крутиться, ожидая `isRunning=false`. Но pipeline ещё даже не стартовал — он стартует
через `jitterMs - elapsed` миллисекунд **после** получения сигнала. PM2 `kill_timeout: 180000`
(3 минуты, README §«Запуск VPS») не покрывает 30-минутный jitter — PM2 пошлёт SIGKILL и
прервёт прогон в середине, потенциально оставив `data/raw/*.json` без `data/output/*.md`.

**Fix:** Хранить `AbortController` в module-level, abort'ить в `shutdown()` и проверять
после sleep:

```typescript
let activeAbort: AbortController | null = null;

async function tick() {
  if (isRunning) { ... }
  isRunning = true;
  activeAbort = new AbortController();
  try {
    const jitterMs = Math.floor(Math.random() * 30 * 60 * 1000);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, jitterMs);
      activeAbort!.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("shutdown"));
      });
    });
    // ... rest of tick
  } catch (e) {
    if ((e as Error).message === "shutdown") {
      log.info("[tick] aborted during jitter sleep");
      return;
    }
    throw e;
  } finally {
    isRunning = false;
    activeAbort = null;
  }
}

const shutdown = async (signal: string) => {
  log.info(`received ${signal}, stopping cron and bot`);
  task.stop();
  activeAbort?.abort();
  // ... existing logic
};
```

### WR-02: `package.json` рассинхронизирован с README — `yaml` декларирован в README, но удалён из deps; `cheerio` в deps, но не упомянут

**File:** `README.md:26`, `package.json:16-22`
**Issue:** README §2 говорит:
> Будет установлено пять runtime-зависимостей: `telegram`, `openai`, `yaml`, `node-cron`, `zod`.

Реальный `package.json`:
- `cheerio` ^1.0.0 — НЕ упомянут в README §2
- `node-cron` ^3.0.3 — упомянут
- `openai` ^4.0.0 — упомянут
- `telegram` ^2.22.0 — упомянут
- `zod` ^3.23.0 — упомянут
- `yaml` — отсутствует, но упомянут в README

Phase 3 добавил cheerio (нужен для extractText), но README не обновлён.
Также README §«Структура проекта» (line 460-487) ссылается на `channels.yaml`, хотя
`pipeline.ts:7` импортирует `channels-store.ts` (`channels.json` + auto-migration).

**Fix:** Обновить README §2 на актуальный список:
```
Будет установлено пять runtime-зависимостей: `telegram`, `openai`, `cheerio`, `node-cron`, `zod`.
```
И §«Структура проекта»: `channels.yaml` → `channels.json` (с пометкой про auto-migration).

### WR-03: README §«Деплой VDS Шаг 4» показывает неправильный cron-schedule

**File:** `README.md:340`
**Issue:** Документация говорит:
> Проверь, что в логах есть `daemon started, schedule: 0 20 * * * Europe/Moscow`

Реальный код (`src/run.ts:76-77`):
```typescript
const task = cron.schedule("15 20 * * *", tick, ...);
log.info("daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter");
```

То есть лог будет `15 20`, а не `0 20`. Оператор, проверяющий по чек-листу README, может
ошибочно думать что daemon настроен неправильно (и наоборот, при опечатке cron на `0 20`
не заметит проблемы).

**Fix:** Обновить README:
```
Проверь, что в логах есть `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter`
```

### WR-04: `hasAnyItem` детектит наличие items по hard-coded `"• "` — silent breakage при изменении bullet-символа

**File:** `src/web-scraper.ts:288-294`
**Issue:**
```typescript
const hasAnyItem = html.includes("• ");
if (!hasAnyItem) {
  log.info(`[web-scraper] runId=${runId} no relevant content — silence in channel (D-14)`);
} else {
  // send digest
}
```

Это хрупкий cross-module контракт с `summarize.renderHtml` — если рефактор сменит bullet
с `• ` на `– `/`*`/inline-теги, `hasAnyItem` всегда вернёт `false`, и web-дайджест
перестанет уходить **молча, без alert**. Тестов на этот контракт нет (в отличие от D-12
contract в `composeWebDigest`).

Дополнительно: `composeWebDigest` уже фиксирует похожий контракт `\n\n` separator с
тестом-anchor'ом (`web-scraper.test.ts:249-282`), но `hasAnyItem` такого anchor'а не имеет.

**Fix:** Возвращать структурированный сигнал из `summarize()` вместо string-grep:

```typescript
// summarize.ts
export async function summarize(posts: Post[]): Promise<{
  html: string;
  postsDropped: number;
  itemsCount: number; // <- добавить
}> { ... }

// web-scraper.ts:282-294
const { html, postsDropped, itemsCount } = await summarize(posts);
itemsDropped = postsDropped;

if (itemsCount === 0) {
  log.info(`[web-scraper] runId=${runId} no relevant content — silence in channel (D-14)`);
} else {
  ...
}
```

Или, как минимум, добавить тест-anchor для `hasAnyItem` (по аналогии с D-12 anchor'ом).

### WR-05: `formatDateRu` в `web-scraper.ts` использует локальный TZ хоста, не MSK

**File:** `src/web-scraper.ts:145-153`
**Issue:**
```typescript
function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "short", year: "numeric"
  }).format(d);
}
```

Без `timeZone` опции `Intl.DateTimeFormat` использует local TZ процесса. На Timeweb VDS
в Москве это совпадёт, но:
- Если контейнер запущен с `TZ=UTC` (Docker default) — header «🌐 Веб-источники — 5 мая 2026 г.»
  отправится в 21:15 MSK (=18:15 UTC), хотя по MSK уже 6 мая.
- README §«Архив прогонов» прямо говорит «дата по MSK».
- `archive.ts:18-27` правильно использует `timeZone: "Europe/Moscow"` для имени файла —
  значит файл будет `data/output/2026-05-06-web.md`, а в HTML заголовке внутри — «5 мая 2026 г.».
  Рассинхрон файла и контента.

**Fix:**
```typescript
function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric", month: "short", year: "numeric",
  }).format(d);
}
```

Также проверить аналогичный код в `summarize.ts` (вне scope этого review, но комментарий
`web-scraper.ts:142-143` явно говорит что `formatDateRu` дублирован — возможно тот же баг).

### WR-06: `logger.ts:34` логирует `postsDropped`, но README §«Ежедневный summary-лог» этого не показывает

**File:** `src/logger.ts:33`, `README.md:393-412`
**Issue:** Реальный output:
```
posts: collected=N deduped=K dropped=M
```
README пример (line 400):
```
posts: collected=412 deduped=5
```
Поле `dropped` (STRUCT-03 LLM-отброс) появилось в Phase 2/3, но не задокументировано
в README. Оператор, увидев `dropped=12`, может не понять что это.

**Fix:** Обновить README §«Ежедневный summary-лог»:
- Добавить `dropped=K` в пример output.
- Добавить пункт в список «Поля» с описанием: «`dropped` — отброшено LLM по STRUCT-03
  (вне 5 категорий и без mentions)».

### WR-07: `redirect: "follow"` в `fetchSite` без host-revalidation

**File:** `src/web-scraper.ts:58-63`
**Issue:** Связано с CR-01 (SSRF). Даже если URL в `websites.json` валиден (например,
`https://oilcapital.ru/`), сервер может отдать 302 → `Location: http://localhost:6379/`
или подобное. `fetch` со `redirect: "follow"` молча перейдёт по этой цепочке. Это
расширяет attack surface CR-01: атакующему не нужно править `websites.json`, достаточно
скомпрометировать DNS/TLS одного из публичных сайтов либо если сайт выдаст редирект.

**Fix:** Либо `redirect: "manual"` + ручная revalidation (см. fix CR-01), либо явный
лимит на число редиректов с проверкой final-URL host'а.

### WR-08: `pipeline.ts` Fisher-Yates мутирует входной массив `channels` от `loadChannels()`

**File:** `src/pipeline.ts:32-35`
**Issue:**
```typescript
const channels: ChannelEntry[] = loadChannels();
...
for (let i = channels.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [channels[i], channels[j]] = [channels[j]!, channels[i]!];
}
```

Если `loadChannels()` кэширует и возвращает shared-reference (а не свежий массив каждый
раз), Fisher-Yates замутит cached state. На один процесс с одним `tick()` (mutex) это
безопасно, но bot-команды (`/channels`, `/add_channel`) могут читать тот же объект
в **середине** перемешивания. Не review'ил `channels-store.ts`, но риск присутствует.

**Fix:** Защитная копия:
```typescript
const channels: ChannelEntry[] = [...loadChannels()];
```

### WR-09: `run.ts` не handle'ит ошибку из самого `tick()` — outer try/catch отсутствует

**File:** `src/run.ts:15-71`, `src/run.ts:76`
**Issue:** В `tick()` есть inner try/catch на TG-pipeline (line 30-47) и web-pipeline
(line 50-67), и outer try/finally сбрасывает `isRunning`. Но если ошибка возникнет
**между** этими блоками или в коде самого jitter-sleep'а (line 25-27), она пробросится
в node-cron callback. В `node-cron@3` unhandled rejection из callback'а сжирается без
лога — daemon будет работать, но без alert владельцу.

Хуже — если `crypto.randomUUID()` бросит (теоретически невозможно, но на edge-runtime
бывало), `isRunning` останется `true` навсегда (выставлено на line 20, finally на line 68
сработает, но сам tick умрёт молча).

**Fix:** Обернуть основное тело tick'а ещё одним try/catch + alert:

```typescript
async function tick(): Promise<void> {
  if (isRunning) { ... return; }
  isRunning = true;
  const runId = crypto.randomUUID().slice(0, 8);
  try {
    try {
      // jitter sleep + TG + web
      ...
    } catch (err) {
      log.error(`[tick] runId=${runId} unexpected tick failure`, err);
      try {
        await sendAlert({ stage: "tick", message: (err as Error).message, runId, stack: (err as Error).stack });
      } catch {}
    }
  } finally {
    isRunning = false;
  }
}
```

## Info

### IN-01: Дублирование `formatDateRu` между `summarize.ts` и `web-scraper.ts`

**File:** `src/web-scraper.ts:142-153`
**Issue:** Комментарий line 142-144 признаёт дубль. При фиксе WR-05 (timezone) нужно будет
поменять в двух местах — легко забыть одно. (См. также CR-01: фикс там добавляет ещё одну
функцию-валидатор, общая поверхность утилит растёт.)
**Fix:** Вынести в `src/utils/date.ts`:
```typescript
export function formatDateRuMsk(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric", month: "short", year: "numeric",
  }).format(d);
}
```
Импортировать из обоих файлов.

### IN-02: `archive-web.test.ts` использует `process.chdir` — глобальное состояние

**File:** `src/__tests__/archive-web.test.ts:26-35`
**Issue:** `beforeEach`/`afterEach` мутируют `process.cwd()`. Vitest по умолчанию
запускает тестовые файлы параллельно (worker pool), но within-file тесты sequential —
безопасно. Однако если когда-нибудь добавят `--pool=threads` + `--isolate=false`, race
вылезет.
**Fix:** Передавать workDir явным параметром в `writeRawWeb(posts, runId, baseDir?)` либо
оставить как есть с явным комментарием про file-level isolation.

### IN-03: `web-scraper.ts:127` — fallback `channelUsername = site.url` при невалидном URL уже мёртвый код

**File:** `src/web-scraper.ts:121-130`
**Issue:**
```typescript
try {
  channelUsername = new URL(site.url).hostname.replace(/^www\./, "");
} catch {
  channelUsername = site.url;
}
```
Но `site.url` уже прошёл `WebsitesFileSchema.parse()` (Zod `.url()`). `new URL()` не
бросит на строке, прошедшей `z.string().url()`. Catch-ветка недостижима.

**Fix:** Удалить try/catch, либо оставить с комментарием «defensive — Zod должен был
отсеять, но на случай рефактора схемы». Если оставлять — добавить `log.warn` в catch,
чтобы рефактор схемы не молча приводил к bizarre channelUsername.

### IN-04: `scripts/run-once.ts` не отправляет alert на ошибку — расхождение с README

**File:** `scripts/run-once.ts:5`, `scripts/run-once.ts:16-19`
**Issue:** Скрипт прямо документирует «exit 1 на ошибку (без отправки alert-бота)» — это
осознанное решение. Однако README §«Как проверить, что всё работает» (line 424) говорит
«При намеренной ошибке... — алерт приходит в личку владельца за ≤60 секунд». Если оператор
проверяет alert'ы через `npm run start:once` (не daemon), alert не придёт и оператор
посчитает что alert-канал сломан.
**Fix:** Либо в README уточнить «через `npm start` (daemon-режим), не `npm run start:once`»,
либо в run-once добавить optional alert flag.

### IN-05: `web-scraper.ts:303` ветка «websites.length === 0» недостижима из-за Zod `.min(1)`

**File:** `src/web-scraper.ts:301-304`
**Issue:** Комментарий это признаёт («schema gate (.min(1)) этого не допускает, но для
безопасности»). Defensive code — допустимо, но за этой веткой никогда не пойдёт control flow.
Можно заменить на `assert(websites.length > 0, "Zod gate violation")` для явной семантики
«unreachable, but prove it».
**Fix:** Не критично; либо заменить на assert, либо оставить с явным `// unreachable`.

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
