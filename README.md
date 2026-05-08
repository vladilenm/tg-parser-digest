# tg-parser-demo

Ежедневный (20:15 MSK) HTML-дайджест событий российского нефтегаза/нефтехимии за последние 24 часа в закрытом Telegram-канале. Дайджест разбит на 5 тематических секций (Бункер, Масла, Керосин, Нефтехимия, Битум) + блок «Упоминания компаний» (Роснефть/Лукойл/Газпромнефть). Каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

Long-running daemon на Node.js + node-cron; на VPS работает под PM2 или Docker. Без БД, без внешнего крона — всё в одном процессе.

## Требования

- Node.js **20.6+** (нужен флаг `--env-file` без `dotenv`).
- Telegram-аккаунт, подписанный на все каналы из `channels.json`.
- DeepSeek API-ключ (https://platform.deepseek.com).
- Личный приватный Telegram-канал, в который бот будет постить дайджест.

## Запуск в 3 команды

    npm install
    npm run login     # разовая генерация TG_SESSION
    npm start         # запустить daemon (ежедневно в 20:15 MSK); Ctrl+C — остановить

## Подготовка перед первым прогоном

### 1. Установка зависимостей

    npm install

Будет установлено пять runtime-зависимостей: `telegram` (GramJS), `openai` (DeepSeek через OpenAI-совместимый SDK), `cheerio` (web-scraping HTML-парсер для Phase 3), `node-cron` (daemon-режим с расписанием 20:15 MSK), `zod` (schema-валидация ответа DeepSeek и `websites.json`/`channels.json`).

### 2. Секреты и конфиг

    cp .env.example .env

Заполни в `.env`:

- `TG_API_ID`, `TG_API_HASH` — возьми на https://my.telegram.org → API development tools → Create application.
- `TG_BOT_TOKEN` — создай бота через [@BotFather](https://t.me/BotFather) (`/newbot`). Используется для доставки дайджеста в приватный канал Заказчика.
- `TG_CHANNEL_ID` — создай приватный Telegram-канал, добавь бота админом (право Post Messages), пересылкой любого сообщения из канала на [@username_to_id_bot](https://t.me/username_to_id_bot) получи ID вида `-100xxxxxxxxxx`.
- `DEEPSEEK_API_KEY` — https://platform.deepseek.com → API keys.
- `BOT_TOKEN_ALERTS` — **отдельный** бот (BotFather `/newbot`), только для технических алертов в личку владельца (НЕ в канал Заказчика).
- `ALERTS_CHAT_ID` — numeric chat_id личного чата владельца с alert-ботом. Узнать: начать диалог с alert-ботом (`/start`), переслать его ответ в [@userinfobot](https://t.me/userinfobot).

`TG_SESSION` оставь пустым — его сгенерирует следующий шаг.

### 3. Разовая генерация TG_SESSION

    npm run login

Скрипт спросит телефон (в международном формате), код из Telegram и (если включена) 2FA-пароль. После успеха он напечатает строку StringSession — **скопируй её в `.env` как `TG_SESSION`**.

**Не публикуй `TG_SESSION`** — это полный доступ к твоему user-аккаунту. Файл `.env` уже в `.gitignore`.

### 4. Подписка user-аккаунта на каналы

User-аккаунт, чей `TG_SESSION` лежит в `.env`, **должен быть подписан** на каждый канал из `channels.json` — иначе GramJS выбросит `ChannelPrivateError` и канал будет пропущен.

Список по умолчанию в `channels.json` — отраслевые каналы российского нефтегаза/нефтехимии. Можно заменить на свой список (10–15 публичных каналов по `username`). Управление списком — через `src/channels-store.ts` (или бот-команды `/channels`, `/add_channel`, `/remove_channel` — см. ниже).

### 5. Первый запуск daemon

    npm start

Что произойдёт:

1. Процесс стартует и выводит в stdout: `[<ISO>] [info] daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter`.
2. Процесс висит (event-loop держится от node-cron handle). Пока не 20:15 MSK — ничего не происходит.
3. В 20:15 MSK (с jitter 0–30 мин) запускается `tick()`:
   - Обходит каналы (с задержкой `CHANNEL_DELAY_MS=1500ms + 0–2500ms jitter`), собирает посты за последние 24ч (до 50/канал).
   - **Первая ступень dedup** — in-memory по `${username}:${messageId}` в рамках прогона.
   - **Вторая ступень dedup** — SHA-256 hash-cache (`data/hash-cache.json`, rolling 14 дней) против кросс-прогонных повторов.
   - Если постов 0 — лог `No posts in window — skipping digest`, выхода нет (daemon живёт).
   - Иначе — батч в DeepSeek → ответ проходит Zod-валидацию `DigestJsonSchema`; при мисматче прогон завершается с ошибкой и алертом в личку владельца → верификация дословности `keyQuote` → HTML → Bot API → приватный канал.
4. Структура HTML-дайджеста — 5 тематических секций с emoji-заголовками:
   - 🚢 **Бункер** — бункерное топливо, флот
   - 🛢 **Масла** — смазочные материалы, технические масла
   - ✈️ **Керосин** — авиационный керосин, реактивное топливо
   - ⚗️ **Нефтехимия** — полимеры, газохимия, нефтехимические переделы
   - 🛣 **Битум** — дорожный и строительный битум
   - 🏢 **Упоминания компаний** — посты без чёткой категории, но с упоминанием Роснефть/Лукойл/Газпромнефть (orphans). Пост в категории с mentions получает inline-маркер `[РОСНЕФТЬ]`/`[ЛУКОЙЛ]`/`[ГПН]` перед summary.
   - Пустая секция явно помечается «— нет упоминаний за сутки», не молчит.
5. По итогу tick печатает многострочный summary-лог (см. «Ежедневный summary-лог» ниже).
6. Следующий tick — завтра в 20:15 MSK.

Остановить локально: `Ctrl+C` → graceful shutdown (daemon ждёт активный прогон, потом `exit 0`).

Сетевые сбои во время прогона: GramJS делает до 3 попыток reconnect с exp backoff (1s / 2s / 4s). При исчерпании канал помечается как skipped, попадает в `errors[]` summary-лога, прогон продолжается с остальными каналами.

## Архив прогонов (`data/`)

После каждого tick daemon создаёт или обновляет:

- `data/raw/YYYY-MM-DD.json` — сырые посты, собранные за сутки (до dedup и LLM). Дата по MSK. Записывается сразу после fetch, до остальных шагов — даже если LLM или доставка упали, raw-данные сохранены для аудита.
- `data/output/YYYY-MM-DD.md` — HTML-дайджест байт-в-байт идентичный отправленному в канал Заказчика. Записывается только после успешной доставки.
- `data/hash-cache.json` — SHA-256 хэши доставленных постов (rolling window 14 дней) для кросс-прогонной дедупликации. Обновляется только после успешной доставки, чтобы при сбое следующий тик повторил те же посты.

Директория `data/` добавлена в `.gitignore` (не коммитится). На VDS persistence обеспечивается тем, что `data/` находится внутри рабочей директории `/opt/tg-parser-demo/data/`, которая переживает `git pull`. На Timeweb Cloud Apps — volume на `/app/data` (см. раздел Docker).

## Запуск на VPS (PM2)

На VPS daemon запускается под PM2: process manager мониторит процесс, рестартует при падении, поднимается автоматически после перезагрузки сервера. Установить PM2 глобально нужно один раз:

    npm install -g pm2

Перед запуском задайте `BOT_ALLOWED_USER_IDS` в `.env`, иначе bot polling будет выключен (daemon стартует только с cron). Подробнее — секция «Команды бота» ниже.

Запуск и базовые операции:

    # 1. Запустить daemon по ecosystem-конфигу
    pm2 start ecosystem.config.cjs

    # 2. Проверить статус
    pm2 status

    # 3. Посмотреть логи (stdout + stderr, tail -f)
    pm2 logs tg-parser

    # 4. Сохранить список процессов для auto-resurrect после перезагрузки
    pm2 save

    # 5. Настроить автозапуск PM2 при перезагрузке VPS
    pm2 startup
    # → PM2 выведет systemd-команду; выполни её (нужны sudo-права)

Операции после изменения кода:

    pm2 restart tg-parser       # graceful restart (SIGINT → ждёт текущий прогон → exit 0 → respawn)
    pm2 reload tg-parser        # alias restart для fork mode
    pm2 stop tg-parser          # остановить (без удаления из списка)
    pm2 delete tg-parser        # удалить из списка

`pm2 kill && pm2 resurrect` — полный перезапуск PM2-демона с восстановлением сохранённых процессов из `~/.pm2/dump.pm2` (нужно предварительно сделать `pm2 save`).

Логи PM2:

    pm2 logs tg-parser --out          # только stdout (наш logger)
    pm2 logs tg-parser --err          # только stderr (warn/error)
    ~/.pm2/logs/tg-parser-out.log     # файл stdout (для grep/tail)
    ~/.pm2/logs/tg-parser-error.log   # файл stderr

Конфиг daemon'а — в `ecosystem.config.cjs` (расширение `.cjs`, а не `.js`, потому что проект в ESM-режиме — `"type": "module"` в `package.json`). Ключевые параметры:
- `kill_timeout: 180000` — PM2 ждёт до 3 минут после SIGINT перед SIGKILL, чтобы graceful shutdown успел завершить активный прогон.
- `max_restarts: 10` + `min_uptime: "30s"` — защита от флап-рестартов (если daemon падает в первые 30с, PM2 сдаётся после 10 попыток).
- `max_memory_restart: "300M"` — рестарт при утечке памяти.

## Команды бота

Бот использует тот же `TG_BOT_TOKEN`, что и доставка дайджеста. Дополнительно требуется
`BOT_ALLOWED_USER_IDS` — список Telegram numeric `user.id`, которым разрешено пользоваться командами.

### Настройка allowlist

1. Узнайте свой numeric user_id: напишите [@userinfobot](https://t.me/userinfobot) и скопируйте поле `Id`.
2. Добавьте `BOT_ALLOWED_USER_IDS=12345678,87654321` в `.env` (через запятую, без пробелов).
3. Если переменная пустая или не задана — bot polling не запускается, daemon стартует только с cron.

### Список команд

Все команды отправляются в личку боту от пользователя из allowlist. Не-allowlist пользователи
игнорируются молча (без ответа).

| Команда | Назначение |
|---------|------------|
| `/channels` | Показать текущий список каналов из `channels.json` |
| `/add_channel <username>` | Добавить публичный канал (валидируется regex, идемпотентно) |
| `/remove_channel <username>` | Удалить канал с подтверждением через inline-кнопку |

Примеры:
- `/add_channel @durov`
- `/add_channel durov` (с `@` или без)
- `/remove_channel @some_channel` → бот покажет inline-кнопки «Удалить» / «Отмена»

### Поведение при перезапуске

`pm2 restart` штатно завершает polling-loop (graceful, ≤35s). На boot polling вызывается
`deleteWebhook(drop_pending_updates: false)` — это сохраняет очередь команд, накопившуюся
за время перезапуска.

### Что не делают команды (Out of Scope)

- Не резолвят канал через Telegram — оператор сам ставит подписку на user-аккаунт. Несуществующие
  каналы будут пропущены в pipeline (стандартный обработчик `UsernameNotOccupiedError`).
- Не управляют расписанием прогона / не показывают статус — для этого `pm2 logs`.
- Не работают через webhook — только long-polling.

## Парсинг веб-сайтов

В тот же ежедневный прогон в 20:15 MSK после TG-дайджеста daemon скрейпит публичные веб-сайты из `websites.json` и доставляет отдельный веб-дайджест в канал Заказчика.

### Формат `websites.json`

Файл живёт в корне репо рядом с `channels.json`. Минимальная схема:

```json
{
  "websites": [
    { "url": "https://oilcapital.ru/" },
    { "url": "https://neftegaz.ru/news/", "name": "neftegaz" }
  ]
}
```

- `url` — обязательный, валидируется через `new URL()` (Zod-схема `WebsitesFileSchema` в `src/schema.ts`).
- `name` — опциональный. Используется как идентификатор сайта в дайджесте. Если не задан — берётся `hostname` без префикса `www.`.

Редактирование — вручную (`vim websites.json` + `pm2 restart tg-parser`). Команд бота для управления списком сайтов в текущей версии нет.

### Что Заказчик увидит в канале

После успешного прогона приходят **два сообщения** подряд:

1. **TG-дайджест** — `<b>Нефтегаз — 6 мая 2026 г.</b>` (как раньше, без изменений).
2. **Web-дайджест** — `<b>🌐 Веб-источники — 6 мая 2026 г.</b>` с субзаголовком `<i>X сайтов из Y обработано</i>` и теми же 5 секциями (Бункер / Масла / Керосин / Нефтехимия / Битум) + блок «Упоминания компаний».

Web-сообщение визуально отличается от TG за счёт emoji-маркера 🌐 и слова «Веб-источники».

### Поведение при ошибках

- **Один сайт упал** (network/timeout/<200 chars) — пропускается с записью в лог `[web-scraper] {url}: ...`. Остальные сайты обрабатываются.
- **Все сайты упали** — в канал приходит плейсхолдер «🌐 Веб-источники — {date}» с пустыми секциями + оператору приходит alert в личку (`stage: "web"`).
- **Сайты прошли валидацию, но LLM не нашёл нашей тематики** — веб-сообщение НЕ отправляется (как при пустом TG-прогоне).
- **TG-pipeline упал, web-pipeline не упал** — Заказчик получит только web-дайджест. Оператор получит alert по TG (`stage: "tick"`).

### Архивы

После каждого прогона создаются два дополнительных файла рядом с TG-архивами:

- `data/raw/YYYY-MM-DD-web.json` — массив скрейпленных постов (url + cleaned text) до dedup/LLM.
- `data/output/YYYY-MM-DD-web.md` — финальный HTML web-дайджеста, byte-for-byte идентичный отправленному в канал.

Re-run за тот же день перезаписывает оба файла.

### Конфигурация

Опциональные env-переменные (defaults в `src/web-scraper.ts`):

- `WEB_FETCH_TIMEOUT_MS=30000` — timeout одного fetch'а через AbortController.
- `WEB_USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"` — User-Agent для обхода bot-blockers.

Обязательных новых env-переменных нет.

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
   - **Опциональные** (значения по умолчанию подходят, см. `.env.example`): `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `CLASSIFY_CHUNK_SIZE`, `FETCH_WINDOW_HOURS`, `MAX_MESSAGES_PER_CHANNEL`, `CHANNEL_DELAY_MS`, `LOG_LEVEL`.

После сохранения Timeweb автоматически собирает образ и запускает контейнер. Каждый последующий `git push` в `main` триггерит ребилд и редеплой.

### Шаг 3. Подключить persistent volume на `/app/data` (опционально, рекомендуется)

Volume настраивается **исключительно через Timeweb UI**, не через `docker-compose.yml` — Timeweb Apps sanitizer блокирует секцию `volumes:` в compose-файле (ошибка `volumes is not allowed in docker-compose.yml`). Зайди в настройки App → раздел Volumes / Disks → добавь mount на `/app/data`.

Без подключенного volume каждый редеплой обнуляет:
- `data/raw/YYYY-MM-DD.json` — сырые посты до dedup и LLM (нужны для аудита).
- `data/output/YYYY-MM-DD.md` — отправленный HTML-дайджест (байт-в-байт).
- `data/hash-cache.json` — SHA-256 hash-cache для кросс-прогонной дедупликации (без него возможны повторы постов в первый день после редеплоя).

### Шаг 4. Локальное тестирование Docker-стека

Перед пушом в Timeweb можно проверить локально:

    docker compose up --build

Compose автоматически прочитает `./.env` через стандартный substitution mechanism (`${VAR:-}` в [docker-compose.yml](docker-compose.yml)) — никакого `--env-file` флага не нужно. Поведение должно быть идентично `npm start`: процесс висит, лог `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter`, в 20:15 MSK (с jitter 0–30 мин) запускается tick. Остановка — `Ctrl+C` → graceful shutdown (благодаря `init: true` в `docker-compose.yml`, иначе SIGTERM не дойдёт до Node как PID 1).

Однократный прогон без ожидания cron:

    docker compose run --rm tg-parser node --import tsx scripts/run-once.ts

**Про локальный persistent storage:** в `docker-compose.yml` секции `volumes:` нет (Timeweb sanitizer блокирует, см. Шаг 3) — поэтому при `docker compose down` `/app/data` теряется. Если нужно проверить персистентность локально, добавь bind mount ad-hoc:

    docker compose run --rm -v $(pwd)/data:/app/data tg-parser

Либо временно допиши `volumes: [./data:/app/data]` в свой локальный `docker-compose.yml` — **но не коммить**, иначе следующий деплой на Timeweb снова упадёт.

### Замечание про identity Telegram-аккаунта

При первом подключении `TG_SESSION` из Timeweb-IP (датацентр в РФ) Telegram пришлёт user-аккаунту уведомление **«Новый вход»**. Это нормально — `CLIENT_IDENTITY` в `src/telegram.ts` та же. Просто подтверди вход в личном Telegram-клиенте и продолжи. Повторных уведомлений при каждом редеплое не будет (session тот же).

### Что НЕ переносится в Docker-путь

- `pm2 logs tg-parser` — на Timeweb используй встроенные логи Apps (вкладка Logs в UI).
- `pm2 save` / `pm2 startup` / `pm2 resurrect` — Timeweb сам перезапускает контейнер по `restart: unless-stopped`.
- Файл `~/.pm2/logs/tg-parser-out.log` — логи stdout/stderr контейнера видны в Timeweb UI; для grep — экспорт через UI или `docker logs` локально.

## Деплой на Timeweb VDS

Альтернатива Cloud Apps. Подходит когда нужен **persistent disk** (архивы прогонов в `data/raw/`, `data/output/`, `data/hash-cache.json` должны переживать редеплой). Cloud Apps этого не умеет — sanitizer блокирует `volumes:` в compose, а managed-storage платформа не предоставляет (см. [docs/hosting.md](docs/hosting.md)).

Стек: Ubuntu 24.04 VDS + Docker (через apt) + GitHub Actions для auto-deploy.

### Шаг 1. Заказать VDS и получить SSH-доступ

В Timeweb Cloud → VDS → Ubuntu 24.04 (минимальный тариф достаточен — RAM ≥1GB). Получить root SSH-ключ или пароль.

### Шаг 2. Однократный bootstrap VDS

С локальной машины:

    scp bootstrap.sh root@<VDS_HOST>:/tmp/
    ssh root@<VDS_HOST> "bash /tmp/bootstrap.sh"

`bootstrap.sh` (идемпотентный) делает:
- `apt-get install docker.io docker-compose-plugin git` (если ещё не стоит)
- `systemctl enable --now docker`
- `git clone <REPO_URL> /opt/tg-parser-demo` (если ещё не клонирован)
- Записывает `/opt/tg-parser-demo/.env` с шаблоном (если файла ещё нет; если есть — НЕ перезаписывает)

Дефолтный REPO_URL: `https://github.com/vladilenm/tg-parser-digest.git`. Если репо переехало — переопредели: `REPO_URL=https://github.com/<owner>/<repo>.git bash /tmp/bootstrap.sh`.

### Шаг 3. Заполнить `.env` на VDS

    ssh root@<VDS_HOST>
    nano /opt/tg-parser-demo/.env

Обязательные ключи (см. также `.env.example`):
- `TG_API_ID`, `TG_API_HASH`, `TG_SESSION` — генерация локально через `npm run login` (см. выше)
- `TG_BOT_TOKEN`, `TG_CHANNEL_ID` — Bot для доставки + ID приватного канала Заказчика
- `DEEPSEEK_API_KEY` — https://platform.deepseek.com
- `BOT_TOKEN_ALERTS`, `ALERTS_CHAT_ID` — отдельный alert-bot для технических ошибок (личка владельца)

Опциональные ключи уже заполнены дефолтами (`DEEPSEEK_MODEL=deepseek-chat`, `FETCH_WINDOW_HOURS=24`, и т.д.) — менять не обязательно.

### Шаг 4. Первый запуск

    sudo bash /opt/tg-parser-demo/deploy.sh

Что произойдёт: `git pull --ff-only origin main` → `docker compose up -d --build` → `docker compose logs --tail 50`. Проверь, что в логах есть `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter` без ошибок коннекта.

### Шаг 5. Настроить auto-deploy через GitHub Actions

В репозитории на GitHub: **Settings → Secrets and variables → Actions**:

**Secrets** (New repository secret):
- `VDS_HOST` — IP или домен VDS
- `VDS_USER` — обычно `root` (или созданный пользователь с docker-правами)
- `VDS_SSH_KEY` — приватный SSH-ключ (full file content, начиная с `-----BEGIN OPENSSH PRIVATE KEY-----`)
- `VDS_PORT` — опционально, по умолчанию 22

**Variables** (New repository variable):
- `VDS_DEPLOY_ENABLED` = `true`

После этого каждый `git push` в `main` триггерит `.github/workflows/deploy.yml`, который через `appleboy/ssh-action` выполняет `bash /opt/tg-parser-demo/deploy.sh` на VDS.

Если `VDS_DEPLOY_ENABLED` не выставлен — workflow тихо скипается (без падения CI). Это позволяет коммитить YAML до первого деплоя и не получать красные галочки в PR.

Ручной запуск без push: GitHub → Actions → Deploy to Timeweb VDS → **Run workflow**.

### Логи

    ssh root@<VDS_HOST>
    cd /opt/tg-parser-demo
    docker compose logs -f          # tail -f stdout+stderr
    docker compose logs --tail 200  # последние 200 строк

### Откат на предыдущий коммит

    ssh root@<VDS_HOST>
    cd /opt/tg-parser-demo
    git checkout <prev-sha>          # или git checkout HEAD~1
    bash deploy.sh                   # пересобрать с откатанной версии

После отката `deploy.sh` НЕ будет тянуть main (потому что `git pull --ff-only` упадёт на detached HEAD — это by design, защита от случайной потери отката). Чтобы вернуться к main: `git checkout main && bash deploy.sh`.

### Что НЕ переносится с PM2-пути

- `pm2 logs tg-parser` → `docker compose logs -f`
- `pm2 startup` / `pm2 save` → `docker-compose.yml` имеет `restart: unless-stopped`, контейнер сам поднимается после перезагрузки VDS

### Что НЕ переносится с Cloud Apps-пути

- Управление env через UI → теперь через файл `/opt/tg-parser-demo/.env` (создан bootstrap.sh, заполняется вручную)
- Логи в UI → `docker compose logs` через ssh

## Оперативная документация

- [docs/RUNBOOK.md](docs/RUNBOOK.md) — сценарии диагностики и восстановления: что делать при FloodWait, ChannelPrivateError, сбое DeepSeek, сбое alert-бота и т.д.
- [docs/CHANNELS.md](docs/CHANNELS.md) — checklist добавления/замены канала в `channels.json`, проверки подписки user-аккаунта и перезапуска daemon.

## Ежедневный summary-лог

По итогу каждого tick (20:15 MSK) daemon печатает многострочный summary-блок в stdout (попадает в `~/.pm2/logs/tg-parser-out.log` на VPS):

    [2026-04-22T17:00:42.123Z] [summary] runId=abc12345
      duration=58.4s
      channels: total=50 succeeded=47 skipped=3
      posts: collected=412 deduped=5 dropped=12
      delivered=true
      errors:
        - neftegazru: FloodWait retry exhausted
        - oil_gas_forum: network disconnect after 3 attempts
        - some_private: ChannelPrivateError

Поля:
- `runId` — короткий UUID прогона (для корреляции с предыдущими логами `[pipeline] runId=...`).
- `duration` — длительность в секундах (на 50 каналах ожидается 90-180 сек).
- `channels: total=N succeeded=M skipped=K` — сколько каналов прошли без ошибок и сколько помечены skipped (попали в errors[]).
- `posts: collected=N deduped=K dropped=M` — собрано уникальных постов; отброшено дублей (in-memory + hash-cache hits суммарно); отброшено LLM (STRUCT-03: пост вне 5 категорий и без mentions, либо не прошёл серверную проверку дословности `keyQuote`).
- `delivered=true|false` — отправлен ли HTML-дайджест в приватный канал (false если `posts.collected === 0` — пустой день).
- `errors:` — список ошибок в формате `${username}: ${message}`; секция не печатается если ошибок нет.

Посмотреть последний summary-блок быстро:

    pm2 logs tg-parser --out --nostream | grep -A 20 "\[summary\]" | tail -25

## Как проверить, что всё работает (5 критериев приёмки)

1. **Daemon стартует.** `npm start` выводит лог `daemon started, schedule: ...Europe/Moscow`, в 20:15 MSK запускается tick без `FloodWaitError`.
2. **Дословность цитат.** Для выборки из 20 постов каждый `keyQuote` в пришедшем HTML-дайджесте дословно найден в исходном тексте поста (проверяется вручную — открываешь ссылку `@channel/messageId` и ищешь цитату).
3. **HTML рендерится.** В приватный канал приходит одно сообщение или корректно пронумерованные части `(1/N)`, `parse_mode: HTML` рендерится без ошибок, теги `<b>` / `<i>` / `<a>` видны как форматирование.
4. **Архив сохраняется.** В `data/output/` появляется файл `YYYY-MM-DD.md` с тем же HTML, что пришёл в Telegram-канал.
5. **Алерты работают.** При намеренной ошибке (например, неверный `DEEPSEEK_API_KEY`) — алерт приходит в личку владельца за ≤60 секунд, в канал Заказчика ничего не уходит.

## Известные ограничения

- Нет дедупликации между каналами — один инфоповод из трёх каналов займёт три строки в дайджесте (LLM частично гасит, беря только 15 «самых содержательных»).
- SHA-256 hash-cache не распознаёт семантически одинаковые, но текстуально разные посты (e.g., репост с небольшой правкой). Semantic dedupe отложен в v4.0+.
- Классификация тем — LLM генерирует на каждом прогоне, темы могут плавать между запусками.
- Приватные каналы по `invite hash` не поддерживаются (только публичные по `username`).
- Ретраев на уровне всего прогона нет — если DeepSeek или Telegram упали, tick завершается с ошибкой и алертом в личку владельца, следующая попытка — завтра в 20:15 MSK. Подробнее — [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Troubleshooting

### `TG_SESSION не задан`

Ты пропустил шаг 3. Запусти `npm run login` и скопируй StringSession в `.env`.

### `ChannelPrivateError` / канал пропускается

User-аккаунт не подписан на этот канал. Открой Telegram-клиент под тем же номером, что использовался в `npm run login`, и подпишись на канал.

### Второй `FloodWaitError` на одном канале в прогоне

Канал помечается как skipped и попадает в `errors[]` summary-лога. Прогон продолжается с остальными каналами. Следующий tick завтра в 20:15 MSK попробует канал снова.

Если FloodWait'ы участились на многих каналах — повысь `CHANNEL_DELAY_MS` в `.env` с 1500мс до 2500мс (увеличит общее время прогона ~на 40 секунд).

### `Telegram sendMessage failed: 400`

Скорее всего HTML-теги разрушились при разрезе. Проверь, что `src/summarize.ts` не был изменён и экранирует `<`, `>`, `&` в пользовательском тексте.

### DeepSeek вернул невалидный JSON или не прошёл Zod-валидацию

Скрипт завершает прогон с ошибкой, отправляет алерт в личку владельца и печатает первые 500 символов raw-ответа. Проверь, что `DEEPSEEK_MODEL=deepseek-chat` и `response_format: json_object` корректно переданы. При повторе проблемы — открыть issue.

## Структура проекта

    ./
    ├── package.json              # scripts: login, start + 5 runtime-зависимостей
    ├── tsconfig.json             # strict, ESNext, moduleResolution: bundler
    ├── ecosystem.config.cjs      # PM2 daemon config
    ├── .env.example              # шаблон секретов и параметров (8 обязательных)
    ├── channels.json             # список публичных каналов (JSON-массив, см. src/channels-store.ts)
    ├── websites.json             # список публичных сайтов для web-pipeline (Phase 3)
    ├── README.md                 # этот файл
    ├── docs/
    │   ├── RUNBOOK.md            # сценарии диагностики и восстановления
    │   └── CHANNELS.md           # checklist добавления/замены канала
    ├── data/                     # в .gitignore — не коммитится
    │   ├── raw/                  # YYYY-MM-DD.json — сырые посты до dedup/LLM
    │   ├── output/               # YYYY-MM-DD.md — HTML-дайджест (байт-в-байт)
    │   └── hash-cache.json       # SHA-256 хэши (rolling 14 дней)
    ├── scripts/
    │   └── login.ts              # разовая генерация TG_SESSION
    └── src/
        ├── types.ts              # Post, DigestItem, DigestJson, RunSummary
        ├── schema.ts             # Zod-схема DigestJsonSchema (валидация ответа DeepSeek)
        ├── telegram.ts           # createClient + fetchLast24h (GramJS)
        ├── summarize.ts          # DeepSeek + верификация keyQuote + renderHtml
        ├── deliver.ts            # sendToChannel + chunkHtml (Bot API)
        ├── dedup.ts              # SHA-256 hash-cache CRUD (loadHashCache, saveHashCache)
        ├── archive.ts            # writeRaw, writeOutput (атомарная запись на ФС)
        ├── alert.ts              # sendAlert (Bot API алерты в личку владельца)
        ├── pipeline.ts           # runPipeline() — оркестратор шагов прогона
        ├── logger.ts             # log.info / log.warn / log.error
        └── run.ts                # daemon entrypoint: node-cron + tick() + graceful shutdown

## Лицензия

Private / personal use.
