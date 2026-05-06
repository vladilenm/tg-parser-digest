# Phase 3: Web Scraping — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

К ежедневному cron-прогону (20:15 MSK + 0–30 min jitter) добавляется блок скрейпинга
веб-сайтов из `websites.json`. Веб-контент извлекается через `cheerio` (без headless
browser), проходит **тот же** two-pass DeepSeek pipeline (`classify` по 5 направлениям →
`summarize` per category) и доставляется **отдельным сообщением** в канал Заказчика
**после** TG-дайджеста. Невалидный/недоступный сайт пропускается с записью в лог,
TG-дайджест доставляется в любом случае; web-pipeline не блокирует и не ломает TG-pipeline.

**Не входит в Phase 3** (см. REQUIREMENTS.md §«Future» / §«Out of Scope»):
- Per-site CSS-селекторы в конфиге (BOT-06 Future) — все сайты обрабатываются единой стратегией
- `@mozilla/readability` как fallback extractor (WEB-05 Future)
- Кросс-прогонная дедупа для web-контента (WEB-06 Future) — каждый прогон LLM видит свежий батч
- Headless browser (Playwright/Puppeteer) — Out of Scope, REQUIREMENTS
- Бот-команды для управления websites.json (нет аналога BOT-01..03 для сайтов в v4.0) — read-only файл

</domain>

<decisions>
## Implementation Decisions

### Cheerio Extraction Strategy

- **D-01:** Cascade-селектор для извлечения text — пробуем по порядку, берём первый
  непустой результат: `[role=main]` → `article` → `main` → `.post-content` →
  `.entry-content` → `body`. Покрывает WordPress/Tilda/обычные SSR-шаблоны без
  per-site CSS-селекторов (BOT-06 отложен). Ranges over per-template heuristics.
- **D-02:** Pre-extraction cleanup — `$('script, style, noscript, nav, header, footer, aside, iframe').remove()`
  ДО `.text()`. Убирает 99% меню/футеров/JS-мусора, не задевает основной контент.
  Чёткая последовательность: cleanup → cascade-select → `.text()` → нормализация
  whitespace (`\s+→' '`).
- **D-03:** Один сайт = один `Post`-эквивалент. Весь извлечённый text упаковывается в
  единую запись `{ url: <исходный>, channelUsername: <hostname или website.name>,
  messageId: 0, postedAt: <ISO now>, text: <cleaned text> }`. LLM в Pass 2 сам решает,
  сколько `items` извлечь из этого Post (обычно 1–3 на длинную статью). Простая модель,
  `verifyExtractiveness()` работает прямо без модификаций.
- **D-04:** Hard cap на размер `text` — `slice(0, 8000)` символов перед отдачей в
  LLM-pipeline. Защищает от «полного архива на главной» (страница со списком 200
  заголовков). Работает с tokens-бюджетом DeepSeek и timeout 120s. При срабатывании —
  `log.info('[web-scraper] {url}: text capped from N to 8000 chars')`.
- **D-05:** Validation 200 символов (WEB-04) — на **нормализованном** text **после**
  cleanup и cascade-select, **до** cap'а. `text.length < 200` → skip + log.warn +
  счётчик `webSitesSkipped`. Не на raw HTML — иначе boilerplate JS/CSS даст
  ложный «прошёл валидацию».

### Daemon Integration

- **D-06:** Web-pipeline живёт в новом `src/web-scraper.ts`, экспортирует
  `runWebPipeline(runId: string): Promise<WebRunSummary>`. Вызывается из `tick()`
  в `src/run.ts` **после** `runPipeline()` в **отдельном** try/catch. Чистая isolation:
  TG-дайджест уже доставлен (или зафейлился) к моменту start'а web-фазы.
- **D-07:** Один общий `runId` на tick. `tick()` генерирует `runId` через
  `crypto.randomUUID().slice(0,8)`, прокидывает в `runPipeline(runId)` и
  `runWebPipeline(runId)`. Лёгкий рефактор: `runPipeline` сейчас сам генерирует runId
  внутри (`pipeline.ts:21`) — выносим параметром. С т.з. оператора 6 мая 2026 в 20:15
  это **один** прогон, фильтрация логов одним `grep runId=`.
