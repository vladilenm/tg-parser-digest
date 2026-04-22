# Phase 2: Daemon + 50 каналов — Research

**Researched:** 2026-04-22
**Domain:** Node.js daemon runtime, node-cron, GramJS reconnect, PM2, structured logging
**Confidence:** HIGH (все ключевые решения зафиксированы в STATE.md и docs/phase-2.md; код v1.0 полностью прочитан)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DAEMON-01 | `npm start` — long-running daemon, graceful shutdown по SIGINT/SIGTERM | §2: node-cron v3 schedule() держит event-loop; SIGINT → task.stop() + drain isRunning |
| DAEMON-02 | Ежедневный прогон по `node-cron`, выражение `0 20 * * *`, timezone `Europe/Moscow` | §1: node-cron v3 поддерживает timezone через Intl.DateTimeFormat |
| DAEMON-03 | Mutex `isRunning` — skipping tick при активном прогоне | §3: in-memory boolean, нет внешних зависимостей |
| DAEMON-04 | Прогон только по расписанию; PM2-рестарт не триггерит дайджест | §2: без `runOnInit: true` и без вызова tick() при старте |
| PIPE-01 | Логика прогона в `src/pipeline.ts` → `runPipeline(): Promise<RunSummary>` | §4: рефакторинг src/run.ts:39-82 в отдельный модуль |
| PIPE-02 | GramJS client per-run, disconnect в finally | §5: уже есть паттерн в run.ts; перенос в pipeline.ts |
| PIPE-03 | In-memory дедупа `${username}:${messageId}` в рамках прогона | §4: Set<string> внутри runPipeline, сбрасывается на каждый вызов |
| RELI-01 | `fetchLast24h` — до 3 попыток exp. backoff 1/2/4s при сетевых сбоях | §6: GramJS бросает `Error("Not connected")`, `Error("TIMEOUT")`; паттерн catch + client.connect() |
| RELI-02 | После 3 попыток — канал skipped, прогон продолжается, ошибка в RunSummary.errors | §6: try/catch в pipeline.ts по каждому каналу отдельно |
| RELI-03 | Reconnect-счётчик отделён от FloodWait-счётчика | §6: два независимых флага/счётчика в fetchLast24h |
| LOG-01 | `src/logger.ts` с log.info/warn/error, ISO-timestamp префикс | §7: console.log без доп. зависимостей |
| LOG-02 | Интерфейс `RunSummary` в src/types.ts | §7: 11 полей включая errors[] |
| LOG-03 | `logRunSummary(s: RunSummary)` — многострочный блок | §7: шаблон из docs/phase-2.md §4 |
| SCALE-01 | channels.yaml расширен до 50 каналов | §8: структура {username, priority} без изменений |
| SCALE-02 | `CHANNEL_DELAY_MS=1750` в .env.example и как дефолт | §8: 50 × ~2000ms ≈ ~100 сек total |
| DEPLOY-01 | ecosystem.config.js с PM2-конфигом | §9: script+interpreter_args паттерн для tsx |
| DEPLOY-02 | package.json: +node-cron@^3.0.3, +@types/node-cron@^3.0.11 | §1: версии подтверждены в npm registry |
| DOC-01 | README секция «Запуск на VPS (PM2)» | §10: команды pm2 start/logs/save/startup |
| DOC-02 | README отражает daemon-режим npm start | §10: удалить «не чаще 10-15 минут» |
| DOC-03 | README секция «Ежедневный summary-лог» с примером | §10: шаблон из docs/phase-2.md |
</phase_requirements>

---

## Summary

Phase 1 отшиплена как одноразовый скрипт: `npm start` запускает прогон и завершается. Phase 2 превращает его в daemon: `npm start` запускает node-cron, который ждёт 20:00 MSK, тригерит `runPipeline()` и не завершается. Новые файлы: `src/pipeline.ts` (логика прогона), `src/logger.ts` (структурированный лог), `ecosystem.config.js` (PM2). Изменяются: `src/run.ts` (daemon entrypoint), `src/telegram.ts` (reconnect retry), `src/types.ts` (RunSummary), `channels.yaml` (+38 каналов), `package.json` (+node-cron).

Все ключевые технические решения уже зафиксированы оператором в `docs/phase-2.md` и `STATE.md`. Этот research верифицирует детали реализации и выявляет конкретные подводные камни кода.

