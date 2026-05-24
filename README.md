# tg-parser-demo

Сервис для ежедневного мониторинга российского нефтегаза / нефтехимии и оперативной работы с битумными xlsx-выгрузками. Запускается одним Node-процессом на VDS под Docker, по cron-расписанию собирает данные и публикует результат в закрытый Telegram-канал.

## Что делает проект

В одном долгоживущем процессе (`src/run.ts`) живут четыре потока работы:

1. **Дневной TG-дайджест.** Каждый день в `CRON_SCHEDULE` (дефолт 21:00 MSK + рандомный jitter 0–30 мин) бот обходит публичные каналы из [`channels.json`](channels.json) через GramJS, забирает посты за последние 24 часа, прогоняет их через DeepSeek и рендерит HTML-дайджест из 5 секций (🚢 Бункер / 🛢 Масла / ✈️ Керосин / ⚗️ Нефтехимия / 🛣 Битум) + блок 🏢 #Компании (orphans с упоминанием Роснефть / Лукойл / ГПН).
2. **Веб-дайджест.** Сразу после TG-пайплайна параллельно скрейпятся публичные сайты из [`websites.json`](websites.json) (cheerio + AbortController), пропускаются через тот же DeepSeek-промпт и рендерятся отдельным сообщением с маркером 🌐 Веб-источники.
3. **Дашборд.** После обоих пайплайнов собирается аккумулированный HTML-дашборд по всему архиву `data/raw/` + `data/output/` (Chart.js timeline + Top-15 источников + распределение по категориям + лента событий с фильтрами) и отправляется в тот же канал как HTML-документ (`dashboard-DD.MM.YYYY.html`).
4. **Daily backup.** Отдельный cron `15 3 * * *` Europe/Moscow — `tar czf` папок `data/config/` + `data/state/` и отправка архива в личку владельцу через alert-бота (на случай восстановления при потере VDS).

### Что в итоге приходит в закрытый канал (`TG_CHANNEL_ID`)

После каждого ежедневного прогона канал получает три (или меньше, если что-то пусто) подряд идущих сообщения:

| # | Что | Когда |
|---|---|---|
| 1 | `<b>Нефтегаз — DD месяц YYYY г.</b>` — TG-дайджест из 5 секций + Компании | TG-пайплайн завершился успешно и нашлись посты |
| 2 | `<b>🌐 Веб-источники — DD месяц YYYY г.</b>` — веб-дайджест | Web-пайплайн отработал, есть события |
| 3 | `dashboard-DD.MM.YYYY.html` — HTML-документ с интерактивным дашбордом | Любой из пайплайнов записал данные в архив |

Каждое сообщение режется на части `(1/N)` если упирается в лимит 4096 символов.

### Какая ещё есть инфраструктура

- **Delivery-бот** (`TG_BOT_TOKEN`) — один и тот же бот доставляет дайджесты в канал и принимает команды от оператора в личке (см. ниже).
- **Alert-бот** (`BOT_TOKEN_ALERTS`) — отдельный бот для технических ошибок. Шлёт в личку владельца (`ALERTS_CHAT_ID`) при падении любой стадии пайплайна (`stage: "tick" | "web" | "dashboard" | "bot"`), туда же уходит daily backup. Не мешает каналу заказчика.
- **DeepSeek** (`DEEPSEEK_API_KEY`) — OpenAI-совместимый SDK для классификации постов, генерации экстрактивных summary и `/summarize`-нарратива по битуму.
- **Persistent volume** `/app/data` (на VDS — bind `/opt/tg-parser-demo/data`) — переживает редеплои. Структура: `config/` (channels, websites), `state/` (hash-cache, web-cache), `raw/` (сырые посты), `output/` (HTML-дайджесты), `uploads/YYYY-Www/` (xlsx от бота), `logs/`, `backups/`, `dashboard/index.html`.

### Команды бота (личка от allowlist-юзеров)

Все команды доступны только пользователям из `BOT_ALLOWED_USER_IDS`. Не-allowlist игнорируется молча. Команды зарегистрированы в меню Telegram (иконка `/` слева от поля ввода) + продублированы reply-клавиатурой 2×2 под полем.

