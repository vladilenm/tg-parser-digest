---
phase: 04-bitum-weekly-report
reviewed: 2026-05-22T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/bitum/types.ts
  - src/bitum/storage.ts
  - src/bitum/manual-numbers.ts
  - src/bitum/refineries.ts
  - src/bitum/parsers/shared.ts
  - src/bitum/parsers/birzha-volumes.ts
  - src/bitum/parsers/birzha-prices.ts
  - src/bitum/parsers/fca-sellers.ts
  - src/bitum/parsers/bitum-price-new.ts
  - src/bitum/parsers/index.ts
  - src/bitum/analyzer.ts
  - src/bitum/reporter.ts
  - src/bitum/index.ts
  - src/bot-bitum.ts
  - src/bot.ts
findings:
  critical: 0
  warning: 6
  info: 7
  total: 13
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-22
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 04 — полный rewrite битум-pipeline (milestone v5.1, simplified). Реализация в целом аккуратная, следует контрактам из 04-01-PLAN.md и 04-CONTEXT.md (D-01..D-19): pure-функции с dict-аргументом, Zod-валидация на output парсеров, atomic `.tmp + rename` + per-week mutex, escapeHtml для всех динамических строк, env-based caps (`BITUM_MAX_XLSX_BYTES`, `BITUM_MAX_ROWS`, `BITUM_CROSS_CHECK_THRESHOLD`).

Critical issues отсутствуют. Найдено 6 warning и 7 info-уровней.

**Ключевые риски (warning):**
- **WR-01**: `parsePrice`/`parseDelta` в `bitum-price-new.ts` некорректно конвертируют русский формат чисел с запятой как thousand-separator (`"31,250"` → `31.25`) — реальный риск порчи данных, если когда-либо встретится такой формат в xlsx.
- **WR-02**: `pendingUploads` key = `msg.message_id` без chatId — message_id уникален в рамках чата, но не глобально; конфликт между чатами гарантированно произойдёт при наличии нескольких разрешённых пользователей в разных чатах.
- **WR-03**: per-week mutex в `manual-numbers.ts` и `storage.ts` — это разные `Map`'ы, поэтому `addManualNumber` и `resetWeek` НЕ сериализуются между собой → возможен race при `/bitum_reset` + параллельном `/bitum_add` той же недели.
- **WR-04**: `currentWeek()` вычисляется дважды (при upload и при callback confirm); если оператор перейдёт через границу недели между этими событиями, xlsx сохранится в другую неделю чем показано в keyboard prompt.
- **WR-05**: `birzha-prices.ts` молча пропускает строки с `price === 0` — это data-loss решение без явного комментария.
- **WR-06**: `findLatestWeekWithUploads()` игнорирует недели с только manual-numbers (без xlsx) — может ввести в заблуждение, если будет использоваться (сейчас экспортируется, но не вызывается).

**Info:** дубликат `escapeHtml`, unused export `findLatestWeekWithUploads`, отсутствует TTL/cleanup для `pendingUploads` Map, неограниченный рост `locks` Map в storage/manual-numbers, повторная загрузка `refineries.json` без кеширования, потенциально неправильный `cellRange` при пустых данных, обработка `+-N` в parseDelta.

## Warnings

### WR-01: Русский формат чисел с запятой искажается при парсинге цен

**File:** `src/bitum/parsers/bitum-price-new.ts:48-66, 71-78`
**Issue:** Функции `parseDelta` и `parsePrice` выполняют `replace(",", ".")` ДО `Number(...)`, не различая роль запятой как десятичного разделителя (ru) vs thousand-separator. Для типичной русской выгрузки `"31 250"` (с пробелом) код работает корректно, но если данные придут в виде `"31,250"` или `"+2,000"` (англо-стилевой thousands-separator), результат искажается: `Number("31.250")` = `31.25` вместо `31250`, что попадает в Zod-валидацию (`nonnegative`, проходит) и закатывается в отчёт.

Комментарий на line 70 ("31,250 → number") даже подсказывает, что автор знал о такой форме записи, но реализация её разрушает.

Примеры:
- `parsePrice("31,250")` → `31.25` (должно: `31250`)
- `parseDelta("+2,000")` → `2.0` (должно: `2000`)
- `parsePrice("31 250")` → `31250` ✅
- `parsePrice("31250")` → `31250` ✅

**Fix:** Различать ru vs en стиль по позиции/количеству разделителей. Простая безопасная стратегия: удалять `,` если за ней следует ≥3 цифры (thousand-separator), иначе трактовать как десятичную точку.