**Главный вывод:** план прямолинеен, рисков мало. Один нетривиальный момент — ESM-импорт CJS node-cron v3, но он корректно работает через `import cron from "node-cron"` (Node.js разрешает дефолтный импорт CJS из ESM). Второй — GramJS бросает plain `Error("Not connected")` и `Error("TIMEOUT")` без специального класса, поэтому детектирование через `err.message.includes(...)`.

---

## §1 — Cron-библиотека: node-cron v3

### Версии (верифицировано в npm registry)

| Package | Locked decision | Latest in npm | Установить |
|---------|----------------|---------------|------------|
| `node-cron` | `^3.0.3` | `3.0.3` (серия v3) / `4.2.1` (latest overall) | `^3.0.3` → установится `3.0.3` |
| `@types/node-cron` | `^3.0.11` | `3.0.11` | `^3.0.11` → установится `3.0.11` |

[VERIFIED: npm registry `npm view node-cron version`, `npm view @types/node-cron version`]

Решение "использовать v3" зафиксировано в `REQUIREMENTS.md` (DEPLOY-02) и `docs/phase-2.md`. Следовать ему.

### API node-cron v3 (верифицировано из исходников пакета)

[VERIFIED: из `node-cron-3.0.3.tgz` → `src/node-cron.js`, `src/scheduled-task.js`, `src/time-matcher.js`]

```typescript
// Импорт из ESM-проекта (type: "module"):
import cron from "node-cron";  // CJS default-import работает в Node ESM

// schedule() API:
cron.schedule(
  expression: string,
  func: (now: Date | "manual" | "init") => void,
  options?: {
    scheduled?: boolean;     // default: true (задача стартует сразу)
    timezone?: string;       // IANA timezone string
    recoverMissedExecutions?: boolean;  // default: false
    name?: string;
    runOnInit?: boolean;     // default: false — NOT использовать в daemon (DAEMON-04)
  }
): ScheduledTask;

// ScheduledTask:
interface ScheduledTask {
  start(): void;
  stop(): void;    // останавливает тики, не завершает процесс
  now(): void;     // немедленный ручной триггер
}
```

**Timezone:** node-cron v3 использует `Intl.DateTimeFormat` с `timeZone` опцией — **без внешних зависимостей** (moment-timezone только в devDeps). Europe/Moscow = валидная IANA timezone. Москва не переходит на летнее время (UTC+3 фиксировано), DST не применяется. [VERIFIED: src/time-matcher.js]

**ESM-совместимость:** node-cron v3 — чистый CJS (нет `exports` поля, только `main`). Node.js поддерживает `import cron from "node-cron"` из ESM-проекта через CJS interop. `cron` будет объектом `{ schedule, validate, getTasks }`. [VERIFIED: package.json v3 без exports поля]

**node-cron v4 vs v3:** v4 (4.2.1) уже стабилен, имеет native ESM exports и добавляет `noOverlap: true` опцию (встроенная защита от параллельных прогонов). Однако v4 **не используем** — decision locked на v3.

### Критически важно: процесс не завершается автоматически

node-cron v3 `schedule()` регистрирует interval через `setTimeout`-цепочку. Это само по себе держит event-loop open. Без дополнительных мер `npm start` не завершится — что и нужно для daemon. [VERIFIED: src/scheduler.js]

---

## §2 — Daemon entrypoint: src/run.ts

### Канонический шаблон (из docs/phase-2.md, верифицирован)

