# Persistent storage + auto-deploy + backups

## Context

Сейчас деплой через Timeweb Cloud Apps пересоздаёт контейнер на каждом push в `main`, и [channels.json](../channels.json) / [websites.json](../websites.json), которые лежат в корне репо и редактируются через Telegram-бота во время работы, **полностью затираются** — теряются все добавленные через `/add_channel` каналы. То же касается `data/hash-cache.json` (dedup-окно 14 дней) и архива в `data/raw/` + `data/output/` (если volume не настроен).

Цель — сделать систему **анти-хрупкой**:
1. Push в GitHub → автодеплой, но мутабельные данные переживают пересборку.
2. Минимальный стек (без новой БД — JSON-файлы в persistent volume).
3. Daily backup в закрытый Telegram-канал, чтобы при потере VDS можно было восстановиться с телефона.
4. Pre-deploy snapshot на VDS — мгновенный rollback при битом релизе.

Подход: **Variant A (volume-only)** — переносим конфиг в volume, без БД. SQLite/Postgres откладываем до момента, когда появится веб-UI с поиском по архиву.

## Архитектура

```
/app/data/                    # persistent volume (bind /opt/tg-parser-demo/data на VDS)
├── config/
│   ├── channels.json         # переехал из корня репо
│   └── websites.json         # переехал из корня репо
├── state/
│   └── hash-cache.json       # переехал из data/
├── raw/                      # как сейчас
├── output/                   # как сейчас
├── logs/                     # run-YYYY-MM-DD.log (переезд из data/)
└── backups/                  # локальные снимки от daily-backup перед отправкой в TG

/app/seed/                    # immutable, в Docker-образе
├── channels.json             # дефолт для первого запуска
└── websites.json
```

Принцип: на старте контейнера, если `/app/data/config/<file>` отсутствует — копируется из `/app/seed/<file>`. Если присутствует — не трогается.

## Файлы к изменению

