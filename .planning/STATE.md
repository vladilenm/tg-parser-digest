---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: milestone
status: executing
stopped_at: Phase 3 context gathered
last_updated: "2026-05-19T11:31:37.377Z"
last_activity: 2026-05-19
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 13
  completed_plans: 13
  percent: 100
---

# State: tg-parser-demo

**Last updated:** 2026-05-05 — Roadmap created for v4.0

## Project Reference

See: `.planning/PROJECT.md` (обновлён 2026-05-05)

**Core Value:** В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.

**Current Focus:** Phase 03 — web-scraping

## Current Position

Phase: 03
Plan: Not started
Status: Executing Phase 03
Last activity: 2026-05-19 - Completed quick task 260519-k6c: Добавить блок 'Не удалось распарсить' в конец дайджеста с перечнем недоступных сайтов

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Storage Migration | TBD | - | - |
| 2. Bot Commands | TBD | - | - |
| 3. Web Scraping | TBD | - | - |
| 03 | 4 | - | - |

*Updated after each plan completion*

## Accumulated Context

### Key Decisions (v4.0)

- **3-phase structure**: STORE (foundation) → BOT (depends on store) → WEB (independent, additive). Phase 3 can never break phases 1–2.
- **Raw fetch polling for bot**: no Telegraf/grammY; 3 commands do not justify framework overhead. See REQUIREMENTS.md Out of Scope.
- **cheerio for web scraping**: only new runtime dep (`cheerio ^1.0.0`); `@mozilla/readability` deferred to v4.x if selector fragility is observed.
- **In-process mutex for channels.json**: must be implemented in `channels-store.ts` before any other code touches the file (race condition at 20:00 MSK cron tick).
- Full decision log: `PROJECT.md` → Key Decisions table.

### Critical Pitfall (Phase 1)

Race condition: bot write overlaps pipeline read at 20:00 MSK → corrupted JSON → no digest. `channels-store.ts` mutex is a safety gate; implement before wiring any other v4.0 code.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260504-f5z | Vitest unit tests для summarize.ts | 2026-05-04 | f71266f | — |
| 260504-ew9 | Рефактор summarize.ts двухпроходная LLM-архитектура | 2026-05-04 | fc47b20 | — |
| 260504-eae | Заголовок дайджеста + per-category DeepSeek лимиты | 2026-05-04 | bb3544e | — |
| 260506-cad | Чанкование Pass 1 в classifyPosts (CLASSIFY_CHUNK_SIZE) — фикс ECONNRESET на 220+ постах | 2026-05-06 | 6d338e5 | [260506-cad-pass-1-src-summarize-ts-classifyposts-ll](./quick/260506-cad-pass-1-src-summarize-ts-classifyposts-ll/) |
| 260506-dht | Drop YAML completely + remove priority field — JSON-only storage, `yaml` dep removed, channels.yaml/prod-channels.yaml deleted | 2026-05-06 | 901b897 | [260506-dht-drop-yaml-completely-remove-priority-fie](./quick/260506-dht-drop-yaml-completely-remove-priority-fie/) |
| 260508-b55 | Расширить ключевые слова в CLASSIFY_SYSTEM_PROMPT и заменить gazprom → gazpromneft (метка [ГПН]) | 2026-05-08 | a99d1de | [260508-b55-classify-system-prompt-gazprom-gazpromne](./quick/260508-b55-classify-system-prompt-gazprom-gazpromne/) |
| 260508-cha | Поднять fetch timeout до 30s и поправить URL для angi.ru | 2026-05-08 | d14e9c4 | [260508-cha-fetch-timeout-30s-url-angi-ru](./quick/260508-cha-fetch-timeout-30s-url-angi-ru/) |
| 260508-cy1 | Форсировать HTTP/1.1 в web-scraper через кастомный undici Agent + browser-like headers | 2026-05-08 | 7d5dc39 | [260508-cy1-http-1-1-web-scraper-undici-agent-browse](./quick/260508-cy1-http-1-1-web-scraper-undici-agent-browse/) |
| 260508-dde | Задать temperature: 0 в обоих DeepSeek вызовах для квази-детерминистичных прогонов | 2026-05-08 | 2635a52 | [260508-dde-temperature-0-deepseek](./quick/260508-dde-temperature-0-deepseek/) |
| 260508-eb5 | IPv4-only undici Agent + rupec без www + log error.cause в fetchSite | 2026-05-08 | d594f4b | [260508-eb5-ipv4-only-undici-agent-rupec-www-log-err](./quick/260508-eb5-ipv4-only-undici-agent-rupec-www-log-err/) |
| 260508-fa1 | Fix max web sources without proxy + dual-sink logger (console + data/run-*.log) | 2026-05-08 | 2cc40ba | [260508-fa1-fix-max-web-sources-without-proxy-and-wr](./quick/260508-fa1-fix-max-web-sources-without-proxy-and-wr/) |
| 260508-juw | Add daily raw-posts cache for web-scraper to prevent info loss across same-day runs | 2026-05-08 | 4b25035 | [260508-juw-add-daily-raw-posts-cache-for-web-scrape](./quick/260508-juw-add-daily-raw-posts-cache-for-web-scrape/) |
| 260508-k8w | Customer feedback batch — Rolf+Lubrigard sources, full company keyword lists, антифриз in oil, hashtag navigation in digest headers | 2026-05-08 | 56a6aac | [260508-k8w-customer-feedback-rename-gazprom-tag-to-](./quick/260508-k8w-customer-feedback-rename-gazprom-tag-to-/) |
| 260508-ktu | Fix Pass 2 mentions recall — duplicate Pass 1 keyword lists into buildSummarizeCategoryPrompt (NIS/ЯНОС/Башнефть/НОРСИ/Litasco get inline prefixes) | 2026-05-08 | 1f389c1 | [260508-ktu-fix-pass-2-mentions-recall-duplicate-pas](./quick/260508-ktu-fix-pass-2-mentions-recall-duplicate-pas/) |
| 260509-k9l | Persistent storage + daily Telegram backup + pre-deploy snapshot (Variant A volume-only) — branch `deploy` | 2026-05-09 | 8e5ea41 | [260509-k9l-persistent-storage-daily-telegram-backup](./quick/260509-k9l-persistent-storage-daily-telegram-backup/) |
| 260510-cla | Прототип статического дашборда для дайджестов (`npm run dashboard` → `data/dashboard/index.html`) | 2026-05-10 | 449e4af | [260510-cla-static-dashboard-prototype](./quick/260510-cla-static-dashboard-prototype/) |
| 260518-fug | Добавить ключевое слово «Росавтодор» в категорию bitumen (Pass 1 классификатор) | 2026-05-18 | 11976c5 | [260518-fug-add-rosavtodor-to-bitumen](./quick/260518-fug-add-rosavtodor-to-bitumen/) |
| 260519-k6c | Блок «⚠️ Не удалось распарсить» в конце web-дайджеста с перечнем сайтов, к которым не удалось получить доступ | 2026-05-19 | 2b16c14 | [260519-k6c-failed-sites-block](./quick/260519-k6c-failed-sites-block/) |

## Session Continuity

**Last session:** 2026-05-06T11:35:52.854Z
**Stopped at:** Phase 3 context gathered
**Next action:** `/gsd-plan-phase 1`

---
*State updated: 2026-05-05 — v4.0 roadmap created, Phase 1 ready to plan*
| 2026-05-08 | fast | Pass BOT_ALLOWED_USER_IDS into docker container | ✅ |
