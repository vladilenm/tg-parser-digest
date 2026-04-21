---
phase: 01-mvp
plan: 02
subsystem: pipeline

tags: [gramjs, openai, deepseek, telegram-mtproto, html-render, extractive-llm, typescript, esm]

# Dependency graph
requires:
  - phase: 01-mvp
    provides: "plan 01 — package.json (dependencies telegram/openai/yaml), tsconfig.json (strict + bundler), .env переменные TG_API_ID/TG_API_HASH/TG_SESSION/DEEPSEEK_API_KEY/DEEPSEEK_MODEL/DEEPSEEK_BASE_URL"
provides:
  - "src/types.ts — общие интерфейсы Post / DigestItem / DigestSection / DigestJson для plan 03"
  - "src/telegram.ts — createClient() с anti-ban identity (Desktop/Windows 11/ru) + fetchLast24h(client, username, opts) + sleep/randomInt helpers"
  - "src/summarize.ts — summarize(posts) → HTML (DeepSeek batch + server-side keyQuote verification + HTML render)"
  - "экспорт escapeHtml / renderHtml для использования в plan 03 (chunkHtml)"
affects: [01-03-delivery-run, future-dedup-v2, future-classifier-v2]

# Tech tracking
tech-stack:
  added:
    - "telegram (GramJS) @2.26.22 — MTProto user-session, StringSession, iterMessages, FloodWaitError"
    - "openai @4.104.0 — OpenAI-совместимый SDK для DeepSeek, response_format: json_object"
  patterns:
    - "ESM + moduleResolution=bundler: импорты .js суффикса в TS-исходниках (./types.js, telegram/sessions/index.js, telegram/errors/index.js)"
    - "Core Value защищается кодом (серверный includes-matcher), не только промптом"
    - "as const literal для immutable constants (CLIENT_IDENTITY)"
    - "asserts x is Type type-predicate для ручной валидации без zod"
    - "HTML-escape через три replace(&, <, >) в правильном порядке"
    - "URL-валидация через new URL().toString() вместо regex"

key-files:
  created:
    - "src/types.ts — 4 интерфейса пайплайна"
    - "src/telegram.ts — GramJS client + fetchLast24h"
    - "src/summarize.ts — DeepSeek + validate + renderHtml"
  modified: []

key-decisions:
  - "D-01..D-05: серверная верификация keyQuote через sourceText.includes(keyQuote.trim()) с маппингом Map<url, Post> — Core Value защищается кодом"
  - "D-06..D-08: anti-ban identity Telegram Desktop / Windows 11 / ru захардкожена в CLIENT_IDENTITY (не в .env), connectionRetries/useWSS — дефолты GramJS"
  - "D-09..D-13: HTML-рендер чистой конкатенацией строк, без шаблонизаторов; escapeHtml для всего пользовательского текста; URL через new URL()"
  - "Claude's Discretion: пустой msg.message (репост-только-медиа) скипается до LLM — пустой keyQuote всё равно не пройдёт серверную проверку"
  - "Обработка ошибок GramJS — по constructor.name + fallback на err.message (строки CHANNEL_PRIVATE/USERNAME_NOT_OCCUPIED/USERNAME_INVALID), поскольку instanceof для RPC-ошибок GramJS не всегда надёжен"

patterns-established:
  - "Deviation-safe error handling: GramJS-ошибки классифицируются через constructor.name + err.message substring — защита от рефакторинга exports в GramJS"
  - "Type-safe untyped GramJS fields: `(msg as unknown as { field?: T }).field` с typeof-проверкой значения — строже чем (msg as any), совместимо с strict mode"
  - "Defensive defaults для DeepSeek: baseURL/model подхватываются из process.env с fallback-литералами, API_KEY обязателен"

requirements-completed:
  - FETCH-01
  - FETCH-02
  - FETCH-03
  - FETCH-04
  - FETCH-05
  - FETCH-06
  - SUM-01
  - SUM-02
  - SUM-03
  - SUM-04

# Metrics
duration: ~9min
completed: 2026-04-21
---

# Phase 01 Plan 02: Сбор и суммаризация Summary

**GramJS user-client с anti-ban identity (Desktop/Windows 11/ru) + fetchLast24h с FloodWait retry + DeepSeek batch-суммаризация с серверной проверкой дословности keyQuote через Map<url, Post> + HTML-рендер для Telegram Bot API**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-21T07:10:40Z
- **Completed:** 2026-04-21T07:19:20Z
- **Tasks:** 2
- **Files created:** 3 (src/types.ts, src/telegram.ts, src/summarize.ts)

## Accomplishments