- **D-08:** Web-pipeline запускается **независимо** от исхода TG-pipeline. Если
  `runPipeline()` упал — `tick()` ловит, шлёт alert через `sendAlert({stage:"tick", ...})`,
  и **продолжает** к `runWebPipeline()`. Заказчик получит хотя бы web-сводку.
  Симметрично: если web упал, TG уже доставлен. Соответствует spirit'у success
  criteria #2 («TG-дайджест доставляется в любом случае»).
- **D-09:** Отдельный alert-stage `"web"` для web-failure: `sendAlert({stage:"web", message, runId, stack})`.
  Владелец сразу видит по тексту алерта что именно упало (TG vs web), не парсит
  message. Симметрично существующим `stage:"pipeline"`/`stage:"tick"`/`stage:"bot"`.

### Web Message Format

- **D-10:** Заголовок отдельного веб-сообщения — `<b>🌐 Веб-источники — {date}</b>`
  где `{date}` = MSK-дата прогона в формате «6 мая 2026 г.» (та же `formatDateRu`
  что в `src/summarize.ts:90`). Параллельно TG-заголовку «Нефтегаз — 6 мая 2026 г.»,
  но с явным emoji-маркером 🌐 и словом «Веб-источники» — Заказчик не путает.
- **D-11:** Субзаголовок (`<i>...</i>` строка после header'а) — «X сайтов из Y
  обработано» где X = количество сайтов прошедших валидацию (text ≥ 200 chars,
  fetch успех, extraction успех), Y = total в `websites.json`. Показывает «missed»-инфо
  Заказчику, не только в логах.
- **D-12:** Структура секций — **те же** 5 фиксированных категорий + «Упоминания
  компаний» что в TG-дайджесте: `🚢 Бункер / 🛢 Масла / ✈️ Керосин / ⚗️ Нефтехимия /
  🛣 Битум / 🏢 Упоминания компаний`. Тот же `renderHtml()` (или близкий клон) с теми
  же inline-маркерами `<b>[РОСНЕФТЬ]</b>`. **Только** заголовок меняется (D-10) и
  субзаголовок (D-11).
- **D-13:** Если **все** сайты пропустились (0 валидных из Y > 0) — **слать плейсхолдер**
  `🌐 Веб-источники — {date}` + субзаголовок `0 сайтов из Y обработано` + 5 пустых
  секций «— нет упоминаний за сутки» + блок mentions. Заказчик видит «прогон был».
  Параллельно — `sendAlert(stage:"web", message:"all N sites skipped or failed")`
  оператору в личку. Цель: оператор знает что есть проблема, Заказчик видит факт прогона.
- **D-14:** Если сайты прошли валидацию, но **LLM** дал `relevant=0` (все Posts с
  `category=null` и `mentions=[]`) — **НЕ слать** веб-сообщение. `log.info('[web] no relevant content')`
  и тишина в канале. Симметрично TG-pipeline'у который при `allPosts.length===0` тоже
  не дёргает Telegram (`pipeline.ts:115-117`). Различие с D-13:
  - **D-13 (technical fail)** = плейсхолдер + alert. Сайты не отдали контент.
  - **D-14 (content miss)** = тишина. Сайты ОК, но новостей по нашей тематике нет.

### Fetch Behaviour

- **D-15:** Параллельный fetch всех сайтов через `Promise.allSettled`. Без лимита
  concurrency (ожидаем 5–15 сайтов в `websites.json` v4.0; разные хосты —
  per-host rate-limit не пересекается). ~3s total vs ~15s sequential. `Promise.allSettled`
  изолирует одиночные падения (network/timeout/parse) от соседних.
- **D-16:** Timeout `10000ms` через `AbortController` + `setTimeout(controller.abort, 10_000)`.
  Покрывает быстрые сайты и SSR-рендер; режет висящие соединения. При abort'е →
  skip + log + счётчик. Симметрично GramJS-таймаутам в `src/telegram.ts`, но проще
  (без exp.backoff — fail fast).
- **D-17:** User-Agent — браузерный Chrome/120:
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`.
  Обходит дефолтные bot-blockers на отраслевых сайтах (РБК, neftegaz.ru и т.п.).
  Принимаем риск: некоторые сайты блокируют не-браузерные UA, identifying UA
  (`tg-parser-demo/1.0`) был бы честным, но overkill для парса публичных сводок.
- **D-18:** Без retry на network fail. `fetch` упал → `log.warn('[web] {url}: {message}')` →
  skip → `webSitesSkipped++` → продолжаем `Promise.allSettled`. Соответствует
  success criteria #2 буквально. Следующий прогон в 20:15 MSK = равносильный retry.

### Extractive Verification (carried from v3.0 Core Value)

- **D-19:** `verifyExtractiveness(digest, posts)` (`src/summarize.ts:106`) применяется
  **без модификаций** — keyQuote проверяется как `Post.text.includes(keyQuote)` где
  `Post.text` = нормализованный cleaned text после D-02..D-04. Success criteria #3
  («keyQuote дословно в HTML исходной страницы») трактуем как «дословно в извлечённом
  cleaned text», поскольку это и есть то, что LLM видел и из чего цитировал.
  Альтернатива (проверять по raw HTML) — overkill: cheerio cleanup не меняет видимый
  текст, только удаляет markup и nav/footer.

### Archive (carried from v3.0 ARCH-01/ARCH-02)

- **D-20:** Web-archives пишутся **отдельными файлами** с suffix'ом `-web`:
  - `data/raw/YYYY-MM-DD-web.json` — массив `Post`-эквивалентов после fetch+extraction
    (по аналогии с TG `data/raw/YYYY-MM-DD.json`). Пишется ДО dedup/LLM, инвариант
    «сырое сохранено даже если остаток упал» (Phase 1-code D-09).
  - `data/output/YYYY-MM-DD-web.md` — финальный HTML web-дайджест **byte-for-byte**
    идентичный отправленному (Phase 1-code D-09 step 8). Пишется ПОСЛЕ успешной
    `sendToChannel`. Re-run за тот же день — перезапись (D-11 carried).
- **D-21:** Реализация — лёгкое расширение `src/archive.ts`: новые функции
  `writeRawWeb(posts, runId)` / `writeOutputWeb(html, runId)` копируют существующий
  паттерн `writeRaw`/`writeOutput` с `-web`-suffix'ом. Атомарная запись `.tmp+rename`,
  MSK-дата (D-10 carried).

### websites.json Schema & Storage

- **D-22:** Формат — минимизм по аналогии с `channels.json`:
  ```json
  { "websites": [
      { "url": "https://oilcapital.ru/" },
      { "url": "https://neftegaz.ru/news/", "name": "neftegaz" }
  ] }
  ```
  - `url: string` (required, валидируется через `new URL()`).
  - `name?: string` (optional). Используется как `Post.channelUsername` для
    inline-ссылки в дайджесте. Если не задан — берётся `new URL(url).hostname.replace(/^www\./, '')`.
  - Никаких version-обёрток, audit-полей, category-hints (BOT-06 Future).
- **D-23:** Файл живёт в корне репо как `./websites.json` (path захардкожен в
  `src/web-scraper.ts` константой). Read-only (нет ботовых команд для управления
  сайтами в Phase 3). Validation через Zod при чтении (стиль Phase 1
  `channels-store.ts`). На invalid JSON / Zod fail → `throw` → ловится в `tick()`
  catch → `sendAlert(stage:"web")`.
- **D-24:** **Не** заводим `websites-store.ts` с mutex/CRUD API. Сайты редактируются
  оператором вручную через `vim websites.json` + `pm2 restart`. Phase 1 mutex был
  оправдан concurrent-доступом бота и cron к `channels.json`; для `websites.json`
  таких consumer'ов нет. YAGNI.

### Claude's Discretion

Planner/researcher решает по best-practice без обращения к оператору:

- **Структура `src/web-scraper.ts`** — single-file ~200 LOC: `loadWebsites()` (Zod
  read), `fetchSite(url)` (Promise<{html, status}>), `extractText($)`
  (cascade-cleanup), `siteToPost(url, name?, text)`, `runWebPipeline(runId)` —
  координатор, вызывает `summarize()` из существующего модуля и `sendToChannel()`
  из `deliver.ts`.
- **Имя env-переменной** для timeout/UA override — если planner посчитает нужным
  (`WEB_FETCH_TIMEOUT_MS`, `WEB_USER_AGENT`), допустимо сделать env-driven с
  D-16/D-17 как defaults. Симметрично существующим `MAX_MESSAGES_PER_CHANNEL`,
  `CHANNEL_DELAY_MS`.
- **`WebRunSummary` тип** — отдельная структура (`websitesTotal`,
  `websitesSucceeded`, `websitesSkipped`, `itemsCollected`, `itemsDropped`,
  `digestDelivered`, `errors[]`) рядом с `RunSummary` в `src/types.ts`.
  `logRunSummary` расширяется или появляется `logWebRunSummary` — на усмотрение
  planner'а.
- **Деление `summarize()`** — для web используется тот же `summarize(posts)` что и
  для TG. Если LLM-prompts для web нужно адаптировать (например, web-статьи длиннее
  и нужно явно сказать LLM «one Post может породить несколько items одной категории»),
  это решает researcher и/или planner. Default: используем как есть.
- **Vitest unit tests** — `src/__tests__/web-scraper.test.ts`: cascade-select на
  fixture-HTML (article-only, main-only, body-only, empty), cleanup (script/nav
  удалены), 200-char validation, 8000-char cap, hostname-derivation для
  `channelUsername`, mocked `fetch` для `Promise.allSettled` сценария
  (1 OK / 1 timeout / 1 <200chars / 1 4xx).
- **`.env.example` дополнения** — никаких новых обязательных env. Возможно
  опциональные `WEB_FETCH_TIMEOUT_MS=10000`, `WEB_USER_AGENT="Mozilla/5.0 ..."` с
  комментарием.
- **`package.json`** — добавить `"cheerio": "^1.0.0"` в `dependencies`. 5-я
  runtime-dep, зафиксирована в STATE.md «Key Decisions (v4.0)».
- **`.gitignore`** — `data/` уже игнорируется с v3.0; новых записей не нужно.
  `websites.json` коммитится (по аналогии с `channels.json`).

### Folded Todos

Cross-reference todo'шек по Phase 3 вернул 0 совпадений (никаких pending-todo по
web-scraping в проекте не зафиксировано). Раздел не нужен.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §«Phase 3: Web Scraping» — goal, depends-on (Phase 1),
  success criteria 1–3
- `.planning/REQUIREMENTS.md` §«Web Scraping (WEB)» — WEB-01..WEB-04 полные
  формулировки + Future WEB-05 (readability) / WEB-06 (web hash-cache); §«Out of Scope»
  (headless browser, БД)
- `.planning/PROJECT.md` §«Constraints» (runtime-deps cap = 4 → 5 c cheerio),
  §«Out of Scope» (Docker, БД, multi-tenancy, abstractions)
- `.planning/STATE.md» §«Key Decisions (v4.0)» — cheerio как единственная новая
  runtime-dep; Phase 3 «can never break phases 1–2» (additive)

### Prior phase context (carried forward, NOT re-asked)
- `.planning/phases/01-storage-migration/01-CONTEXT.md» §«JSON Schema» — стиль
  Zod-валидации для `websites.json` (D-22), §«Atomic Writes» — `.tmp+rename` (D-21)
- `.planning/phases/01-code/01-CONTEXT.md» — D-02..D-04 (5 категорий + mentions
  заголовки), D-09 (lifecycle archive→LLM→deliver→commit), D-10 (MSK даты), D-11
  (re-run перезапись), D-12..D-15 (alert-обёртка в `tick()`, await sendAlert),
  D-17 (atomic `.tmp+rename`)
- `.planning/phases/02-bot-commands/02-CONTEXT.md» §«Daemon Integration» —
  существующий `tick()` ловит exception и вызывает `sendAlert`; web-pipeline
  следует тому же паттерну с `stage:"web"`

### Existing code to read/extend
- `src/run.ts:14-48` (`tick()`) — точка интеграции `runWebPipeline` ПОСЛЕ
  `runPipeline`. Нужен лёгкий рефактор: `runId` генерируется в `tick()` и
  прокидывается параметром (сейчас живёт внутри `pipeline.ts:21`)
- `src/pipeline.ts` — после рефактора `runPipeline(runId)` принимает runId
  аргументом; внутри `crypto.randomUUID().slice(0,8)` исчезает (line 21);
  всё остальное без изменений
- `src/summarize.ts» (полностью) — переиспользуется как есть. `summarize(posts)`
  вызывается дважды на tick: один раз для TG `freshPosts`, второй раз для web
  `webPosts`. Тот же two-pass classify+summarize, та же `verifyExtractiveness`,
  тот же `renderHtml` (заголовок MTL переопределяется в `runWebPipeline`)
- `src/deliver.ts» (полностью) — `sendToChannel(html)` переиспользуется. Один
  `TG_BOT_TOKEN` + `TG_CHANNEL_ID` (Phase 2 D-01: один токен и для delivery,
  и для бота). Web-сообщение — отдельный вызов `sendToChannel` после TG.
- `src/archive.ts:34-39` (`atomicWriteText`), `src/archive.ts:18-27` (`todayMsk`)
  — переиспользовать для web-archives (D-21). Возможно вынести в helpers или
  скопировать в новую функцию.
- `src/alert.ts:8-13` (`AlertPayload`) — `stage` уже string, передаём `"web"`
  без модификаций типа
- `src/logger.ts» — `log.info/warn/error` с префиксом `[web-scraper]` или `[web]`
- `src/types.ts» — `Post` тип. **НЕ** меняем для совместимости с TG-pipeline,
  web сайт мапим в `Post` по D-03. Добавить `WebRunSummary` интерфейс рядом с
  `RunSummary` (Claude's discretion на состав полей)
- `src/schema.ts» — стиль Zod-валидации. Добавить `WebsitesFileSchema` (для
  `websites.json` Zod-парса) — отдельным экспортом
- `src/__tests__/» — место для `web-scraper.test.ts`

### Test/build infrastructure
- `vitest.config.ts» — без изменений
- `tsconfig.json» — `strict: true`, ESM, `moduleResolution: bundler` — новый
  модуль обязан соответствовать
- `package.json» — добавить `"cheerio": "^1.0.0"` в `dependencies` (5-я
  runtime-dep, утверждено в STATE.md)

### External docs
- https://cheerio.js.org/docs/intro — основной API (load, $, .text(), .remove())
- https://cheerio.js.org/docs/basics/loading — варианты загрузки HTML
- https://developer.mozilla.org/en-US/docs/Web/API/AbortController — паттерн
  для timeout-implementation на native `fetch`

### Source data
- `channels.json» (корень репо) — формат-референс для `websites.json` (минимизм
  Zod-схема `{ websites: [{ url, name? }] }`, D-22)
- `websites.json» — будет создан в Phase 3 (planner определит, входит ли seed-список
  в этот phase или это операторская задача поверх). Минимум для тестов: 5 публичных
  отраслевых сайтов

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (without modification)

- **`summarize(posts, channelStats?)`** в `src/summarize.ts:487` — two-pass
  DeepSeek pipeline. Web-pipeline вызывает идентично, передавая массив
  `Post`-эквивалентов из cheerio extraction. Возвращает `{html, postsDropped}`.
- **`verifyExtractiveness(digest, posts)`** в `src/summarize.ts:106` —
  серверная проверка `Post.text.includes(keyQuote)`. Работает прямо для
  web-Posts (D-19), потому что `Post.text` = cleaned cheerio text.
- **`renderHtml(digest, posts)`** в `src/summarize.ts:199` — рендерит 5
  фиксированных секций + mentions. Для web нужен **другой заголовок** (D-10)
  и **другой субзаголовок** (D-11) — либо параметризовать `renderHtml`, либо
  написать `renderWebHtml` в `web-scraper.ts` который зовёт `renderHtml` для
  body и склеивает свои header'ы.
- **`sendToChannel(html)`** в `src/deliver.ts:49` — переиспользуется, тот же
  `TG_BOT_TOKEN` + `TG_CHANNEL_ID` (Phase 2 D-01). Web-сообщение — отдельный
  вызов после TG-доставки.
- **`chunkHtml(html, max)`** в `src/deliver.ts:18` — нарезка по 4000 chars при
  переполнении. Web-дайджест с 5 сайтами обычно < 4000 chars; chunkHtml
  сработает прозрачно.
- **`atomicWriteText(path, content)`** в `src/archive.ts:34-39` — копируем
  паттерн в новые `writeRawWeb`/`writeOutputWeb` (или extend existing с
  suffix-параметром).
- **`todayMsk()`** в `src/archive.ts:18-27` — MSK-дата для archive-paths,
  переиспользуется без изменений.
- **`sendAlert(payload)`** в `src/alert.ts:20` — `stage:"web"` принимается без
  модификаций (тип `string`).
- **`escapeHtml(s)`** в `src/summarize.ts:82` — для web-заголовка экранирование
  `name`/`hostname` если они содержат `&`/`<`/`>`.
- **`formatDateRu(iso)`** в `src/summarize.ts:90` — единый формат «6 мая 2026 г.»
  для TG и web заголовков.
- **`log.info/warn/error`** в `src/logger.ts` — префикс `[web-scraper]` или
  `[web]` симметрично `[pipeline]`/`[bot]`/`[alert]`/`[channels-store]`.

### Established Patterns

- **ESM + `.js` суффиксы в импортах** — `import { x } from "./web-scraper.js"`.
  Обязательно (`moduleResolution: bundler`).
- **Module-level helpers, no DI** — `web-scraper.ts` экспортирует функции,
  никакого классового DI.
- **Stage-prefixed logs** — `log.info('[web-scraper] fetched {url} → {N} chars')`.
- **Атомарная запись `.tmp+rename`** — для всех файловых записей (D-21).
- **In-memory state без persistence** — никакого state'а между прогонами для
  web в Phase 3 (web hash-cache отложен в WEB-06).
- **`Promise.allSettled`** — в `src/summarize.ts:540` уже паттерн для
  параллельных LLM-вызовов; web-fetch использует тот же стиль.
- **`AbortController` для timeout** — паттерн `fetch + setTimeout(abort, ms)`,
  не в проекте сейчас, но стандартный (Node 20+).
- **Zod-валидация при чтении** — `channels-store.ts` (Phase 1 D-02), web-scraper
  применяет аналогично для `websites.json`.

### Integration Points

- **`src/run.ts:14-48`** (`tick()`) — рефактор: `runId = crypto.randomUUID().slice(0,8)`
  поднимается на уровень `tick()`; вызывается `runPipeline(runId)` в одном
  try/catch, затем `runWebPipeline(runId)` в другом try/catch. Существующий
  `try { ... } catch (err) { sendAlert(stage:"tick", ...) }` разбивается на
  два независимых блока. `logRunSummary(summary)` после TG, `logRunSummary(webSummary)`
  после web (или `logWebRunSummary`).
- **`src/pipeline.ts:20-21`** — `runPipeline(): Promise<RunSummary>` →
  `runPipeline(runId: string): Promise<RunSummary>`. Удалить
  `crypto.randomUUID().slice(0,8)` на line 21. Никаких других изменений.
- **`src/types.ts`** — добавить `WebRunSummary` интерфейс рядом с `RunSummary`.
  Поля: `runId, startedAt, finishedAt, durationMs, websitesTotal,
  websitesSucceeded, websitesSkipped, itemsCollected, itemsDropped,
  digestDelivered, errors[]`. Существующий `Post` НЕ меняем.
- **`src/schema.ts`** — добавить `WebsitesFileSchema = z.object({ websites: z.array(z.object({ url: z.string().url(), name: z.string().min(1).optional() })).min(1) })`.
- **`src/archive.ts`** — добавить `writeRawWeb(posts, runId)` и
  `writeOutputWeb(html, runId)` — копии существующих функций с `-web` суффиксом
  в имени файла. Переиспользуют `atomicWriteText` и `todayMsk` (либо вынести
  их в helpers если копирование становится тяжёлым).
- **`src/logger.ts`** — `logRunSummary` существует для `RunSummary`. Возможно
  добавить `logWebRunSummary` или расширить существующий через union type
  (Claude's discretion).
- **`package.json`** — `"cheerio": "^1.0.0"` в `dependencies`. 5-я runtime-dep.
- **`websites.json`** — новый файл в корне; planner решит, входит ли seed-список
  в Phase 3 или это операторская задача поверх.
- **`README.md`** — секция «Парсинг веб-сайтов» (1 страница: что такое,
  как редактировать `websites.json`, ссылка на `data/output/*-web.md`).

</code_context>

<specifics>
## Specific Ideas

- **Web-сводка ДОЛЖНА визуально отличаться от TG-сводки.** Заказчик получает два
  сообщения подряд после 20:15 MSK. Один и тот же формат секций (5 категорий) —
  риск спутать. Заголовок «🌐 Веб-источники — 6 мая 2026 г.» с явным emoji —
  главный различитель.
- **Один сайт = один Post — компромисс простоты vs точности.** Альтернатива
  «парсить список новостей по article/h2» хрупка на разных templates и фактически
  это per-site селекторы (BOT-06 Future). LLM в Pass 2 неплохо извлекает 2–3
  items из длинной cleaned-страницы, а лишние шапки/футеры мы убираем в D-02.
- **Пустые случаи различаются осознанно (D-13 vs D-14).** «Все сайты упали»
  (technical) → плейсхолдер + alert. «Сайты ОК, LLM не нашёл нашей тематики»
  (content) → тишина. Разная природа, разные UX-сообщения. Это не баг — это
  фича UX.
- **`runWebPipeline` запускается даже если TG упал.** Edge case: DeepSeek API
  недоступен → TG падает → web-pipeline тоже зовёт DeepSeek → web падает.
  Получаем два алерта за одну минуту. Это допустимо: два независимых stage,
  два независимых alert'а владельцу — оператор сразу понимает что отвалился
  внешний сервис, не часть нашего кода.

</specifics>

<deferred>
## Deferred Ideas

Идеи, которые всплыли в обсуждении и не входят в Phase 3.

- **Per-site CSS-селекторы** в `websites.json» (`{ url, selector: ".post-body" }`)
  — BOT-06 Future, REQUIREMENTS.md. Phase 3 использует cascade-fallback (D-01).
  Re-открыть, если cascade покажет ложные пропуски/мусор на 7-day smoke.
- **`@mozilla/readability` как fallback extractor** — WEB-05 Future. Phase 3
  проверяет, насколько cheerio cascade покрывает реальные отраслевые сайты;
  если будет много <200char-skip'ов на нормальных сайтах — readability
  оправдан. Re-открыть после 1-week наблюдений.
- **Кросс-прогонная дедупа для web** (hash-cache как для TG) — WEB-06 Future.
  Phase 3 не реализует — каждый прогон LLM видит свежий батч. Re-открыть, если
  Заказчик пожалуется на повторы web-новостей между сутками.
- **Headless browser** — Out of Scope, REQUIREMENTS. Целевые сайты — статический
  HTML.
- **Бот-команды для управления `websites.json»** (нет аналога BOT-01..03 для
  сайтов в v4.0). Re-открыть, если `vim websites.json` начнёт раздражать
  оператора.
- **Сжатие/архивация старых `data/output/*-web.md`** — отложено в backlog v3.0,
  применимо и к web-output. Re-открыть при росте директории `data/`.
- **Отдельный alert при `webSitesSkipped > 50%`** (мягкий «обрати внимание»
  алерт) — отложено. Phase 3 алертит только D-13 (0 валидных).
- **Retry на network fail** — отклонено в пользу fail-fast (D-18). Re-открыть,
  если оператор пожалуется на временные network-фейлы.
- **`messageId` как хеш URL** для web-Posts вместо `0` — micro-optimization,
  не нужно в Phase 3 (нет cross-run dedup для web).
- **Параметризация `renderHtml` через header/subheader-аргументы** для
  переиспользования между TG и web — Claude's discretion на planner.

### Reviewed Todos (not folded)

Cross-reference вернул 0 совпадений с pending-todos — раздел не нужен.

</deferred>

---

*Phase: 03-web-scraping*
*Context gathered: 2026-05-06*
