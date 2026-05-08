---
phase: quick-260508-cha
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/web-scraper.ts
  - websites.json
  - README.md
autonomous: true
requirements:
  - QUICK-260508-cha
must_haves:
  truths:
    - "При очередном `npm start` сайты gazprom-neft.ru, gazpromneft-sm, gazpromneft-oil, g-energy, bitum.gazprom-neft, tk418, tatneft не отваливаются по timeout (10s) при доступности сети — окно ожидания 30s."
    - "Сайт angi.ru скрейпится по корневому URL `https://www.angi.ru/` (HTTP 200), а не по `/news/` (HTTP 404)."
    - "README документирует фактический дефолт `WEB_FETCH_TIMEOUT_MS=30000`, синхронно с кодом."
  artifacts:
    - path: "src/web-scraper.ts"
      provides: "DEFAULT_FETCH_TIMEOUT_MS = 30_000"
      contains: "30_000"
    - path: "websites.json"
      provides: "angi.ru entry с url=https://www.angi.ru/"
      contains: "https://www.angi.ru/"
    - path: "README.md"
      provides: "Документация WEB_FETCH_TIMEOUT_MS=30000"
      contains: "WEB_FETCH_TIMEOUT_MS=30000"
  key_links:
    - from: "src/web-scraper.ts:26 (DEFAULT_FETCH_TIMEOUT_MS)"
      to: "src/web-scraper.ts:61 (fetchSite ms = ... ?? DEFAULT_FETCH_TIMEOUT_MS)"
      via: "константа потребляется fetchSite() при отсутствии env-override"
      pattern: "DEFAULT_FETCH_TIMEOUT_MS"
    - from: "websites.json:7"
      to: "src/web-scraper.ts loadWebsites() → fetchSite()"
      via: "Zod-валидация WebsitesFileSchema, дальше fetch"
      pattern: "https://www.angi.ru/"
---

<objective>
Quick task 260508-cha — фикс двух наблюдаемых дефектов из последнего прогона веб-скрейпера (logs.txt, 2026-05-07):

1. Семь сайтов из доменов «Газпром нефть» (gazprom-neft.ru, gazpromneft-sm, gazpromneft-oil, g-energy, bitum.gazprom-neft) плюс tk418 и tatneft падают с `This operation was aborted` — текущий fetch timeout 10s слишком короток для отраслевых SSR-сайтов с тяжёлой главной.
2. `https://www.angi.ru/news/` отдаёт HTTP 404 — страница переехала. Дискавери подтвердил, что главная `https://www.angi.ru/` (200 OK) сама является лентой новостей и пригодна для cheerio cascade-extractor.

Решение — три атомарных правки, объединённые в один коммит:
- Поднять `DEFAULT_FETCH_TIMEOUT_MS` 10s → 30s в `src/web-scraper.ts`.
- Сменить URL angi.ru в `websites.json` с `/news/` на `/`.
- Синхронизировать `README.md` (упоминание дефолта `WEB_FETCH_TIMEOUT_MS=10000` → `30000`).

Purpose: восстановить покрытие 7+ нефтегазовых источников в web-дайджесте без правки бизнес-логики, БД-схем или тестов. Env-override `WEB_FETCH_TIMEOUT_MS` уже существует (line 61), его трогать не нужно — меняем только дефолт.

Output: один коммит, обновлённые три файла, без новых зависимостей.

Out of scope (отложено):
- neftegaz.ru, rupec.ru — TLS/network "fetch failed" (требует undici-dispatcher или Playwright).
- nangs.org — HTTP 403 antibot.
- oilcapital.ru, oilexp.ru — пересечение с timeout-проблемой, но сначала проверим эффект 30s.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@logs.txt

<interfaces>
<!-- Контракт уже зафиксирован в коде, executor использует существующее поведение. -->

From src/web-scraper.ts (текущее состояние, релевантные строки):
```typescript
// line 25-26
// D-16: timeout fetch (env override опционально).
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;   // ← поменять на 30_000

// line 60-61 (НЕ ТРОГАТЬ — уже корректно использует env-override)
export async function fetchSite(url: string, timeoutMs?: number): Promise<string> {
  const ms = timeoutMs ?? Number(process.env.WEB_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS);
```

From websites.json (текущее состояние):
```json
{ "url": "https://www.angi.ru/news/" },   // line 7 — поменять на "https://www.angi.ru/"
```
Имя/`name` НЕ добавлять: согласно `siteToPost()` в src/web-scraper.ts (≈line 185), `channelUsername` для записи без `name` берётся из hostname как `angi.ru`. Это требуемое поведение.

From README.md (текущее состояние, line 234):
```
- `WEB_FETCH_TIMEOUT_MS=10000` — timeout одного fetch'а через AbortController.
```
</interfaces>

<failure_log_excerpt>
Из logs.txt (последний прогон):
```
[web-scraper] fetch error: https://www.gazprom-neft.ru/press-center/news/ — This operation was aborted
[web-scraper] fetch error: https://gazpromneft-sm.ru/press-center — This operation was aborted
[web-scraper] fetch error: https://gazpromneft-oil.ru/ru/brand/news — This operation was aborted
[web-scraper] fetch error: https://g-energy.org/ru/brand/news — This operation was aborted
[web-scraper] fetch error: https://bitum.gazprom-neft.ru/press-center/news/ — This operation was aborted
[web-scraper] fetch error: https://tk418.ru/news/ — This operation was aborted
[web-scraper] fetch error: https://www.tatneft.ru/news — This operation was aborted
[web-scraper] fetch error: https://www.angi.ru/news/ — HTTP 404
```
</failure_log_excerpt>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Поднять fetch timeout до 30s, сменить URL angi.ru, синхронизировать README</name>
  <files>src/web-scraper.ts, websites.json, README.md</files>
  <action>
