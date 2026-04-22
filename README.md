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
