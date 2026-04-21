---
phase: 01-mvp
plan: 01
subsystem: infra

tags: [nodejs, typescript, esm, tsx, gramjs, telegram, yaml, stringsession]

# Dependency graph
requires: []
provides:
  - package.json с ровно 3 runtime-зависимостями (openai, telegram, yaml) и scripts login/start через --env-file=.env
  - tsconfig.json strict + moduleResolution:bundler + noEmit для TypeScript без build-шага
  - .env.example со всеми 12 переменными окружения (контракт для src/run.ts, src/telegram.ts, src/summarize.ts, src/deliver.ts)
  - channels.yaml с 12 публичными каналами российского нефтегаза (якорные neftegazru, oilfornication)
  - .gitignore защищающий .env и node_modules/ от коммита (T-01/T-05 mitigation)
  - scripts/login.ts — интерактивная разовая генерация TG_SESSION через GramJS StringSession + node:readline/promises
affects:
  - 01-02 (src/telegram.ts — использует TG_API_ID/TG_API_HASH/TG_SESSION + FETCH_WINDOW_HOURS/MAX_MESSAGES_PER_CHANNEL/CHANNEL_DELAY_MS из .env)
  - 01-03 (src/run.ts — npm start через --env-file=.env, читает channels.yaml с полем priority)
  - 01-03 (src/summarize.ts — DEEPSEEK_API_KEY/DEEPSEEK_MODEL/DEEPSEEK_BASE_URL из .env)
  - 01-03 (src/deliver.ts — TG_BOT_TOKEN/TG_CHANNEL_ID из .env)

# Tech tracking
tech-stack:
  added:
    - node@>=20.6.0 (runtime, нужен для --env-file)
    - typescript@^5.4.0 (dev, noEmit)
    - tsx@^4.0.0 (dev, run TS without build)
    - "@types/node@^20.0.0 (dev)"
    - telegram@^2.22.0 (runtime, GramJS MTProto client)
    - openai@^4.0.0 (runtime, DeepSeek OpenAI-compatible)
    - yaml@^2.5.0 (runtime, parse channels.yaml)
  patterns:
    - "ESM-only project (type:module); импорты с расширением .js в рантайме"
    - "node --env-file=.env --import tsx для всех скриптов (login и start симметричны)"
    - "12-переменных env-контракт фиксирован в .env.example; downstream модули читают через process.env без dotenv"
    - "Секреты только в stdout/env, никогда не в файлы (scripts/login.ts → console.log вместо writeFile)"

key-files:
  created:
    - package.json
    - tsconfig.json
    - .gitignore
    - .env.example
    - channels.yaml
    - scripts/login.ts
    - package-lock.json
  modified: []

key-decisions:
  - "Префикс `node --env-file=.env --import tsx` в scripts.login (не `tsx scripts/login.ts`): обеспечивает доступ к TG_API_ID/TG_API_HASH через process.env без dotenv; симметрично с scripts.start"
  - "В channels.yaml ровно 12 каналов (граница 10–15): включены якорные neftegazru+oilfornication и seed-список отраслевых (oil_gas_forum, neftianka, energytodaygroup, oilcapital) + общеновостные (interfax, tass, rbc, kommersant, vedomosti, prime1) — оператор подредактирует перед первым прогоном"
  - "В scripts/login.ts — Number.isFinite(apiId) + length check apiHash: ранний fail до TelegramClient чтобы не получать невразумительное MTProto-сообщение"
  - "В scripts/login.ts client.session.save() печатается в stdout, никогда не пишется в файл (T-05 mitigation; принцип MVP «без персистентности»)"

patterns-established:
  - "Pattern 1: `node --env-file=.env --import tsx path.ts` для всех TS-скриптов — ни один downstream модуль не должен требовать dotenv"
  - "Pattern 2: Секретные поля в .env.example всегда пустые (KEY=); дефолты только для не-секретов (FETCH_WINDOW_HOURS=24, DEEPSEEK_MODEL=deepseek-chat и т.п.)"
  - "Pattern 3: Каркас-файлы (package.json/tsconfig.json/.gitignore) коммитятся одним атомарным chore-коммитом; конфиги данных (.env.example, channels.yaml) отдельно; код — отдельно"

requirements-completed: [CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, AUTH-01, AUTH-02]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 01 Plan 01: Каркас + Session Summary

**Каркас ESM/TypeScript-проекта с 3 runtime-зависимостями (openai, telegram, yaml), 12-переменным env-контрактом, seed-списком 12 каналов и интерактивным GramJS StringSession-логином через readline**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-21T07:13:31Z
- **Completed:** 2026-04-21T07:17:22Z
- **Tasks:** 3
- **Files created:** 7 (включая package-lock.json)
- **Files modified:** 0

