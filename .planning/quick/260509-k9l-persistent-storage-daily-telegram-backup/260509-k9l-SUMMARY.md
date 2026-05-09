---
quick_id: 260509-k9l
date: 2026-05-09
status: completed
branch: deploy
commits: 5
---

# Quick Task 260509-k9l — Summary

**Goal:** Persistent storage + daily Telegram backup + pre-deploy snapshot (Variant A, volume-only).

## Outcome

Все мутабельные данные tg-parser-demo переехали под единый persistent volume `/app/data` (на VDS — bind mount `/opt/tg-parser-demo/data`). Push в `main` теперь не затирает channels.json/websites.json/hash-cache.json и архивы прогонов. Daily backup в закрытый Telegram-канал в 03:15 MSK работает как страховка от потери VDS. Pre-deploy snapshot на VDS даёт мгновенный rollback при битом релизе.

## Changes by commit

| # | Commit | Files | What |
|---|--------|-------|------|
| 1 | [659e29f](../../../) `feat(quick-260509-k9l): add paths.ts and seed.ts` | [src/paths.ts](../../../src/paths.ts), [src/seed.ts](../../../src/seed.ts) | Новые модули: `paths` (getter-based, единый источник истины путей) + `ensureSeedFiles` + `ensureDataDirs`. Без вызовов из других модулей. |
| 2 | [c07605a](../../../) `feat(quick-260509-k9l): migrate 6 modules to paths.ts` | channels-store, web-scraper, dedup, archive, logger, web-posts-cache + 4 test files | Все хардкоды путей заменены на `paths.*`. Сигнатуры публичных функций сохранены. Тесты обновлены под новый layout (data/config/, data/state/) с pre-test mkdir. CHANNELS_PATH/WEBSITES_PATH удалены. |
| 3 | [1f7ec89](../../../) `feat(quick-260509-k9l): wire ensureSeedFiles + daily Telegram backup` | [src/run.ts](../../../src/run.ts), [src/backup.ts](../../../src/backup.ts) | `ensureSeedFiles()` top-level до loadChannels. Второй cron `15 3 * * *` MSK. `backup.ts` через FormData+Blob multipart, retain=7, общий try/catch — daemon никогда не падает из-за бэкапа. |
| 4 | [e3d1cb4](../../../) `chore(quick-260509-k9l): Dockerfile seed/ + DATA_DIR env, compose volume` | [Dockerfile](../../../Dockerfile), [docker-compose.yml](../../../docker-compose.yml) | `apt install tar`, `ENV DATA_DIR/SEED_DIR`, `COPY → /app/seed/`, mkdir 6 поддиректорий. Compose: env passthrough + `volumes: ./data:/app/data`. |
| 5 | [8e5ea41](../../../) `chore(quick-260509-k9l): deploy.sh pre-deploy snapshot + .gitignore` | [deploy.sh](../../../deploy.sh), [.gitignore](../../../.gitignore) | `deploy.sh`: pre-deploy snapshot tar.gz config/+state/ → `/opt/backups/pre-deploy-${TS}.tgz` до `git fetch`, retain=5, ONE-TIME MIGRATION блок в комментарии. `.gitignore`: `/opt/backups/`. |

## Verification performed

- ✅ `npx tsc --noEmit` — после каждой задачи, всегда exit 0.
- ✅ `npm test` — все **1054** vitest-теста зелёные после Task 2.
- ✅ Smoke `ensureSeedFiles()` с `DATA_DIR=/tmp/...`: 6 поддиректорий созданы, channels.json/websites.json скопированы из seed.
- ✅ Smoke `backupAndSend()` с fake TG-токеном: `.tgz` создан с `config/+state/` структурой, fail на 404 от api.telegram.org поглощён, daemon-симуляция отработала чисто.
- ✅ `bash -n deploy.sh` — синтаксис валиден, executable bit сохранён.
- ✅ Smoke pre-deploy snapshot блока в /tmp: tar содержит `data/config/+data/state/`.
- ✅ `docker compose config` — environment+volumes валидно проинспектированы (DATA_DIR=/app/data, SEED_DIR=/app/seed, TG_BACKUP_CHANNEL_ID passthrough, `./data:/app/data`).

## Pre-approved deviations from plan

1. **`paths.ts` через getter'ы вместо const-объекта.** Тесты vitest используют `process.chdir(tmpdir)` per-test — const, резолвящий `path.resolve("./data")` при загрузке модуля, заморозил бы пути на корне репо. Getter'ы переоценивают cwd/env при каждом обращении.
2. **Тесты обновлены вместе с production-кодом** (Task 2). Иначе `CHANNELS_PATH === "./channels.json"` literal-equality assertion блокировал бы миграцию.
3. **`daemon.ts` отсутствует в репо** — daemon-логика живёт в `src/run.ts`. План упоминал `daemon.ts` как точку wiring'а; фактически wiring сделан в `run.ts`.

## Out of scope (требует ручной проверки оператором)

- **Docker build verification** — daemon недоступен на локальной машине разработчика. `docker compose config` валиден, реальный `docker build` сделается при первом деплое CI или на VDS.
- **VDS deploy E2E simulation** — нужен живой VDS, который пользователь ещё не настроил. Pre-deploy snapshot блок в `deploy.sh` протестирован на tmpdir.
- **Реальная доставка backup в Telegram** — нужен валидный `TG_BOT_TOKEN` и `TG_BACKUP_CHANNEL_ID`/`TG_CHANNEL_ID`. Smoke с fake-токеном подтвердил, что архив создаётся и ошибка sendDocument гасится в общем try/catch.
- **Restore drill** — оператор должен скачать `.tgz` из канала, распаковать в свежий `data/`, проверить что `npm start` поднимается (per docs/db-deploy.md §Verification.6).

## One-time migration на VDS (для оператора)

До первого `docker compose up` на VDS с новой версией:

```bash
ssh user@vds
cd /opt/tg-parser-demo
mkdir -p data/{config,state,logs}
cp channels.json data/config/
cp websites.json data/config/
mv data/hash-cache.json data/state/ 2>/dev/null || true
mv data/web-posts-*.json data/state/ 2>/dev/null || true
mv data/run-*.log data/logs/ 2>/dev/null || true
```

После этого первого деплоя seed-логика просто увидит существующие config/*.json и не перетрёт их дефолтами. Этот блок продублирован в комментарии deploy.sh.

## Operator next steps

1. Просмотреть diff: `git log main..deploy` (5 commits) → проверить.
2. Локально (если есть Docker): `docker compose up -d --build` → проверить что daemon стартует, в логах `[seed] copied from seed` или `found existing`, и `[backup] scheduled: 15 3 * * * Europe/Moscow`.
3. Merge в main: `git checkout main && git merge deploy && git push`.
4. На VDS: выполнить one-time migration выше → дождаться webhook автодеплоя из GitHub Actions.
5. Через сутки (после 03:15 MSK) проверить, что в закрытом TG-канале появился `config-YYYY-MM-DD.tgz`.
