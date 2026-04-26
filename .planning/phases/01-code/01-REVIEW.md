---
phase: 01-code
reviewed: 2026-04-26T11:39:43Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/schema.ts
  - src/types.ts
  - src/dedup.ts
  - src/archive.ts
  - src/alert.ts
  - src/summarize.ts
  - src/pipeline.ts
  - src/run.ts
  - src/logger.ts
  - docs/RUNBOOK.md
  - docs/CHANNELS.md
  - package.json
  - .env.example
  - .gitignore
findings:
  critical: 0
  warning: 4
  info: 9
  total: 13
status: issues_found
---

# Phase 01-code: Code Review Report

**Reviewed:** 2026-04-26T11:39:43Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 1 (v3.0 milestone) реализует 5-категорийный structured Telegram digest с Zod-валидацией, SHA-256 кросс-прогонной дедупой, ФС-архивами и alert-bot. Архитектура чистая: модули хорошо разделены (schema/types/dedup/archive/alert/summarize/pipeline/run), порядок D-09 в `pipeline.ts` строго соблюдён, secrets читаются из `process.env` (не логируются и не сериализуются в alert-payload), `escapeHtml` применён к LLM-контенту, `verifyExtractiveness` сохраняет Core Value (дословность keyQuote).

Критических уязвимостей не найдено. Зафиксировано 4 warning'а: (1) нарушение D-09 invariant при ошибке `writeOutput`, (2) расхождение Zod-схемы (summary max=500) и системного промпта (250 символов), (3) дублирующий I/O и misleading API в `saveHashCache`, (4) отсутствие защиты от не-https схем в URL-валидации (mitigated `verifyExtractiveness`, но защита в глубину желательна). Остальные 9 находок — Info-уровень: устаревший комментарий, code smells, отсутствие защиты от NaN в env, неиспользуемые параметры и т. п.

CLAUDE.md по-прежнему утверждает «runtime-зависимости ровно три» — это констрейнт владельца проекта, а Phase 1 явно добавил `zod` (5-я dep, согласовано в PLAN). Синхронизация констрейнта в CLAUDE.md — задача владельца, не код-ревью.

## Warnings

### WR-01: D-09 invariant нарушается при сбое `writeOutput` после успешной доставки

**File:** `src/pipeline.ts:123-132`
**Issue:** Порядок вызовов `sendToChannel(html)` → `writeOutput(html, runId)` → `commitHashCache(...)` стоит подряд без try/catch вокруг `writeOutput`. Если сообщение успешно ушло в канал, но запись архива упала (ENOSPC, EACCES), исключение пробросится наверх в `tick()`, `commitHashCache` НЕ выполнится. На следующий cron-тик 20:00 MSK тот же набор постов снова пройдёт dedup-фильтр (хешей нет в cache), DeepSeek снова сгенерирует тот же дайджест, читатель канала увидит дубликат. Это противоречит инварианту D-09 «hash-cache съедает только реально доставленные» — реально-доставленные ≠ архивированные. Архив — audit-trail (T-01-11), а не gating-условие.
**Fix:**
```ts
await sendToChannel(html);
digestDelivered = true;
log.info(`[pipeline] дайджест отправлен.`);

// commitHashCache привязан к УСПЕШНОЙ ДОСТАВКЕ, а не к успешной записи архива.
// writeOutput — best-effort audit-trail; его сбой не должен ломать инвариант DEDUP-02.
commitHashCache(freshHashes, runId);

try {
  writeOutput(html, runId);
} catch (err) {
  log.error(`[archive] writeOutput failed (доставка прошла, hash-cache закоммичен): ${(err as Error).message}`);
  // Прокидываем дальше в tick() для алерта оператору, но hash-cache уже зафиксирован.
  throw err;
}
```

### WR-02: Расхождение Zod-схемы и системного промпта по длине `summary`

**File:** `src/schema.ts:14`, `src/summarize.ts:31`, `src/types.ts:21`
**Issue:** `DigestItemSchema.summary = z.string().min(1).max(500)`, но системный промпт инструктирует «summary — 1–2 предложения на русском, **до 250 символов**», и `types.ts:21` комментарий тоже фиксирует «до 250 символов». DeepSeek может вернуть 251–500 символов — Zod-валидация это пропустит, и в Telegram-канал попадёт более длинная сводка чем спецификация. На один пост это безобидно, но на 15 items в дайджесте может привести к превышению ожидаемой длины разбиения по `chunkHtml`. Single source of truth должен быть один — либо 250, либо 500.
**Fix:**
```ts
// src/schema.ts:14
summary: z.string().min(1).max(250),  // согласовано с types.ts:21 и SYSTEM_PROMPT
```

