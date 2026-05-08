---
phase: 260508-cy1
plan: 01
subsystem: web-scraping
tags: [http, undici, fetch, headers, h1, dispatcher]
requires: []
provides:
  - "src/web-scraper.ts: fetchSite использует HTTP/1.1 через кастомный undici.Agent"
  - "module-level httpDispatcher singleton с allowH2: false"
  - "browser-like headers (accept-language ru-RU, sec-fetch-*, upgrade-insecure-requests)"
affects:
  - "все web-источники из websites.json (HTML-режим, не RSS)"
tech-stack:
  added: []  # undici — built-in в Node 20.6+, новых deps нет
  patterns:
    - "module-level singleton dispatcher с pooled connections"
    - "type-cast as RequestInit & { dispatcher?: unknown } для расширения DOM-овского RequestInit undici-полем"
key-files:
  created: []
  modified:
    - "src/web-scraper.ts"
decisions:
  - "Cast `as RequestInit & { dispatcher?: unknown }` вместо @ts-expect-error — устойчив к будущему добавлению типа в DOM lib"
  - "connect.timeout 10_000ms на dispatcher — отдельно от fetch-level WEB_FETCH_TIMEOUT_MS=30s; ловит «висящие» TCP/TLS handshakes раньше"
metrics:
  duration: "~5 min"
  completed: "2026-05-08"
  tasks: 1
  files: 1
  commits: 1
---

# Quick Task 260508-cy1: Force HTTP/1.1 in fetchSite via undici Agent Summary

Форсирован HTTP/1.1 в `fetchSite` через кастомный `undici.Agent({ allowH2: false })` + расширены fetch headers до браузерного набора (accept-language ru-RU, sec-fetch-* document-navigation, upgrade-insecure-requests). Цель — устранить массовые `fetch failed` после quick-260508-cha (timeout уже 30s) на сайтах с Tengine (`neftegaz.ru`), Bitrix-стеком и WAF, где native fetch undici роняет h2-frames несмотря на успешный TLS handshake (curl с тем же UA проходит).

## What Changed

**`src/web-scraper.ts`** (1 файл, 23 insertions / 2 deletions):

1. Новый импорт: `import { Agent } from "undici"` — undici встроен в Node 20.6+, ничего не добавлено в `package.json`.
2. Module-level singleton `httpDispatcher = new Agent({ allowH2: false, connect: { timeout: 10_000 } })` — создаётся один раз на процесс, параллельные `fetchSite` вызовы шарят connection pool.
3. В единственном `fetch(currentUrl, { ... })` вызове внутри `fetchSite`:
   - headers расширены: `accept` теперь полный q-list, добавлены `accept-language: ru-RU,ru;q=0.9,en;q=0.8`, `sec-fetch-dest: document`, `sec-fetch-mode: navigate`, `sec-fetch-site: none`, `sec-fetch-user: ?1`, `upgrade-insecure-requests: 1`;
   - добавлено `dispatcher: httpDispatcher`;
   - options-объект cast'нут `as RequestInit & { dispatcher?: unknown }` — DOM-овский `RequestInit` не знает про undici-расширение.

## What Did NOT Change

- `AbortController` / `WEB_FETCH_TIMEOUT_MS` (30s) / `WEB_USER_AGENT` env overrides — не тронуты;
- `isSafePublicUrl` SSRF-guard на исходном URL и на каждом redirect Location — не тронут;
- `redirect: "manual"` + ручной resolve относительных Location через `new URL(location, currentUrl)` — не тронут;
- `MAX_REDIRECT_HOPS = 5` и тело redirect-цикла — не тронуты;
- лог-формат `[web-scraper] fetch start/redirect/ok` — не тронут;
- `package.json` — не тронут (никаких новых dependencies).

## Verification

```
$ npx tsc --noEmit
(clean)

$ node -e "<plan-checks>"
OK undici import
OK allowH2 false
OK dispatcher passed
OK accept-language
OK sec-fetch-dest
OK upgrade-insecure
OK no new deps

$ git diff --stat HEAD~1 HEAD
 src/web-scraper.ts | 25 +++++++++++++++++++++++--
 1 file changed, 23 insertions(+), 2 deletions(-)
```

Все 7 структурных проверок плана зелёные. TypeScript `--noEmit` чист. Diff локализован в одном целевом файле.

## Deviations from Plan

None — plan executed exactly as written. Выбран `as RequestInit & { dispatcher?: unknown }` (cast), а не `@ts-expect-error` — оба варианта были разрешены планом, cast устойчивее к будущим изменениям DOM-типов.

## Auth Gates

None.

## Known Stubs

None.

## Commits

| Hash    | Message                                                                            |
| ------- | ---------------------------------------------------------------------------------- |
| 7d5dc39 | quick-260508-cy1: force HTTP/1.1 in fetchSite via undici Agent + browser-like headers |

## Smoke Test (deferred, optional)

`npm run start:once:web` — ожидаем заметное снижение `fetch failed` на neftegaz.ru / oilcapital.ru / oilexp.ru / *.gazprom-neft.ru. nangs.org с большой вероятностью продолжит давать 403 (Cloudflare challenge) — это вне скоупа quick-260508-cy1.

## Self-Check: PASSED

- src/web-scraper.ts — modified, committed in 7d5dc39 (FOUND).
- Commit 7d5dc39 — present in `git log` (FOUND).
- package.json — unchanged (verified via `git diff --stat`).
- No other files modified by this task (other working-tree changes pre-existed and were left unstaged).