- **Core Value защищён кодом:** `sourceText.includes(item.keyQuote.trim())` через `Map<url, Post>` — LLM-галлюцинации не попадают в дайджест даже при идеальном промпте
- **Anti-ban identity:** захардкоженные `deviceModel="Desktop"`, `systemVersion="Windows 11"`, `appVersion="5.3.0 x64"`, `langCode="ru"`, `systemLangCode="ru"` (D-06..D-07)
- **FloodWait-устойчивость:** один retry после `err.seconds * 1000 + 2000`, второй подряд — проброс наверх (FETCH-04)
- **Частные ошибки каналов** (`ChannelPrivateError` / `UsernameNotOccupiedError` / `UsernameInvalidError`) — warn + пустой массив, прогон продолжается (FETCH-05)
- **HTML-рендер строго по формату D-09..D-13:** шапка `<b>Нефтегаз — {дата}</b>\n<i>{N} постов из {K} каналов за 24ч</i>`, секции `<b>Заголовок</b>`, буллеты `• {summary} — <i>«{keyQuote}»</i> — <a href="{url}">@{channel}</a>`
- **HTML-безопасность:** `escapeHtml` вызывается для summary/keyQuote/channel/title/date (5 мест, T-02 mitigated); URL — через `new URL().toString()` (T-04 mitigated)
- **`npx tsc --noEmit` exit 0** — все три файла проходят strict-типизацию

## Task Commits

1. **Task 1: src/types.ts + src/telegram.ts** — `d17aa82` (feat)
2. **Task 2: src/summarize.ts** — `a769954` (feat)

_Итоговый metadata-commit — ответственность orchestrator'а (этот worktree-агент его не создаёт, per parallel execution protocol)._

## Files Created/Modified

- `src/types.ts` — интерфейсы `Post`, `DigestItem`, `DigestSection`, `DigestJson` (единый контракт для plan 03)
- `src/telegram.ts` — `createClient()`, `fetchLast24h(client, username, opts)`, `sleep(ms)`, `randomInt(min, max)`, `CLIENT_IDENTITY` как внутренняя константа
- `src/summarize.ts` — `summarize(posts)`, `renderHtml(digest, posts)`, `escapeHtml(s)`; внутренние `validate(x)` (typeof/Array.isArray), `verifyExtractiveness(digest, posts)` (D-01..D-05), `formatDateRu(iso)`, `SYSTEM_PROMPT`

## Decisions Made

### Технические решения плана (локально принятые внутри task'ов)

- **`(msg as unknown as { field?: T }).field` вместо `(msg as any)`**: защищает strict-типизацию и делает явным, какие поля GramJS API мы читаем. Использовано для `date`, `message`, `id`.
- **Double-strategy для error classification**: `constructor.name === "ChannelPrivateError"` ИЛИ `err.message.includes("CHANNEL_PRIVATE")`. Первое работает когда GramJS экспортирует класс; второе — fallback для вариантов, когда класс собран динамически или не экспортирован. Это **усиление** FETCH-05 относительно спецификации — закрывает риск изменения internals GramJS.
- **SYSTEM_PROMPT как массив строк с `.join("\n")`** вместо одной многострочной строки — упрощает чтение/diff и позволяет безопасно вставить двойные кавычки в JSON-шаблон внутри промпта.
- **Skip постов с пустым `text`** (репост-только-медиа) реализован в `fetchLast24h` до DeepSeek — соответствует Claude's Discretion из CONTEXT.md. Обоснование: пустой текст всё равно не пройдёт серверную проверку keyQuote, а лишний шум в batch-запросе увеличивает стоимость prompt-токенов.
- **`BigInt`-safe messageId**: GramJS может вернуть `msg.id` как `bigint`, поэтому `Number(rawId)` для нормализации. В границах `number` это безопасно — Telegram message IDs укладываются в `Number.MAX_SAFE_INTEGER` (текущие < 10^10).

### Применённые locked decisions из 01-CONTEXT.md

| ID | Реализовано |
|----|-------------|
| D-01 | Серверная проверка keyQuote обязательна (не только промпт) |
| D-02 | `post.text.includes(item.keyQuote.trim())` — strict + trim по краям, без toLowerCase/whitespace-normalize |
| D-03 | `Map<string, Post>` по `url`, url не совпал → skip |
| D-04 | Skip + console.warn в stderr с channel / messageId / keyQuote / 60-char textSnippet |
| D-05 | Только stderr (console.warn/console.error), ни одного writeFile/appendFile |
| D-06 | CLIENT_IDENTITY = Desktop / Windows 11 / 5.3.0 x64 / ru / ru |
| D-07 | Идентичность захардкожена в `src/telegram.ts`, не в .env |
| D-08 | connectionRetries/useWSS — дефолты GramJS (0 вхождений `connectionRetries` в `src/telegram.ts`) |
| D-09 | Шапка `<b>Нефтегаз — {DD MMM YYYY}</b>\n<i>{N} постов из {K} каналов за 24ч</i>\n\n` |
| D-10 | Заголовки тем `<b>{title}</b>` без emoji/нумерации |
| D-11 | Буллет `• {summary} — <i>«{keyQuote}»</i> — <a href="{url}">@{channel}</a>` |
| D-12 | Разделитель секций `\n\n` (одна пустая строка) |
| D-13 | escapeHtml для <, >, & (5 точек вызова); URL через `new URL()` |