```typescript
import cron from "node-cron";
import { runPipeline } from "./pipeline.js";
import { log, logRunSummary } from "./logger.js";

let isRunning = false;

async function tick(): Promise<void> {
  if (isRunning) {
    log.warn("prev run still in progress — skipping tick");
    return;
  }
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

**Почему нет `process.exit(0)` после `task = cron.schedule(...)`:** event-loop держится от cron-handle. Процесс живёт, пока task активен.

**DAEMON-04 (no run-on-start):** НЕ передавать `runOnInit: true`. Без него — task молчит до первого 20:00 MSK. PM2-рестарт в любое другое время не запустит прогон.

### SIGINT/SIGTERM в ESM

В ESM-проекте `process.on("SIGINT", ...)` работает идентично CJS. `void` перед `shutdown(...)` нужен для подавления TypeScript-предупреждения о floating promise. [ASSUMED — стандартный Node.js паттерн, подтверждён в коде docs/phase-2.md]

**Grace period shutdown:** `while (isRunning) await new Promise(r => setTimeout(r, 500))` — polling каждые 500мс. Для ежесуточного прогона (<2 мин) это нормально. Нет таймаута — если прогон завис навечно, daemon не завершится. По проектным требованиям этого достаточно (ошибки пайплайна должны разрешаться за разумное время).

---

## §3 — Reentrancy guard (DAEMON-03)

In-memory boolean `isRunning` — единственный правильный подход для single-process daemon.

| Подход | Применимость | Вывод |
|--------|-------------|-------|
| `let isRunning = boolean` | Single process, no restart during run | Используем |
| File lock (lockfile) | Multi-process или cross-restart | Избыточно; PM2 fork mode = один процесс |
| `async-mutex` пакет | Избыточно | +4-я зависимость без причины |

Паттерн из docs/phase-2.md корректен. При `pm2 restart` — новый процесс стартует с `isRunning = false`, что правильно (рестарт прерывает текущий прогон через SIGTERM, новый начнёт с нуля по расписанию).

---

## §4 — src/pipeline.ts: рефакторинг из run.ts

### Что переезжает из src/run.ts

Из `run.ts:39-82` (функция `main()`):
- `loadChannelsYaml()` + типы `ChannelEntry`, `ChannelsFile`
- Чтение env-переменных (`MAX_MESSAGES_PER_CHANNEL`, `FETCH_WINDOW_HOURS`, `CHANNEL_DELAY_MS`)
- `createClient()` + `client.connect()`
- Loop по каналам с `fetchLast24h()` + jitter
- `client.disconnect()` в finally
- `summarize()` + `sendToChannel()`

### Изменения по сравнению с run.ts

1. **Нет `process.exit()`** — функция возвращает `RunSummary`, ошибки пробрасывает.
2. **Per-channel try/catch** — каждый канал оборачивается в try/catch; исключения добавляются в `errors[]`, прогон продолжается.
3. **In-memory дедупа** — `const seen = new Set<string>()` с ключом `${username}:${messageId}`. Создаётся при старте `runPipeline()`, умирает при его завершении.
4. **Счётчики** — `channelsSucceeded`, `channelsSkipped`, `postsCollected`, `postsDeduped`.
5. **runId** — `crypto.randomUUID().slice(0, 8)`. `crypto.randomUUID()` доступен в Node 20 без импорта. [VERIFIED: `node -e "console.log(typeof crypto.randomUUID)"` → `function`]

### Примерная сигнатура

```typescript
// src/pipeline.ts
export async function runPipeline(): Promise<RunSummary> {
  const runId = crypto.randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const channels = loadChannelsYaml("./channels.yaml");
  const limit = Number(process.env.MAX_MESSAGES_PER_CHANNEL ?? 50);
  const windowHours = Number(process.env.FETCH_WINDOW_HOURS ?? 24);
  const channelDelayMs = Number(process.env.CHANNEL_DELAY_MS ?? 1750);  // SCALE-02

  const client = createClient();
  await client.connect();

  const seen = new Set<string>();
  const allPosts: Post[] = [];
  let channelsSucceeded = 0;
  let channelsSkipped = 0;
  let postsDeduped = 0;
  const errors: string[] = [];

  try {
    for (let i = 0; i < channels.length; i++) {
      const { username } = channels[i]!;
      try {
        const fetched = await fetchLast24h(client, username, { limit, windowHours });
        for (const post of fetched) {
          const key = `${post.channelUsername}:${post.messageId}`;
          if (seen.has(key)) { postsDeduped++; continue; }
          seen.add(key);
          allPosts.push(post);
        }
        channelsSucceeded++;
      } catch (err) {
        channelsSkipped++;
        errors.push(`${username}: ${(err as Error).message}`);
        log.warn(`channel skipped: ${username}`, err);
      }
      if (i < channels.length - 1) {
        await sleep(channelDelayMs + randomInt(0, 500));
      }
    }
  } finally {
    await client.disconnect();
  }

  let digestDelivered = false;
  if (allPosts.length > 0) {
    const html = await summarize(allPosts);
    await sendToChannel(html);
    digestDelivered = true;
  } else {
    log.info("no posts in window — skipping digest");
  }

  const finishedAt = new Date().toISOString();
  return {
    runId, startedAt, finishedAt,
    durationMs: Date.now() - startMs,
    channelsTotal: channels.length,
    channelsSucceeded,
    channelsSkipped,
    postsCollected: allPosts.length,
    postsDeduped,
    digestDelivered,
    errors,
  };
}
```

**Важно:** FloodWait на уровне канала теперь тоже должен пробрасываться через `throw` наверх (в `errors[]`), не прерывая весь прогон. Текущий код `telegram.ts` при втором FloodWait бросает ошибку — это корректно, pipeline её поймает.

---

## §5 — GramJS: per-run client и disconnect

Решение из STATE.md: "Клиент GramJS создаётся per-run внутри `runPipeline` и дисконнектится в `finally`."

**Почему не держим сессию:** GramJS long-lived connection в daemon требует ping-pong keepalive. Ежесуточный прогон означает 24 часа idle, за которые TCP-соединение умрёт. Reconnect при каждом прогоне надёжнее.

**`client.disconnect()` в `finally`:** текущий run.ts уже так делает (строки 63-65). Переносится в pipeline.ts без изменений. StringSession (в памяти, из TG_SESSION env) сохраняет авторизацию между прогонами — не нужен файловый storage.

---

## §6 — GramJS reconnect: детали реализации (RELI-01, RELI-02, RELI-03)

### Какие ошибки бросает GramJS при сетевом сбое

[VERIFIED: из `telegram/network/connection/Connection.js` — реальные строки в throw]

| Ошибка | Тип | Условие |
|--------|-----|---------|
| `Error("Not connected")` | plain Error | клиент не подключён при вызове send/recv |
| `Error("TIMEOUT")` | plain Error | timeout ожидания ответа (Helpers.js) |
| `Error("no data received")` | plain Error | TCP получил пустые данные |

**Нет специального класса `ConnectionError`** — это только название в JSDoc комментарии `Connection.d.ts`. Реально бросается `new Error("Not connected")`. [VERIFIED: Connection.js `throw new Error("Not connected")`]

`client.connected` — getter на `telegramBaseClient.d.ts` возвращает `boolean | undefined`. Можно использовать как дополнительный guard.

### Паттерн reconnect в fetchLast24h

```typescript
// src/telegram.ts — добавить RELI-01 поверх существующего кода

