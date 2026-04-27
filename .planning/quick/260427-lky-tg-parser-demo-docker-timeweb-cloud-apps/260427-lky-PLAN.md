---
phase: 260427-lky-quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - Dockerfile
  - docker-compose.yml
  - .dockerignore
  - CLAUDE.md
  - README.md
autonomous: true
requirements:
  - QUICK-DOCKER-01
  - QUICK-DOCKER-02
  - QUICK-DOCKER-03
  - QUICK-CONSTRAINT-01
  - QUICK-DOCS-01
tags:
  - docker
  - deploy
  - timeweb
  - infra
must_haves:
  truths:
    - "Команда `docker compose up --build` собирает образ и запускает daemon с тем же поведением, что `npm start` (cron 20:15 MSK + jitter, graceful shutdown по SIGTERM)."
    - "Образ корректно резолвит таймзону Europe/Moscow для node-cron и Intl.DateTimeFormat (tzdata установлен, ENV TZ выставлен)."
    - "Build context минимален: node_modules, .env, data/, .planning/, docs/, scripts/login.ts, prod-channels.yaml, ecosystem.config.cjs, *.log, .DS_Store не попадают в образ."
    - "PM2-путь (ecosystem.config.cjs + npm start локально) остаётся рабочим без изменений — PR ничего не ломает в существующих сценариях."
    - "README содержит секцию 'Деплой через Docker / Timeweb Cloud Apps' с шагами: локальный `npm run login` для TG_SESSION → создание App в Timeweb → подключение GitHub-репо → env через UI → опциональный volume на /app/data → локальная проверка `docker compose up --build`."
    - "CLAUDE.md в секции Constraints отражает, что Docker теперь опционален (для деплоя на Timeweb), а локальная разработка — `npm start` / `npm run start:once`."
  artifacts:
    - path: "Dockerfile"
      provides: "Образ node:20-slim с tzdata, TZ=Europe/Moscow, npm ci по lock-файлу, CMD запускает daemon через tsx"
      contains: "FROM node:20-slim"
    - path: "docker-compose.yml"
      provides: "Локальный/Timeweb-совместимый стек с init: true, restart: unless-stopped, env_file: .env, environment TZ, volume ./data:/app/data"
      contains: "init: true"
    - path: ".dockerignore"
      provides: "Минимальный build context — исключает секреты, рантайм-данные, планирование, docs, login.ts"
      contains: ".env"
    - path: "CLAUDE.md"
      provides: "Обновлённая строка про Docker в секции Constraints"
      contains: "Docker — опционально"
    - path: "README.md"
      provides: "Новая секция 'Деплой через Docker / Timeweb Cloud Apps' рядом с PM2-секцией"
      contains: "Timeweb Cloud Apps"
  key_links:
    - from: "docker-compose.yml"
      to: "Dockerfile"
      via: "build: ."
      pattern: "build:\\s*\\."
    - from: "docker-compose.yml"
      to: "src/run.ts graceful shutdown"
      via: "init: true (PID 1 reaper для корректного SIGTERM)"
      pattern: "init:\\s*true"
    - from: "Dockerfile"
      to: "node-cron timezone Europe/Moscow в src/run.ts:52"
      via: "RUN apt-get install -y tzdata + ENV TZ=Europe/Moscow"
      pattern: "tzdata"
    - from: "Dockerfile"
      to: "package-lock.json"
      via: "COPY package.json package-lock.json + RUN npm ci"
      pattern: "npm ci"
    - from: ".dockerignore"
      to: "build context"
      via: "исключение .env, data/, scripts/login.ts, ecosystem.config.cjs, .planning/"
      pattern: "scripts/login\\.ts"
---

<objective>
Упаковать tg-parser-demo в Docker для деплоя на Timeweb Cloud Apps (маркетплейс "Docker Compose Latest", auto-deploy по `git push` из подключённого GitHub-репо).

Purpose: дать оператору альтернативу PM2-пути — управляемый деплой через Timeweb UI без ручной настройки VPS, при сохранении локальной разработки через `npm start` / `npm run start:once`.