## Accomplishments

- `npm install` успешно (92 пакета, 0 уязвимостей) с ровно 3 runtime-зависимостями (openai, telegram, yaml) и 3 dev (tsx, typescript, @types/node)
- `npx tsc --noEmit` завершается с exit 0 — strict TypeScript без build-шага
- `.env.example` содержит все 12 переменных с комментариями-источниками (my.telegram.org, BotFather, platform.deepseek.com), без реальных секретов
- `channels.yaml` парсится библиотекой `yaml`, содержит 12 публичных каналов с обязательным заголовочным комментарием про дисциплину подписки
- `scripts/login.ts` компилируется, реализует `new StringSession("") → client.start(callbacks) → console.log(client.session.save())` через node:readline/promises, не пишет TG_SESSION в файл
- `.gitignore` защищает `.env` и `node_modules/` (T-01 secrets leak + T-05 session hijack mitigations)

## Task Commits

1. **Task 1: package.json + tsconfig.json + .gitignore** — `25cf421` (chore)
2. **Task 2: .env.example + channels.yaml** — `2e1b6eb` (chore)
3. **Task 3: scripts/login.ts** — `abe3941` (feat)

**Plan metadata:** [будет добавлен финальным docs-коммитом]

## Files Created/Modified

- `package.json` — манифест ESM, scripts login/start через --env-file=.env, engines node>=20.6.0, 3 runtime + 3 dev зависимости
- `package-lock.json` — lockfile от npm install (92 пакета)
- `tsconfig.json` — strict TypeScript, target ES2022, moduleResolution:bundler, noEmit, include src+scripts
- `.gitignore` — блокирует .env, .env.local, node_modules/, *.log, .DS_Store, .vscode/, .idea/, dist/, build/, *.tsbuildinfo
- `.env.example` — 12 переменных окружения (TG_API_ID, TG_API_HASH, TG_SESSION, TG_BOT_TOKEN, TG_CHANNEL_ID, DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL, FETCH_WINDOW_HOURS, MAX_MESSAGES_PER_CHANNEL, CHANNEL_DELAY_MS, LOG_LEVEL) с комментариями-источниками
- `channels.yaml` — 12 публичных TG-каналов российского нефтегаза с priority (neftegazru, oilfornication, oil_gas_forum, neftianka, energytodaygroup, oilcapital, interfaxonline, tass_agency, rbc_news, kommersant, vedomosti, prime1)
- `scripts/login.ts` — интерактивный скрипт разовой генерации TG_SESSION через GramJS StringSession + node:readline/promises (AUTH-01, AUTH-02)

## Decisions Made

- **Скрипт login использует `node --env-file=.env --import tsx`** (не `tsx scripts/login.ts` как в REQUIREMENTS.md CFG-01): без --env-file скрипт не получит доступ к TG_API_ID/TG_API_HASH через process.env. Это корректная реализация требования, а не отход от него. Симметрично с scripts.start.
- **12 каналов в channels.yaml (граница 10–15):** 2 якорных (neftegazru, oilfornication) + 4 отраслевых + 6 общеновостных как seed-список. Оператор подредактирует перед первым прогоном (см. §Deferred в 01-CONTEXT.md). Все usernames — публичные каналы.
- **`Number.isFinite(apiId)` + `apiHash.length < 8`-валидация** до `new TelegramClient`: MTProto-ошибки при невалидных креденшелах маскируются внутри GramJS — явная проверка даёт оператору чёткое сообщение о причине.
- **`as unknown as string` приведение для `client.session.save()`:** GramJS объявляет возвращаемый тип как `string | Promise<string>`, но StringSession возвращает всегда синхронно строку — двойное приведение проще, чем `await Promise.resolve`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] npm install cache permission fix**
- **Found during:** Task 1 (npm install)
- **Issue:** Default `~/.npm` содержит root-owned файлы от предыдущих версий npm (EACCES), npm install падал
- **Fix:** Использован локальный кэш `--cache /tmp/npm-cache-agent-a66bdc9d` для этого прогона. Не изменяет конфиг репозитория, только обходит проблему локального окружения.
- **Files modified:** нет (операционное решение)
- **Verification:** npm install отрапортовал «added 92 packages, 0 vulnerabilities»
- **Committed in:** нет (операционное, конфиг не менялся)