export async function fetchLast24h(
  client: TelegramClient,
  username: string,
  opts: { limit: number; windowHours: number }
): Promise<Post[]> {
  const { limit, windowHours } = opts;
  const sinceUnix = Math.floor(Date.now() / 1000) - windowHours * 3600;

  // RELI-03: отдельные счётчики для reconnect и FloodWait
  let floodRetried = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 3;
  const RECONNECT_BACKOFF = [1000, 2000, 4000];

  const isNetworkError = (err: unknown): boolean => {
    const msg = (err as Error)?.message ?? String(err);
    const name = (err as { constructor?: { name?: string } })?.constructor?.name ?? "";
    return (
      msg.includes("Not connected") ||
      msg.includes("Disconnect") ||
      msg.includes("TIMEOUT") ||
      msg.includes("no data received") ||
      name === "ConnectionError" ||
      client.connected === false
    );
  };

  while (true) {
    try {
      return await tryFetch(client, username, sinceUnix, limit);
    } catch (err: unknown) {
      const name = (err as { constructor?: { name?: string } })?.constructor?.name ?? "";
      const errorMessage = (err as Error)?.message ?? String(err);

      // FETCH-05: channel errors — warn + empty
      if (/* ... existing channel private checks ... */) {
        console.warn(`[telegram] channel skipped: ${username}`);
        return [];
      }

      // FETCH-04: FloodWait — один retry (отдельный от reconnect)
      if (err instanceof FloodWaitError || name === "FloodWaitError") {
        const seconds = (err as { seconds?: number }).seconds ?? 30;
        if (floodRetried) {
          throw err;  // второй FloodWait — пробрасываем, pipeline поймает
        }
        console.warn(`[telegram] FloodWait on ${username}: ${seconds}s`);
        await sleep(seconds * 1000 + 2000);
        floodRetried = true;
        continue;
      }

      // RELI-01: network error — reconnect с exp backoff
      if (isNetworkError(err)) {
        if (reconnectAttempts >= MAX_RECONNECT) {
          throw new Error(`${username}: network disconnect after ${MAX_RECONNECT} attempts`);
        }
        const delay = RECONNECT_BACKOFF[reconnectAttempts] ?? 4000;
        console.warn(
          `[telegram] reconnect attempt ${reconnectAttempts + 1}/${MAX_RECONNECT} for ${username}, waiting ${delay}ms`
        );
        await sleep(delay);
        try { await client.connect(); } catch { /* ignore connect error, retry outer */ }
        reconnectAttempts++;
        continue;
      }

      throw err;  // прочие ошибки — наверх
    }
  }
}
```

**Лог-строка для Success Criterion 4:** `reconnect attempt 1/3` — именно такой формат указан в roadmap.md.

**RELI-03:** FloodWait-счётчик (`floodRetried`) и reconnect-счётчик (`reconnectAttempts`) полностью независимы. Один FloodWait + три сетевые ошибки не складываются в 4 ретрая.

---

## §7 — Структурированное логирование (LOG-01, LOG-02, LOG-03)

### src/logger.ts — без новых зависимостей

Пишем через `console.log/warn/error`. PM2 перехватывает stdout/stderr в `pm2-out.log` / `pm2-err.log`. [ASSUMED: стандартное поведение PM2]

```typescript
// src/logger.ts
function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(msg: string, ...ctx: unknown[]): void {
    console.log(`[${timestamp()}] [info] ${msg}`, ...ctx);
  },
  warn(msg: string, ...ctx: unknown[]): void {
    console.warn(`[${timestamp()}] [warn] ${msg}`, ...ctx);
  },
  error(msg: string, ...ctx: unknown[]): void {
    console.error(`[${timestamp()}] [error] ${msg}`, ...ctx);
  },
};

