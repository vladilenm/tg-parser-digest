---
phase: 02-bot-commands
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/bot.ts
  - src/run.ts
  - src/__tests__/bot-handlers.test.ts
  - README.md
  - .env.example
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Фаза 02 добавила Telegram bot polling, четыре handler'а (`/channels`, `/add_channel`, `/remove_channel` + `callback_query`), интеграцию в `run.ts` и vitest-покрытие. Архитектурно реализация чистая: единственный `TG_BOT_TOKEN` (D-01), allowlist через silent ignore (D-07/D-08), reuse существующего `mutate()`-mutex для race-condition safety, exp.backoff в polling-loop, graceful shutdown с deadline 35s. Plain-text only ответы (D-10) выдержаны.

Критических уязвимостей не обнаружено. Найдено 3 предупреждения и 6 info-замечаний:
- WR-01: `parseAllowlist` принимает невалидные числовые префиксы (`"12345abc"` → 12345) из-за `Number.parseInt` без strict validation.
- WR-02: `answerCallbackQuery` без try/catch перед мутацией — сетевая ошибка ack отменит `removeChannel` при confirm.
- WR-03: тестовый mock `mutate()` игнорирует возвращаемое значение `fn`, не имитирует production-семантику (false-positive risk при будущих изменениях).
- Несколько info-замечаний по pattern smells (write-on-no-op в `mutate`), test isolation, отсутствующим `chat.type`-checks.

Async polling resilience, graceful shutdown ordering, callback_query allowlist semantics, idempotency и plain-text constraint — все реализованы корректно.

## Warnings

### WR-01: `parseAllowlist` принимает строки с числовым префиксом

**File:** `src/bot.ts:69-79`

**Issue:** `Number.parseInt("12345abc", 10)` возвращает `12345`, а не `NaN`. Текущая реализация:

```ts
.map((s) => Number.parseInt(s, 10))
.filter((n) => Number.isInteger(n) && n > 0)
```

Это означает, что в `BOT_ALLOWED_USER_IDS=12345abc,67890` будет принят user_id `12345`. Тест `"abc,12345" → Set([12345])` (line 113-115) проходит только потому, что `"abc"` начинается с буквы → `NaN`. Edge-case `"12345abc"` или `"12345 #comment"` (без пробела перед `#`) не покрыт и приведёт к "тихому" расширению allowlist'а на префиксное число. Для security-чувствительной env-переменной это потенциально опасно: опечатка вроде `BOT_ALLOWED_USER_IDS=12345678a` пропустит `12345678`, оставив у оператора впечатление, что allowlist пуст.

**Fix:** Использовать строгий regex-чек перед `parseInt` или `Number()` без коэрсии:

```ts
export function parseAllowlist(envValue: string | undefined): Set<number> {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[1-9]\d*$/.test(s)) // строго: только positive integer без префикса/суффикса
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}
```

И добавить unit-тест:
```ts
it('"12345abc" отбрасывается (parseInt strict)', () => {
  expect(parseAllowlist("12345abc")).toEqual(new Set());
});
```

### WR-02: `answerCallbackQuery` без try/catch перед `removeChannel`

**File:** `src/bot.ts:371-385`

**Issue:** В `handleCallbackQuery` сразу после allowlist-проверки идёт безусловный `await tgFetch(...answerCallbackQuery)`. Если этот вызов бросит (сетевой сбой/HTTP 500 от Telegram), исключение пробросится наверх в `pollOnce`'s try/catch (line 442-444), и **`removeChannel(username)` не будет вызван** при `action === "confirm"`. Пользователь видит, что бот не отреагировал (кнопки на месте), но новая попытка через нажатие той же кнопки даст тот же результат, если сеть нестабильна. Кнопки не уберутся, идемпотентность сохраняется, но UX путающий: «нажал — не отработало — повторил — каждый раз вылетает».

Сравните с двумя последующими `editMessage*`-блоками (line 390-409), где try/catch вокруг каждого. Аналогичная защита нужна для ack — это лучший effort, его failure не должен срывать основное действие.

**Fix:** Обернуть ack в try/catch и продолжить flow даже при failure:

```ts
try {
  await tgFetch<{ ok: boolean }>(token, "answerCallbackQuery", {
    callback_query_id: cb.id,
  });
} catch (err) {
  log.warn(`[bot] answerCallbackQuery failed: ${(err as Error).message}`);
  // продолжаем — ack лучший-effort, основная операция ниже
}
```

### WR-03: Mock `mutate()` в тестах не имитирует production-семантику

**File:** `src/__tests__/bot-handlers.test.ts:38-42`

**Issue:** Helper `withCurrentChannels` мокает `mutate` так:

```ts
mockedMutate.mockImplementation(async (fn) => {
  await fn(channels);
});
```

Возвращаемое значение `fn` игнорируется. В production-коде `channels-store.ts:113-120` mutate использует возврат `fn` для записи на диск:

```ts
const next = await fn(current);
const payload: ChannelsFile = ChannelsFileSchema.parse({ channels: next });
atomicWriteJson(CHANNELS_PATH, payload);
```

Текущие тесты `addChannel`/`removeChannel` работают потому, что проверяют `result`-переменную внутри closure'а (которая мутируется side-effect'ом внутри `fn`), а не финальное состояние `channels.json`. Это false-positive risk: если завтра кто-то изменит `addChannel` так, чтобы он мутировал `result` корректно, но возвращал неверный массив (например, забыл `[...channels, { username }]`), тесты пройдут зелёными, а production сломается. Также Zod-валидация на `next` (которая в production может выбросить!) не воспроизводится в тесте.

**Fix:** Сделать mock более реалистичным — захватывать и проверять финальное состояние:

```ts
let lastWrittenChannels: ChannelEntry[] | null = null;
function withCurrentChannels(channels: ChannelEntry[]): void {
  lastWrittenChannels = null;
  mockedMutate.mockImplementation(async (fn) => {
    const next = await fn(channels);
    lastWrittenChannels = next; // имитируем production: захватываем результат
  });
}
```

И обновить assertions в тестах `addChannel`/`removeChannel`:

```ts
it("возвращает 'added' и записывает новый канал", async () => {
  withCurrentChannels([]);
  const result = await addChannel("newch");
  expect(result).toBe("added");
  expect(lastWrittenChannels).toEqual([{ username: "newch" }]);
});
```

## Info

### IN-01: `addChannel`/`removeChannel` пишут на диск даже на no-op

**File:** `src/bot.ts:175-203`

**Issue:** При `addChannel("existing")` обёртка возвращает `channels` неизменённым, но `mutate()` всё равно выполняет `atomicWriteJson(...)` на тех же данных. Аналогично `removeChannel("missing")` пишет тот же массив. На /add_channel @existing 100 раз будет 100 лишних `writeFileSync` + `rename`. Не корректность (POSIX rename атомарен, состояние правильное), но pattern smell — лишний disk I/O на no-op'ах.

**Fix:** Опционально — добавить в `mutate()` short-circuit `if (next === current) return;` или сменить контракт `addChannel/removeChannel` на `saveChannels` с явной проверкой на изменение. Поскольку write-amplification минимален (~1KB/op, единичный оператор), фикс — низкий приоритет.

### IN-02: Нет проверки `chat.type === 'private'`

**File:** `src/bot.ts:214-306`

**Issue:** README заявляет «Все команды отправляются в личку боту от пользователя из allowlist». В коде нет проверки `msg.chat.type === 'private'` — если бот добавлен в группу и allowlist-юзер вызовет `/add_channel @x` в groupchat, команда отработает. Allowlist защищает от unauthorized users, но документация и реальность расходятся. В worst-case (если бот случайно добавлен в публичный чат), allowlist-юзер может публично продемонстрировать список каналов через `/channels`.

**Fix:** Добавить раннюю проверку (если намерение — strict private):

```ts
// В TgChat добавить type
interface TgChat { id: number; type?: string; }
// В handleCommand после извлечения userId/text:
if (msg.chat.type && msg.chat.type !== "private") {
  log.info(`[bot] non-private chat ignored: chat_id=${msg.chat.id} type=${msg.chat.type}`);
  return;
}
```