### WR-03: `saveHashCache` игнорирует параметр `existing`, выполняет дублирующий I/O

**File:** `src/dedup.ts:82-106`
**Issue:** Функция принимает `existing: Set<string>` — но не использует его. Вместо этого она перечитывает файл с диска и заново фильтрует по TTL (строки 88-101). Это создаёт три проблемы: (1) misleading API — вызывающий ожидает, что `existing` работает; (2) дублирующий disk read (load уже был в `commitHashCache:137`); (3) тонкая race-condition даже в single-process: между `loadHashCache()` в `commitHashCache` и re-read внутри `saveHashCache` файл теоретически может быть подменён (на single-operator/PM2-fork это не реализуется, но контракт хрупкий). Дополнительно: при многократной доставке одного и того же поста (например при ручном повторе) `entries` пухнет с дубликатами одинаковых hash-значений (load-Set их дедупит, но файл растёт).
**Fix:**
```ts
// Вариант A: убрать неиспользуемый параметр и читать только raw для preserved entries.
export function saveHashCache(newHashes: string[]): void {
  const now = new Date().toISOString();
  let preservedEntries: HashEntry[] = [];
  if (existsSync(HASH_CACHE_PATH)) {
    try {
      const raw = readFileSync(HASH_CACHE_PATH, "utf8");
      const parsed = JSON.parse(raw) as HashCacheFile;
      if (parsed && Array.isArray(parsed.entries)) {
        const cutoff = Date.now() - TTL_MS;
        preservedEntries = parsed.entries.filter((e) => {
          const t = new Date(e.ts).getTime();
          return Number.isFinite(t) && t >= cutoff;
        });
      }
    } catch { /* preserved пустой */ }
  }
  // Дедупа по хешу: оставляем последнее ts при коллизии — предотвращает рост файла.
  const byHash = new Map<string, HashEntry>();
  for (const e of preservedEntries) byHash.set(e.hash, e);
  for (const h of newHashes) byHash.set(h, { hash: h, ts: now });
  atomicWriteJson(HASH_CACHE_PATH, { entries: [...byHash.values()] });
}

// commitHashCache упрощается:
export function commitHashCache(freshHashes: string[], runId: string): void {
  saveHashCache(freshHashes);
  log.info(`[dedup] runId=${runId} commit hash-cache: +${freshHashes.length} entries`);
}
```

### WR-04: `new URL().toString()` пропускает `javascript:` и `data:` схемы

**File:** `src/summarize.ts:151-157`
**Issue:** Валидация URL через `new URL(item.url).toString()` принимает любую well-formed URL, включая `javascript:alert(1)` и `data:text/html,<script>...</script>`. Проверено: `new URL("javascript:alert(1)").toString() === "javascript:alert(1)"`. Текущая защита: `verifyExtractiveness` (строки 86-109) дропает item, чей `url` отсутствует в `byUrl` Map — а `byUrl` строится из `Post.url`, которые формируются в `telegram.ts` как `https://t.me/<username>/<messageId>`. То есть LLM-инжектированный `javascript:`-URL не пройдёт verify-фильтр и не попадёт в `renderItem`. **Текущая модель угроз закрыта**, но защита держится на одной нити (verify-фильтр). Defense-in-depth: явная проверка протокола в `renderItem` стоит копейку и устраняет риск, если когда-нибудь `verifyExtractiveness` будет ослаблен или порядок вызовов изменится.
**Fix:**
```ts
function renderItem(item: DigestItem): string | null {
  let safeUrl: string;
  try {
    const parsed = new URL(item.url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      console.warn(`[summarize] skip (non-http(s) url): ${item.url}`);
      return null;
    }
    safeUrl = parsed.toString();
  } catch {
    console.warn(`[summarize] skip (bad url): ${item.url}`);
    return null;
  }
  // ...
}
```

## Info

### IN-01: `commitHashCache` делает лишний load перед save

**File:** `src/dedup.ts:136-140`
**Issue:** `commitHashCache` вызывает `loadHashCache()` исключительно чтобы передать его в `saveHashCache(existing, ...)`, где он игнорируется (см. WR-03). Лишняя операция чтения файла.
**Fix:** Удалить `const existing = loadHashCache();` и сделать `saveHashCache(freshHashes)` (после применения WR-03).

### IN-02: `Number(process.env.HASH_CACHE_TTL_DAYS ?? 14)` беззвучно превращается в NaN

