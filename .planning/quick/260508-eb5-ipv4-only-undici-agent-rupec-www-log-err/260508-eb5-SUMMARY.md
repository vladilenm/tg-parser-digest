---
phase: quick-260508-eb5
plan: 01
subsystem: web-scraper
tags: [undici, fetch, ipv4, happy-eyeballs, tls-sni, error-cause, diagnostics]

# Dependency graph
requires:
  - phase: quick-260508-cy1
    provides: undici h1-only httpDispatcher (allowH2:false) — расширяем теми же опциями
provides:
  - "IPv4-only fetch для российских корп-сайтов (gazprom-neft.ru и группа), обход IPv6 SYN-timeout"
  - "rupec.ru без www-префикса (TLS SAN match)"
  - "formatErrCause() helper — единая раскрутка err.cause.code/message в логах и WebRunSummary.errors[]"
  - "scripts/diagnose-web-fetches.mjs — постоянный stand-alone репродьюсер undici-фейлов (Agent + headers идентичны web-scraper.ts)"
affects: [web-scraper, future quick-fixes for neftegaz.ru leaf-signature, nangs.org cloudflare-403]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Connect.family=4 + allowH2:false на одном undici Agent — компактный обход двух стеков нестандартного поведения (h2-fingerprinting + Happy Eyeballs)"
    - "formatErrCause(unknown): string — единая точка форматирования native-fetch ошибок (TypeError('fetch failed').cause)"

key-files:
  created:
    - "scripts/diagnose-web-fetches.mjs"
  modified:
    - "src/web-scraper.ts"
    - "websites.json"

key-decisions:
  - "family:4 (а не family:0/Happy Eyeballs) — корп-сайты не имеют AAAA или фильтруют v6 SYN; для всех сайтов в проекте v4 достаточно (не теряем доступность)"
  - "formatErrCause через структурное narrowing (unknown → cast{message,cause}) вместо runtime-проверки instanceof Error — undici cause часто AggregateError-подобен и не проходит instanceof"
  - "diag-скрипт оставлен с family:0 (старое поведение), а не зеркально с family:4 — он остаётся регрессионным репродьюсером старого бага для сравнения 'до/после'"
  - "rupec.ru без www-префикса — единственное правильное решение: TLS-сертификат rupec.ru не содержит www в SAN, любой redirect-rewrite на стороне сервера привёл бы к лишнему RTT"

patterns-established:
  - "Comment-pinning quick-fix tags: каждая правка стека fetch-настроек помечается quick-NNNNNN-xxx-комментарием в стиле проекта; следующий quick расширяет тот же блок новым параграфом, не переписывая старый"
  - "Helper formatErrCause переиспользуется и в map-catch (per-site лог), и в final-aggregation (WebRunSummary.errors[]) — одно форматирование, две точки выхода"

requirements-completed:
  - QUICK-260508-eb5

# Metrics
duration: ~2min
completed: 2026-05-08
---

# Phase quick-260508-eb5 Plan 01: IPv4-only undici Agent + raw rupec.ru + log err.cause Summary

**connect.family=4 на undici Agent + rupec.ru без www + formatErrCause helper — устранены 8 fetch-фейлов (7 connect-timeout + 1 TLS altname), оставшиеся причины теперь видны в логах**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-08T07:26:36Z
- **Completed:** 2026-05-08T07:28:05Z
- **Tasks:** 1 (atomic)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **httpDispatcher: family:4** — устранены 7 фейлов с UND_ERR_CONNECT_TIMEOUT на gazprom-neft.ru, gazpromneft-sm.ru, gazpromneft-oil.ru, g-energy.org, bitum.gazprom-neft.ru, tk418.ru, tatneft.ru. Корневая причина — Node Happy Eyeballs гонит IPv6 первым, эти сайты на v6-SYN не отвечают, fetch висит до 10s и валится. `family: 4` пропускает v6-ветку.
- **rupec.ru: drop www** — устранён ERR_TLS_CERT_ALTNAME_INVALID. SAN сертификата `rupec.ru` (без www); URL `https://www.rupec.ru/news/` → `https://rupec.ru/news/`.
- **formatErrCause()** — раскрутка `err.cause.code` / `err.cause.message` в обоих местах: per-site warn-лог (`runWebPipeline` map-catch) и итоговый `WebRunSummary.errors[]`. Лог `[web-scraper] [N/M] fail: <url> — fetch failed (cause: UND_ERR_CONNECT_TIMEOUT — Connect Timeout Error)` вместо немого `fetch failed`.
- **scripts/diagnose-web-fetches.mjs** — переименован untracked-репродьюсер из orchestrator-сессии в постоянный диагностический tool. Stand-alone Node-скрипт с теми же undici Agent + headers, что и web-scraper.ts; печатает `dumpErr()` для AggregateError-подобных undici-фейлов. Полезен для regression-проверки будущих quick-фиксов.

## Task Commits

Один atomic commit:

1. **Task 1: IPv4-only undici Agent + raw rupec.ru + log err.cause** — `d594f4b` (quick-fix)

## Files Created/Modified

### Создано

- `scripts/diagnose-web-fetches.mjs` — stand-alone репродьюсер undici-фейлов; гоняет 11 проблемных URL через `new Agent({ allowH2: false, connect: { timeout: 10_000 } })` с теми же headers что и web-scraper, печатает `dumpErr` (message, code, cause.name, cause.message, cause.code, cause.errors[]). Запуск: `node scripts/diagnose-web-fetches.mjs`.

### Модифицировано