Output:
- Три новых файла в корне репо: `Dockerfile`, `docker-compose.yml`, `.dockerignore`.
- Точечный edit `CLAUDE.md` (одна строка в секции Constraints).
- Новая секция в `README.md` рядом с существующей "Запуск на VPS (PM2)".
- PM2-путь и существующие npm-скрипты не модифицируются.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@README.md
@package.json
@ecosystem.config.cjs
@src/run.ts
@src/archive.ts
@.env.example
@.gitignore

<interfaces>
<!-- Ключевые контракты, которые исполнитель должен учесть. -->

From package.json:
- "type": "module" (ESM)
- engines.node: ">=20.6.0" → база образа node:20-slim подходит
- runtime deps: telegram, openai, yaml, node-cron, zod (5 шт.)
- devDeps: tsx, typescript, @types/node, @types/node-cron
- scripts.start: `node --env-file=.env --import tsx src/run.ts` — локальный путь
- scripts.start:once: `node --env-file=.env --import tsx scripts/run-once.ts` — однократный прогон
- scripts.login: `node --env-file=.env --import tsx scripts/login.ts` — НЕ запускается в контейнере

From src/run.ts (daemon):
- node-cron schedule: "15 20 * * *" с timezone "Europe/Moscow" → требует системный tzdata
- graceful shutdown: SIGINT/SIGTERM → task.stop() → ждёт isRunning → exit 0
  → требует init: true в docker-compose, чтобы Node как PID 1 получал SIGTERM правильно

From src/archive.ts:
- Использует Intl.DateTimeFormat с timeZone: "Europe/Moscow"
- Пишет в ./data/raw и ./data/output → требует mount-volume для persistence

Container CMD без --env-file:
- В контейнере env приходит из docker-compose env_file (локально) или Timeweb UI (прод)
- НЕ использовать `node --env-file=.env --import tsx src/run.ts` в CMD — флаг попытается прочитать .env из образа, которого там нет (исключён в .dockerignore)
- Корректный CMD: `["node", "--import", "tsx", "src/run.ts"]`
</interfaces>

<reference_files>
- ./scripts/login.ts — должен быть исключён из образа (login генерится локально)
- ./scripts/run-once.ts — оставляем в образе (вдруг понадобится разовый прогон через `docker compose run`)
- ./channels.yaml — копируем в образ как дефолтный список (prod-channels.yaml исключаем)
- ./tsconfig.json — копируем в образ (нужен tsx для resolve типов и paths)
</reference_files>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create Dockerfile, docker-compose.yml, .dockerignore</name>
  <files>Dockerfile, docker-compose.yml, .dockerignore</files>
  <action>
Создать три новых файла в корне репозитория.

**1. `Dockerfile`** — собирает рантайм-образ daemon'а:

```dockerfile
FROM node:20-slim

# tzdata критичен: node-cron и Intl.DateTimeFormat в src/archive.ts требуют системную TZ-базу
# для корректного резолва "Europe/Moscow". На node:20-slim tzdata НЕ установлен.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Moscow
ENV NODE_ENV=production

WORKDIR /app

# Слой кэшируется до изменения lock-файла → быстрый rebuild при правке кода
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false

# Копируем ровно то, что нужно рантайму. channels.yaml — дефолт-список;
# при необходимости оператор может прокинуть prod-channels.yaml через bind mount на Timeweb.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY channels.yaml ./

# Каталог для архивов прогонов (data/raw, data/output, data/dedup-cache).
# На Timeweb сюда подключается persistent volume через UI; локально — bind mount из docker-compose.
RUN mkdir -p /app/data

# КРИТИЧНО: НЕ использовать --env-file=.env (как в npm start), потому что .env исключён из образа.
# Env переменные приходят из docker-compose env_file (локально) или Timeweb UI (прод).
CMD ["node", "--import", "tsx", "src/run.ts"]
```