| Команда / кнопка | Что делает |
|---|---|
| `/start` | Приветствие + закрепляет reply-клавиатуру 2×2 |
| `/help` | Инструкция: как загружать xlsx и какие команды доступны |
| `/channels` (📋 Каналы новостей) | Показать текущий список каналов из `data/config/channels.json` |
| `/add_channel <username>` | Добавить публичный канал (валидация regex, идемпотентно) — будет использован в ближайшем прогоне |
| `/remove_channel <username>` | Удалить канал, inline-кнопки «Удалить»/«Отмена» |
| `/upload_status` (📊 Статус загрузок) | Показать, что лежит в `data/uploads/<latest-week>/`: prices/fca/volumes |
| `/summarize` (🧠 Сделать сводку) | LLM-нарратив от DeepSeek по битум-xlsx последней недели (требует prices+fca) |
| **Прислать xlsx-файл** | Бот определяет тип по маркеру A1 (`Цена битум на бирже` → `birzha_prices`, `Объем битум на бирже` → `birzha_volumes`, `Битум цены продавцов FCA` → `fca`), сохраняет в `data/uploads/YYYY-Www/<type>.xlsx`. Когда в неделе собрана пара prices+fca — автоматически считает Δ цен и отправляет Markdown-отчёт |

## Как пользоваться

### 1. Локальная проверка

```bash
npm install
npm run login     # разовая генерация TG_SESSION; интерактивный prompt
npm start         # daemon: висит, тикает по CRON_SCHEDULE
```

Доступные npm-скрипты:

| Скрипт | Что делает |
|---|---|
| `npm start` | Запустить daemon (cron + bot polling + backup-cron). Это то, что крутится на VDS. |
| `npm run start:once` | Прогнать TG-пайплайн один раз (без cron, без web), отправить TG-дайджест + дашборд. Для отладки. |
| `npm run start:once:web` | Прогнать только web-пайплайн один раз. Для отладки websites.json. |
| `npm run login` | Интерактивный prompt, генерирует StringSession для GramJS (нужен ровно один раз). |
| `npm run dashboard` | Локально собрать `data/dashboard/index.html` из существующего архива без отправки в канал. |
| `npm run discover:rss` | Найти RSS-фиды на сайтах из `websites.json` (вспомогательный скрипт). |
| `npm test` | vitest — юнит-тесты в `src/__tests__/`. |

### 2. Управление каналами через бота

