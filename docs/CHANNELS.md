# CHANNELS — lifecycle канала в tg-parser-demo

Оперативная инструкция оператора по управлению `channels.json`.
Соответствует DOC-05 milestone v3.0.

Каналы — публичные Telegram-каналы по российскому нефтегазу/нефтехимии.
User-аккаунт (тот, чей `TG_SESSION` в `.env`) обязан быть подписан на каждый канал.

---

## Структура channels.json

```json
{
  "channels": [
    { "username": "oil_news_ru" },
    { "username": "bunker_market_ru" },
    { "username": "PLACEHOLDER_38" }
  ]
}
```

Корневой ключ `channels` — массив объектов с единственным обязательным полем `username` (строка, без префикса `@`). Никаких других полей в схеме нет (поле `priority` удалено как неиспользуемое).

---

## 1. Добавление нового канала

1. Найти публичный канал по теме (нефтегаз / нефтехимия / бункер / битум / etc).
2. **Проверка подписки** (КРИТИЧНО):
   - Открыть Telegram client под user-аккаунтом, чей `TG_SESSION` в `.env`.
   - Найти канал по `@username`.
   - Нажать **Subscribe** / **Подписаться**. Без подписки GramJS не увидит историю.
3. Открыть `channels.json` на VPS:
   ```bash
   ssh user@vps
   cd ~/tg-parser-demo
   vim channels.json
   ```
4. Добавить запись в массив `channels` (не забыть запятую после предыдущего элемента):
   ```json
   { "username": "new_channel_name" }
   ```
   (без `@`, ровно как в URL `https://t.me/new_channel_name`).
5. Перезапустить daemon, чтобы подхватил новый channels.json на следующем тике:
   ```bash
   pm2 restart tg-parser
   ```
6. Дождаться следующего cron-тика 20:00 MSK. Проверить `pm2 logs tg-parser --lines 200`:
   - `[pipeline] new_channel_name: N постов` — успех.
   - `[pipeline] channel skipped: new_channel_name — ChannelPrivateError` — забыли подписаться. См. RUNBOOK сценарий 3.

---

## 2. Проверка подписки user-аккаунта

Шпаргалка: «у меня есть канал в `channels.json`, но парсер выдаёт `channelsSkipped`».

1. Открыть Telegram client (НЕ приложение бота, а аккаунт владельца с `TG_SESSION`).
2. Найти канал в списке чатов или через поиск.
3. Если канала **нет в списке чатов** — подписаться (Subscribe).
4. Если канал в списке, но в чатах — открыть и убедиться, что не silenced/архивирован (это не блокирует чтение, но удобно для оператора).
5. После подписки → `pm2 restart tg-parser` → дождаться следующего тика.

---

## 3. Удаление канала

Когда:
- Канал стал приватным (после ребрендинга/закрытия).
- Username сменился, и старый возвращает `UsernameNotOccupiedError`.
- Канал перестал давать релевантный контент (всё рекламы, копипаст из других).

Действия:
1. `vim channels.json`.
2. Удалить запись (весь объект `{ "username": ... }` из массива `channels`, не забыть про запятые между соседями).
3. `pm2 restart tg-parser`.
4. Опционально: отписаться в user-аккаунте (не обязательно, но снижает rate-limit риск).

---

## 4. Карантин канала (временное отключение)

Когда:
- Канал ВРЕМЕННО даёт мусор (политика, новогодние поздравления, спам).
- Канал ВРЕМЕННО недоступен (FloodWait приходит каждый тик).
- Хочется протестировать, влияет ли канал на качество дайджеста.

JSON не поддерживает inline-комментарии, поэтому карантин делается через дополнительный массив на верхнем уровне (`ChannelsFileSchema` — `z.object({ channels: ... })` без `.strict()`, поэтому Zod по умолчанию молча игнорирует неизвестные ключи; такой подход безопасен).

Способ карантина без потери записи:
1. Открыть `channels.json`.
2. Перенести объект канала из массива `channels` в дополнительный массив `channels_quarantine` в том же файле:
   ```json
   {
     "channels": [
       { "username": "oil_news_ru" }
     ],
     "channels_quarantine": [
       { "username": "noisy_channel_ru" }
     ]
   }
   ```
3. `pm2 restart tg-parser`. `loadChannels` читает только `channels`; ключ `channels_quarantine` Zod-схемой игнорируется.
4. Через 7-14 дней либо вернуть запись обратно в `channels`, либо удалить окончательно.

---

## 5. Замена PLACEHOLDER_NN из v2.0

В `channels.json` после v2.0 содержится 38 записей `PLACEHOLDER_01..PLACEHOLDER_38` — их нужно заменить на реальные каналы перед 7-day smoke (Phase 2).

Подход:
1. Найти подходящий канал по теме (см. п.1 «Добавление»).
2. Подписаться user-аккаунтом (см. п.2).
3. `vim channels.json`, заменить `PLACEHOLDER_NN` на реальный username:
   ```json
   { "username": "PLACEHOLDER_05" }     // ДО
   { "username": "bunker_dispatch_ru" } // ПОСЛЕ
   ```
4. `pm2 restart tg-parser`.
5. Проверить на следующем тике, что канал не в `channelsSkipped`.

Заменять можно постепенно — daemon не падает на PLACEHOLDER (`UsernameNotOccupiedError` → channel skipped → прогон продолжается без него).

---

*CHANNELS.md — обновлено 2026-05-06: переход на channels.json, удаление поля priority.*
