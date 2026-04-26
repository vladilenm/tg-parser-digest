---
phase: 02-daemon-50
reviewed: 2026-04-22T12:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/types.ts
  - src/pipeline.ts
  - src/logger.ts
  - src/telegram.ts
  - src/run.ts
  - channels.yaml
  - .env.example
  - ecosystem.config.cjs
  - package.json
  - README.md
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-22T12:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 2 добавил daemon-режим (node-cron + PM2) поверх пайплайна из Phase 1: вынес single-run логику в `runPipeline()`, добавил структурированный логгер, GramJS reconnect retry с exp backoff, in-memory mutex в entrypoint и PM2 ecosystem-конфиг. Общее качество кода — высокое: явные комментарии со ссылками на REQ-ID, строгая типизация, разумное разделение обязанностей между `run.ts` (оркестратор) и `pipeline.ts` (единичный прогон).

Критических уязвимостей нет. Нет захардкоженных секретов, нет injection-паттернов, нет явных crash-ов. Основные замечания касаются граничных случаев daemon-lifecycle (необработанные промисы, idempotency shutdown, race при ранней SIGINT), минорных багов в жизненном цикле GramJS-клиента и нескольких несоответствий документации реализации.

Для production-daemon на VPS рекомендую устранить хотя бы WR-01 (неперехваченные rejection/exception) и WR-02 (`client.disconnect()` на неподключенном клиенте), остальное можно оставить на следующую итерацию.

## Warnings

### WR-01: Отсутствуют обработчики `uncaughtException` и `unhandledRejection`

**File:** `src/run.ts:1-45`
**Issue:** Daemon рассчитан на long-running работу под PM2, но в `run.ts` нет глобальных обработчиков `process.on("uncaughtException", ...)` и `process.on("unhandledRejection", ...)`. Любой unhandled reject вне `await`-цепочки (например, «fire-and-forget» вызов внутри GramJS или таймер из node-cron) приведёт к аварийному `process.exit(1)` в Node 20+ без прохождения graceful-shutdown ветки. PM2 сделает respawn, но в stdout попадёт только stack trace без `runId` и контекста прогона, и активный tick может остаться в полуразобранном состоянии (недовыгруженные HTTP-соединения DeepSeek, активная сессия GramJS).

В `tick()` все исключения ловятся, но `setInterval`-колбэки от GramJS/OpenAI и `ScheduledTask` от node-cron могут кинуть вне этой try-границы.

**Fix:**
```ts
process.on("uncaughtException", (err) => {
  log.error("uncaughtException — daemon will exit for PM2 respawn", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection — daemon will exit for PM2 respawn", reason);
  process.exit(1);
});
```
Добавить в начало `run.ts`, до регистрации cron. PM2 рестартует процесс (`autorestart: true`), а оператор получит явный error-log в `~/.pm2/logs/tg-parser-error.log`.

### WR-02: `client.disconnect()` в finally вызывается даже при провале `client.connect()`

**File:** `src/pipeline.ts:58-96`
**Issue:** Блок `try { for ... } finally { await client.disconnect(); }` начинается после `await client.connect()` на строке 59. Если `connect()` упадёт (network timeout, bad session) — исключение пробросится до try, finally не выполнится, это OK. Но если `createClient()` (строка 58) пройдёт, `connect()` пройдёт, а дальше в цикле произойдёт что-то необычное (например, reconnect в `fetchLast24h` оставил клиент в inconsistent state или GramJS уже выставил `connected=false`) — `disconnect()` может бросить «Not connected» и мы потеряем оригинальную ошибку из цикла, которая сейчас просто «проглатывается» в логах `log.error` (в `tick()` catch).

Более серьёзный случай: если `client.connect()` throws, а оператор успеет поймать SIGINT между `createClient()` и началом try — соединение в состоянии «half-open», disconnect не вызовется никогда.

**Fix:** Обернуть connect в try и гарантировать disconnect:
```ts
const client = createClient();
try {
  await client.connect();
  // ... весь цикл по каналам здесь
} finally {
  try {
    await client.disconnect();
  } catch (err) {
    log.warn("[pipeline] disconnect failed (ignored)", (err as Error).message);
  }
}
```

### WR-03: Race condition между SIGINT и запуском tick()