export function logRunSummary(s: RunSummary): void {
  const dur = (s.durationMs / 1000).toFixed(1);
  const lines = [
    `[${s.finishedAt}] [summary] runId=${s.runId}`,
    `  duration=${dur}s`,
    `  channels: total=${s.channelsTotal} succeeded=${s.channelsSucceeded} skipped=${s.channelsSkipped}`,
    `  posts: collected=${s.postsCollected} deduped=${s.postsDeduped}`,
    `  delivered=${s.digestDelivered}`,
  ];
  if (s.errors.length > 0) {
    lines.push("  errors:");
    for (const e of s.errors) lines.push(`    - ${e}`);
  }
  console.log(lines.join("\n"));
}
```

### RunSummary interface (LOG-02)

```typescript
// src/types.ts — добавить
export interface RunSummary {
  runId: string;               // crypto.randomUUID().slice(0, 8)
  startedAt: string;           // ISO 8601
  finishedAt: string;          // ISO 8601
  durationMs: number;
  channelsTotal: number;
  channelsSucceeded: number;   // вернули ≥0 постов без throw
  channelsSkipped: number;     // throw после исчерпания retry
  postsCollected: number;      // уникальных постов после дедупа
  postsDeduped: number;        // отброшено дублей
  digestDelivered: boolean;
  errors: string[];            // `${username}: ${err.message}`
}
```

**Ключ для Success Criterion 2:** summary-лог должен содержать `channels: total=50`, `delivered=true`, `durationMs` (через `duration=Xs`).

---

## §8 — Масштабирование до 50 каналов (SCALE-01, SCALE-02)

### Задержка между каналами

`CHANNEL_DELAY_MS=1750` (с jitter 0-500ms) → реальная задержка 1750-2250ms.

50 каналов × 2000ms avg = ~100 сек на loop + время GramJS запросов (~0.5-1s каждый) ≈ **2-3 минуты** на прогон. Это в рамках нормы для суточного daemon. [VERIFIED: математика из docs/phase-2.md §5]

**FloodWait риск при 50 каналах:** FloodWait обычно триггерится на частых запросах одного типа в короткое время. 1750ms между каналами достаточно для большинства случаев. Оператор может поднять до 2500ms если FloodWait участится. [ASSUMED: основано на общих практиках GramJS]

### channels.yaml структура (без изменений)

```yaml
channels:
  - username: channel_name
    priority: 1