### 1. Пути и DATA_DIR
- **[src/channels-store.ts](../src/channels-store.ts)** — заменить хардкод `channels.json` на `path.join(DATA_DIR, 'config/channels.json')`. Использовать `process.env.DATA_DIR ?? './data'`.
- **[src/web-scraper.ts:90](../src/web-scraper.ts#L90)** — `loadWebsites()` тянет из `path.join(DATA_DIR, 'config/websites.json')`.
- **[src/dedup.ts](../src/dedup.ts)** — `hash-cache.json` лежит в `path.join(DATA_DIR, 'state/hash-cache.json')`.
- **[src/archive.ts](../src/archive.ts)** — пути уже относительные от `data/`, нужно лишь префикс заменить на `DATA_DIR` env.
- Логи (`run-YYYY-MM-DD.log`) — переехать в `${DATA_DIR}/logs/`.

Создать **[src/paths.ts](../src/paths.ts)** (новый, ~30 строк): единственный источник истины для путей. Экспорт `paths.channelsConfig`, `paths.websitesConfig`, `paths.hashCache`, `paths.rawDir(date)`, `paths.outputDir(date)`, `paths.logFile(date)`. Константа `DATA_DIR = process.env.DATA_DIR ?? path.resolve('./data')`.

### 2. Seed-логика
**[src/seed.ts](../src/seed.ts)** (новый, ~40 строк): функция `ensureSeedFiles()`:
- На старте смотрит `/app/data/config/{channels,websites}.json`.
- Если файла нет — `fs.copyFile('/app/seed/<name>', '/app/data/config/<name>')`.
- Логирует «seeded» или «found existing».
- Вызывается в [src/run.ts](../src/run.ts) и [src/daemon.ts](../src/daemon.ts) **до** первого `loadChannels()`.

### 3. Daily backup
**[src/backup.ts](../src/backup.ts)** (новый, ~80 строк):
- `cron.schedule('15 3 * * *', backupAndSend, { timezone: 'Europe/Moscow' })` — в 03:15 MSK.
- Делает `tar czf ${DATA_DIR}/backups/config-${YYYY-MM-DD}.tgz config/ state/`.
- Через `Telegraf.bot.telegram.sendDocument(BACKUP_CHANNEL_ID, ...)` отправляет архив в закрытый канал (тот же `TG_CHANNEL_ID` или отдельный `TG_BACKUP_CHANNEL_ID` если задан).
- Хранит локально 7 последних, старые удаляет.
- Логирует размер и хэш для аудита.
- Подключается из [src/daemon.ts](../src/daemon.ts) рядом с существующим `node-cron` шедулером.

### 4. Docker
**[Dockerfile](../Dockerfile)**:
- Перенести `COPY channels.json websites.json` → `COPY channels.json websites.json /app/seed/`.
- Создать `RUN mkdir -p /app/data/{config,state,raw,output,logs,backups} /app/seed`.
- Добавить `ENV DATA_DIR=/app/data`.

**[docker-compose.yml](../docker-compose.yml)**:
- Volume на `/app/data` остаётся (на Cloud Apps — через UI, на VDS — bind mount).
- Добавить `environment: DATA_DIR=/app/data` (явно).
- Добавить `TG_BACKUP_CHANNEL_ID` в `${VAR:-}` подстановки.

### 5. VDS deploy + pre-deploy snapshot
**[deploy.sh](../deploy.sh)** (если уже есть на VDS — обновить; иначе создать):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/tg-parser-demo

# 1. Pre-deploy snapshot
mkdir -p /opt/backups
TS=$(date +%Y%m%d-%H%M%S)
tar czf "/opt/backups/pre-deploy-${TS}.tgz" data/config/ data/state/ 2>/dev/null || true

# 2. Pull
git fetch origin main
git reset --hard origin/main

# 3. Rebuild
docker compose pull || true
docker compose build --pull
docker compose up -d --remove-orphans

# 4. Retain only 5 latest
ls -1t /opt/backups/pre-deploy-*.tgz | tail -n +6 | xargs -r rm
```

**[.github/workflows/deploy.yml](../.github/workflows/deploy.yml)** — уже есть, не трогаем (триггерит `bash /opt/tg-parser-demo/deploy.sh` через SSH).

Первая разовая миграция на VDS (вручную): скопировать актуальные `channels.json` + `websites.json` в `/opt/tg-parser-demo/data/config/` **до** первого `docker compose up`, чтобы seed-логика их не перетёрла дефолтами из репо.

### 6. .gitignore + cleanup
- `.gitignore`: убедиться что `/data/` уже игнорируется (есть). Дополнительно — `/data/backups/`.
- `channels.json` и `websites.json` остаются в корне репо как **seed**, продолжают версионироваться (они становятся «дефолтным конфигом для свежей установки»).

## Reuse

Используем уже готовое:
- Атомарная запись `tmp + rename` — [src/channels-store.ts:atomicWriteJson](../src/channels-store.ts#L58).
- In-process mutex — [src/channels-store.ts:lockChain](../src/channels-store.ts#L70).
- Cron-шедулер с TZ Europe/Moscow — `node-cron` уже в [src/daemon.ts](../src/daemon.ts).
- `bot.sendDocument` через GramJS / Bot API — бот уже инициализирован в [src/bot.ts](../src/bot.ts).
- Docker init flag и env-passthrough — [docker-compose.yml](../docker-compose.yml).

## Verification

End-to-end проверка:

1. **Локально**: `rm -rf data/` → `npm start`. Должен сработать seed: data/config/{channels,websites}.json появятся, hash-cache построится.
2. **Mutate-test**: `/add_channel @oilcomru` через бота → перезапуск процесса → `/channels` показывает добавленный канал. То же на свежесобранном Docker-образе с volume.
3. **Docker volume integrity**: `docker compose down && docker compose up -d --build` — состояние сохраняется (channels добавленные через бота не теряются).
4. **VDS deploy simulation** (на staging-VDS если есть, или dry-run на проде):
   - `/add_channel @testch1` → `git push main` → дождаться webhook → проверить, что `@testch1` всё ещё в `/channels`.
   - `cat /opt/backups/pre-deploy-*.tgz` — должен лежать снимок.
5. **Backup delivery**: вручную дёрнуть `node --import tsx -e "import('./src/backup.ts').then(m => m.backupAndSend())"` → в закрытом Telegram-канале появляется `.tgz` (~3-5 KB).
6. **Restore drill**: на чистой машине скачать `.tgz` из Telegram → распаковать в `data/` → `npm start` → состояние восстанавливается.
7. **Negative**: положить битый JSON в `data/config/channels.json` → процесс должен падать с ясной ошибкой (не молча создавать пустой файл). Текущий `loadChannels()` это уже делает.

## Out of scope (на потом)

- SQLite миграция — когда появится веб-UI с поиском по архиву.
- S3 backup — текущий объём (~5 KB/день) не оправдывает.
- Webhook-режим бота — пока polling работает, не трогаем.
- Health-check автоrollback в [deploy.sh](../deploy.sh) — добавим, если будет реальный инцидент с битым релизом.