**File:** `src/run.ts:12-44`
**Issue:** Порядок в `shutdown()`: `task.stop()` → `while (isRunning) wait`. Если SIGINT приходит ровно в момент, когда node-cron уже вызвал `tick` (колбэк в очереди event-loop), но до строки `isRunning = true` (строка 17), то:
1. `task.stop()` не отменяет уже переданный в event-loop вызов tick.
2. `shutdown` видит `isRunning === false` и сразу вызывает `process.exit(0)`.
3. `tick()` запускается параллельно в доли миллисекунды после, но процесс уже убит — runPipeline оборвётся посередине, `client.disconnect()` не вызовется, на стороне Telegram останется подвешенная сессия.

Также у `shutdown` нет idempotency-guard: два подряд SIGINT (оператор нажал Ctrl+C дважды) запустят две параллельных shutdown-корутины, обе сделают `process.exit(0)` — не катастрофа, но некорректно.

**Fix:**
```ts
let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) {
    log.warn(`received ${signal} during shutdown, force exit`);
    process.exit(1);
  }
  shuttingDown = true;
  log.info(`received ${signal}, stopping cron`);
  task.stop();
  // Дать event-loop один тик, чтобы только что поставленный в очередь tick успел взвести isRunning.
  await new Promise((r) => setImmediate(r));
  while (isRunning) {
    await new Promise((r) => setTimeout(r, 500));
  }
  process.exit(0);
};
```

### WR-04: `LOG_LEVEL` из `.env.example` не реализован в logger

**File:** `src/logger.ts:11-21`, `.env.example:40`
**Issue:** В `.env.example` строка `LOG_LEVEL=info # debug | info | warn | error` создаёт у оператора ожидание, что можно задать `LOG_LEVEL=warn` и не видеть `log.info(...)` вызовов (а их в `pipeline.ts` порядка 5 на каждый tick, плюс per-channel). Но `log.info` безусловно вызывает `console.log`. Конфиг — dead configuration. Для daemon в PM2 это значит, что `~/.pm2/logs/tg-parser-out.log` растёт быстрее, чем оператор ожидает по конфигу.

**Fix:** Либо реализовать фильтрацию:
```ts
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const current = LEVELS[(process.env.LOG_LEVEL as keyof typeof LEVELS) ?? "info"] ?? 1;
export const log = {
  info(msg: string, ...ctx: unknown[]): void {
    if (current <= LEVELS.info) console.log(`[${timestamp()}] [info] ${msg}`, ...ctx);
  },
  // ... аналогично для warn/error/debug
};
```
Либо удалить строку `LOG_LEVEL=info` из `.env.example`, чтобы не плодить мёртвый конфиг.

## Info

### IN-01: Относительный путь `./channels.yaml` чувствителен к cwd

**File:** `src/pipeline.ts:50`
**Issue:** `loadChannelsYaml("./channels.yaml")` резолвится от `process.cwd()`. PM2 при `pm2 start ecosystem.config.cjs` запускает скрипт с cwd = каталог конфига, но если оператор сделает `pm2 start /abs/path/ecosystem.config.cjs` из другого каталога или поставит `cwd` в конфиге — путь сломается. В `ecosystem.config.cjs` нет явного поля `cwd`.

**Fix:** Явный resolve от расположения run.ts или добавить `cwd: __dirname` в ecosystem.config.cjs:
```ts
// pipeline.ts
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const channelsPath = resolve(__dirname, "..", "channels.yaml");
```

### IN-02: Потеря точности `bigint` → `number` в `messageId`

**File:** `src/telegram.ts:89-91`
**Issue:** `messageId = typeof rawId === "number" ? rawId : Number(rawId)`. Для GramJS API message IDs иногда возвращаются как `bigint`. При значениях выше `Number.MAX_SAFE_INTEGER` (2^53) конвертация теряет точность — дедуп-ключ `${username}:${messageId}` может коллизировать для двух разных постов. Практически Telegram message IDs сейчас далеко от 2^53, но код уязвим к будущему.

**Fix:**
```ts
const rawId = (msg as unknown as { id?: number | bigint }).id;
const messageId =
  typeof rawId === "bigint" ? Number(rawId) :
  typeof rawId === "number" ? rawId :
  Number(rawId);
// Безопаснее: хранить как string для ключа дедупа.
```
Или хранить `messageId` в `Post` как `string` и ключ дедупа собирать уже из строки — избавляет от конвертации вовсе.