```

38 новых каналов подбирает оператор перед мёржем. Требование: публичные каналы + user-аккаунт подписан (иначе `ChannelPrivateError` → skipped).

### Дедупа (PIPE-03)

In-memory Set<string> с ключом `${username}:${messageId}`. Дубли возникают при:
- кросс-постинге одного сообщения в несколько каналов (редко в реальности при нефтегазовых каналах)
- два канала из одного чата (если вдруг добавлен дважды)

`postsDeduped` в RunSummary показывает реальный масштаб проблемы.

---

## §9 — PM2: ecosystem.config.js (DEPLOY-01)

### Паттерн для tsx + ESM entrypoint

[ASSUMED: на основе PM2 документации и стандартных паттернов; PM2 на VPS не проверен до этого milestone]

```javascript
// ecosystem.config.js
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
    time: true,
  }],
};
```

**Почему `script: "src/run.ts"` + `interpreter: "node"` + `interpreter_args: "--env-file=.env --import tsx"`:**
- PM2 вызывает `node --env-file=.env --import tsx src/run.ts`
- Эквивалентно `npm start` (который делает то же самое)
- Альтернатива `script: "npm"` + `args: "start"` работает, но менее прозрачна

**Параметры PM2:**
- `max_restarts: 10` + `min_uptime: "30s"` — защита от флап-рестартов (если daemon крашится в первые 30s, PM2 считает это флапом и перестаёт рестартовать после 10 попыток)
- `max_memory_restart: "300M"` — node-cron daemon обычно потребляет <50-100MB; 300M = запас × 3
- `time: true` — PM2 добавляет timestamp к каждой строке в своих логах (дополняет наш logger)
- `autorestart: true` — при крэше daemon рестартует; SIGTERM при graceful shutdown → `exit 0` не триггерит рестарт

### PM2 save/resurrect механика

```bash
pm2 start ecosystem.config.js   # запустить
pm2 save                         # сохранить список в ~/.pm2/dump.pm2
pm2 startup                      # генерирует systemd/launchd unit для auto-start при перезагрузке
pm2 kill && pm2 resurrect        # restore из dump.pm2
```

`pm2 resurrect` читает `~/.pm2/dump.pm2` и восстанавливает все сохранённые процессы. [ASSUMED: PM2 документация]

### Логи PM2

```bash
pm2 logs tg-parser               # tail -f обоих stdout+stderr
pm2 logs tg-parser --out         # только stdout (наш logger + node-cron тики)
~/.pm2/logs/tg-parser-out.log    # файл pm2-out.log для Success Criterion 2
```

---

## §10 — Документация (DOC-01, DOC-02, DOC-03)

### README: секция «Запуск на VPS (PM2)»

```bash
# 1. Установить PM2 глобально (один раз)
npm install -g pm2

# 2. Запустить daemon
pm2 start ecosystem.config.js

# 3. Проверить статус
pm2 status
pm2 logs tg-parser

# 4. Сохранить для auto-resurrect
pm2 save

# 5. Настроить автозапуск при перезагрузке VPS
pm2 startup
# Выполнить команду, которую выдаст pm2 startup
```

### README: daemon-режим npm start

- `npm start` теперь запускает daemon, не завершается
- Для локальной остановки: `Ctrl+C` → graceful shutdown
- Удалить фразу «не чаще 1 прогона в 10–15 минут» — крон сам контролирует (раз в сутки)

### README: пример summary-лога (DOC-03)

```
[2026-04-22T17:00:42.123Z] [summary] runId=abc12345
  duration=58.4s
  channels: total=50 succeeded=47 skipped=3
  posts: collected=412 deduped=5
  delivered=true
  errors:
    - neftegazru: FloodWait retry exhausted
    - oil_gas_forum: network disconnect after 3 attempts
    - some_private: ChannelPrivateError