Замечания:
- Не используем multi-stage build — TypeScript в проекте без шага сборки (`tsx` runtime), оптимизация по размеру не критична для одного daemon'а.
- `npm ci` требует package-lock.json (он уже есть в репо).
- НЕ используем `USER node` — пока оставляем root, чтобы избежать проблем с правами на mounted volume `/app/data` на Timeweb (можно добавить позже отдельной задачей).

**2. `docker-compose.yml`** — стек для локальной разработки и совместимый с Timeweb Cloud Apps маркетплейсом:

```yaml
services:
  tg-parser:
    build: .
    image: tg-parser-demo:latest
    container_name: tg-parser-demo
    restart: unless-stopped
    # init: true КРИТИЧНО — без него Node как PID 1 не получает SIGTERM правильно,
    # graceful shutdown в src/run.ts:55-65 (ожидание активного прогона перед exit 0) ломается.
    init: true
    # env_file молча игнорируется, если .env отсутствует (Docker Compose v2 поведение).
    # На Timeweb env приходит через UI, локально — из ./env. Файл .env НЕ попадает в образ
    # (см. .dockerignore), сюда он подключается рантаймом через env_file.
    env_file:
      - .env
    environment:
      TZ: Europe/Moscow
    volumes:
      # Persistent storage для data/raw, data/output, data/dedup-cache.
      # На Timeweb пользователь подключит volume через UI; локально — bind mount.
      - ./data:/app/data
```

Замечания:
- НЕ указываем `version:` — устаревшее поле в Compose v2.
- НЕ пробрасываем порты — daemon ничего не слушает (cron + outbound HTTPS).
- `container_name` облегчает `docker logs tg-parser-demo` локально.

**3. `.dockerignore`** — минимизировать build context. Содержание:

```
# Зависимости и артефакты
node_modules
dist
build
*.tsbuildinfo

# Секреты — НИКОГДА не должны попасть в образ
.env
.env.local
.env.example

# Рантайм-данные (приходят через volume)
data

# Git и CI
.git
.gitignore
.gitattributes

# Планирование, документация, спецификации (не нужны рантайму)
.planning
docs
package
spec-app.md

# Альтернативные пути запуска (не нужны в Docker-образе)
ecosystem.config.cjs

# Login-скрипт — генерируется локально, в контейнере не запускается
scripts/login.ts

# Prod-список каналов (если есть локально) — оператор подключает через volume/UI
prod-channels.yaml

# Логи
*.log

# IDE/OS
.DS_Store
.vscode
.idea

# Markdown проекта (README/CLAUDE достаточно git-репо, в образ не нужны)
README.md
CLAUDE.md
```

Замечание про `scripts/login.ts`: это разовый интерактивный скрипт для генерации `TG_SESSION` (читает stdin). В контейнере он бесполезен и потенциально вреден — оператор должен запустить `npm run login` локально и вставить session в Timeweb UI. Поэтому исключаем точечно, оставляя `scripts/run-once.ts`.

После создания файлов — НЕ запускать `docker build` / `docker compose up` (это будет частью верификации оператором). Только записать файлы.
  </action>
  <verify>
    <automated>test -f Dockerfile && test -f docker-compose.yml && test -f .dockerignore && grep -q "FROM node:20-slim" Dockerfile && grep -q "tzdata" Dockerfile && grep -q "ENV TZ=Europe/Moscow" Dockerfile && grep -q "init: true" docker-compose.yml && grep -q "TZ: Europe/Moscow" docker-compose.yml && grep -q "./data:/app/data" docker-compose.yml && grep -q "^\.env$" .dockerignore && grep -q "scripts/login.ts" .dockerignore && grep -q "ecosystem.config.cjs" .dockerignore && grep -q "prod-channels.yaml" .dockerignore</automated>
  </verify>
  <done>