Узнайте свой numeric user_id (напишите [@userinfobot](https://t.me/userinfobot), скопируйте поле `Id`), добавьте в `.env`:

```env
BOT_ALLOWED_USER_IDS=12345678
```

После рестарта daemon'а пишите боту в личку. **Внимание:** канал ещё нужно подписать на user-аккаунте, чей `TG_SESSION` лежит в `.env`, — иначе GramJS выбросит `ChannelPrivateError` и канал будет пропущен. Бот сам каналы не подписывает — только редактирует JSON.

### 3. Загрузка битум-xlsx

В личку боту переслать файл `*.xlsx`. Бот:

1. Скачает файл через `getFile` Bot API.
2. Определит тип по тексту в ячейке A1 (case-insensitive).
3. Если тип распознан — сохранит в `data/uploads/<ISO-week>/<type>.xlsx`, где неделя берётся из даты данных в файле, а не из «сейчас».
4. Если в неделе уже есть пара prices+fca — посчитает Δ цен (analyzer) и отправит Markdown-отчёт по частям.
5. Команда `/summarize` дополнительно генерирует human-readable LLM-нарратив поверх собранной пары — не пишет на диск, только читает.

### 4. Алерты и архивы

- **Технические алерты.** Падение TG / web / dashboard / bot стадии → alert в личку владельца с `runId` и stacktrace. Канал заказчика не загрязняется.
- **Daily backup.** Каждый день в 03:15 MSK архив `config/` + `state/` (≈3–5 КБ) уходит в личку владельцу через alert-бота. Локально хранится 7 копий в `data/backups/`, старые удаляются.
- **Архивы прогонов.** `data/raw/YYYY-MM-DD.json` (сырые посты до dedup/LLM), `data/output/YYYY-MM-DD.md` (HTML-дайджест байт-в-байт), `data/state/hash-cache.json` (SHA-256, rolling 14 дней). Веб-дубликаты с суффиксом `-web`.

## Все ключи окружения

Шаблон — в [`.env.example`](.env.example). На VDS файл лежит в `/opt/tg-parser-demo/.env` с правами 600. На локалке скопировать в корень репо: `cp .env.example .env`.

### Обязательные

| Ключ | Назначение | Где взять |
|---|---|---|
| `TG_API_ID` | API ID Telegram-приложения для GramJS user-сессии. Число. | [my.telegram.org](https://my.telegram.org) → API development tools → App api_id |
| `TG_API_HASH` | API hash того же приложения. Строка. | Там же, поле api_hash |
| `TG_SESSION` | StringSession user-аккаунта (читает каналы). | Генерируется один раз через `npm run login` — введите телефон, код из Telegram, 2FA. Результат — длинная строка, скопируйте сюда. **Не публикуйте: это полный доступ к user-аккаунту.** |
| `TG_BOT_TOKEN` | Токен delivery-бота. Тем же ботом приходят дайджесты в канал и принимаются команды/файлы в личке. | [@BotFather](https://t.me/BotFather) → `/newbot` → скопировать токен `123456:ABC...` |
| `TG_CHANNEL_ID` | ID закрытого канала, в который доставляется дайджест. Формат `-100xxxxxxxxxx`. Бот должен быть админом канала с правом Post Messages. | Создать приватный канал → добавить бота админом → переслать любое сообщение из канала в [@username_to_id_bot](https://t.me/username_to_id_bot) → скопировать numeric ID |
| `BOT_ALLOWED_USER_IDS` | Numeric Telegram user.id (через запятую, без пробелов), которым разрешены команды бота. Пусто или не задано → polling выключен, daemon стартует только с cron. | Написать [@userinfobot](https://t.me/userinfobot) → скопировать `Id`. Пример: `BOT_ALLOWED_USER_IDS=12345678,87654321` |
| `DEEPSEEK_API_KEY` | Ключ DeepSeek API. Используется и для дайджеста, и для `/summarize`. | [platform.deepseek.com](https://platform.deepseek.com) → API keys |
| `BOT_TOKEN_ALERTS` | Токен **отдельного** alert-бота. Шлёт техошибки и daily backup в личку владельцу — НЕ в канал заказчика. | [@BotFather](https://t.me/BotFather) → `/newbot` (второй бот, отдельный от delivery) |
| `ALERTS_CHAT_ID` | Numeric chat_id личного чата владельца с alert-ботом. | Начать диалог с alert-ботом (`/start`), переслать его ответное сообщение в [@userinfobot](https://t.me/userinfobot), скопировать `Id` |

### Опциональные (дефолты подходят)

| Ключ | Дефолт | Что значит |
|---|---|---|
| `DEEPSEEK_MODEL` | `deepseek-chat` | Модель DeepSeek. Не менять без причины — промпт-инструкции рассчитаны на `deepseek-chat`. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Базовый URL OpenAI-совместимого SDK. |
| `CLASSIFY_CHUNK_SIZE` | `40` | Сколько постов в один LLM-запрос Pass-1 классификации. Уменьшать при таймаутах, увеличивать только осознанно. |
| `FETCH_WINDOW_HOURS` | `24` | Окно чтения постов на канал. |
| `MAX_MESSAGES_PER_CHANNEL` | `50` | Лимит сообщений на канал за один прогон. |
| `CHANNEL_DELAY_MS` | `1500` | Базовая задержка между каналами; добавляется jitter 0–2500 мс (итого 1.5–4 с). При FloodWait — поднять до 2500. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. |
| `CRON_SCHEDULE` | `0 21 * * *` | Cron-выражение в Europe/Moscow (5 полей). К нему добавляется jitter 0–30 мин внутри `tick()`. Примеры: `15 20 * * *` (20:15), `0 9,21 * * *` (дважды в день). |
| `DATA_DIR` | `./data` локально, `/app/data` в Docker | Корень persistent volume. На VDS — `/app/data`, биндится на `/opt/tg-parser-demo/data`. |
| `SEED_DIR` | `./` локально, `/app/seed` в Docker | Откуда брать дефолтные `channels.json` / `websites.json` при первом старте, если в volume их нет. |
| `WEB_FETCH_TIMEOUT_MS` | `30000` | Timeout одного fetch'а в web-scraper (AbortController). |
| `WEB_USER_AGENT` | реалистичный Chrome UA | Чтобы обходить bot-blockers. |
| `TG_BACKUP_CHANNEL_ID` | — | Опциональный канал для daily backup. Если не задан — backup идёт в `ALERTS_CHAT_ID`. |

## Деплой

Прод — **Timeweb VDS (Ubuntu 24.04) + Docker + GitHub Actions auto-deploy**. Локально и для отладки — Docker Compose или прямой `npm start`. PM2-вариант оставлен как опция, но не основной путь.

### Архитектура текущего деплоя

```
GitHub main ── push ──► .github/workflows/deploy.yml
                           │ (appleboy/ssh-action)
                           ▼
                  ssh root@<VDS_HOST> bash /opt/tg-parser-demo/deploy.sh
                           │
                           ├─ tar czf /opt/backups/pre-deploy-TS.tgz data/config data/state
                           ├─ git fetch + git reset --hard origin/main
                           ├─ docker compose build --pull
                           └─ docker compose up -d --remove-orphans
                                      │
                                      ▼
                              tg-parser container
                              ├─ /app (код, immutable)
                              ├─ /app/seed (default channels.json / websites.json)
                              └─ /app/data ◄── bind /opt/tg-parser-demo/data
                                              (persistent: config/state/raw/output/logs/backups/uploads/dashboard)
```

Ключевые свойства:

- **Persistent volume** — `channels.json` и `websites.json` живут в `/opt/tg-parser-demo/data/config/`, переживают редеплой. На первом запуске `src/seed.ts` копирует туда дефолты из `/app/seed/`. Версионируются в репо как seed-defaults для свежей установки.
- **Pre-deploy snapshots** — `deploy.sh` перед каждым редеплоем делает `tar.gz` папок `config/` + `state/` в `/opt/backups/`. Хранятся 5 последних — мгновенный rollback при битом релизе.
- **Hard reset** на `origin/main` — `git fetch + git reset --hard` вместо `git pull --ff-only`. Защита от случайных правок на проде, которые блокировали бы FF.
- **`init: true`** в `docker-compose.yml` — иначе Node как PID 1 не получает SIGTERM и graceful shutdown (`src/run.ts` ждёт активный прогон, потом `exit 0`) не работает.
- **TZ=Europe/Moscow** прибит в `Dockerfile`, плюс `apt-get install tzdata tar` — нужны node-cron'у и `src/backup.ts` соответственно.

### Первичная настройка VDS (один раз)

#### Шаг 1. Сгенерировать `TG_SESSION` локально

```bash
npm install
npm run login
```

Скрипт запросит телефон в международном формате, код из Telegram, 2FA-пароль. Скопировать полученную StringSession — она нужна в Шаге 3.

> **Никогда не запускать `npm run login` в Docker-контейнере.** У образа нет stdin, login-скрипт исключён из build context через `.dockerignore`.

#### Шаг 2. Bootstrap VDS

Скопировать `bootstrap.sh` на свежий Ubuntu 24.04 VDS и запустить:

```bash
scp bootstrap.sh root@<VDS_HOST>:/tmp/
ssh root@<VDS_HOST> "bash /tmp/bootstrap.sh"
```

Скрипт идемпотентный, делает:

- `apt-get install docker.io docker-compose-plugin git` (если ещё не стоит)
- `systemctl enable --now docker`
- `git clone https://github.com/vladilenm/tg-parser-digest.git /opt/tg-parser-demo`
- Создаёт `/opt/tg-parser-demo/.env` с пустым шаблоном (если файла ещё нет)

Если репо переехало:

```bash
REPO_URL=https://github.com/<owner>/<repo>.git bash /tmp/bootstrap.sh
```

#### Шаг 3. Заполнить `.env` на VDS

```bash
ssh root@<VDS_HOST>
nano /opt/tg-parser-demo/.env    # см. секцию «Все ключи окружения»
chmod 600 /opt/tg-parser-demo/.env
```

Минимум — 9 обязательных ключей из таблицы выше.

#### Шаг 4. Первый деплой вручную

```bash
ssh root@<VDS_HOST>
sudo bash /opt/tg-parser-demo/deploy.sh
```

Что произойдёт: snapshot → `git pull` → `docker compose build --pull` → `docker compose up -d`. В конце выведет последние 50 строк логов — должно быть:

```
daemon started, schedule: 0 21 * * * Europe/Moscow + 0–30min jitter
[backup] scheduled: 15 3 * * * Europe/Moscow
[bot] polling started (allowlist size=N)
[bot] setMyCommands ok (7 commands)
```

#### Шаг 5. GitHub Actions auto-deploy

В **Settings → Secrets and variables → Actions** репозитория:

**Secrets:**
- `VDS_HOST` — IP или домен VDS
- `VDS_USER` — обычно `root` (или пользователь с docker-правами)
- `VDS_SSH_KEY` — приватный ключ целиком, начиная с `-----BEGIN OPENSSH PRIVATE KEY-----`
- `VDS_PORT` — опционально, дефолт 22

**Variables:**
- `VDS_DEPLOY_ENABLED` = `true`

Воркфлоу [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) триггерится на `push` в `main` и через `workflow_dispatch`. Пока `VDS_DEPLOY_ENABLED ≠ true`, шаг тихо скипается (никаких красных галочек на PR).

### Команды для повседневной работы

#### Логи

```bash
ssh root@<VDS_HOST>
cd /opt/tg-parser-demo
docker compose logs -f                    # tail -f stdout+stderr
docker compose logs --tail 200            # последние 200 строк
docker compose logs --since 1h            # за последний час
grep '\[summary\]' /opt/tg-parser-demo/data/logs/run-*.log   # дневные summary
```

#### Деплой / ребилд

```bash
# Из CI: просто push в main — GitHub Actions сам зайдёт и выполнит deploy.sh

# Вручную на VDS:
sudo bash /opt/tg-parser-demo/deploy.sh

# Ручной запуск воркфлоу без push:
# GitHub → Actions → Deploy to Timeweb VDS → Run workflow
```

#### Остановка / рестарт без деплоя

```bash
ssh root@<VDS_HOST>
cd /opt/tg-parser-demo
docker compose restart                    # graceful: SIGTERM → ждёт активный tick → exit 0 → respawn
docker compose down                       # остановить
docker compose up -d                      # поднять с текущим образом
```

#### Локальная отладка Docker-стека

```bash
docker compose up --build                 # compose сам подхватит ./.env
# Один прогон без ожидания cron:
docker compose run --rm tg-parser node --import tsx scripts/run-once.ts
```

#### Откат на предыдущий релиз

Pre-deploy snapshots живут в `/opt/backups/`, по 5 последних:

```bash
ssh root@<VDS_HOST>
ls -lt /opt/backups/pre-deploy-*.tgz
# Откат конфигов:
tar xzf /opt/backups/pre-deploy-<TS>.tgz -C /opt/tg-parser-demo/

# Откат кода:
cd /opt/tg-parser-demo
git log --oneline -n 5
git checkout <prev-sha>
docker compose up -d --build
```

После отката `deploy.sh` НЕ будет тянуть `main` (detached HEAD блокирует `git reset --hard origin/main` — by design). Чтобы вернуться к свежему main: `git checkout main && bash deploy.sh`.

#### Восстановление из daily backup

В личке alert-бота лежит ежедневный `config-YYYY-MM-DD.tgz` с `config/` + `state/`. На чистой машине:

```bash
mkdir -p /opt/tg-parser-demo/data
tar xzf config-YYYY-MM-DD.tgz -C /opt/tg-parser-demo/data
# Дальше bootstrap + deploy как обычно — seed-логика увидит существующие config/ и не перетрёт.
```

### Критерии приёмки после деплоя

1. `docker compose logs --tail 50` показывает `daemon started, schedule: ...Europe/Moscow`, `[backup] scheduled: ...`, `[bot] polling started`.
2. В назначенное `CRON_SCHEDULE` время + 0–30 мин запускается `tick`, в канал приходят TG-дайджест + web-дайджест + `dashboard-DD.MM.YYYY.html`.
3. В `data/output/YYYY-MM-DD.md` лежит HTML, байт-в-байт идентичный отправленному.
4. При намеренной ошибке (например, неверный `DEEPSEEK_API_KEY`) алерт приходит в личку владельца ≤60 сек, канал заказчика чист.
5. На следующее утро в 03:15 MSK в личке alert-бота появляется `config-YYYY-MM-DD.tgz` размером ~3–5 КБ.

## Структура репозитория

```
./
├── package.json              # 7 npm-скриптов + 7 runtime-зависимостей
├── tsconfig.json             # strict, ESNext, moduleResolution: bundler
├── Dockerfile                # node:20-slim + tzdata + tar
├── docker-compose.yml        # service tg-parser, init: true, volume /app/data
├── bootstrap.sh              # однократная установка VDS
├── deploy.sh                 # snapshot + git pull + docker rebuild
├── ecosystem.config.cjs      # альтернативный PM2-режим (не основной путь)
├── .env.example              # шаблон секретов
├── channels.json             # seed-defaults для data/config/channels.json
├── websites.json             # seed-defaults для data/config/websites.json
├── .github/workflows/
│   └── deploy.yml            # GitHub Actions → ssh-action → deploy.sh
├── docs/
│   ├── ABOUT.md              # подробное описание архитектуры
│   ├── RUNBOOK.md            # сценарии диагностики и восстановления
│   ├── CHANNELS.md           # как добавить/заменить канал
│   ├── db-deploy.md          # обоснование persistent-volume архитектуры
│   └── hosting.md            # выбор Timeweb VDS vs Cloud Apps
├── data/                     # persistent volume (в .gitignore)
│   ├── config/               # channels.json + websites.json (mutable через бота)
│   ├── state/                # hash-cache.json + web-posts-*.json
│   ├── raw/                  # YYYY-MM-DD.json + YYYY-MM-DD-web.json
│   ├── output/               # YYYY-MM-DD.md + YYYY-MM-DD-web.md
│   ├── uploads/YYYY-Www/     # xlsx-выгрузки, присланные боту
│   ├── logs/                 # run-YYYY-MM-DD.log
│   ├── backups/              # daily tar.gz (7 копий)
│   └── dashboard/index.html  # последний дашборд
├── scripts/
│   ├── login.ts              # генерация TG_SESSION
│   ├── run-once.ts           # одиночный TG-прогон
│   ├── run-once-web.ts       # одиночный web-прогон
│   ├── build-dashboard.ts    # сборка дашборда без отправки
│   ├── discover-rss.ts       # поиск RSS-фидов
│   └── diagnose-web-fetches.mjs
└── src/
    ├── run.ts                # daemon entrypoint: cron + bot polling + backup-cron + graceful shutdown
    ├── pipeline.ts           # runPipeline() — TG-оркестратор
    ├── web-scraper.ts        # runWebPipeline() — веб-оркестратор + парсинг
    ├── dashboard.ts          # buildDashboard + buildAndSendDashboard
    ├── backup.ts             # tar.gz config/state → sendDocument в alert-бот
    ├── bot.ts                # polling + 7 команд + xlsx-handler
    ├── upload/               # битум-xlsx pipeline: detect → parse → analyze → render
    ├── telegram.ts           # GramJS client + fetchLast24h
    ├── summarize.ts          # DeepSeek + verification keyQuote + renderHtml
    ├── deliver.ts            # sendMessage + sendDocument + chunkHtml
    ├── alert.ts              # sendAlert через alert-бота
    ├── archive.ts            # writeRaw / writeOutput (атомарная запись)
    ├── dedup.ts              # SHA-256 hash-cache (rolling 14 дней)
    ├── channels-store.ts     # CRUD над channels.json с atomic write + mutex
    ├── seed.ts               # ensureSeedFiles() — копирование дефолтов в volume
    ├── paths.ts              # все пути под DATA_DIR / SEED_DIR
    ├── schema.ts             # Zod-схемы (DigestJson + websites + channels)
    ├── types.ts              # Post / DigestItem / RunSummary
    ├── logger.ts             # log.info/warn/error + logRunSummary
    └── __tests__/            # vitest юнит-тесты
```

## Оперативная документация

- [docs/ABOUT.md](docs/ABOUT.md) — подробная архитектура и обоснование решений
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — сценарии диагностики: FloodWait, ChannelPrivateError, сбой DeepSeek, сбой alert-бота
- [docs/CHANNELS.md](docs/CHANNELS.md) — checklist добавления/замены канала
- [docs/db-deploy.md](docs/db-deploy.md) — обоснование архитектуры persistent storage + backup
- [docs/hosting.md](docs/hosting.md) — выбор VDS vs Cloud Apps

## Лицензия

Private / personal use.