Либо обновить README: убрать «в личку» (просто «от пользователя из allowlist»).

### IN-03: `lastOffset` сбрасывается при рестарте, getUpdates вернёт всю историю

**File:** `src/bot.ts:56`

**Issue:** `lastOffset = 0` — module-level state, не персистится. На рестарте `getUpdates(offset: 0, ...)` возвращает все pending updates (Telegram держит ≤24ч). С `drop_pending_updates: false` (line 456) очередь сохраняется — это by design (D-03 — сохранить команды на время рестарта). Но если бот стоял несколько часов и накопилась очередь, на старте все команды отработают bulk'ом (включая устаревшие /remove_channel callback'и с истекшими кнопками). Не критично — handlers идемпотентны (D-14), но возможен «всплеск» edits/sendMessages.

**Fix:** Не требуется для v2.0. Альтернатива (если станет проблемой) — на старте дропнуть старые updates через `getUpdates(offset: -1)` и потом продолжать с актуального; но это нарушит D-03. Оставить как есть, документация в коде уже корректна.

### IN-04: `[bot] denied:` лог печатает сырой `cb.data` без sanitization

**File:** `src/bot.ts:352`

**Issue:** При not-allowlist callback'е логируется `[bot] denied: from=${userId} cmd=callback:${data}`. `data` может содержать что угодно (≤64 байт от любого Telegram-клиента). Не security risk (логи только на VPS, не в Telegram-канал), но можно засорить логи: злоумышленник может слать callback'и с длинными data, генерируя noise.

**Fix:** Truncate до разумной длины:

```ts
log.info(`[bot] denied: from=${userId} cmd=callback:${data.slice(0, 64)}`);
```

(64 байт — лимит Telegram, можно даже короче для логов.)

### IN-05: Тесты не вызывают `vi.unstubAllGlobals()` в afterEach

**File:** `src/__tests__/bot-handlers.test.ts:74-88`

**Issue:** `vi.stubGlobal("fetch", ...)` подменяет global fetch, но в `beforeEach` нет `vi.unstubAllGlobals()` (vitest auto-isolates по тестовым файлам, но в рамках одного файла stub переживает между describe'ами и пересоздаётся каждым `beforeEach`). Текущий код работает (новый stub перезаписывает старый), но если кто-то добавит тест без `beforeEach`-обёртки (`describe.skip` сценарий или isolated `it.only`), fetch может остаться от предыдущего теста.

**Fix:** Добавить afterEach (опционально):

```ts
import { afterEach } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  consoleLogSpy?.mockRestore();
});
```

### IN-06: Fire-and-forget IIFE отлично документирован, но `startBot` нельзя re-run после crash

**File:** `src/run.ts:63-81` + `src/bot.ts:494-522`

**Issue:** Outer IIFE логирует и шлёт alert при unexpected exit, но не перезапускает polling. Если `pollLoop` упал в `catch` (line 516-517), `pollingActive = false`, alert ушёл, но bot polling больше не работает до PM2/Docker restart. Cron-tick продолжает дайджесты, но команды бота превращаются в немой. PM2 restart-on-exit'а не сработает (процесс жив).

Это intentional дизайн (см. комментарий: "без restart-loop'а"), и PM2 `max_memory_restart`/`min_uptime` не покрывает это. Низкий риск (exp.backoff внутри `pollLoop` ловит сетевые ошибки), но Phase 03 (мониторинг/alerts) может захотеть rethink. Сейчас alert-канал служит сигналом оператору, что нужно `pm2 restart tg-parser`.

**Fix:** Не требуется. Оставить как есть, при необходимости пересмотреть в Phase 03+. Альтернатива — внутри outer IIFE сделать retry:

```ts
let attempts = 0;
while (attempts < 3) {
  try {
    await startBot();
    break;
  } catch (err) {
    attempts++;
    log.error(`bot startBot failed (attempt ${attempts})`, err as Error);
    await new Promise((r) => setTimeout(r, 5000 * attempts));
  }
}
```

Но это уже выходит за scope Phase 02.

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