```ts
function normalizeNumberStr(s: string): string {
  // Сначала уберём пробелы (включая NBSP) — это всегда thousands-separator.
  let t = s.replace(/[\s ]/g, "");
  // Запятая перед 3 цифрами в конце или перед другой группой 3-цифр → thousands.
  // Запятая перед 1-2 цифрами или 4+ цифрами → десятичная.
  if (/,\d{3}(?:\D|$)/.test(t) && !/\.\d/.test(t)) {
    t = t.replace(/,/g, "");
  } else {
    t = t.replace(",", ".");
  }
  return t;
}

function parsePrice(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(normalizeNumberStr(s));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
```

Альтернативно, если по контракту в этом xlsx запятая ВСЕГДА десятичная — добавить явный комментарий + Zod-проверку, что результат не аномально мал (например, `priceRub > 1000` для рублёвых цен на тонну битума).

---

### WR-02: pendingUploads key = message_id без chatId — коллизии между чатами

**File:** `src/bot-bitum.ts:68, 118, 469`
**Issue:** `pendingUploads.set(msg.message_id, ...)` использует только `message_id` как ключ. Telegram message_id уникален в рамках одного чата, но не глобально. Если у бота несколько разрешённых пользователей в разных приватных чатах, их message_id'ы могут совпадать — второй upload перезапишет first в Map, и при callback'е первого пользователя обработается чужой буфер.

Сейчас риск маленький (1-2 оператора в одном чате), но это явная типизационная ошибка, готовая выстрелить при расширении allowlist.

**Fix:** Использовать составной ключ `chatId:msgId` (string) или Map<chatId, Map<msgId, …>>:

```ts
type UploadKey = string; // `${chatId}:${msgId}`
const pendingUploads = new Map<UploadKey, PendingUpload>();

function uploadKey(chatId: number, msgId: number): UploadKey {
  return `${chatId}:${msgId}`;
}

// в handleBitumDocument:
pendingUploads.set(uploadKey(chatId, msg.message_id), { … });

// в callback_data — добавить chatId:
callback_data: `bu:${t}:${chatId}:${msg.message_id}`

// в handleBitumCallback парсить parts[2]=chatId, parts[3]=msgId.
```

Альтернатива (если callback_data overhead неприемлем): использовать `cb.message.chat.id` для восстановления ключа на callback-сайде, поскольку reply создаётся в том же чате, что и оригинал.

---

### WR-03: Отдельные mutex'ы в storage.ts и manual-numbers.ts — race между addManualNumber и resetWeek

**File:** `src/bitum/manual-numbers.ts:22, src/bitum/storage.ts:54`
**Issue:** Оба модуля определяют локальные `const locks = new Map<string, Promise<void>>()`. Это два разных Map'а. Следовательно, `addManualNumber(week, ...)` и `resetWeek(week)`/`saveXlsx(week, ...)` не сериализуются между собой по неделе.

Сценарий: пользователь вызывает `/bitum_reset` и сразу же `/bitum_add foo=bar` параллельно (в реальности — две гонки внутри `handleBitumReset` callback confirm path, которая делает `resetWeek` + `clearManualNumbers`, и параллельный `/bitum_add` от другого clicка). `rmSync(dir, {recursive:true})` уничтожает каталог, после чего `addManualNumber`: `mkdirSync(dir, {recursive:true})` + `writeFileSync(tmp)` + `renameSync` пересоздаёт каталог + manual-numbers.json. В результате `/bitum_reset` отрапортовал успех, но в неделе остался "осиротевший" manual-numbers.json.

**Fix:** Использовать общий module-level mutex для всех операций над неделей. Простейший вариант — экспортировать `withWeekLock` из `storage.ts` и использовать его в `manual-numbers.ts`:

```ts
// storage.ts
export function withWeekLock<T>(week: string, op: () => Promise<T>): Promise<T> { … }

// manual-numbers.ts
import { withWeekLock, weekDir } from "./storage.js";
// удалить локальный locks + withWeekLock
```

Это также упрощает understanding (один mutex на неделю — один источник истины).

---

### WR-04: Race-условие на границе недели: currentWeek вычисляется дважды

**File:** `src/bot-bitum.ts:118 (handleBitumDocument), 491 (handleBitumCallback)`
**Issue:** `handleBitumDocument` принимает xlsx и сохраняет его в `pendingUploads`, но НЕ фиксирует `week` в payload. Затем `handleBitumCallback` для `bu:type:msgId` вызывает `currentWeek(cb.message)` повторно — line 491. Если оператор загрузил xlsx в воскресенье 23:59 MSK и подтвердил тип в понедельник 00:01 MSK, файл сохранится в неделю, отличную от той, что подразумевалась при upload (но операторе на тот момент не показывалась явно).