**File:** `src/dedup.ts:12-13`
**Issue:** Если оператор задаст `HASH_CACHE_TTL_DAYS=14d` или `=`, `Number("14d") === NaN`. `TTL_MS = NaN * ...= NaN`, и в `loadHashCache:69` фильтр `t >= cutoff` всегда false → cache всегда пустой → дедупа сломана без алерта. Те же риски в `pipeline.ts` для `MAX_MESSAGES_PER_CHANNEL`/`FETCH_WINDOW_HOURS`/`CHANNEL_DELAY_MS`.
**Fix:**
```ts
const TTL_DAYS = (() => {
  const raw = process.env.HASH_CACHE_TTL_DAYS;
  if (!raw) return 14;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`HASH_CACHE_TTL_DAYS невалиден: "${raw}"`);
  }
  return n;
})();
```

### IN-03: `loadChannelsYaml` не отлавливает дубликаты `username`

**File:** `src/pipeline.ts:23-40`
**Issue:** Если в `channels.yaml` оператор случайно задвоит запись (`- username: oil_news_ru` дважды), pipeline дважды сделает `fetchLast24h(client, "oil_news_ru", ...)` — вдвое больший Telegram rate-limit risk и удвоенная задержка между каналами. In-memory `seen` Set дедупит по `channel:msgId` — посты не задвоятся, но fetch-вызов выполнится. Логичнее упасть рано на старте.
**Fix:**
```ts
const seenUsernames = new Set<string>();
for (const c of parsed.channels) {
  // ... существующая валидация ...
  if (seenUsernames.has(c.username)) {
    throw new Error(`${path}: дубликат username "${c.username}"`);
  }
  seenUsernames.add(c.username);
  channels.push({ username: c.username, priority: c.priority });
}
```

### IN-04: Устаревшая ссылка на `docs/phase-2.md`

**File:** `src/logger.ts:25`
**Issue:** Комментарий `// Формат зафиксирован в docs/phase-2.md §4` ссылается на документ, которого нет в репозитории (это артефакт v2.0). Сейчас формат zafiksirovan фактически в `src/logger.ts` сам по себе.
**Fix:** Удалить ссылку или обновить на актуальный артефакт (например, `.planning/phases/01-code/01-01-SUMMARY.md`).

### IN-05: `channels[i]!` non-null assertion

**File:** `src/pipeline.ts:73`
**Issue:** `const { username } = channels[i]!;` — non-null assertion избыточен (под `strict: true` без `noUncheckedIndexedAccess` `channels[i]` уже типизирован как `ChannelEntry`). Если когда-нибудь включат `noUncheckedIndexedAccess`, `!` станет необходимым, но сейчас это лишний шум. Альтернатива — `for...of`.
**Fix:**
```ts
for (let i = 0; i < channels.length; i++) {
  const channel = channels[i];
  if (!channel) continue;  // защита, если когда-нибудь включат noUncheckedIndexedAccess
  const { username } = channel;
  // ...
}
// или даже проще:
for (const [i, { username }] of channels.entries()) { ... }
```

### IN-06: Отсутствие timeout для fetch к Telegram Bot API

**File:** `src/alert.ts:51-59`
**Issue:** `await fetch(...)` без `signal: AbortSignal.timeout(N)` — если Telegram Bot API повиснет (network split, hung connection), вызов повиснет на минуты. Это блокирует возврат из `tick()` (alert вызывается под `await` в catch), что в свою очередь блокирует graceful shutdown в `run.ts:55` (`while (isRunning)`). Оператор после Ctrl+C может ждать долго. На «один тик в сутки» риск низкий, но defensive-таймаут стоит копейку.
**Fix:**
```ts
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text: safeText, disable_web_page_preview: true }),
  signal: AbortSignal.timeout(10_000),  // 10s — alert не критичен, но shutdown должен быть быстрым
});
```

### IN-07: `atomicWriteText`/`atomicWriteJson` не делают `fsync` перед `rename`

**File:** `src/dedup.ts:43-49`, `src/archive.ts:34-39`
**Issue:** `writeFileSync(tmp, ...)` пишет в OS page cache, `renameSync(tmp, path)` атомарно переименовывает. При сбое VPS (kernel panic, hard reboot, питание) rename мог отработать, но содержимое не сброшено на диск — после reboot файл существует, но пуст или обрывается на середине. Гарантированно корректный паттерн: `open + write + fsync + close + rename`. Для single-operator на cloud-VPS вероятность сценария низкая (managed power, qemu virtio-blk кеширует), но нарушает строгий контракт «атомарная запись».
**Fix:**
```ts
function atomicWriteText(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = path + ".tmp";
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
```

