---
phase: 260427-lky-quick
plan: 01
subsystem: deploy/docker
tags:
  - docker
  - deploy
  - timeweb
  - infra
requirements_completed:
  - QUICK-DOCKER-01
  - QUICK-DOCKER-02
  - QUICK-DOCKER-03
  - QUICK-CONSTRAINT-01
  - QUICK-DOCS-01
key_files:
  created:
    - Dockerfile
    - docker-compose.yml
    - .dockerignore
  modified:
    - CLAUDE.md
    - README.md
commits:
  - 8ab7c81 — feat(260427-lky-01): add Dockerfile, docker-compose.yml, .dockerignore for Timeweb Cloud Apps deploy
  - 8ec1e66 — docs(260427-lky-01): mark Docker as optional in CLAUDE.md Constraints
  - bcd7914 — docs(260427-lky-01): add Docker / Timeweb Cloud Apps deploy section to README
metrics:
  tasks: 3
  files_changed: 5
  completed: "2026-04-27"
---

# Quick Task 260427-lky: Docker for Timeweb Cloud Apps Summary

Упаковали tg-parser-demo в Docker (`Dockerfile` + `docker-compose.yml` + `.dockerignore`), задокументировали путь деплоя через Timeweb Cloud Apps в README, и пометили Docker как опциональный в CLAUDE.md — без изменений в `src/`, `scripts/`, `package.json`, `ecosystem.config.cjs`.

## What was done

### Task 1 — Создание Docker-инфраструктуры (commit 8ab7c81)
Созданы три новых файла в корне репо:

- **`Dockerfile`** — образ `node:20-slim` + установка `tzdata` (для корректного резолва `Europe/Moscow` в node-cron и `Intl.DateTimeFormat`), `ENV TZ=Europe/Moscow`, `npm ci` по lock-файлу, копируется только runtime (`src/`, `scripts/`, `tsconfig.json`, `channels.yaml`, `package*.json`), `mkdir -p /app/data` для архивов, `CMD ["node", "--import", "tsx", "src/run.ts"]` (без `--env-file`, так как `.env` исключён из образа).
- **`docker-compose.yml`** — стек с `init: true` (критично для graceful shutdown через PID 1 / SIGTERM), `restart: unless-stopped`, `env_file: [{path: .env, required: false}]` (чтобы Compose не падал на Timeweb где `.env` отсутствует), `environment: TZ: Europe/Moscow`, bind mount `./data:/app/data` для persistence, без `version:` и без `ports:`.
- **`.dockerignore`** — исключает секреты (`.env*`), `node_modules`, рантайм-данные (`data`), git-метаданные, планирование (`.planning`), документацию (`docs`, `README.md`, `CLAUDE.md`, `spec-app.md`), альтернативный путь (`ecosystem.config.cjs`), `scripts/login.ts` (интерактивный, в контейнере не работает), `prod-channels.yaml`, логи и IDE-артефакты.

### Task 2 — CLAUDE.md Constraints (commit 8ec1e66)
Точечная замена одной строки в секции `### Constraints` внутри блока `<!-- GSD:project-start -->`:

- **Было:** `- **Нет БД, нет Redis, нет Docker, нет cron** — один процесс, один запуск, без внешней инфры.`
- **Стало:** `- **Нет БД, нет Redis.** Docker — опционально (для деплоя на Timeweb Cloud Apps); локальная разработка остаётся через 'npm start' / 'npm run start:once'. node-cron используется внутри daemon-режима для расписания 20:15 MSK.`

`.planning/PROJECT.md` не содержит этой фразы — не трогали (по правилам плана).

### Task 3 — README "Деплой через Docker / Timeweb Cloud Apps" (commit bcd7914)
Новая `## ` секция вставлена между `## Запуск на VPS (PM2)` и `## Ежедневный summary-лог`. Содержит 4 шага:

1. **Шаг 1** — локальный `npm run login` для генерации `TG_SESSION` (объяснение, почему НЕ запускать в контейнере).
2. **Шаг 2** — создание App в Timeweb Cloud Apps: маркетплейс "Docker Compose Latest" → подключение GitHub-репо → env через UI; перечислены все 8 обязательных и 6 опциональных переменных (источник — `.env.example`).
3. **Шаг 3** — persistent volume на `/app/data` для `data/raw/`, `data/output/`, `data/dedup-cache/`.
4. **Шаг 4** — локальное тестирование `docker compose up --build` и `docker compose run --rm tg-parser node --import tsx scripts/run-once.ts`.

Дополнительно: замечание про identity-уведомление "Новый вход" при первом подключении `TG_SESSION` с Timeweb-IP, и блок "Что НЕ переносится в Docker-путь" (соответствия `pm2 logs` → Timeweb UI, `pm2 save`/`startup` → `restart: unless-stopped`).

PM2-секция не модифицирована, существующая структура README сохранена.

## Files Created / Modified