Дополнительно: `currentWeek` принимает `msg`, но игнорирует его (`void msg;` line 89) — TS-сигнатура обманчива.

**Fix:** Зафиксировать неделю в момент upload и пронести её через callback_data + pendingUploads:

```ts
interface PendingUpload {
  buffer: Buffer;
  fileName: string;
  uploadedAt: number;
  week: string; // <- ADD
}

// handleBitumDocument:
const week = currentWeek();
pendingUploads.set(msg.message_id, { buffer, fileName, uploadedAt: Date.now(), week });

// handleBitumCallback bu:…
const week = pending.week; // вместо currentWeek(cb.message)
await saveXlsx(week, type, pending.buffer);
```

Опционально показывать неделю в prompt: ``Я получил xlsx «${fileName}» (${sizeKb} КБ) для недели ${week}. Что это за файл?``

---

### WR-05: Молча отбрасываются строки с price === 0 в birzha-prices

**File:** `src/bitum/parsers/birzha-prices.ts:93`
**Issue:** `if (price === null || price === 0) continue;` — нулевая цена пропускается без записи в `errors`. Это data-loss решение: если ячейка по факту валидна (например, технический ноль = "торгов не было"), она исчезнет из дайджеста бесшумно. Семантика «пусто vs 0» в xlsx разная, и текущий код их склеивает.

Контрастирует с `birzha-volumes.ts`, где `vol === null` → continue, но 0 проходит дальше и попадает в Zod (`nonnegative`).

**Fix:** Либо явный комментарий + лог, либо записывать в `errors` для diagnostics:

```ts
if (price === null) continue;
if (price === 0) {
  // Нулевая цена в birzha = "торгов нет"; не валим в данных, но логируем.
  // errors.push({ rowNum: r, reason: `zero price col=${c} (skipped)` });
  continue;
}
```

Минимум — добавить комментарий, объясняющий разницу с volumes.

---

### WR-06: findLatestWeekWithUploads игнорирует недели с manual-numbers

**File:** `src/bitum/storage.ts:199-222`
**Issue:** Функция ищет недели, у которых есть `${type}.xlsx`. Если оператор только заполнил `manual-numbers.json` без xlsx (что разрешено по D-14), эта неделя не будет возвращена. Если функция позже будет использована для "автоматического выбора последней активной недели" (что подразумевает имя), это даст inconsistent поведение vs `getWeekStatus` (которая учитывает manual-numbers).

Сейчас функция экспортируется в `index.ts:11`, но я не вижу её вызовов в reviewed коде → пока это латентный bug.

**Fix:** Учитывать `manual-numbers.json`:

```ts
for (const w of candidates) {
  const dir = path.join(root, w);
  if (existsSync(path.join(dir, "manual-numbers.json"))) return w;
  for (const type of BITUM_TYPES) {
    if (existsSync(path.join(dir, `${type}.xlsx`))) return w;
  }
}
```

Либо переименовать в `findLatestWeekWithXlsx` чтобы зафиксировать контракт; либо удалить (если не используется).

## Info

### IN-01: Дубликат escapeHtml между reporter.ts и bot-bitum.ts

**File:** `src/bitum/reporter.ts:22-27, src/bot-bitum.ts:439-444`
**Issue:** Идентичная функция определена в двух местах. Будущие изменения (например, добавить `&quot;`) придётся синхронизировать.

**Fix:** Вынести в `src/bitum/html-utils.ts` (или общий `src/util.ts`) и импортировать в обоих местах:

```ts
// src/bitum/html-utils.ts
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

---

### IN-02: pendingUploads без TTL / cleanup → потенциальный memory leak

**File:** `src/bot-bitum.ts:68-75, 118`
**Issue:** В отличие от `pendingReports` (имеет `setTimeout(...REPORT_TTL_MS)`, line 264), `pendingUploads` живёт пока оператор не нажмёт кнопку или не загрузит файл с тем же message_id (что невозможно — TG message_id монотонно растёт). Если оператор загрузил 10 файлов и не нажал ни одной кнопки, 10 Buffer'ов (до 10 МБ каждый = 100 МБ) висят в RAM до перезагрузки бота.

**Fix:** Добавить TTL аналогично `pendingReports`:

```ts
const UPLOAD_TTL_MS = 15 * 60 * 1000;
pendingUploads.set(key, { … });
setTimeout(() => pendingUploads.delete(key), UPLOAD_TTL_MS);
```

---

### IN-03: locks Map не очищается → unbounded growth

**File:** `src/bitum/storage.ts:54, src/bitum/manual-numbers.ts:22`
**Issue:** `locks.set(week, ...)` никогда не вызывает `locks.delete`. Entry per уникальная неделя — для долгоживущего daemon-процесса (cron 20:15 MSK) это копится ~52 entries/год. Не критично, но это технический долг.

**Fix:** После завершения операции delete entry если текущая promise равна сохранённой:

```ts
function withWeekLock<T>(week: string, op: () => Promise<T>): Promise<T> {
  const prev = locks.get(week) ?? Promise.resolve();
  const result = prev.then(op, op);
  const tail = result.then(() => undefined, () => undefined);
  locks.set(week, tail);
  // cleanup на следующем тике если никто не успел seterride
  tail.then(() => {
    if (locks.get(week) === tail) locks.delete(week);
  });
  return result;
}
```

---

### IN-04: loadRefineriesDict() без кеширования — повторная синхронная I/O на каждый /bitum_report

**File:** `src/bitum/refineries.ts:35-52, src/bot-bitum.ts:244, 493`
**Issue:** Каждый вызов `/bitum_status`/`/bitum_report` → `loadRefineriesDict()` → `existsSync` + `readFileSync` + `JSON.parse` + Zod-валидация. Словарь меняется редко (обычно один раз при деплое). Реентрантная I/O на handler-path добавляет ~5-20 ms latency и неявно блокирует event loop.

**Fix:** Кешировать с invalidation по mtime (или просто один раз в процессе):

```ts
let _cached: { dict: RefineriesDict; mtime: number; path: string } | null = null;

export function loadRefineriesDict(): RefineriesDict {
  // ... найти первый existsSync кандидат, получить mtime
  if (_cached && _cached.path === found && _cached.mtime === stat.mtimeMs) {
    return _cached.dict;
  }
  // re-parse + Zod
  _cached = { dict: parsed, mtime: stat.mtimeMs, path: found };
  return parsed;
}
```

Это нарушает "pure dict-аргументом" stratight only если кешировать молча; вариант — кеш + явный `reloadRefineriesDict()` для тестов.

---

### IN-05: cellRange = "B4:T3" если данных нет (off-by-one в trace footer)

**File:** `src/bitum/parsers/birzha-volumes.ts:74, 118; src/bitum/parsers/birzha-prices.ts:70, 112`
**Issue:** `let lastDataRow = HEADER_ROW;` (=3). Если ни одна data-row не прошла, `cellRange = "B4:T3"` — невалидный диапазон, попадает в trace footer (`Источники: birzha_volumes.xlsx: 0 чисел из B4:T3`). Косметика, но мешает в footer.

**Fix:** Проверить условие:

```ts
cellRange = lastDataRow > HEADER_ROW ? `B${HEADER_ROW + 1}:T${lastDataRow}` : "";
```

---

### IN-06: parseDelta degenerate sign на ввод `+-N` / `-+N`

**File:** `src/bitum/parsers/bitum-price-new.ts:48-66`
**Issue:** Regex `(-?\+?\d+(?:\.\d+)?)` принимает `-+500` или `+-500`. Sign-detection через `/-/.test(cleaned.replace(/^\+/, ""))` сработает на оба, но семантика неоднозначна. Сейчас не приводит к крашу (вернёт ±500), но это указание на нестабильный contract парсера дельт.

**Fix:** Более строгий regex (один знак ИЛИ ни одного):

```ts
const m = /^([+-]?)(\d+(?:\.\d+)?)$/.exec(cleaned);
if (!m) return 0;
const sign = m[1] === "-" ? -1 : 1;
const n = Number(m[2]);
if (!Number.isFinite(n)) return 0;
// учесть ▼ как override negative
const negFromArrow = /▼/.test(s);
return sign * (negFromArrow ? -1 : 1) * n * (negFromArrow ? -1 : 1);
```

Либо просто документировать, что `+-N` / `-+N` — undefined behavior.

---

### IN-07: currentWeek принимает msg-параметр, но игнорирует его

**File:** `src/bot-bitum.ts:87-92`
**Issue:** Сигнатура `function currentWeek(msg?: TgMessage)` обманчива — внутри `void msg;` и игнор. Если в будущем понадобится взять время из `msg.date`, контракт перевернётся.

**Fix:** Удалить параметр либо использовать `msg.date` (TG date в UTC seconds — даст точный момент upload вместо Date.now() в момент handle):

```ts
function currentWeek(msg?: TgMessage): string {
  const epochMs = msg?.date ? msg.date * 1000 : Date.now();
  const mskMs = epochMs + 3 * 3600 * 1000;
  return isoWeekFolder(new Date(mskMs));
}
```

Это также частично смягчает WR-04 (хотя полное решение там — фиксация недели в pendingUploads).

---

_Reviewed: 2026-05-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
