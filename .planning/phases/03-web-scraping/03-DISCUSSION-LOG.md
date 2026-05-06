# Phase 3: Web Scraping — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 3-web-scraping
**Areas discussed:** Cheerio extraction, Daemon integration, Web message format, Fetch behaviour

---

## Gray Areas Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Cheerio extraction | Стратегия извлечения text: selector chain (article/main/body), cleanup, нормализация — определяет, как keyQuote-проверка работает | ✓ |
| Daemon integration | Где живёт web-pipeline: внутри runPipeline после TG, отдельная runWebPipeline, параллельно? Один runId или два? Failure isolation | ✓ |
| Web message format | Заголовок отдельного веб-сообщения, что в шапке, что слать если ВСЕ сайты пропустились | ✓ |
| Fetch behaviour | Параллельность, timeout, User-Agent, sleep+jitter между запросами | ✓ |

**User's choice:** все 4 области.

---

## Cheerio extraction

### Q1: Какой основной селектор cheerio извлекает text со страницы?

| Option | Description | Selected |
|--------|-------------|----------|
| Fallback chain article → main → body | Простая цепочка, покрывает ~80% отраслевых сайтов | |
| Только body, без fallback | $('body').text() всегда — простейший, но захватывает nav/footer/cookie-banner | |
| Cascade с богатым выбором | [role=main] / article / main / .post-content / .entry-content / body | ✓ |

**User's choice:** Cascade с богатым выбором — точнее покрывает WordPress/Tilda templates.

### Q2: Что вырезаем из cheerio-DOM перед извлечением text?

| Option | Description | Selected |
|--------|-------------|----------|
| Standard cleanup | $('script, style, noscript, nav, header, footer, aside, iframe').remove() | ✓ (Recommended) |
| Минимум — только script/style | Только JS-мусор; пропускает nav/footer | |
| Aggressive — всё кроме основного блока | Дополнительно .ad, .banner, .cookie-banner, .related, .comments, .share | |

**User's choice:** Standard cleanup.

### Q3: Один сайт = один «Post» или попытка распарсить список новостей?

| Option | Description | Selected |
|--------|-------------|----------|
| Один сайт = один Post | Весь text страницы упаковывается в единый Post; LLM в Pass 2 решает сколько items извлечь | ✓ (Recommended) |
| Распарсить список новостей (article/h2) | $('article').each() → каждый = отдельный Post; хрупко на разных templates | |

**User's choice:** Один сайт = один Post.

### Q4: Нужен ли hard-cap на размер извлечённого text на сайт (для бюджета LLM)?

| Option | Description | Selected |
|--------|-------------|----------|
| Cap 8000 символов | .slice(0, 8000) + log при срабатывании | ✓ (Recommended) |
| Без cap'а | DeepSeek 128K context выдержит, но timeout 120s и стоимость растёт | |
| Мягкий cap 4000 символов | Прямое отражение 4096-лимита Telegram-поста | |

**User's choice:** Cap 8000 символов.

---

## Daemon integration

### Q1: Где живёт web-pipeline и как вызывается?

| Option | Description | Selected |
|--------|-------------|----------|
| Отдельная runWebPipeline() после runPipeline() | Новый src/web-scraper.ts; tick() вызывает оба в отдельных try/catch | ✓ (Recommended) |
| Внутри runPipeline() после sendToChannel | Один файл, один runId, но смешиваются обязанности | |
| Параллельно Promise.all | Экономит 30s, но порядок доставки недетерминирован | |

**User's choice:** Отдельная runWebPipeline().

### Q2: Как runId прокидывается между TG и Web?

| Option | Description | Selected |
|--------|-------------|----------|
| Один общий runId на tick | tick() генерирует runId, прокидывает в обе функции; лёгкий рефактор runPipeline | ✓ (Recommended) |
| Два независимых runId | Чистая автономия модулей, но в логах прогон разбивается на два ID | |

**User's choice:** Один общий runId.

### Q3: Если runPipeline() (TG) упал — запускать ли web-pipeline?

| Option | Description | Selected |
|--------|-------------|----------|
| Да — запускаем web независимо | Заказчик получает хотя бы web-сводку | ✓ (Recommended) |
| Нет — фейл всего tick'а | TG-фейл → alert → выходим, web пропускаем | |

**User's choice:** Да — запускаем web независимо.

### Q4: Отдельный alert-stage для web-pipeline failure?

| Option | Description | Selected |
|--------|-------------|----------|
| stage:"web" | sendAlert({stage:"web", ...}) отдельно от "pipeline"/"tick"/"bot" | ✓ (Recommended) |
| Тот же stage:"pipeline" | Один общий stage, оператор парсит message | |

**User's choice:** stage:"web".

---

## Web message format

### Q1: Заголовок отдельного веб-сообщения?

| Option | Description | Selected |
|--------|-------------|----------|
| 🌐 Веб-источники — 6 мая 2026 г. | Параллель TG-заголовку «Нефтегаз — 6 мая 2026 г.», явный emoji 🌐 | ✓ (Recommended) |
| Дайджест по сайтам — 6 мая 2026 г. | Слово «дайджест», без emoji | |
| Нефтегаз — веб-источники — 6 мая 2026 г. | Полный параллелизм с TG, но длинно | |

**User's choice:** 🌐 Веб-источники — 6 мая 2026 г.

### Q2: Что в субзаголовке?

| Option | Description | Selected |
|--------|-------------|----------|
| X сайтов из Y обработано | <i>5 сайтов из 7 обработано</i> | ✓ (Recommended) |
| X items извлечено | Скрывает «сколько сайтов было» | |
| X items из Y сайтов | <i>12 items из 5 сайтов обработано</i>, неравные числа сбивают | |