Выполнить три точечные правки одним атомарным коммитом:

**A) src/web-scraper.ts (line 26):**
Заменить:
```ts
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
```
на:
```ts
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
```
Комментарий выше (`// D-16: timeout fetch (env override опционально).`) НЕ трогать — он остаётся валидным.
Никаких других правок в файле. Использование константы в `fetchSite()` (line 61) уже через env-override корректное — не трогать.

**B) websites.json (line 7):**
Заменить запись angi.ru с:
```json
    { "url": "https://www.angi.ru/news/" },
```
на:
```json
    { "url": "https://www.angi.ru/" },
```
ВАЖНО: НЕ добавлять поле `"name"`. Это намеренно — `siteToPost()` вычислит `channelUsername` из hostname как `angi.ru`. Структура файла (Zod-схема `WebsitesFileSchema`) валидирует обе формы. Остальные 28 записей в файле НЕ трогать.

ПРИМЕЧАНИЕ executor'у: эта правка может уже быть в working tree (`git diff websites.json` покажет). Если так — оставить как есть, файл уже в нужном состоянии, и пункт B сводится к проверке.

**C) README.md (line 234):**
Заменить:
```
- `WEB_FETCH_TIMEOUT_MS=10000` — timeout одного fetch'а через AbortController.
```
на:
```
- `WEB_FETCH_TIMEOUT_MS=30000` — timeout одного fetch'а через AbortController.
```
Никаких других правок в README не делать. Слово «дефолт» в этом блоке отсутствует — синхронизировать нечего.

Никаких новых файлов, тестов, зависимостей. tsx-runtime, проверять не нужно (изменения — литералы и строки).
  </action>
  <verify>
    <automated>node -e "const fs=require('fs');const ws=fs.readFileSync('src/web-scraper.ts','utf8');const sites=fs.readFileSync('websites.json','utf8');const rd=fs.readFileSync('README.md','utf8');const ok=ws.includes('const DEFAULT_FETCH_TIMEOUT_MS = 30_000;') && !ws.includes('const DEFAULT_FETCH_TIMEOUT_MS = 10_000;') && sites.includes('\"url\": \"https://www.angi.ru/\"') && !sites.includes('\"url\": \"https://www.angi.ru/news/\"') && rd.includes('WEB_FETCH_TIMEOUT_MS=30000') && !rd.includes('WEB_FETCH_TIMEOUT_MS=10000');if(!ok){console.error('verify failed');process.exit(1);}console.log('ok');"</automated>
  </verify>
  <done>
    - `src/web-scraper.ts` строка 26: `const DEFAULT_FETCH_TIMEOUT_MS = 30_000;`
    - `websites.json` строка 7 (angi entry): `{ "url": "https://www.angi.ru/" }` (без поля `name`)
    - `README.md` строка ~234: `WEB_FETCH_TIMEOUT_MS=30000`
    - Других правок нет (никаких форматирующих перестановок ключей в websites.json, никаких изменений в комментарии D-16, никаких новых строк в README).
    - `git diff --stat` показывает ровно 3 файла: src/web-scraper.ts, websites.json, README.md.
  </done>
</task>

</tasks>

<verification>
Финальные проверки после применения:

1. Автоматическая (см. `<verify>` в Task 1) — три файла содержат новые литералы и не содержат старых.
2. Синтаксический контроль JSON: `node -e "JSON.parse(require('fs').readFileSync('websites.json','utf8'))"` → выход 0 без ошибок.
3. TypeScript остаётся компилируемым (опционально, не блокирующее): `npx tsc --noEmit` — но изменилcя только числовой литерал, тип-инвариант сохранён.

Smoke-test (опциональный, оператор делает позже вручную):
- `npm start` или дождаться следующего cron-tick.
- В logs.txt больше нет `aborted` для семи перечисленных доменов И нет `HTTP 404` для angi.ru.
- В `data/raw/YYYY-MM-DD-web.json` появляются записи с `channelUsername: "angi.ru"` и для перечисленных Газпром-сайтов.
- Это не часть acceptance этого plan'а — only PR/коммит-уровень верификация выше.
</verification>

<success_criteria>
- [ ] Все три файла отредактированы согласно Task 1.
- [ ] Автоматический verify-скрипт возвращает `ok`.
- [ ] `git diff --stat` показывает ровно 3 затронутых файла.
- [ ] Никакие другие файлы (package.json, package-lock.json, schema.ts, других сайтов в websites.json) НЕ изменены.
- [ ] Изменения закоммичены одним атомарным коммитом с префиксом `quick-260508-cha`.
</success_criteria>

<output>
После выполнения создать `.planning/quick/260508-cha-fetch-timeout-30s-url-angi-ru/260508-cha-SUMMARY.md` со следующей структурой:

- Что сделано (3 буллета по A/B/C).
- Файлы и точные строки.
- Hash коммита.
- Что НЕ сделано и почему (отложенные сайты: neftegaz, rupec, nangs).
- Next observation: что проверить в следующем прогоне (исчезновение 7 abort'ов + успех angi.ru).
</output>
