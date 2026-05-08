---
phase: quick-260508-cha
plan: 01
subsystem: web-scraper
tags: [web-scraper, fetch-timeout, websites, config]
requires: []
provides:
  - "DEFAULT_FETCH_TIMEOUT_MS=30_000 (src/web-scraper.ts)"
  - "angi.ru URL = https://www.angi.ru/ (websites.json)"
  - "README.md синхронизирован с кодом по WEB_FETCH_TIMEOUT_MS=30000"
affects:
  - src/web-scraper.ts
  - websites.json
  - README.md
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - src/web-scraper.ts
    - websites.json
    - README.md
decisions:
  - "Timeout 10s → 30s: дефолт для всего pipeline; env-override WEB_FETCH_TIMEOUT_MS остался без изменений (line 61)."
  - "angi.ru без поля name: channelUsername вычисляется из hostname (siteToPost), будет 'angi.ru'."
  - "README sync: упоминание дефолта обновлено вместе с кодом, чтобы документация не врала."
metrics:
  duration_seconds: 61
  completed_at: "2026-05-08T06:04:42Z"
  tasks_completed: 1
  files_modified: 3
---

# Quick Task 260508-cha: Fetch timeout 30s + angi.ru URL fix — Summary

One-liner: Поднял DEFAULT_FETCH_TIMEOUT_MS с 10s до 30s в web-scraper, починил 404 на angi.ru переключив URL на корень, синхронизировал README с новым дефолтом.

## Что сделано

- **A) src/web-scraper.ts (line 26):** `const DEFAULT_FETCH_TIMEOUT_MS = 10_000;` → `30_000;`. Фикс abort'ов на 7 нефтегаз-сайтах с тяжёлой SSR-главной (gazprom-neft.ru, gazpromneft-sm, gazpromneft-oil, g-energy, bitum.gazprom-neft, tk418, tatneft). Комментарий D-16 не тронут. Использование константы в `fetchSite()` (line 61, через env-override) не менялось.
- **B) websites.json (line 7):** `{ "url": "https://www.angi.ru/news/" }` → `{ "url": "https://www.angi.ru/" }`. Старый URL отдавал HTTP 404; корневая страница отдаёт 200 и сама является лентой новостей. Поле `name` не добавлялось — `siteToPost()` подставит hostname `angi.ru` как `channelUsername`.
- **C) README.md (line 234):** `WEB_FETCH_TIMEOUT_MS=10000` → `WEB_FETCH_TIMEOUT_MS=30000`. Документация теперь совпадает с фактическим дефолтом в коде.

## Файлы и точные строки

| Файл | Строка | Было | Стало |
|------|--------|------|-------|
| `src/web-scraper.ts` | 26 | `const DEFAULT_FETCH_TIMEOUT_MS = 10_000;` | `const DEFAULT_FETCH_TIMEOUT_MS = 30_000;` |
| `websites.json` | 7 | `    { "url": "https://www.angi.ru/news/" },` | `    { "url": "https://www.angi.ru/" },` |
| `README.md` | 234 | `` - `WEB_FETCH_TIMEOUT_MS=10000` — timeout одного fetch'а через AbortController. `` | `` - `WEB_FETCH_TIMEOUT_MS=30000` — timeout одного fetch'а через AbortController. `` |

`git diff --stat` итог: 3 files changed, 3 insertions(+), 3 deletions(-).

## Commit

- `d14e9c4` — `quick-260508-cha: bump fetch timeout to 30s + fix angi.ru URL`

## Verification

- Автоматический verify-скрипт из плана (`<verify><automated>`) → `ok` (новые литералы присутствуют, старые отсутствуют во всех трёх файлах).
- `JSON.parse(websites.json)` → ok, файл валидный JSON.
- `git diff --stat` за коммит показывает ровно 3 затронутых файла. Никаких побочных правок (package.json, schema.ts, других сайтов в websites.json) не сделано.

## Что НЕ сделано и почему

- **neftegaz.ru, rupec.ru** — падают с TLS/network "fetch failed", это не таймаут. Требуется отдельная диагностика (возможно undici-dispatcher или Playwright-fallback). Отложено как out-of-scope этого quick-плана.
- **nangs.org** — отдаёт HTTP 403 (antibot). Не лечится таймаутом или сменой UA, нужен отдельный план (residential proxy / Playwright). Отложено.
- **oilcapital.ru, oilexp.ru** — пересекались с timeout-проблемой; план явно говорит сначала проверить эффект 30s, потом решать. Если в следующем прогоне всё ещё abort — открыть отдельный quick.
- **Тесты** — не добавляли по плану (нет новых публичных API/контрактов, только числовой литерал и строка URL).
- **Новые зависимости** — не добавляли (constraint `три runtime-зависимости` соблюдён).

## Next observation

В следующем прогоне `npm start` (или cron 20:15 MSK) проверить:

1. В `logs.txt` нет строк `This operation was aborted` для семи доменов: `www.gazprom-neft.ru`, `gazpromneft-sm.ru`, `gazpromneft-oil.ru`, `g-energy.org`, `bitum.gazprom-neft.ru`, `tk418.ru`, `www.tatneft.ru`.
2. В `logs.txt` нет строки `https://www.angi.ru/news/ — HTTP 404`; вместо неё — успешный fetch `https://www.angi.ru/`.
3. В `data/raw/YYYY-MM-DD-web.json` появляются записи с `channelUsername: "angi.ru"` (без префиксов) и для семи перечисленных Газпром-нефть/tk418/tatneft источников.
4. Если кто-то из «отложенных» (neftegaz/rupec/nangs/oilcapital/oilexp) всё ещё падает — это уже отдельная история, открыть новый quick.

## Self-Check: PASSED

- FOUND: src/web-scraper.ts (DEFAULT_FETCH_TIMEOUT_MS = 30_000)
- FOUND: websites.json (angi entry → https://www.angi.ru/)
- FOUND: README.md (WEB_FETCH_TIMEOUT_MS=30000)
- FOUND commit: d14e9c4