**User's choice:** X сайтов из Y обработано.

### Q3: Что слать если ВСЕ сайты пропустились (все <200 chars / network фейлы)?

| Option | Description | Selected |
|--------|-------------|----------|
| Не слать веб-сообщение + alert | sendAlert(stage:"web", ...) + log.warn, ничего в канал | |
| Слать плейсхолдер с пустыми секциями | «🌐 Веб-источники — ...\n0 сайтов из N обработано» + 5 пустых секций | ✓ |

**User's choice:** Плейсхолдер с пустыми секциями (technical fail).
**Notes:** Заказчик видит «прогон был, но данных нет»; параллельно sendAlert уведомляет оператора в личку.

### Q4: Что делать если LLM пропустил все web-Posts (relevant=0)?

| Option | Description | Selected |
|--------|-------------|----------|
| Не слать веб-сообщение | log.info('web: no relevant content'); тишина в канале | ✓ (Recommended) |
| Слать веб-сообщение с пустыми секциями | Полный скелет с 5 «нет упоминаний» — лента засоряется | |

**User's choice:** Не слать веб-сообщение (content miss → silence).

---

## Fetch behaviour

### Q1: Параллельность fetch'а сайтов?

| Option | Description | Selected |
|--------|-------------|----------|
| Promise.allSettled — все параллельно | Разные хосты, anti-ban не нужен; ~3s vs ~15s sequential | ✓ (Recommended) |
| Sequential с sleep+jitter (как Telegram) | Излишняя осторожность — разные хосты | |
| Promise.allSettled с лимитом concurrency 5 | Для больших списков (>30); v4.0 ожидает 5–10 сайтов | |

**User's choice:** Promise.allSettled — все параллельно.

### Q2: Timeout на fetch сайта?

| Option | Description | Selected |
|--------|-------------|----------|
| 10с | AbortController + setTimeout(abort, 10_000) | ✓ (Recommended) |
| 5с — жёсткий | Быстрый fail-fast, но SSR может рендерить 5-7с | |
| 30с — щедрый | Очень лежачий сайт получит шанс, но total runtime растёт | |

**User's choice:** 10с.

### Q3: User-Agent в запросе?

| Option | Description | Selected |
|--------|-------------|----------|
| Браузерный UA (Chrome/120) | Mozilla/5.0 ... Chrome/120 ... Safari/537.36, обходит bot-blockers | ✓ (Recommended) |
| Identifying UA: tg-parser-demo/1.0 | Честный, но многие сайты режут 403 | |
| Default node-fetch UA | Непредсказуемый fail | |

**User's choice:** Браузерный Chrome/120.

### Q4: Retry при network fail на один сайт?

| Option | Description | Selected |
|--------|-------------|----------|
| Нет retry — fail → skip → лог | Success criteria #2 буквально; следующий прогон в 20:15 = retry | ✓ (Recommended) |
| 1 retry через 1с | Не было в исходных REQ; добавляет сложности | |

**User's choice:** Нет retry.

---

## Claude's Discretion

Решения не обсуждались с пользователем, выбраны по best-practice и аналогии с
существующим кодом:

- **Структура `src/web-scraper.ts`** — single-file ~200 LOC: loadWebsites,
  fetchSite, extractText (cascade+cleanup), siteToPost, runWebPipeline.
- **`websites.json` schema** — `{ websites: [{ url, name? }] }`, минимизм по
  аналогии с `channels.json`. Read-only файл, без mutex/CRUD (нет ботовых команд).
- **Mapping `url → channelUsername`** — из `name` если задан, иначе
  `new URL(url).hostname.replace(/^www\./, '')`.
- **`messageId = 0`** для web-Posts (нет cross-run dedup для web в Phase 3).
- **`postedAt = new Date().toISOString()`** для web-Posts (страница не имеет
  «момента публикации» — берём время скрейпа).
- **Archives** — `data/raw/YYYY-MM-DD-web.json` и `data/output/YYYY-MM-DD-web.md`
  с `-web` suffix'ом. Реализация: новые `writeRawWeb`/`writeOutputWeb` в
  `src/archive.ts` или extend существующих.
- **Validation 200 chars** — на нормализованном cleaned text после cleanup и
  cascade-select, до 8000-cap'а.
- **Extractive verification target** — нормализованный text (не raw HTML).
  `verifyExtractiveness()` работает прямо без модификаций.
- **`WebRunSummary` тип** — отдельная структура в `src/types.ts` (websitesTotal,
  websitesSucceeded, websitesSkipped, itemsCollected, itemsDropped, digestDelivered,
  errors[]).
- **`WebsitesFileSchema`** — Zod в `src/schema.ts`, на invalid → throw → ловится
  в tick() catch → sendAlert(stage:"web").
- **Vitest tests** — `src/__tests__/web-scraper.test.ts` (cascade-select, cleanup,
  200-char validation, 8000-cap, hostname-derivation, mocked fetch для
  Promise.allSettled).
- **`.env.example` дополнения** — опциональные `WEB_FETCH_TIMEOUT_MS=10000`,
  `WEB_USER_AGENT=...` с D-16/D-17 как defaults.
- **`package.json`** — `"cheerio": "^1.0.0"` (5-я runtime-dep, утверждено в
  STATE.md).

## Deferred Ideas

См. `<deferred>` секцию в CONTEXT.md — преимущественно Future-флаги REQUIREMENTS
(BOT-06 per-site selectors, WEB-05 readability, WEB-06 web hash-cache) и
рассмотренные-но-отвергнутые опции (retry, timeout 5с/30с, identifying UA,
sequential fetch, lemma «не слать плейсхолдер при tech-fail», Tagged messageId).
