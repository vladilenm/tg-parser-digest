# RUNBOOK — tg-parser-demo

Оперативная инструкция оператора (владельца) при сбоях daemon на VPS под PM2.
Все 5 сценариев соответствуют DOC-04 milestone v3.0.

Документ читается сверху вниз: каждый сценарий — **Симптом → Диагностика → Действие → Восстановление**.

---

## 1. DeepSeek возвращает 5xx (или timeout)

**Симптом:**
- Алерт в личке: `🚨 [tg-parser-demo] pipeline failure ... stage: tick ... error: 500 Internal Server Error` (или `ETIMEDOUT`, `ECONNRESET`).
- В канале Заказчика тишина (sendToChannel не достигнут).
- `data/raw/YYYY-MM-DD.json` за сегодня СУЩЕСТВУЕТ (raw-архив пишется до LLM, ARCH-01).
- `data/output/YYYY-MM-DD.md` за сегодня ОТСУТСТВУЕТ.

**Диагностика:**
- `pm2 logs tg-parser --lines 200` — смотрим stack trace целиком.
- `curl -I https://api.deepseek.com` — доступен ли endpoint вообще?
- Проверить статус DeepSeek: https://status.deepseek.com (если есть).

**Действие:**
- Если DeepSeek упал на их стороне (5xx по всем endpoint'ам) — ждём.
- Cron сработает следующим тиком в 20:00 MSK завтра — daemon сам прогонит ещё раз.
- Hash-cache `data/hash-cache.json` НЕ был обновлён (commitHashCache вызывается только после успешной sendToChannel) → завтра те же посты пройдут заново.
- Ручной retry СЕГОДНЯ: `pm2 restart tg-parser` НЕ запускает прогон (cron 20:00 — единственный триггер). Если очень нужно — временно изменить cron в `src/run.ts` на ближайшую минуту, перезапустить, потом откатить.

**Восстановление:**
- Следующая успешная сводка появится в канале на следующем cron-тике.
- Никаких ручных action'ов на ФС не нужно — invariant ARCH-02 + DEDUP-02 сам восстановит состояние.

---

## 2. Telegram FloodWait / rate-limit

**Симптом:**
- Алерт: `error: A wait of N seconds is required (FloodWaitError)`.
- Один из каналов помечен skipped в RunSummary; остальные — обработаны.
- В канале Заказчика — частичная сводка (если хотя бы 1 канал успел). ИЛИ полная тишина (если floodwait во время sendToChannel).

**Диагностика:**
- `pm2 logs tg-parser --lines 500 | grep -i flood` — смотрим, какой именно канал флудит.
- Если флудит fetchLast24h — проблема с user-сессией (TG_SESSION).
- Если флудит sendToChannel — проблема с Bot API (TG_BOT_TOKEN, лимит ~30 msg/sec).

**Действие:**
- Один FloodWait на user-сессии → существующий retry x1 в `src/telegram.ts` уже обработал. Daemon продолжает.
- Повторный FloodWait подряд → канал помечен skipped, прогон продолжается без него.
- Если FloodWait на КАЖДЫЙ канал — увеличить `CHANNEL_DELAY_MS` в `.env` (текущий 1750мс, поднять до 3000).
- `pm2 restart tg-parser` для подхвата нового значения env.

**Восстановление:**
- Подождать минимум 1 час, лучше 24, прежде чем поднимать частоту тиков.
- Telegram банит при повторных нарушениях — лучше пожертвовать 1 каналом, чем сессией.

---

## 3. Парсер не видит канал (ChannelPrivate / UsernameInvalid / UsernameNotOccupied)

**Симптом:**
- В RunSummary `channelsSkipped > 0`.
- В `errors[]`: `<username>: ChannelPrivateError` / `UsernameNotOccupiedError` / `UsernameInvalidError`.
- Пакетного алерта НЕ приходит (это per-channel ошибка, локализована).

**Диагностика:**
- Какой именно канал? `pm2 logs tg-parser --lines 200 | grep -i "channel skipped"`.
- Открыть в Telegram-клиенте `https://t.me/<username>` руками. Видим ли мы канал из user-аккаунта (того, чей TG_SESSION в .env)?

**Действие:**
- **Канал стал приватным** → удалить из `channels.yaml` ИЛИ перевести в карантин (см. `docs/CHANNELS.md`).
- **Username не существует** (опечатка/удалили) → удалить запись из `channels.yaml`.
- **User-аккаунт не подписан** → подписаться руками с того же аккаунта, чей TG_SESSION в .env.
- `pm2 restart tg-parser` после правки channels.yaml.

**Восстановление:**
- Следующий cron-тик прогонит обновлённый список каналов.

---

## 4. Диск переполнен (data/ или PM2 logs)

**Симптом:**
- Алерт: `error: ENOSPC: no space left on device, write` (или `rename` на атомарной записи).
- VPS-команды зависают, `df -h` показывает `100%`.

**Диагностика:**
- `df -h` — какой раздел заполнен.
- `du -sh ~/.pm2/logs/*` — размер pm2-логов.
- `du -sh ./data/*` — размер архивов raw/output.

**Действие:**
- **PM2 logs раздулись** (>500 МБ): `pm2 flush tg-parser` (очистить).
- **data/raw/ переполнено** (>1 ГБ): удалить старые `data/raw/*.json` руками (старше 30 дней): `find data/raw -name '*.json' -mtime +30 -delete`.
- **data/output/ — НЕ удалять**: эти файлы нужны для acceptance-пакета Phase 2.
- **data/hash-cache.json раздулось** (>100 МБ — нереально, но): rolling 14d сам отфильтрует на следующем load. Ручная очистка: `rm data/hash-cache.json` (но это даст 1 день повторов в канале — нежелательно).

**Восстановление:**
- После очистки запустить `pm2 restart tg-parser`.
- Долгосрочно — настроить logrotate на `~/.pm2/logs/*.log` и автоматическую ротацию `data/raw/`.

---

## 5. Network down на VPS

**Симптом:**
- Никаких алертов не приходит (сам alert-bot не может отправить — D-15 пишет в pm2-err.log).
- Канал Заказчика молчит несколько суток.

**Диагностика:**
- SSH на VPS, проверить `ping 8.8.8.8`, `curl -I https://api.telegram.org`, `curl -I https://api.deepseek.com`.
- `pm2 list` — daemon вообще запущен?
- `pm2 logs tg-parser --lines 1000 --err` — что писалось последние сутки.

**Действие:**
- **Сеть down** → связаться с провайдером VPS. Daemon продолжит работать на тиках, но они будут падать.
- **Daemon упал** (`pm2 list` не показывает) → `pm2 resurrect` или `pm2 start ecosystem.config.cjs`.
- **Token инвалидирован** (`401 Unauthorized` в pm2-err.log) → перевыпустить через @BotFather, обновить `.env`, `pm2 restart tg-parser`.

**Восстановление:**
- После восстановления сети — следующий 20:00 MSK тик пройдёт штатно.
- Если сеть была down >24ч, проверить, что hash-cache не «съел» лишнего (он rolling 14d — не должен; но визуально сравнить data/output/*.md за последние 3 дня).

---

*RUNBOOK v3.0 — обновлено при milestone v3.0 (DOC-04). При появлении новых сценариев добавлять сюда same структуру: Симптом → Диагностика → Действие → Восстановление.*
