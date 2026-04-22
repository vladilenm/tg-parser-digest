# Phase 2: Автоматизация + 50 каналов (v2.0)

## Context

MVP v1.0 (Phase 01-mvp) отшиплен 2026-04-21: `npm start` — одноразовый скрипт, 12 каналов, запуск руками. Эта фаза переводит парсер на VPS в daemon-режим: ежедневный прогон в 20:00 MSK через node-cron под PM2, расширение до 50 каналов, in-memory дедупа message_id в рамках прогона, graceful reconnect GramJS при сетевых сбоях, структурированный summary-лог для диагностики.

Это старт milestone v2.0. Формально `/gsd-new-milestone` стоит запустить после аппрува плана (вне scope этой подготовки).

**Решения (зафиксировано с пользователем):**
- `npm start` становится long-running daemon (старый одноразовый режим уходит).
- Timezone = `Europe/Moscow`, cron `'0 20 * * *'`.
- Прогон ТОЛЬКО по расписанию — без run-on-start. PM2-рестарт в 14:00 не триггерит дайджест.
- Список 38 новых каналов подбираю я (нефтегаз РФ: нефтехимия, бункеровка, масла, битум, керосин).

## Changes

### 1. Выделить пайплайн из entrypoint

**Новый файл:** [src/pipeline.ts](../src/pipeline.ts)
- Переместить тело `main()` из [src/run.ts:39-82](../src/run.ts#L39-L82) в `runPipeline(): Promise<RunSummary>`.
- Убрать все `process.exit(...)` — функция возвращает результат, ошибки пробрасывает.
- `loadChannelsYaml()` и типы `ChannelEntry`, `ChannelsFile` переезжают сюда же.
- Добавить in-memory дедупу: `const seen = new Set<string>()` с ключом `${username}:${messageId}`, фильтрация перед `posts.push(...)`. Сбрасывается на каждый вызов `runPipeline` (в рамках прогона, не между).
- Вернуть `RunSummary` с counters; daemon решает что делать с ошибкой.

### 2. Daemon-entrypoint с node-cron

**Переписать:** [src/run.ts](../src/run.ts)
```ts
import cron from "node-cron";
import { runPipeline } from "./pipeline.js";
import { log, logRunSummary } from "./logger.js";

let isRunning = false;

async function tick(): Promise<void> {
  if (isRunning) { log.warn("prev run still in progress — skipping tick"); return; }
  isRunning = true;
  try {
    const summary = await runPipeline();
    logRunSummary(summary);
  } catch (err) {
    log.error("pipeline failed", err);
  } finally {
    isRunning = false;
  }
}

const task = cron.schedule("0 20 * * *", tick, { timezone: "Europe/Moscow" });
log.info("daemon started, schedule: 0 20 * * * Europe/Moscow");

const shutdown = async (signal: string): Promise<void> => {
  log.info(`received ${signal}, stopping cron`);
  task.stop();
  while (isRunning) await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```
Без `process.exit(0)` после старта — процесс живёт от cron-handle.

### 3. Graceful reconnect в GramJS

**Изменить:** [src/telegram.ts](../src/telegram.ts)
- В `fetchLast24h` расширить обработчик ошибок: ловить сетевые сбои (сообщения содержат `"not connected"`, `"Disconnect"`, `"TIMEOUT"`, `ConnectionError`, или `client.connected === false`) и делать до 3 попыток с exp. backoff `1000 / 2000 / 4000` мс, между попытками `await client.connect()`. Это отдельная ветка от FloodWait/ChannelPrivate.
- Вынести `tryFetch` логику и использовать **два независимых счётчика: до 3 попыток reconnect и до 3 попыток FloodWait-retry на канал; счётчики не суммируются и не взаимоблокируются** (RELI-03). Один FloodWait + три сетевых = до 4 итераций внешнего loop, это ожидаемое поведение.
- Если после 3 попыток всё ещё падает — пробрасывается наверх, pipeline ловит и добавляет в `errors`, канал помечается как skipped, прогон продолжается.

**Важно:** `createClient()` остаётся без изменений; клиент создаётся один раз на каждый прогон и дисконнектится в `finally` — daemon не держит живую сессию между прогонами (ежесуточный прогон → коннект всё равно протухает).

### 4. Структурированное логирование

**Новый файл:** [src/logger.ts](../src/logger.ts)
- `log.info(msg, ...ctx)`, `log.warn(...)`, `log.error(...)` — префикс `[ISO-timestamp] [level]`.
- `logRunSummary(s: RunSummary)` печатает многострочный блок:
```
[2026-04-22T17:00:42.123Z] [summary] runId=abc123
  duration=58.4s
  channels: total=50 succeeded=47 skipped=3
  posts: collected=412 deduped=5
  delivered=true
  errors:
    - neftegazru: FloodWait retry exhausted
    - oil_gas_forum: network disconnect after 3 attempts
```
- Используется `console.log/warn/error` (идёт в PM2 out/err логи).

**Новый тип в** [src/types.ts](../src/types.ts):
```ts
export interface RunSummary {
  runId: string;              // short uuid/crypto.randomUUID().slice(0,8)
  startedAt: string;          // ISO
  finishedAt: string;         // ISO
  durationMs: number;
  channelsTotal: number;
  channelsSucceeded: number;  // вернули ≥0 постов без throw
  channelsSkipped: number;    // ChannelPrivate/throw после retry
  postsCollected: number;     // уникальных после дедупа
  postsDeduped: number;       // сколько message_id встретились повторно и отброшены
  digestDelivered: boolean;   // true если sendToChannel отработал
  errors: string[];           // `${username}: ${err.message}`
}
```

### 5. Расширение до 50 каналов

**Изменить:** [channels.yaml](../channels.yaml)
- Добавить 38 каналов по российскому нефтегазу/нефтехимии (бункеровка, масла, битум, керосин, нефтехимия). Структура `{ username, priority }` остаётся.
- Список подбираю я, ты ревьюишь перед мёржем. Критерий: публичные каналы, подписан твой user-аккаунт (иначе skip через `ChannelPrivateError`).

**Изменить:** [.env.example](../.env.example)
- `CHANNEL_DELAY_MS=1000` → `1750`. Код читает из env, дефолт в `src/pipeline.ts` обновить на `1750`.
- На 50 каналах × ~1750-2250ms = ~95-115 сек — укладываемся в спокойный темп, анти-бан дисциплина сохранена.

### 6. PM2 на VPS

**Новый файл:** [ecosystem.config.js](../ecosystem.config.js)
```js
module.exports = {
  apps: [{
    name: "tg-parser",
    script: "src/run.ts",
    interpreter: "node",
    interpreter_args: "--env-file=.env --import tsx",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 10,
    min_uptime: "30s",
    max_memory_restart: "300M",
    kill_timeout: 180000, // ждём graceful shutdown активного прогона до 3 мин
    time: true,
  }],
};
```
- `max_restarts: 10` + `min_uptime: 30s` защищают от флап-рестартов (если крон падает сразу — PM2 перестанет).
- `max_memory_restart: 300M` — node-cron daemon обычно <100M, 300 — запас.
- `kill_timeout: 180000` — PM2 дефолт 1600мс недостаточен: прогон 50 каналов длится 2-3 минуты, SIGKILL до завершения graceful shutdown = дайджест не уходит.
- `time: true` добавляет timestamp в логи PM2 (параллельно с нашими в logger).

### 7. package.json

**Изменить:** [package.json](../package.json)
- Добавить dep: `"node-cron": "^3.0.3"`.
- Добавить devDep: `"@types/node-cron": "^3.0.11"`.
- Скрипты остаются: `npm start` (теперь daemon), `npm run login` (без изменений).
- **Не добавляем** `npm run start:pm2` — это деплой-команда, в README достаточно.

### 8. README обновление

**Изменить:** [README.md](../README.md)
- Новая секция «Запуск на VPS (PM2)»: `pm2 start ecosystem.config.js`, `pm2 logs tg-parser`, `pm2 save`, `pm2 startup`.
- Пометка что `npm start` теперь daemon — `Ctrl+C` для остановки локально.
- Убрать старую дисциплину «не чаще 1 прогона в 10-15 минут» — крон сам контролирует (раз в сутки).
- Новый раздел «Ежедневный summary-лог» с примером вывода.

## Critical Files

- [src/run.ts](../src/run.ts) — переписан как daemon
- [src/pipeline.ts](../src/pipeline.ts) — **NEW**, содержит `runPipeline()`
- [src/logger.ts](../src/logger.ts) — **NEW**, structured log + summary
- [src/telegram.ts](../src/telegram.ts) — добавлен reconnect retry с exp backoff
- [src/types.ts](../src/types.ts) — добавлен `RunSummary`
- [channels.yaml](../channels.yaml) — +38 каналов, итого 50
- [.env.example](../.env.example) — `CHANNEL_DELAY_MS=1750`
- [package.json](../package.json) — +node-cron, +@types/node-cron
- [ecosystem.config.js](../ecosystem.config.js) — **NEW**, PM2 config
- [README.md](../README.md) — секция VPS/PM2 + daemon-режим

## Переиспользуем

- `fetchLast24h()` из [src/telegram.ts:61](../src/telegram.ts#L61) — только оборачиваем reconnect-логикой внутри `tryFetch`.
- `summarize()` из [src/summarize.ts](../src/summarize.ts) — без изменений (keyQuote-верификация остаётся).
- `sendToChannel()` из [src/deliver.ts](../src/deliver.ts) — без изменений.
- `sleep()`, `randomInt()` из [src/telegram.ts:19](../src/telegram.ts#L19) — используются в `runPipeline` и в reconnect backoff.

## Verification

1. **Типы и сборка.** `npx tsc --noEmit` — 0 ошибок.
2. **Локальный smoke daemon.** `npm start` → виден лог `daemon started, schedule: 0 20 * * * Europe/Moscow`. Процесс висит, не завершается. `Ctrl+C` → `received SIGINT, stopping cron` → exit 0.
3. **Ручной триггер прогона.** Временно заменить cron-паттерн на `"*/2 * * * *"` (раз в 2 мин) → дождаться прогона → проверить summary-лог: `channels: total=50 succeeded=X skipped=Y`, `posts: collected=N deduped=M`, `delivered=true`, дайджест в канале. Вернуть `"0 20 * * *"`.
4. **Mutex.** Поставить паттерн `"*/1 * * * *"`, проверить что при запуске второй тик пишет `prev run still in progress — skipping tick` (если первый не успел).
5. **Дедупа.** В логе `postsDeduped > 0` если в 50 каналах есть реальные кросс-пересечения (репосты). Либо руками в pipeline закинуть дубль и убедиться что отфильтрован.
6. **Reconnect.** Во время прогона оборвать сеть на 10 сек (wifi off/on) → лог `reconnect attempt 1/3` → прогон продолжается, дайджест уходит.
7. **PM2 smoke (опционально, на VPS).** `pm2 start ecosystem.config.js` → `pm2 status` показывает online → `pm2 logs tg-parser` показывает daemon-стартап → `pm2 kill && pm2 resurrect` восстанавливает процесс.
8. **Вручную в 20:00 MSK.** После деплоя — дождаться реальных 20:00, проверить что дайджест пришёл и summary-лог ушёл в `pm2-out.log`.