- Три новых файла существуют в корне репо.
- Dockerfile: `FROM node:20-slim`, `tzdata` устанавливается через apt-get, `ENV TZ=Europe/Moscow`, `npm ci` по lock-файлу, CMD без `--env-file`, `mkdir -p /app/data`.
- docker-compose.yml: `init: true`, `restart: unless-stopped`, `env_file: .env`, `environment: TZ`, volume `./data:/app/data`, без `version:`, без `ports:`.
- .dockerignore: исключает `.env`, `node_modules`, `data`, `.planning`, `docs`, `scripts/login.ts`, `ecosystem.config.cjs`, `prod-channels.yaml`, `*.log`, `.DS_Store`, `README.md`, `CLAUDE.md`.
- `package-lock.json` уже существует в репо (проверено заранее).
  </done>
</task>

<task type="auto">
  <name>Task 2: Update CLAUDE.md Constraints (одна строка про Docker)</name>
  <files>CLAUDE.md</files>
  <action>
В файле `CLAUDE.md`, в секции `### Constraints` (строка 13 в текущей версии), заменить ровно одну строку:

**Было:**
```
- **Нет БД, нет Redis, нет Docker, нет cron** — один процесс, один запуск, без внешней инфры.
```

**Стало:**
```
- **Нет БД, нет Redis.** Docker — опционально (для деплоя на Timeweb Cloud Apps); локальная разработка остаётся через `npm start` / `npm run start:once`. node-cron используется внутри daemon-режима для расписания 20:15 MSK.
```

Использовать инструмент `Edit` для точечной замены строки. НЕ менять окружающие строки. НЕ переписывать всю секцию.

Замечание: эта правка делается ВНУТРИ блока `<!-- GSD:project-start source:PROJECT.md -->` … `<!-- GSD:project-end -->`. По правилам GSD этот блок синхронизируется из `.planning/PROJECT.md`, поэтому после редактирования CLAUDE.md в идеале синхронизировать строку и в `.planning/PROJECT.md`. Однако для quick-деплоя достаточно правки CLAUDE.md (PROJECT.md обновится при следующем `/gsd-state-sync`). Если `.planning/PROJECT.md` существует и содержит ту же фразу — обновить и там для парности; если не существует или содержит другую формулировку — не трогать.
  </action>
  <verify>
    <automated>grep -q "Docker — опционально (для деплоя на Timeweb Cloud Apps)" CLAUDE.md && ! grep -q "нет Docker, нет cron" CLAUDE.md && grep -q "npm start" CLAUDE.md</automated>
  </verify>
  <done>
- CLAUDE.md в секции Constraints содержит новую формулировку про опциональный Docker.
- Старая фраза "нет Docker, нет cron" удалена.
- Остальные строки секции Constraints не изменены (Tech stack, Один оператор, Telegram API limits, DeepSeek, Telegram Bot API лимиты).
- Если `.planning/PROJECT.md` существует и содержит старую фразу — обновлён аналогично.
  </done>
</task>

<task type="auto">
  <name>Task 3: README — добавить секцию "Деплой через Docker / Timeweb Cloud Apps"</name>
  <files>README.md</files>
  <action>
В `README.md` добавить новую секцию между существующей `## Запуск на VPS (PM2)` (заканчивается на строке `max_memory_restart: "300M"...`) и секцией `## Ежедневный summary-лог`.

**Точка вставки:** сразу ПОСЛЕ конца секции `## Запуск на VPS (PM2)` (после строки `- max_memory_restart: "300M" — рестарт при утечке памяти.`) и ДО заголовка `## Ежедневный summary-лог`.

PM2-секцию НЕ удалять, НЕ изменять, НЕ переименовывать. Новая секция дополняет, не заменяет.

**Содержание новой секции** (вставить дословно):

