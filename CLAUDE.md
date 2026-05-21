<!-- GSD:project-start source:PROJECT.md -->
## Project

**tg-parser-demo**

Один исполняемый Node.js-скрипт, который читает 10–15 публичных Telegram-каналов по российскому нефтегазу/нефтехимии за последние 24 часа, прогоняет все посты через DeepSeek и отправляет экстрактивный HTML-дайджест в мой личный закрытый Telegram-канал. Запуск — руками (`npm start`) с рабочей машины, между запусками состояние не хранится.

**Core Value:** За один `npm start` получить в закрытом канале дайджест событий нефтегаза за последние 24 часа, в котором **каждая цитата дословно присутствует в исходном посте** — без галлюцинаций LLM.

// todo: update

### Constraints

- **Tech stack**: Node.js 20.6+ (нужен `--env-file`), TypeScript без шага сборки (`tsx`), ESM, `moduleResolution: bundler`, `strict: true`. Runtime-зависимости ровно три: `telegram` (GramJS), `openai` (DeepSeek через OpenAI-совместимый SDK), `yaml`.
- **Нет БД, нет Redis.** Docker — опционально (для деплоя на Timeweb Cloud Apps); локальная разработка остаётся через `npm start` / `npm run start:once`. node-cron используется внутри daemon-режима для расписания 20:15 MSK.
- **Один оператор, один потребитель** — я запускаю, я читаю в закрытом канале. Никакого multi-tenancy.
- **Telegram API limits**: окно чтения ≤24ч, ≤50 сообщений на канал по умолчанию, задержка между каналами ≥1с + jitter, не чаще одного прогона в 10–15 минут (дисциплина).
- **DeepSeek**: один батч-запрос на прогон, `response_format: json_object`, модель выбирает не более 15 записей в итоговом дайджесте.
- **Telegram Bot API**: лимит 4096 символов на сообщение — режем с запасом ~4000 и нумеруем части.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

- Node.js 20.6+ (нужен `--env-file`)
- TypeScript без шага сборки (`tsx`), ESM, `moduleResolution: bundler`, `strict: true`
- Runtime deps: `telegram` (GramJS), `openai` (DeepSeek), `exceljs`, `cheerio`, `fast-xml-parser`, `node-cron`, `zod`
- Test runner: `vitest`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- Pure-функции + dict-аргументом, без module-level singleton'ов (`normalizeRefinery(raw, dict)`, `analyze(prices, fca, volumes, dict)`)
- Lazy client creation для DeepSeek с `temperature: 0`, `maxRetries: 1`, env DEEPSEEK_*
- Атомарная запись через `.tmp + rename` для всех config/state файлов (channels.json, signatures-learned.json, .last-run.json)
- Zod-валидация на output парсеров (`ParserResult<T> = { rows, errors }`)
- HTML output: Telegram parse_mode=HTML, whitelist `<b>`, `<i>`, `<code>`, `<a href>` (БЕЗ `<h1>`/`<hr>`/`<br>`)
- callback_query handler с pending state в Map<msgId, …> (рестарт бота → теряются — acceptable)
- Phase 4 (milestone v5.0): битум-pipeline в `src/bitum/*`; legacy `src/upload/*` удалён
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

- `src/run.ts` — daemon entry (cron 20:15 MSK + bot polling)
- `src/bot.ts` — Telegram bot polling + command routing
- `src/bot-bitum.ts` — битум-handlers (`/bitum_status`, `/bitum_preview`, `/bitum_report`, `/bitum_reset` + xlsx upload + classifier learning UX)
- `src/bitum/` — milestone v5.0 битум-pipeline:
  - `types.ts` — все типы (BitumType, ClassifyResult, ParsedRow*, ReportResult, NumberTrace, LearnedSignature, WeekStatusV5)
  - `signatures.ts` — built-in TS-таблица 5 known signatures
  - `classifier.ts` — `classifyFile(buffer)` со stepped confidence (A1+A3=1.0, A1=0.7, partial=0.4, none→unknown)
  - `learned-signatures.ts` — append-only `data/bitum/signatures-learned.json` с atomic .tmp+rename + in-process mutex
  - `parsers/` — 5 idempotent parsers с Zod-валидацией: birzha-prices, birzha-volumes, fca-sellers, all-prices, bitum-price-new
  - `refineries.ts` — словарь канонических НПЗ + `normalizeRefinery` + `getCompany`
  - `storage.ts` — ISO-week storage с WeekStatusV5 (5 boolean флагов) + resetWeek
  - `analyzer.ts` — `deltasFor` + `byCompanyFixedOrder` (Роснефть→Газпромнефть→ЛУКОЙЛ→Прочие) + `crossCheck` (REPORT-08, env BITUM_CROSS_CHECK_THRESHOLD)
  - `reporter.ts` — structured HTML по `docs/bitum/algoritm.md` §6 с cell-trace footer (REPORT-07) + partial-render (D-10)
  - `llm.ts` — hybrid scope (D-08): LLM ТОЛЬКО framing, numbers programmatic; `response_format: json_object`
- `src/deliver.ts` — TG канал доставки (`chunkHtml` reuse)
- `src/channels-store.ts` — атомарное хранилище channels.json с mutex
- `data/uploads/<YYYY-Www>/` — 5 битум xlsx per ISO week
- `data/bitum/signatures-learned.json` — append-only learned signatures (создаётся при первом learning event)
- `data/refineries.json` — словарь НПЗ с холдингами (Роснефть/Газпромнефть/ЛУКОЙЛ/Татнефть/независимые)
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