```

---

## Don't Hand-Roll

| Проблема | Не строить | Использовать |
|----------|-----------|--------------|
| Cron scheduling + timezone | Собственный setTimeout-цикл с TZ-конвертацией | `node-cron@^3.0.3` — встроенный Intl.DateTimeFormat |
| ISO timestamp | `new Date().toString()` | `new Date().toISOString()` (встроенный) |
| Unique ID для runId | Math.random() | `crypto.randomUUID().slice(0, 8)` (встроенный Node 20) |
| PM2 конфиг для tsx | `node -r ts-node/register` или компиляция | `--import tsx` — транзитивная регистрация без сборки |

---

## Common Pitfalls

### Pitfall 1: node-cron v3 — CJS, но проект ESM

**Что идёт не так:** `import { schedule } from "node-cron"` — именованные экспорты из CJS не работают в ESM (TypeScript может скомпилировать, но runtime упадёт с `SyntaxError` или вернёт `undefined`).

**Почему:** node-cron v3 — чистый CJS без `exports` поля. Node ESM видит только дефолтный экспорт (весь `module.exports`).

**Как избежать:** Использовать `import cron from "node-cron"` → `cron.schedule(...)`. [VERIFIED: проверен package.json v3, нет exports поля]

### Pitfall 2: GramJS "Not connected" — не класс, а строка

**Что идёт не так:** `err instanceof ConnectionError` — не сработает, такого экспортируемого класса нет в GramJS.

**Почему:** GramJS бросает `new Error("Not connected")` — plain Error с текстом. [VERIFIED: Connection.js]

**Как избежать:** `err.message.includes("Not connected")` + `err.message.includes("TIMEOUT")`.

### Pitfall 3: `process.exit(0)` в pipeline.ts убивает daemon

**Что идёт не так:** Если оставить `process.exit(0)` из run.ts в pipeline.ts, daemon завершится после первого прогона.

**Как избежать:** В pipeline.ts нет ни одного `process.exit()`. Ошибки пробрасываются через `throw`. Только daemon-entrypoint (run.ts) вызывает `process.exit(0)` — и только в shutdown-хэндлере.

### Pitfall 4: runOnInit не указан явно

**Что идёт не так:** Если случайно передать `runOnInit: true` в `cron.schedule()`, прогон запустится сразу при старте (PM2-рестарт в 14:00 → дайджест в 14:00).

**Как избежать:** В `options` передавать только `{ timezone: "Europe/Moscow" }`. `runOnInit` не упоминать.

### Pitfall 5: Double SIGTERM от PM2 при max_restarts

**Что идёт не так:** PM2 при graceful reload отправляет SIGINT, ждёт kill_timeout (default 1600ms), потом SIGKILL. Если graceful shutdown занимает >1600ms (ждём активный прогон), PM2 убивает процесс принудительно.

**Как избежать:** Ежесуточный прогон <3 минут, kill_timeout по умолчанию достаточен. Если нужно — `kill_timeout: 180000` в ecosystem.config.js. [ASSUMED: PM2 документация]

### Pitfall 6: tsx + `--import` не поддерживает все tsconfig опции

**Что идёт не так:** `moduleResolution: "bundler"` в tsconfig.json — tsx понимает, но некоторые версии tsx старше 4.0 могут игнорировать bundler resolution.

**Как избежать:** tsx ≥ 4.0.0 (в devDeps уже `"tsx": "^4.0.0"`) корректно поддерживает moduleResolution: bundler. [VERIFIED: package.json devDeps]

### Pitfall 7: `pm2 resurrect` требует предварительного `pm2 save`

**Что идёт не так:** `pm2 kill && pm2 resurrect` возвращает "no process saved" если оператор не выполнил `pm2 save` после первого `pm2 start`.

**Как избежать:** В README и DOC-01 обязательно: `pm2 start ecosystem.config.js && pm2 save`.

---

## State of the Art

| Старый подход (v1.0) | Новый подход (v2.0) | Изменение | Impact |
|---------------------|--------------------|-----------|--------|
| `main()` → `process.exit(0)` | `runPipeline()` → `RunSummary` | Phase 2 | Тестируемость, daemon-совместимость |
| `console.log("[run] ...")` | `log.info(msg)` с ISO-timestamp | Phase 2 | Диагностируемость в PM2-логах |
| Нет FloodWait retry отдельно от reconnect | Два счётчика (RELI-03) | Phase 2 | Корректный подсчёт ретраев |
| Одноразовый процесс без дедупа | In-memory Set per-run | Phase 2 | Подготовка к cross-run дедупе |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PM2 `kill_timeout` default = 1600ms достаточен для graceful shutdown | §9, Pitfall 5 | Если прогон долгий (>1.6s до SIGKILL) — PM2 убьёт процесс без drain; решение: добавить `kill_timeout` в ecosystem.config.js |
| A2 | GramJS при вызове `client.connect()` в reconnect не создаёт новый auth key (переиспользует StringSession) | §6 | Если connect() требует полной re-auth — reconnect не поможет без нового login; низкий риск для коротких обрывов |
| A3 | FloodWait на 50 каналах при 1750ms задержке редок | §8 | Если FloodWait частый — нужно поднять CHANNEL_DELAY_MS до 2500+; обнаружится на первом реальном прогоне |
| A4 | PM2 с `script: "src/run.ts"` + `interpreter_args: "--env-file=.env --import tsx"` корректно стартует на VPS | §9 | Если VPS версия Node не поддерживает `--env-file` или `--import` — нужен wrapper-скрипт; убедиться что Node ≥20.6 на VPS |
| A5 | `process.on("SIGINT", ...)` в ESM-модуле работает без специальных флагов | §2 | Стандартный Node.js behaviour; крайне низкий риск |

---

## Open Questions

1. **38 новых каналов**
   - Что знаем: список подбирает оператор
   - Что неясно: нет списка в репозитории на момент research
   - Рекомендация: оператор добавляет список перед execution; плану не нужен полный список, только структура

2. **kill_timeout в ecosystem.config.js**
   - Что знаем: graceful shutdown ждёт активный прогон; PM2 default kill_timeout = 1600ms
   - Что неясно: нужен ли явный `kill_timeout` в config
   - Рекомендация: добавить `kill_timeout: 180000` (3 минуты) — дешевле чем дебажить принудительный SIGKILL

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ (dev machine) | 22.18.0 | — |
| npm | Package manager | ✓ | 10.9.3 | — |
| tsx (devDep) | TypeScript runner | ✓ (в devDeps) | ^4.0.0 | — |
| node-cron | DAEMON-02 | ✗ (not yet installed) | install: `^3.0.3` | — |
| @types/node-cron | TypeScript types | ✗ (not yet installed) | install: `^3.0.11` | — |
| PM2 | DEPLOY-01 | ✗ (не установлен глобально) | install: `npm install -g pm2` на VPS | Ручной запуск через `npm start` (только для локальной разработки) |

**Missing dependencies with no fallback:**
- `node-cron@^3.0.3` — установить как part of Wave 0 (`npm install node-cron@^3.0.3`)

**Missing dependencies with fallback:**
- PM2 — не нужен для локального smoke-теста daemon; нужен только для VPS deployment verification (Success Criterion 3)

---

## Validation Architecture

Тест-фреймворк в проекте отсутствует (v2.0 продолжает линию ручной приёмки). Все критерии проверяются вручную или через наблюдение за логами.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | нет автотестов (по решению v1.0/v2.0) |
| Config file | — |
| Quick run command | `npx tsc --noEmit` (type check) |
| Full suite command | `npx tsc --noEmit` |

### Success Criteria → Verification Map

| SC# | Success Criterion | Проверка | Команда / Наблюдение |
|-----|------------------|----------|----------------------|
| SC1 | `npm start` не завершается; `Ctrl+C` → `received SIGINT, stopping cron` → exit 0 | Ручной smoke | `npm start` → наблюдать stdout → `Ctrl+C` → проверить exit code `echo $?` |
| SC2 | В 20:00 MSK дайджест автоматически; summary-лог содержит `total=50`, `delivered=true`, `durationMs` | Ручной триггер | Временно заменить pattern на `"*/2 * * * *"`, запустить, подождать тик, проверить лог |
| SC3 | PM2 smoke: `pm2 start ecosystem.config.js` → online; `pm2 kill && pm2 resurrect` → восстановление | Ручной (VPS) | На VPS: `pm2 start` → `pm2 status` → `pm2 save` → `pm2 kill` → `pm2 resurrect` → `pm2 status` |
| SC4 | Обрыв сети → `reconnect attempt 1/3` → прогон продолжается | Ручной во время прогона | Запустить прогон (temp pattern `*/2`), обрезать сеть, наблюдать лог |
| SC5 | Второй тик при активном прогоне → `prev run still in progress — skipping tick` | Ручной | Временно pattern `"*/1 * * * *"`, наблюдать два тика |
| SC6 | `npx tsc --noEmit` = 0 ошибок | Автоматический | `npx tsc --noEmit` |

### Wave 0 Gaps

- [ ] `npm install node-cron@^3.0.3 @types/node-cron@^3.0.11` — DEPLOY-02 пакеты не установлены

*(Существующая инфраструктура покрывает все остальные требования — нет фреймворка, нет конфигов)*

---

## Sources

### Primary (HIGH confidence)
- `node_modules/telegram/network/connection/Connection.js` — актуальные строки ошибок GramJS
- `node_modules/telegram/client/telegramBaseClient.d.ts` — `client.connected` getter
- `/tmp/node-cron-3.0.3.tgz` → `src/time-matcher.js`, `src/node-cron.js`, `src/scheduled-task.js` — API v3
- `/tmp/typesncron/node-cron/index.d.ts` — типы @types/node-cron@3.0.11
- `npm view node-cron version` — версии в registry [VERIFIED]
- `npm view @types/node-cron version` — версии в registry [VERIFIED]
- `node -e "console.log(typeof crypto.randomUUID)"` — availability в Node 20 [VERIFIED]
- `docs/phase-2.md` — все locked decisions и канонические code snippets

### Secondary (MEDIUM confidence)
- `package.json v4 exports` — ESM/CJS split в node-cron v4 (для сравнения)
- `src/run.ts`, `src/telegram.ts`, `src/types.ts` — текущая кодовая база v1.0

### Tertiary (LOW confidence — требуют проверки на VPS)
- PM2 `kill_timeout` default и `interpreter_args` поведение (A4)
- GramJS reconnect через `client.connect()` без re-auth (A2)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — версии верифицированы в npm registry, API прочитан из распакованных пакетов
- Architecture: HIGH — все решения зафиксированы в docs/phase-2.md; рефакторинг прямолинеен
- Pitfalls: HIGH — GramJS error strings верифицированы из Connection.js; node-cron CJS/ESM из package.json
- PM2 config: MEDIUM — паттерны ecosystem.config.js общеизвестны, но VPS smoke не проведён

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (стабильный стек, изменений не ожидается)