```markdown
## Деплой через Docker / Timeweb Cloud Apps

Альтернатива PM2-пути для тех, кто хочет управляемый деплой без ручной настройки VPS. Подход: маркетплейс **Timeweb Cloud Apps** → тип "Docker Compose Latest" → подключение GitHub-репо → авто-деплой по `git push`. Образ собирается из `Dockerfile` в корне репо, оркестрация — через `docker-compose.yml`.

PM2-путь (`ecosystem.config.cjs`) остаётся рабочим — выбирай тот, который удобнее.

### Шаг 1. Сгенерировать `TG_SESSION` локально

`npm run login` — интерактивный скрипт, запрашивает телефон, код из Telegram, 2FA-пароль. **Не запускай его в контейнере** — у образа нет stdin, и login-скрипт исключён из build context (см. `.dockerignore`).

После успеха скопируй строку StringSession — она понадобится в Шаге 2.

### Шаг 2. Создать App в Timeweb Cloud Apps

1. Войти в Timeweb Cloud → Apps → создать приложение → выбрать **Docker Compose Latest** в маркетплейсе.
2. Подключить GitHub-репо (`tg-parser-demo`), ветку `main`. Timeweb сам найдёт `docker-compose.yml` в корне.
3. Задать env-переменные через UI (Timeweb передаёт их в контейнер, `.env` файл НЕ нужен на проде):
   - **Обязательные:** `TG_API_ID`, `TG_API_HASH`, `TG_SESSION` (из Шага 1), `TG_BOT_TOKEN`, `TG_CHANNEL_ID`, `DEEPSEEK_API_KEY`, `BOT_TOKEN_ALERTS`, `ALERTS_CHAT_ID`.
   - **Опциональные** (значения по умолчанию подходят, см. `.env.example`): `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `FETCH_WINDOW_HOURS`, `MAX_MESSAGES_PER_CHANNEL`, `CHANNEL_DELAY_MS`, `LOG_LEVEL`.

После сохранения Timeweb автоматически собирает образ и запускает контейнер. Каждый последующий `git push` в `main` триггерит ребилд и редеплой.

### Шаг 3. Подключить persistent volume на `/app/data` (опционально, рекомендуется)

В Timeweb UI добавь volume на mount-point `/app/data`. Без volume каждый редеплой обнуляет:
- `data/raw/YYYY-MM-DD.json` — сырые посты до dedup и LLM (нужны для аудита).
- `data/output/YYYY-MM-DD.md` — отправленный HTML-дайджест (байт-в-байт).
- `data/dedup-cache/` — hash-кэш для DEDUP-логики (без него возможны повторы постов в первый день после редеплоя).

### Шаг 4. Локальное тестирование Docker-стека

Перед пушом в Timeweb можно проверить локально:

    docker compose up --build

Поведение должно быть идентично `npm start`: процесс висит, лог `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter`, в 20:15 MSK (с jitter 0–30 мин) запускается tick. Остановка — `Ctrl+C` → graceful shutdown (благодаря `init: true` в `docker-compose.yml`, иначе SIGTERM не дойдёт до Node как PID 1).

Однократный прогон без ожидания cron:

    docker compose run --rm tg-parser node --import tsx scripts/run-once.ts

### Замечание про identity Telegram-аккаунта

При первом подключении `TG_SESSION` из Timeweb-IP (датацентр в РФ) Telegram пришлёт user-аккаунту уведомление **«Новый вход»**. Это нормально — `CLIENT_IDENTITY` в `src/telegram.ts` ту же. Просто подтверди вход в личном Telegram-клиенте и продолжи. Повторных уведомлений при каждом редеплое не будет (session тот же).

### Что НЕ переносится в Docker-путь

- `pm2 logs tg-parser` — на Timeweb используй встроенные логи Apps (вкладка Logs в UI).
- `pm2 save` / `pm2 startup` / `pm2 resurrect` — Timeweb сам перезапускает контейнер по `restart: unless-stopped`.
- Файл `~/.pm2/logs/tg-parser-out.log` — логи stdout/stderr контейнера видны в Timeweb UI; для grep — экспорт через UI или `docker logs` локально.
```

После вставки убедиться, что:
- Заголовки уровня `##` корректны и идут в порядке: `## Запуск на VPS (PM2)` → `## Деплой через Docker / Timeweb Cloud Apps` → `## Ежедневный summary-лог`.
- Между секциями стоит ровно одна пустая строка.
- Markdown-списки и code-блоки рендерятся (отступы 4 пробела для команд — как в существующих секциях README).
  </action>
  <verify>
    <automated>grep -q "## Деплой через Docker / Timeweb Cloud Apps" README.md && grep -q "Docker Compose Latest" README.md && grep -q "TG_SESSION" README.md && grep -q "init: true" README.md && grep -q "/app/data" README.md && grep -q "## Запуск на VPS (PM2)" README.md && grep -q "## Ежедневный summary-лог" README.md && awk '/^## Запуск на VPS \(PM2\)/{pm2=NR} /^## Деплой через Docker/{docker=NR} /^## Ежедневный summary-лог/{summary=NR} END{exit !(pm2 < docker && docker < summary)}' README.md</automated>
  </verify>
  <done>