| File                | Type     | Description                                                                                                   |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`        | created  | Образ node:20-slim + tzdata + npm ci + tsx runtime; CMD без `--env-file`                                       |
| `docker-compose.yml`| created  | `init: true`, `env_file required: false`, volume `./data:/app/data`, TZ Europe/Moscow                         |
| `.dockerignore`     | created  | Минимальный build context — исключены секреты, рантайм-данные, login-скрипт, ecosystem конфиг, prod-каналы    |
| `CLAUDE.md`         | modified | Одна строка в Constraints — Docker помечен как опциональный                                                    |
| `README.md`         | modified | Новая секция "Деплой через Docker / Timeweb Cloud Apps" между PM2 и Ежедневный summary-лог                    |

## Verification Status

### Automated checks (executor)

- [x] `test -f Dockerfile && test -f docker-compose.yml && test -f .dockerignore` — PASS
- [x] Все required-фразы из плана найдены в Dockerfile (`FROM node:20-slim`, `tzdata`, `ENV TZ=Europe/Moscow`)
- [x] `docker-compose.yml` содержит `init: true`, `TZ: Europe/Moscow`, `./data:/app/data`
- [x] `.dockerignore` исключает `.env`, `scripts/login.ts`, `ecosystem.config.cjs`, `prod-channels.yaml`
- [x] `grep -q "Docker — опционально (для деплоя на Timeweb Cloud Apps)" CLAUDE.md` — PASS
- [x] `! grep -q "нет Docker, нет cron" CLAUDE.md` — PASS
- [x] README содержит обе секции (PM2 + Docker), порядок: PM2 → Docker → Ежедневный summary-лог — PASS
- [x] `docker compose config` — компоуз-файл валиден, парсится без ошибок (Docker 29.3.1).
- [x] `npx tsc --noEmit` — без ошибок (исходники не менялись).

### Manual checks (за оператором, по плану §verification)

- [ ] `docker compose build` — успешно, размер образа < 500 MB.
- [ ] `docker compose up` — daemon стартует, лог `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter`. Ctrl+C → graceful shutdown < 3 сек.
- [ ] `docker compose run --rm tg-parser node --import tsx scripts/run-once.ts` — однократный прогон проходит идентично `npm run start:once`.
- [ ] `transferring context` < 5 MB при билде.
- [ ] `npm start` локально работает как раньше (PM2-путь не сломан).
- [ ] Push в `main` → Timeweb Cloud Apps: контейнер поднимается, в Logs UI виден `daemon started`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] env_file без `required: false` ломал `docker compose config`**

- **Найдено в:** Task 1, во время `docker compose config` validation на хост-системе (Docker 29.3.1, Compose v2.x).
- **Issue:** План утверждал «env_file молча игнорируется, если `.env` отсутствует (Docker Compose v2 поведение)» и предлагал плоский синтаксис:
  ```yaml
  env_file:
    - .env
  ```
  Реальное поведение Compose v2.x — fatal error: `env file ... not found`. Это ломает оба сценария:
  - локальную разработку (если `.env` забыт → `docker compose up` падает на этапе валидации, а не на этапе запуска приложения);
  - Timeweb (env приходит из UI, файла `.env` в репо нет → `docker compose up` упал бы при попытке Timeweb развернуть стек).
- **Fix:** Заменил на расширенный синтаксис env_file (поддерживается Compose v2.24+):
  ```yaml
  env_file:
    - path: .env
      required: false
  ```
  Теперь Compose не падает при отсутствии `.env`, но если файл есть — подгружает его как обычно. Добавил комментарий в YAML, объясняющий зачем.
- **Files modified:** `docker-compose.yml`
- **Commit:** 8ab7c81 (включён в первоначальный коммит Task 1, не отдельным).

Других отклонений не было — три задачи выполнены ровно по плану.

## Followups (опциональные, не блокирующие)

1. **`USER node` в Dockerfile + права на volume.** Сейчас контейнер бежит под root, чтобы избежать проблем с правами на bind mount `/app/data` на Timeweb. Безопаснее: `RUN chown -R node:node /app && USER node` + проверка, что volume на Timeweb инициализируется с UID 1000.
2. **Multi-stage build для минимизации образа.** Текущий образ ~250–350 MB (node:20-slim + tzdata + node_modules). Multi-stage с `npm ci --omit=dev` в финальной стадии срежет ~50 MB. Не критично для одного daemon'а.
3. **Healthcheck в docker-compose.** Добавить `healthcheck: { test: ["CMD", "node", "-e", "process.exit(0)"], interval: 60s }` — чтобы Timeweb видел контейнер как unhealthy при зависании Node event loop.
4. **Synchronize PROJECT.md** с CLAUDE.md (Docker — опционально), если/когда там появится фраза-источник для GSD-блока.

## Self-Check: PASSED

Verified:
- [x] FOUND: `Dockerfile` (3060 bytes)
- [x] FOUND: `docker-compose.yml`
- [x] FOUND: `.dockerignore`
- [x] FOUND commit: 8ab7c81 (Task 1)
- [x] FOUND commit: 8ec1e66 (Task 2)
- [x] FOUND commit: bcd7914 (Task 3)
- [x] Все три коммита присутствуют в `git log --oneline -5`
- [x] `npx tsc --noEmit` — без ошибок
- [x] `docker compose config` — валиден