**2. [Rule 3 - Blocking] tsconfig include pattern требует хотя бы один .ts-файл**
- **Found during:** Task 1 (верификация `npx tsc --noEmit` exit 0)
- **Issue:** С `"include": ["src/**/*.ts", "scripts/**/*.ts"]` и пустыми директориями tsc выдаёт TS18003 («No inputs were found»). Альтернатива `"files": []` даёт TS18002 («empty files list»).
- **Fix:** Верификация `tsc --noEmit` перенесена на Task 3 (где создаётся `scripts/login.ts`). Task 1's `<verify>` block не включает tsc — только структурные проверки. План внутренне корректен: overall-verification и Task 3 `<verify>` ловят это.
- **Files modified:** нет (порядок верификации)
- **Verification:** После Task 3: `npx tsc --noEmit` → exit 0
- **Committed in:** нет (методологическое замечание)

---

**Total deviations:** 2 auto-fixed (2 blocking, операционных)
**Impact on plan:** Обе девиации — операционные (кэш npm, порядок верификации tsc), код плана не менялся. No scope creep.

## Issues Encountered

- `tsc --noEmit` не может пройти на конфиге с include-паттернами до появления хотя бы одного .ts-файла. Решено порядком: Task 3 создаёт `scripts/login.ts`, после чего overall-verification проходит с exit 0.

## User Setup Required

**Оператор обязан выполнить следующие ручные действия перед первым `npm start`** (детали — в `user_setup` frontmatter плана 01-01-PLAN.md):

1. **Telegram API (my.telegram.org):** создать приложение, скопировать `TG_API_ID` и `TG_API_HASH` в `.env`
2. **Generate StringSession:** `cp .env.example .env`, заполнить `TG_API_ID`/`TG_API_HASH`, затем `npm run login` — ввести телефон/код/2FA, скопировать StringSession в `.env` как `TG_SESSION`
3. **Telegram Bot (@BotFather):** создать бота, скопировать `TG_BOT_TOKEN` в `.env`
4. **Приватный канал:** создать в Telegram, добавить бота админом, получить ID через @username_to_id_bot (формат `-100xxxxxxxxxx`), положить в `.env` как `TG_CHANNEL_ID`
5. **DeepSeek (platform.deepseek.com):** создать API key, положить в `.env` как `DEEPSEEK_API_KEY`
6. **Подписать user-аккаунт** (чей TG_SESSION сгенерирован на шаге 2) на все каналы из `channels.yaml` — иначе GramJS бросит ChannelPrivateError и эти каналы будут пропущены

Ни одно из действий не требуется для компиляции или unit-проверок (верифицировано: `npm install` + `npx tsc --noEmit` exit 0). Только для рантайма `npm run login` / `npm start`.

## Next Phase Readiness

**Готовы к plan 01-02 (пайплайн сбора + LLM):**
- Все 12 переменных окружения зафиксированы в `.env.example` — `src/telegram.ts` и `src/summarize.ts` могут полагаться на контракт.
- `channels.yaml` парсится через `yaml.parse` — `src/run.ts` получит `{ channels: Array<{ username: string; priority: number }> }`.
- tsconfig strict + moduleResolution:bundler — компиляция TS без билда готова для следующих модулей.
- GramJS уже установлен; `scripts/login.ts` демонстрирует корректный импорт `import { StringSession } from "telegram/sessions/index.js"` — `src/telegram.ts` повторит тот же паттерн с `new StringSession(process.env.TG_SESSION)`.

**Готовы к plan 01-03 (доставка + склейка + README):**
- `TG_BOT_TOKEN` / `TG_CHANNEL_ID` в контракте — `src/deliver.ts` имеет всё для `fetch('/sendMessage')`.
- `LOG_LEVEL` в контракте — при необходимости `src/run.ts` прочитает.

**Blockers:** Нет. Оператор может запустить `npm run login` уже сейчас (после заполнения TG_API_ID/TG_API_HASH в .env) — скрипт самодостаточен и не требует других модулей.

## Self-Check: PASSED

- Files verified present: package.json, tsconfig.json, .gitignore, .env.example, channels.yaml, scripts/login.ts, package-lock.json, .planning/phases/01-mvp/01-01-SUMMARY.md
- Commits verified in git log: 25cf421 (Task 1), 2e1b6eb (Task 2), abe3941 (Task 3)
- `npm install` ok (92 packages, 0 vulnerabilities)
- `npx tsc --noEmit` exits 0
- deps set (sorted) = `openai,telegram,yaml`
- channels.yaml parses to 12 channels через библиотеку `yaml`
- `.env.example` не содержит реальных секретов (`^(TG_API_HASH|TG_SESSION|TG_BOT_TOKEN|DEEPSEEK_API_KEY)=.+` — 0 матчей)

---
*Phase: 01-mvp*
*Plan: 01*
*Completed: 2026-04-21*