## Deviations from Plan

None - plan executed exactly as written. Промпт-рецепт plan'а применён дословно; acceptance-критерии прошли с первой попытки (одно минорное исправление комментария: удалено слово "Handlebars" и "connectionRetries" из комментариев, чтобы пройти grep-based acceptance `! grep -qi "handlebars"` и `! grep -q "connectionRetries"` — это не отступление от реализации, а соблюдение буквы verify-команд).

## Issues Encountered

### npm cache permission (infra, не код)

- **Issue:** `npm install` в чистом worktree без scaffolding падал с `EACCES` на `~/.npm/_cacache` (root-owned после прошлых установок)
- **Fix:** Использована изолированная кэш-директория через `npm install --cache $(mktemp -d)`; deps (`telegram 2.26.22`, `openai 4.104.0`) поставились, `npx tsc --noEmit` прошёл
- **Impact:** Только для type-check внутри этого worktree. `package.json` / `package-lock.json` / `node_modules/` остались **untracked** — они создаются plan 01-01 в параллельном worktree, orchestrator смержит. Этот агент не коммитит scaffolding.
- **Verification:** `git status --short` показывает только `?? node_modules/ package-lock.json package.json tsconfig.json` (не отслеживаются), а мои три файла — в коммитах `d17aa82` / `a769954`.

## User Setup Required

None — этот plan не добавляет новых внешних сервисов. Все переменные окружения (`TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`) уже описаны в `user_setup` frontmatter plan 01-01 и будут настроены оператором перед первым `npm start`.

## Next Phase Readiness

### Готово для plan 01-03 (doставка + склейка run.ts)

- **Импорты для `src/run.ts`:**
  ```typescript
  import { createClient, fetchLast24h, sleep, randomInt } from "./telegram.js";
  import { summarize } from "./summarize.js";
  import type { Post } from "./types.js";
  ```
- **Контракт `fetchLast24h`:** `Promise<Post[]>`, не бросает на `ChannelPrivate`/`UsernameNotOccupied`/`UsernameInvalid` — эти каналы просто дают `[]`. Второй FloodWait подряд — throw (plan 03 должен поймать и сделать `process.exit(1)`).
- **Контракт `summarize`:** `Promise<string>` — готовый HTML для Bot API `sendMessage` с `parse_mode: "HTML"`. Может быть пустой по секциям (если все keyQuote не прошли проверку) — шапка всё равно будет, это валидный edge-case.
- **`chunkHtml(html, 4000)` для plan 03:** `escapeHtml` уже применён к содержимому, `renderHtml` гарантирует корректный HTML — plan 03 должен резать по границам буллетов / `\n\n`, не посередине `<i>`/`<a>` тегов.

### Блокеры

Нет. Все контракты с plan 01 (scaffold) и plan 03 (delivery) зафиксированы и стабильны.

### Для будущего milestone (v2 / SPEC.md)

- Классификатор направлений (бункеровка/масла/керосин/нефтехимия/битум) может переиспользовать `Post.channelUsername` + `Post.text` без изменения `fetchLast24h`
- Дедуп через embeddings — добавится как post-filter перед `summarize`, не меняя сигнатуру `fetchLast24h → Post[]`
- Мульти-провайдер LLM (`LLMProvider` абстракция) — потребует выделить `summarize` внутренности; SYSTEM_PROMPT и `verifyExtractiveness` можно оставить общими

## Self-Check: PASSED

**Files exist:**
- FOUND: src/types.ts
- FOUND: src/telegram.ts
- FOUND: src/summarize.ts

**Commits exist:**
- FOUND: d17aa82 (Task 1)
- FOUND: a769954 (Task 2)

**Type-check:**
- `npx tsc --noEmit` exit 0

**Acceptance criteria:**
- All 13 D-XX decisions verified via grep patterns
- All 10 requirements (FETCH-01..06, SUM-01..04) covered
- `escapeHtml` called ≥ 5 times (5 callsites)
- `connectionRetries` = 0 occurrences in `src/telegram.ts`
- No `handlebars`, no `zod`, no `writeFile`, no `toLowerCase` on keyQuote, no `replace(/\s+)` on text

---
*Phase: 01-mvp*
*Plan: 02*
*Completed: 2026-04-21*