### IN-08: `summarize.ts` смешивает `console.warn/error` и `log.info/warn` из `logger.ts`

**File:** `src/summarize.ts:92-103, 155, 233-235, 243`
**Issue:** Файл импортирует только `OpenAI`, типы и схему — не импортирует `log` из `./logger.js`. Пишет напрямую через `console.warn/error`. Под PM2 это попадает в pm2-out/err.log одинаково с `log.*`, но без timestamp/level-префикса, что усложняет grep по логам (`grep '\[warn\]'` пропустит эти строки). Несогласовано с остальным проектом, где все модули используют `log` (`pipeline.ts`, `dedup.ts`, `archive.ts`, `alert.ts`, `run.ts`).
**Fix:**
```ts
import { log } from "./logger.js";
// ...
log.warn(`[summarize] skip (url not in source): channel=${item.channel} url=${item.url}`);
// и аналогично для остальных warn/error
```

### IN-09: Расхождение CLAUDE.md и фактических зависимостей

**File:** `package.json:13-19`, `CLAUDE.md` (constraints)
**Issue:** `CLAUDE.md` декларирует «Runtime-зависимости ровно три: telegram, openai, yaml». Фактические dependencies — пять: `node-cron`, `openai`, `telegram`, `yaml`, `zod`. Это не баг кода (PLAN.md явно согласовал `zod` как 5-ю dep, `node-cron` живёт с v2.0), но констрейнт в CLAUDE.md устарел и потенциально вводит будущего contributor в заблуждение. Owner проекта решает, синхронизировать констрейнт или оставить как было — это документная задача, не code-issue.
**Fix:** Обновить CLAUDE.md: «Runtime-зависимости пять: telegram, openai, yaml, zod, node-cron» с краткой ссылкой на PLAN/SUMMARY, где это согласовано.

---

## Verified Threat-Mitigations (no issues)

Дополнительная верификация — все эти паттерны корректны и угроз не порождают:

- **Secrets handling (T-01-01, T-01-02):** `BOT_TOKEN_ALERTS`/`TG_BOT_TOKEN`/`DEEPSEEK_API_KEY` читаются только из `process.env`, не логируются (alert payload содержит только `{stage, message, runId, stack}`), `.env` в `.gitignore`. ✓
- **HTML escape (T-01-05):** `escapeHtml` применён к `summary`, `keyQuote`, `channel`, `date` (header). Маркеры `[РОСНЕФТЬ]/[ЛУКОЙЛ]/[ГАЗПРОМ]` — литералы из `MENTION_LABEL`, не user input. ✓
- **Дословность keyQuote (Core Value):** `verifyExtractiveness` проверяет `post.text.includes(item.keyQuote.trim())` — финальный барьер. ✓
- **Path traversal (T-01-09):** `data/raw/${todayMsk()}.json` — `todayMsk()` детерминистично возвращает `YYYY-MM-DD` через `Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Moscow"})`. User input нигде не попадает в путь. ✓
- **Zod retry x1 (STRUCT-02):** Жёсткая граница в 1 повтор (`if (!result.success) { retry; if (!result.success) throw }`) — нет цикла, второй fail пробрасывает Error в `tick()` для алерта. ✓
- **Hash-cache commit ordering (D-09):** `commitHashCache` вызывается ПОСЛЕ `sendToChannel` (см. WR-01 — есть нюанс c writeOutput). ✓
- **Alert-on-alert-fail (D-15):** Внутренний try/catch в `run.ts:36-39` ловит alert-throw без рекурсии, не прерывает основной flow. ✓
- **`writeRaw` ДО dedup/LLM (ARCH-01):** Сырьё за день сохраняется даже при сбое последующих шагов. ✓
- **`data/*` в .gitignore с `.gitkeep` (T-01-03):** Архивы не попадают в git, директория сохраняется. ✓
- **ESM-корректность:** Все локальные импорты используют `.js` расширение (`./logger.js`, `./schema.js`, etc.) — корректный ESM-пакет. ✓
- **Plain-text alerts:** `sendAlert` НЕ передаёт `parse_mode: "HTML"` в Bot API → инъекция из stack trace невозможна. ✓
- **DAEMON-03 mutex:** `isRunning` boolean защищает от параллельных тиков (single-process PM2 fork). ✓

---

_Reviewed: 2026-04-26T11:39:43Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