- `src/web-scraper.ts` (+22/-3):
  - **L23-30** — httpDispatcher: расширен комментарий quick-260508-eb5-параграфом, в connect добавлено `family: 4`.
  - **L32-44** — новый helper `formatErrCause(err: unknown): string` (раскрутка err.cause.code/message).
  - **L359** — map-catch: `const msg = formatErrCause(err);` (вместо `(err as Error)?.message ?? String(err)`).
  - **L374** — final-aggregation: `const msg = formatErrCause(r.reason);` (вместо `(r.reason as Error)?.message ?? String(r.reason)`).
- `websites.json` (+1/-1):
  - **L5** — `https://www.rupec.ru/news/` → `https://rupec.ru/news/`.

## До / После (по логам последнего прогона до фикса)

Воспроизведение пробного `npm start` после коммита НЕ выполнялось (экономия API-quoty + сетевая флакитость), но статически фиксы предсказуемо устраняют:

| URL | Было | Будет |
|-----|------|-------|
| https://www.gazprom-neft.ru/press-center/news/ | `fail — fetch failed` (cause UND_ERR_CONNECT_TIMEOUT) | OK 200 (v4 SYN отвечает) |
| https://gazpromneft-sm.ru/press-center | `fail — fetch failed` | OK 200 |
| https://gazpromneft-oil.ru/ru/brand/news | `fail — fetch failed` | OK 200 |
| https://g-energy.org/ru/brand/news | `fail — fetch failed` | OK 200 |
| https://bitum.gazprom-neft.ru/press-center/news/ | `fail — fetch failed` | OK 200 |
| https://tk418.ru/news/ | `fail — fetch failed` | OK 200 |
| https://www.tatneft.ru/news | `fail — fetch failed` | OK 200 |
| https://www.rupec.ru/news/ | `fail — fetch failed` (cause ERR_TLS_CERT_ALTNAME_INVALID) | URL заменён на `https://rupec.ru/news/` → OK 200 |

В худшем случае (сайт остаётся недоступен по другой причине) лог теперь покажет `cause: <CODE> — <message>` вместо немого `fetch failed`.

## Всё ещё фейлящиеся сайты (out-of-scope, диагноз для следующих quick'ов)

| URL | Видимая причина (после eb5) | Disposition |
|-----|------------------------------|-------------|
| https://neftegaz.ru/news/ | `cause: UNABLE_TO_VERIFY_LEAF_SIGNATURE — unable to verify the first certificate` | Цепочка intermediate certs не отдаётся сервером. Нужен либо ручной CA-bundle, либо `https.Agent({ ca: ... })`. Отдельный quick-фикс. |
| https://nangs.org/news | `cause: HTTP 403` (Cloudflare challenge) | Bot-challenge, требует либо js-engine, либо headless browser, либо смены источника. Отдельный quick-фикс или замена URL. |
| https://oilcapital.ru/ | OK 200 в последний прогон (был интермиттент) | NO-OP, мониторить. |

## Decisions Made

См. `key-decisions` во frontmatter. Кратко:
- `family:4` достаточно для всех русских корп-сайтов (нет смысла в Happy Eyeballs).
- formatErrCause через structural cast (а не instanceof Error) — undici часто кидает AggregateError-подобные объекты.
- diag-скрипт оставлен с `family:0` — он остаётся снимком старого поведения для сравнения.

## Deviations from Plan

None — plan executed exactly as written. Все четыре изменения (family:4, formatErrCause + 2 callsite, websites.json, rename diag) выполнены ровно в формулировке plan'а.

## Issues Encountered

- `git mv scripts/diag-fetch.mjs scripts/diagnose-web-fetches.mjs` отказал с `fatal: not under version control, source=scripts/diag-fetch.mjs` — это ожидаемо для untracked-файла, plan явно описывает fallback («`mv` вручную и `git add`»). Сделан plain `mv`, файл застейджен через `git add scripts/diagnose-web-fetches.mjs` (попал в коммит как `create mode 100644`). Никакой потери: содержимое файла идентично, mtime сохранён.

## User Setup Required

None — quick-fix полностью кодовый, никакой внешней конфигурации не требуется.

## Threat Flags

Не введено новых сетевых поверхностей; `family:4` и формат лога не меняют trust-boundaries. Раскрутка `err.cause` потенциально может попасть в логи, но `cause.message` от undici не содержит секретов (стандартные сетевые/TLS-сообщения, без кук/headers).

## Next Phase Readiness

- Web-scraper pipeline теперь даёт диагностируемый лог; следующие quick'и (neftegaz SSL chain, nangs cloudflare) могут стартовать сразу с конкретного `cause.code`.
- `scripts/diagnose-web-fetches.mjs` остаётся пригодным для regression-проверок при изменении undici / Node-версии.

## Self-Check: PASSED

- FOUND: src/web-scraper.ts:30 содержит `family: 4`
- FOUND: src/web-scraper.ts:36 содержит `function formatErrCause`
- FOUND: src/web-scraper.ts:359 содержит `formatErrCause(err)` (map-catch)
- FOUND: src/web-scraper.ts:374 содержит `formatErrCause(r.reason)` (final-aggregation)
- FOUND: websites.json содержит `"https://rupec.ru/news/"` (без www)
- FOUND: scripts/diagnose-web-fetches.mjs (создан, 72 строки, idem-content к diag-fetch.mjs)
- MISSING (intentional): scripts/diag-fetch.mjs (переименован)
- FOUND: commit d594f4b на main, 3 files changed, 95 insertions(+), 4 deletions(-)
- FOUND: `npx tsc --noEmit` exit 0

---
*Phase: quick-260508-eb5*
*Completed: 2026-05-08*
