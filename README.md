# tg-parser-demo

Ежедневный (20:00 MSK) HTML-дайджест событий российского нефтегаза/нефтехимии за последние 24 часа в закрытом Telegram-канале. Каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM.

v2.0: `npm start` — long-running daemon на Node.js + node-cron; на VPS работает под PM2. Без БД, без Docker, без внешнего крона — всё в одном процессе.

## Требования

- Node.js **20.6+** (нужен флаг `--env-file` без `dotenv`).
- Telegram-аккаунт, подписанный на все каналы из `channels.yaml`.
- DeepSeek API-ключ (https://platform.deepseek.com).
- Личный приватный Telegram-канал, в который бот будет постить дайджест.

## Запуск в 3 команды

    npm install
    npm run login     # разовая генерация TG_SESSION
    npm start         # запустить daemon (ежедневно в 20:00 MSK); Ctrl+C — остановить

## Подготовка перед первым прогоном

### 1. Установка зависимостей

    npm install

Будет установлено четыре runtime-зависимости: `telegram` (GramJS), `openai` (DeepSeek через OpenAI-совместимый SDK), `yaml`, `node-cron` (добавлен в v2.0 для daemon-режима).

### 2. Секреты и конфиг

    cp .env.example .env

Заполни в `.env`:

- `TG_API_ID`, `TG_API_HASH` — возьми на https://my.telegram.org → API development tools → Create application.
- `TG_BOT_TOKEN` — создай бота через [@BotFather](https://t.me/BotFather) (`/newbot`).
- `TG_CHANNEL_ID` — создай приватный Telegram-канал, добавь бота админом (право Post Messages), пересылкой любого сообщения из канала на [@username_to_id_bot](https://t.me/username_to_id_bot) получи ID вида `-100xxxxxxxxxx`.
- `DEEPSEEK_API_KEY` — https://platform.deepseek.com → API keys.

`TG_SESSION` оставь пустым — его сгенерирует следующий шаг.

### 3. Разовая генерация TG_SESSION

    npm run login

Скрипт спросит телефон (в международном формате), код из Telegram и (если включена) 2FA-пароль. После успеха он напечатает строку StringSession — **скопируй её в `.env` как `TG_SESSION`**.

**Не публикуй `TG_SESSION`** — это полный доступ к твоему user-аккаунту. Файл `.env` уже в `.gitignore`.

### 4. Подписка user-аккаунта на каналы

User-аккаунт, чей `TG_SESSION` лежит в `.env`, **должен быть подписан** на каждый канал из `channels.yaml` — иначе GramJS выбросит `ChannelPrivateError` и канал будет пропущен.

Список по умолчанию в `channels.yaml` — отраслевые каналы российского нефтегаза/нефтехимии. Можно заменить на свой список (10–15 публичных каналов по `username`).

### 5. Первый запуск daemon

    npm start

Что произойдёт:

1. Процесс стартует и выводит в stdout: `[<ISO>] [info] daemon started, schedule: 0 20 * * * Europe/Moscow`.
2. Процесс висит (event-loop держится от node-cron handle). Пока не 20:00 MSK — ничего не происходит.
3. В 20:00 MSK запускается `tick()`:
   - Обходит 50 каналов (с задержкой `CHANNEL_DELAY_MS=1750ms + 0–500ms jitter`), собирает посты за последние 24ч (до 50/канал).
   - In-memory дедуплицирует повторы по `${username}:${messageId}`.
   - Если постов 0 — лог `No posts in window — skipping digest`, выхода нет (daemon живёт).
   - Иначе — батч в DeepSeek → верификация дословности `keyQuote` → HTML → Bot API → приватный канал.
4. По итогу tick печатает многострочный summary-лог (см. «Ежедневный summary-лог» ниже).
5. Следующий tick — завтра в 20:00 MSK.

Остановить локально: `Ctrl+C` → graceful shutdown (daemon ждёт активный прогон, потом `exit 0`).

Сетевые сбои во время прогона: GramJS делает до 3 попыток reconnect с exp backoff (1s / 2s / 4s). При исчерпании канал помечается как skipped, попадает в `errors[]` summary-лога, прогон продолжается с остальными каналами.

## Запуск на VPS (PM2)

На VPS daemon запускается под PM2: process manager мониторит процесс, рестартует при падении, поднимается автоматически после перезагрузки сервера. Установить PM2 глобально нужно один раз:

    npm install -g pm2

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

Compose автоматически прочитает `./.env` через стандартный substitution mechanism (`${VAR:-}` в [docker-compose.yml](docker-compose.yml)) — никакого `--env-file` флага не нужно. Поведение должно быть идентично `npm start`: процесс висит, лог `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter`, в 20:15 MSK (с jitter 0–30 мин) запускается tick. Остановка — `Ctrl+C` → graceful shutdown (благодаря `init: true` в `docker-compose.yml`, иначе SIGTERM не дойдёт до Node как PID 1).

Однократный прогон без ожидания cron:

    docker compose run --rm tg-parser node --import tsx scripts/run-once.ts

### Замечание про identity Telegram-аккаунта

При первом подключении `TG_SESSION` из Timeweb-IP (датацентр в РФ) Telegram пришлёт user-аккаунту уведомление **«Новый вход»**. Это нормально — `CLIENT_IDENTITY` в `src/telegram.ts` ту же. Просто подтверди вход в личном Telegram-клиенте и продолжи. Повторных уведомлений при каждом редеплое не будет (session тот же).

### Что НЕ переносится в Docker-путь

- `pm2 logs tg-parser` — на Timeweb используй встроенные логи Apps (вкладка Logs в UI).
- `pm2 save` / `pm2 startup` / `pm2 resurrect` — Timeweb сам перезапускает контейнер по `restart: unless-stopped`.
- Файл `~/.pm2/logs/tg-parser-out.log` — логи stdout/stderr контейнера видны в Timeweb UI; для grep — экспорт через UI или `docker logs` локально.

## Ежедневный summary-лог

По итогу каждого tick (20:00 MSK) daemon печатает многострочный summary-блок в stdout (попадает в `~/.pm2/logs/tg-parser-out.log` на VPS):

    [2026-04-22T17:00:42.123Z] [summary] runId=abc12345
      duration=58.4s
      channels: total=50 succeeded=47 skipped=3
      posts: collected=412 deduped=5
      delivered=true
      errors:
        - neftegazru: FloodWait retry exhausted
        - oil_gas_forum: network disconnect after 3 attempts
        - some_private: ChannelPrivateError

Поля:
- `runId` — короткий UUID прогона (для корреляции с предыдущими логами `[pipeline] runId=...`).
- `duration` — длительность в секундах (на 50 каналах ожидается 90-180 сек).
- `channels: total=N succeeded=M skipped=K` — сколько каналов прошли без ошибок и сколько помечены skipped (попали в errors[]).
- `posts: collected=N deduped=K` — собрано уникальных постов и отброшено дублей по `${username}:${messageId}` в рамках прогона.
- `delivered=true|false` — отправлен ли HTML-дайджест в приватный канал (false если `posts.collected === 0` — пустой день).
- `errors:` — список ошибок в формате `${username}: ${message}`; секция не печатается если ошибок нет.

Посмотреть последний summary-блок быстро:

    pm2 logs tg-parser --out --nostream | grep -A 20 "\[summary\]" | tail -25

## Как проверить, что всё работает (5 критериев приёмки)

1. **Сбор быстрый.** `npm start` на 15 каналах завершается за < 60 секунд и не выбрасывает `FloodWaitError`.
2. **Дословность цитат.** Для выборки из 20 постов каждый `keyQuote` в пришедшем HTML-дайджесте дословно найден в исходном тексте поста (проверяется вручную — открываешь ссылку `@channel/messageId` и ищешь цитату).
3. **HTML рендерится.** В приватный канал приходит одно сообщение или корректно пронумерованные части `(1/N)`, `parse_mode: HTML` рендерится без ошибок, теги `<b>` / `<i>` / `<a>` видны как форматирование.
4. **Идемпотентность.** Повторный запуск через 15+ минут не триггерит FloodWait и не крашится (может отправить тот же дайджест повторно — это допустимо в MVP).
5. **Пустой день.** Если за 24 часа ни одного поста нет (выходные, технические выходные каналов) — скрипт логирует `No posts in window — skipping digest`, выходит с кодом 0, DeepSeek и Telegram не дёргаются.

## Известные ограничения

См. `spec-app.md` §12:

- Нет персистентности — одна и та же новость может попасть в дайджест несколько дней подряд, если канал её продолжает репостить.
- Нет дедупликации между каналами — один инфоповод из трёх каналов займёт три строки в дайджесте (LLM частично гасит, беря только 15 «самых содержательных»).
- Классификация тем — LLM генерирует на каждом прогоне, темы могут плавать между запусками.
- Приватные каналы по `invite hash` не поддерживаются (только публичные по `username`).
- Ретраев на уровне всего прогона нет — если DeepSeek или Telegram упали, скрипт выходит с кодом 1, оператор перезапускает руками.

## Troubleshooting

### `TG_SESSION не задан`

Ты пропустил шаг 3. Запусти `npm run login` и скопируй StringSession в `.env`.

### `ChannelPrivateError` / канал пропускается

User-аккаунт не подписан на этот канал. Открой Telegram-клиент под тем же номером, что использовался в `npm run login`, и подпишись на канал.

### Второй `FloodWaitError` на одном канале в прогоне

Канал помечается как skipped и попадает в `errors[]` summary-лога. Прогон продолжается с остальными каналами. Следующий tick завтра в 20:00 MSK попробует канал снова.

Если FloodWait'ы участились на многих каналах — повысь `CHANNEL_DELAY_MS` в `.env` с 1750мс до 2500мс (увеличит общее время прогона ~на 40 секунд).

### `Telegram sendMessage failed: 400`

Скорее всего HTML-теги разрушились при разрезе. Проверь, что `src/summarize.ts` не был изменён и экранирует `<`, `>`, `&` в пользовательском тексте.

### DeepSeek вернул невалидный JSON

Скрипт выходит с `exit 1` и печатает первые 500 символов raw-ответа. Проверь, что `DEEPSEEK_MODEL=deepseek-chat` и `response_format: json_object` корректно переданы. При повторе проблемы — открыть issue.

## Структура проекта

    ./
    ├── package.json              # scripts: login, start + 3 runtime-зависимости
    ├── tsconfig.json             # strict, ESNext, moduleResolution: bundler
    ├── .env.example              # шаблон секретов и параметров
    ├── channels.yaml             # список публичных каналов
    ├── README.md                 # этот файл
    ├── scripts/
    │   └── login.ts              # разовая генерация TG_SESSION
    └── src/
        ├── types.ts              # Post, DigestJson, DigestItem, DigestSection
        ├── telegram.ts           # createClient + fetchLast24h (GramJS)
        ├── summarize.ts          # DeepSeek + валидация keyQuote + renderHtml
        ├── deliver.ts            # sendToChannel + chunkHtml (Bot API)
        └── run.ts                # entrypoint: fetch → summarize → deliver

## Лицензия

Private / personal use.
