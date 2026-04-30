# Hosting Decision — tg-parser-demo

**Status:** WIP — выбор не сделан, ждём решения оператора
**Дата:** 2026-04-28
**Контекст:** Timeweb App Platform sanitizer заблокировал `volumes:` в [docker-compose.yml](../docker-compose.yml), затем поддержка Timeweb подтвердила: persistent disk на App Platform **не поддерживается в принципе**. Нужно решить, как сохранять архивы прогонов между редеплоями.

---

## Что мы храним и насколько это важно

| Файл | Что это | Критичность | Объём |
|---|---|---|---|
| `data/hash-cache.json` | SHA-256 хешей доставленных постов, TTL 14 дней (см. [src/dedup.ts:11-13](../src/dedup.ts#L11-L13)) | **Средняя.** Защищает от дублей **между** прогонами. Внутри прогона работает другая дедупа (`Set<channel:msgId>` в [src/pipeline.ts:78-82](../src/pipeline.ts#L78-L82)) — она НЕ зависит от hash-cache. | ~10–50 KB |
| `data/raw/YYYY-MM-DD.json` | Сырые посты до LLM (для аудита) | **Высокая** по Core Value: «полный архив прогонов на ФС» — записано в [.planning/STATE.md](../.planning/STATE.md) | ~50–200 KB/день |
| `data/output/YYYY-MM-DD.md` | Отправленный HTML-дайджест байт-в-байт | **Высокая** по Core Value | ~4–15 KB/день |

---

## Реальные последствия ephemeral-режима

1. **`hash-cache` потерян** → следующий cron-tick может пропустить через LLM «вчерашние» посты повторно, если канал репостит один и тот же контент в разные дни. На практике каналы редко так делают — дубли возможны, но редки. Не блокер.

2. **`raw` и `output` потеряны при каждом push** → Core Value договора нарушен: оператор не сможет поднять архив за конкретный день, если между прогоном и запросом был редеплой.

---

## Три варианта дальше

### A) Принять ephemeral на App Platform — без изменений

- ✅ Ничего не делаем, пушаем что есть
- ❌ Архив прогонов теряется при `git push` (Core Value не выполнен)
- **Подходит**: если этап MVP, архив пока не запрашивают

### B) App Platform + S3 для архива — переработка кода

- ✅ Auto-deploy из git остаётся, архивы переживают редеплой
- ❌ Нужно: добавить S3-клиент (`@aws-sdk/client-s3`), переписать [src/archive.ts](../src/archive.ts) и [src/dedup.ts](../src/dedup.ts) на работу с bucket вместо ФС, добавить env (`S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`), Timeweb даёт совместимое S3-хранилище отдельно (≈100₽/мес)
- ❌ Constraints в [CLAUDE.md](../CLAUDE.md) упоминают «один процесс, без внешней инфры» — формально нарушает (S3 = внешняя инфра)
- **Подходит**: если архив критичен и хочется сохранить git-push-deploy

### C) Уйти на Timeweb VDS — то, что предложила сама поддержка

- ✅ Persistent disk работает, в `docker-compose.yml` нужно вернуть `volumes: ./data:/app/data`
- ✅ Code не меняется
- ❌ Auto-deploy из git нужно настроить вручную (webhook → ssh → `git pull && docker compose up`) или через CI типа GitHub Actions
- ❌ Нужна ручная настройка SSH, firewall, обновлений
- **Подходит**: если хочется сохранить ФС-архив без переписывания кода

---

## Рекомендация

Учитывая что Core Value явно требует «архив прогонов на ФС» — **C) VDS** (самый простой путь без переработки кода). VDS на Timeweb стоит ~+300₽/мес, у нас уже готовы:

- [ecosystem.config.cjs](../ecosystem.config.cjs) — PM2-конфиг
- [docker-compose.yml](../docker-compose.yml) — Docker-конфиг (нужно вернуть `volumes:` локально для VDS)

**B) S3** имеет смысл только если очень хочется именно git-push-deploy + критичны архивы. Это самая дорогая в реализации опция (~2–3 часа кода + новый стек хранилища + правка constraints в CLAUDE.md).

**A) ephemeral** — приемлемо только если на этом этапе архив никто не проверяет (демо/MVP).

---

## Дальнейшие шаги

После выбора оператором:

- **A** → ничего не меняем, push в App Platform, добавить ремарку в [README.md](../README.md) про ephemeral
- **B** → /gsd-quick с research-фазой: интеграция Timeweb S3, правка `src/archive.ts` + `src/dedup.ts`, новые env, обновить CLAUDE.md constraints
- **C** → вернуть `volumes: ./data:/app/data` в docker-compose.yml, написать deploy-скрипт `deploy.sh` для ssh-push, документировать ssh-сетап в README

История обсуждения и контекст ошибок Timeweb sanitizer — в commit-сообщениях `f4da47d` и `2d3f9ab`.