### IN-03: README противоречит CLAUDE.md по числу runtime-зависимостей

**File:** `README.md:26`, `CLAUDE.md`
**Issue:** README.md:26 пишет «Будет установлено четыре runtime-зависимости: telegram, openai, yaml, node-cron», но CLAUDE.md Constraints прямо говорит «Runtime-зависимости ровно три». Phase 2 осознанно расширил стек (node-cron добавлен для daemon), но CLAUDE.md не обновлён — это создаст конфликт при следующем `/gsd-*` команде, которая прочитает CLAUDE.md и увидит несоответствие.

**Fix:** Обновить CLAUDE.md Constraints: «Runtime-зависимости: в MVP три (`telegram`, `openai`, `yaml`); в v2.0 добавлен `node-cron` для daemon-режима — итого четыре».

### IN-04: Эвристика `isNetworkError` по substring — хрупкая

**File:** `src/telegram.ts:110-119`
**Issue:** Классификация сетевой ошибки через `msg.includes("Not connected") || msg.includes("Disconnect") || ...`. Если GramJS в будущей версии переформулирует сообщение (например, `"connection closed"` или локализует на русский), reconnect-ветка не сработает, ошибка пролетит в `throw err` и канал будет помечен skipped без попытки reconnect. Это снижает availability daemon в долгом run'е.

**Fix:** Проверять по названию класса ошибки (GramJS экспортирует `NetworkError`, `TimeoutError` в `telegram/errors`):
```ts
import { NetworkError, TimeoutError } from "telegram/errors/index.js";
const isNetworkError = (err: unknown): boolean => {
  if (err instanceof NetworkError) return true;
  if (err instanceof TimeoutError) return true;
  const msg = (err as Error)?.message ?? String(err);
  return /not connected|disconnect|timeout|no data received/i.test(msg);
};
```
Комбинация instance-проверки + regex — надёжнее.

### IN-05: `kill_timeout: 180000` — риск обрезания tick'а на 50 каналах

**File:** `ecosystem.config.cjs:19`, `README.md:116`
**Issue:** README декларирует «на 50 каналах ожидается 90-180 сек», при этом `kill_timeout: 180000` (3 минуты) — ровно верхняя граница. Если реальный tick займёт 181 сек (плюс расходы на DeepSeek ~20с и Telegram chunks ~5с), PM2 отправит SIGKILL прямо посреди работы. Граница слишком плотная.

Расчёт: 50 каналов × (1750ms + 500ms jitter + GramJS latency ~500ms) = ~135-140 сек, плюс DeepSeek (~15-30с), плюс deliver (~3-8с) = 155-180 сек. Один FloodWait retry (30 сек sleep) выводит за лимит.

**Fix:** Поднять `kill_timeout` до 240000 (4 минуты) или даже 300000 (5 минут) — безопасный запас. PM2 всё равно не уложится в тот же тик cron (следующий — через 24 часа), а преждевременный SIGKILL приводит к потере дайджеста за день.

### IN-06: `channels.yaml` содержит 38 `PLACEHOLDER_NN` — гарантированный шум в summary

**File:** `channels.yaml:36-111`
**Issue:** По design PLACEHOLDER-каналы помечаются `UsernameNotOccupiedError` и попадают в `errors[]` summary. На каждый tick в `pm2 logs` будет падать ~38 warn-строк `[telegram] channel skipped: PLACEHOLDER_XX` плюс раздутый summary с 38 строками `errors:`. Для оператора это создаёт «log fatigue» и маскирует реальные ошибки (FloodWait, network).

Нужно либо удалить PLACEHOLDER-записи до production-старта, либо отдельно классифицировать их в `channelsSkipped`, не выбрасывая в `errors[]`.

**Fix:** В `pipeline.ts:84-89` можно не добавлять в `errors[]` записи, начинающиеся с `PLACEHOLDER_`:
```ts
} catch (err) {
  channelsSkipped++;
  const msg = (err as Error)?.message ?? String(err);
  if (!username.startsWith("PLACEHOLDER_")) {
    errors.push(`${username}: ${msg}`);
  }
  log.warn(`[pipeline] channel skipped: ${username} — ${msg}`);
}
```
Или (предпочтительнее) просто удалить PLACEHOLDER-строки из `channels.yaml` и оставить только реально подписанные каналы.

---

_Reviewed: 2026-04-22T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