- README.md содержит новую секцию `## Деплой через Docker / Timeweb Cloud Apps` между PM2-секцией и summary-секцией.
- Секция содержит 4 шага: локальный `npm run login` для TG_SESSION, создание App в Timeweb, подключение volume на `/app/data`, локальное тестирование `docker compose up --build`.
- Список env-переменных (обязательные + опциональные) совпадает с `.env.example`.
- Замечание про "новый вход" Telegram включено.
- PM2-секция не модифицирована (`pm2 start ecosystem.config.cjs`, `kill_timeout: 180000`, etc. на месте).
- Порядок секций: PM2 → Docker → Ежедневный summary-лог.
  </done>
</task>

</tasks>

<verification>
**После всех трёх задач — оператор проверяет вручную:**

1. **Локальный билд работает:**
   ```
   docker compose build
   ```
   Завершается без ошибок, размер образа разумный (< 500 MB).

2. **Локальный запуск работает:**
   ```
   docker compose up
   ```
   Лог содержит `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter`. Процесс висит. `Ctrl+C` → graceful shutdown за < 3 сек (если активного прогона нет).

3. **Однократный прогон через docker compose run:**
   ```
   docker compose run --rm tg-parser node --import tsx scripts/run-once.ts
   ```
   Идентичен `npm run start:once` — собирает посты, прогоняет через DeepSeek, шлёт дайджест в канал.

4. **Build context минимален:** `docker compose build` в выводе показывает `transferring context` < 5 MB (без node_modules и data).

5. **Локальная разработка не затронута:**
   ```
   npm start
   ```
   работает как раньше (использует `--env-file=.env` через `npm scripts`).

6. **Timeweb-деплой:** оператор push'ит в `main`, создаёт App в Timeweb UI, заполняет env, запускает. В Timeweb logs появляется `daemon started`.
</verification>

<success_criteria>
- [ ] Три новых файла (`Dockerfile`, `docker-compose.yml`, `.dockerignore`) созданы в корне репо.
- [ ] `Dockerfile`: `node:20-slim` + `tzdata` + `ENV TZ=Europe/Moscow` + `npm ci` + CMD без `--env-file`.
- [ ] `docker-compose.yml`: `init: true` (для graceful shutdown) + volume `./data:/app/data` + `restart: unless-stopped` + `env_file: .env`.
- [ ] `.dockerignore` исключает `.env`, `node_modules`, `data`, `.planning`, `scripts/login.ts`, `ecosystem.config.cjs`, `prod-channels.yaml`.
- [ ] `CLAUDE.md` секция Constraints обновлена (одна строка про Docker как опциональный).
- [ ] `README.md` содержит новую секцию между PM2-секцией и summary-секцией с 4 шагами и замечанием про identity.
- [ ] PM2-путь (`ecosystem.config.cjs`, npm scripts) не изменён.
- [ ] Содержимое `src/`, `scripts/run-once.ts`, `scripts/login.ts` не изменено.
</success_criteria>

<output>
После завершения создать `.planning/quick/260427-lky-tg-parser-demo-docker-timeweb-cloud-apps/260427-lky-SUMMARY.md` с разделами:
- What was done (3 task outcomes)
- Files created/modified (paths + brief description)
- Verification status (automated checks pass, manual `docker compose up --build` — за оператором)
- Followups (опц.: USER в Dockerfile + права на volume; multi-stage build для минимизации образа; healthcheck в docker-compose)
</output>
