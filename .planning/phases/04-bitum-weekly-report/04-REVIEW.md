---
phase: 04-bitum-weekly-report
reviewed: 2026-05-21T00:00:00Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - .env.example
  - .gitignore
  - CLAUDE.md
  - data/bitum/.gitkeep
  - data/refineries.json
  - src/__tests__/bitum-analyzer.test.ts
  - src/__tests__/bitum-bot-commands.test.ts
  - src/__tests__/bitum-bot-learning.test.ts
  - src/__tests__/bitum-classifier.test.ts
  - src/__tests__/bitum-learned-signatures.test.ts
  - src/__tests__/bitum-llm.test.ts
  - src/__tests__/bitum-parser-all-prices.test.ts
  - src/__tests__/bitum-parser-birzha-prices.test.ts
  - src/__tests__/bitum-parser-birzha-volumes.test.ts
  - src/__tests__/bitum-parser-bitum-price-new.test.ts
  - src/__tests__/bitum-parser-fca-sellers.test.ts
  - src/__tests__/bitum-refineries.test.ts
  - src/__tests__/bitum-reporter-order.test.ts
  - src/__tests__/bitum-reporter-trace.test.ts
  - src/__tests__/bitum-reporter.test.ts
  - src/__tests__/bitum-signatures.test.ts
  - src/__tests__/bitum-storage.test.ts
  - src/__tests__/bitum-types.test.ts
  - src/__tests__/bot-handlers.test.ts
  - src/bitum/analyzer.ts
  - src/bitum/classifier.ts
  - src/bitum/index.ts
  - src/bitum/learned-signatures.ts
  - src/bitum/llm.ts
  - src/bitum/parsers/all-prices.ts
  - src/bitum/parsers/birzha-prices.ts
  - src/bitum/parsers/birzha-volumes.ts
  - src/bitum/parsers/bitum-price-new.ts
  - src/bitum/parsers/fca-sellers.ts
  - src/bitum/parsers/index.ts
  - src/bitum/parsers/shared.ts
  - src/bitum/refineries.ts
  - src/bitum/reporter.ts
  - src/bitum/storage.ts
  - src/bitum/types.ts
  - src/bot-bitum.ts
  - src/bot.ts
  - vitest.config.ts
findings:
  critical: 1
  warning: 6
  info: 8
  total: 15
status: issues_found
---

# Phase 4 — Code Review Report (битум-отчёт, milestone v5.0)

**Reviewed:** 2026-05-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 42 (20 source файлов + 17 test файлов + 5 конфиг/данные)
**Status:** issues_found

## Summary

Phase 4 реализует битум-pipeline v5.0: расширение с 3 до 5 типов xlsx, structured HTML-отчёт по `docs/bitum/algoritm.md` §6, hybrid LLM scope (framing-only, числа programmatic), classifier learning UX, cell-trace footer (REPORT-07), cross-check (REPORT-08), partial render (D-10) и 4 битум-команды бота с confirm flows.

Общая оценка: код архитектурно чистый, следует конвенциям проекта (pure-функции с dict-аргументом, atomic .tmp+rename, Zod-валидация parsers, нет module-level singleton'ов). Покрытие тестами хорошее — 17 test файлов на 12 модулей. Идемпотентность парсеров проверена. Cell-trace REPORT-07 имеет валидные unit-тесты.

Найдены проблемы:

1. **CR-01 (critical):** `src/__tests__/bot-handlers.test.ts:31-37` использует `vi.mock("../upload/storage.js", …)` для модуля, который физически удалён в wave 6 (`src/upload/` отсутствует). Vitest упадёт при загрузке этого теста с ошибкой "Cannot find module". **Blocking issue для baseline tests** (упомянуто в комментарии vitest.config.ts).
2. **WR-01..WR-04 (warnings):** реальные баги в reporter (лекс-сортировка Excel-ячеек ломает диапазон), невыполнимый cross-check для snapshot↔FCA, схема Zod отбрасывает легитимные нули, memory-leak в pending state Map'ов без TTL.
3. **WR-05..WR-06:** хард-коды `"Sheet1"` в trace и `"B4"` defaults в reporter — trace становится misleading при реальных файлах с другими именами листов.
4. **Info:** мелкие code-smells (dead code, exhaustiveness без default, leaked internal tags в user-visible warning).

---

## Critical Issues

### CR-01: Test mocks несуществующий модуль `src/upload/storage.js`

**File:** `src/__tests__/bot-handlers.test.ts:31-37`
**Issue:** `vi.mock("../upload/storage.js", …)` ссылается на модуль `src/upload/storage.ts`, который удалён в Phase 4 wave 6 (CLAUDE.md §Conventions: «legacy src/upload/* удалён»; `ls src/` подтверждает отсутствие директории `upload/`). Vitest при загрузке этого test-файла попытается resolve'нуть путь и упадёт с `Cannot find module '../upload/storage.js'` — весь file будет проигнорирован или тестовый run упадёт целиком. Это явно сломает baseline test suite phase 4.

Комментарий в самом файле говорит: «Phase 4 wave 5: bitum/storage заменил upload/storage; mock'аем оба для надёжности» — но это уже неверно после wave 6.

**Fix:**
```diff
- // Phase 4 wave 5: bitum/storage заменил upload/storage; mock'аем оба для надёжности.
- vi.mock("../upload/storage.js", () => ({
-   findLatestWeekWithUploads: vi.fn(() => null),
-   listWeek: vi.fn(() => ({ hasPrices: false, hasFca: false, hasVolumes: false, lastRunAt: null })),
-   isoWeekFolder: vi.fn(() => "2026-W21"),
-   saveUpload: vi.fn(),
-   writeLastRun: vi.fn(),
- }));
- vi.mock("../bitum/storage.js", () => ({
+ // Phase 4 wave 6: src/upload/* удалён, mock'аем только bitum/storage.
+ vi.mock("../bitum/storage.js", () => ({
    findLatestWeekWithUploads: vi.fn(() => null),
    // ... rest unchanged
  }));
```

---

## Warnings

### WR-01: Reporter — лексикографическая сортировка Excel-ячеек ломает диапазон

**File:** `src/bitum/reporter.ts:198-207, 221-231`
**Issue:** Функция `buildVolumesBlock` собирает `sourceCell` строки из `payload.volumes` и сортирует через `Array.sort()` (по умолчанию строковое сравнение):
```ts
const volCells = payload.volumes
  .map((v) => v.sourceCell)
  .filter(Boolean)
  .sort();
const volRange = `${volCells[0]}..${volCells[volCells.length - 1]}`;
```
Excel A1-адреса в строковом сравнении сортируются неправильно: `"B10" < "B4" < "B9"`. Получив на вход `["B4", "B5", …, "B10"]`, `.sort()` вернёт `["B10", "B4", "B5", …]` → диапазон выйдет как `"B10..B9"` (от меньшего лексикографически к большему лексикографически). Trace footer и user-visible cell-pointer становится бесполезным/вводящим в заблуждение, что подрывает основную ценность REPORT-07 (auditable cell-trace).

Та же проблема в `perCells.sort()` (строка 224-225), `buildCompanyGroupBlock` диапазон строится из `firstCell..lastCell` (строки 270-271) — но там это безопасно, потому что эти cells берутся из Δ first/last по `Date`, а не сортируются по адресу.

**Fix:**
```ts
// helper: Excel A1-address → tuple [colNumeric, rowNumeric] for proper sort
function cellSortKey(addr: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!m) return [0, 0];
  // letters → base-26 numeric
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [col, parseInt(m[2], 10)];
}
function compareCells(a: string, b: string): number {
  const [ca, ra] = cellSortKey(a);
  const [cb, rb] = cellSortKey(b);
  return ca !== cb ? ca - cb : ra - rb;
}
// usage:
const volCells = payload.volumes
  .map((v) => v.sourceCell)
  .filter(Boolean)
  .sort(compareCells);
```

### WR-02: Cross-check (REPORT-08) для snapshot↔FCA не сработает в проде

**File:** `src/bitum/reporter.ts:323-330` + `src/bitum/analyzer.ts:159-199`
**Issue:** `buildCrossCheckBlock` пушит в `prices1` snapshot с `canonical: "БНД snapshot"`:
```ts
prices1.push({
  canonical: "БНД snapshot",
  price: payload.bitumSnapshot.bnd.price,
  // ...
});
```
А `prices2` берёт `fca.refineryCanonical` — реальные имена НПЗ типа `"Саратовский НПЗ"`. Затем `crossCheck` фильтрует по `f.canonical === p.canonical` (analyzer.ts:176) — никогда не получит match. Cross-check для snapshot эффективно мёртв (alert REPORT-08 никогда не сработает на snapshot ↔ FCA divergence).

Тест `bitum-reporter.test.ts:99-137` маскирует это, искусственно подсовывая `refineryCanonical: "БНД snapshot"` в FCA-row, что не соответствует production.

Если требование REPORT-08 — сравнивать snapshot БНД-цену со средневзвешенной FCA-ценой по конкретным НПЗ (или со средней по всему рынку) — текущая реализация не работает.

**Fix:** Уточнить семантику REPORT-08 в algoritm.md §6 и переписать. Варианты:
- (a) Сравнивать `bitumSnapshot.bnd.price` со средним по `payload.fca[].priceRub` (без per-canonical match), `canonical: "БНД (рынок)"`.
- (b) Дублировать snapshot row под каждый canonical из FCA: `for (const ref of new Set(fca.map(f => f.refineryCanonical))) prices1.push({canonical: ref, price: snapshot.bnd.price, …})` — тогда match'ы пойдут.
- (c) Если REPORT-08 only про `all_prices` ↔ FCA cross-check (без snapshot), убрать snapshot из prices1 и пометить snapshot-only как out-of-scope.

Без выбора и реализации этот block — silent dead code в production.

### WR-03: Zod-схема отбрасывает легитимные нули в priceRub (birzha_prices, fca_sellers)

**File:** `src/bitum/parsers/birzha-prices.ts:25` и `src/bitum/parsers/fca-sellers.ts:25`
**Issue:** Обе схемы используют `priceRub: z.number().positive().finite()` — отбрасывает не только ошибочные `0` (cell без данных, который случайно пришёл числом 0), но и реальные `0` (если на конкретный день торгов не было, может быть пустая ячейка, но также возможна `0` от XLSX-формулы). При наличии `0` schema fail → строка попадает в `errors[]`, отчёт теряет данные без явного сигнала оператору.

Контраст: `birzha-volumes.ts:24` использует `z.number().nonnegative()` (правильно — объём может быть `0`).

Если по бизнес-логике 0 — это «нет торгов» (а не «бесплатная сделка»), правильное поведение — пропустить строку (continue) ДО Zod-валидации (как сейчас делается для `null` цены), а не сваливать в errors.

**Fix:**
```diff
  if (rawPrice == null) continue;
+ if (rawPrice === 0) continue; // 0 = «нет торгов в этот день», не ошибка
  const priceRub = rawPrice * 1000;
```
Аналогично в `fca-sellers.ts:59`.

Если 0 — это валидная цена (например, бесплатная отгрузка по контракту), наоборот: схему сменить на `nonnegative()`. В любом случае текущее поведение «упадёт в errors» — некорректное.

### WR-04: Pending state Map'ы — нет TTL, утечка памяти

**File:** `src/bot-bitum.ts:67, 74, 83`
**Issue:** Три in-memory Map'а (`pendingPublishByMsgId`, `pendingResetByMsgId`, `pendingLearningByMsgId`) хранят `Buffer`/`html`/`week` + `createdAt`. `createdAt` фиксируется, но НИКОГДА не используется для очистки. Если пользователь:
- загрузит 100 неизвестных xlsx подряд и не нажмёт ни на одну learning-кнопку → 100 Buffer'ов остаются в RSS бота до рестарта;
- сделает 100 `/bitum_report` без confirm/cancel → 100 рендеренных HTML'ов (могут быть по 4000+ chars каждый);
- Map никогда не сжимается.

Стратегия «рестарт бота → теряются» из CLAUDE.md §Conventions ОК как fallback, но без TTL/eviction даже один сценарий «оператор положил телефон на 30 мин» забивает память без видимой причины.

**Fix:** Добавить простой TTL-cleanup в `handleBitumCallback` / каждый handler, либо периодический cron:
```ts
const PENDING_TTL_MS = 15 * 60 * 1000; // 15 минут
function purgeStale<V extends { createdAt: number }>(m: Map<number, V>): void {
  const now = Date.now();
  for (const [k, v] of m) {
    if (now - v.createdAt > PENDING_TTL_MS) m.delete(k);
  }
}
// вызывать в начале handleBitumCallback и handleBitumDocument:
purgeStale(pendingLearningByMsgId);
purgeStale(pendingPublishByMsgId);
purgeStale(pendingResetByMsgId);
```

### WR-05: Trace `sheet: "Sheet1"` хард-код противоречит CLAUDE.md архитектуре

**File:** `src/bitum/reporter.ts:159, 165, 172, 179, 211, 235, 275, 282`
**Issue:** Все `ctx.trace.push({…, sheet: "Sheet1", …})` хард-кодят имя листа `"Sheet1"`. В то же время `CLAUDE.md §Architecture` явно описывает: `all_prices` использует вкладку `"исходник"`, `bitum_price_new` использует `"свод"`. Парсеры действительно ищут листы через `findSheet(wb, "исходник")` (parsers/all-prices.ts:107) — значит реальные имена другие, чем `"Sheet1"`.

Цель REPORT-07 cell-trace — дать оператору формат «файл/лист/cell», по которому он откроет xlsx, перейдёт на нужный лист и проверит число. С `sheet: "Sheet1"` оператор откроет вкладку, которой не существует или которая пустая, — auditable cell-trace становится бесполезным.

**Fix:** Прокидывать реальное имя листа из парсеров. Простейший вариант — добавить в `ParserResult<T>` опциональное `sheetName` поле (либо в каждую `ParsedRow*`):
```ts
// в типах:
interface ParserResult<T> {
  rows: T[];
  errors: { rowNum: number; reason: string }[];
  sheetName?: string; // реальное имя листа из xlsx
}
// в парсерах:
return { rows: …, errors: …, sheetName: ws.name };
// в reporter: пробросить sheetName в trace вместо "Sheet1"
```

### WR-06: Default `"B4"` для `sourceCell` в reporter — silently broken cell-trace

**File:** `src/bitum/reporter.ts:208, 228, 269`
**Issue:** Три места используют `?? "B4"` fallback, когда `sourceCell` отсутствует:
```ts
const volRange = volCells.length > 0 ? … : "B4";
const perRange = perCells.length === 0 ? "B4" : …;
const lastCell = d.lastCell ?? "B4";
```
Если по какой-то причине `sourceCell` не заполнен (например, парсер не успел/баг), trace покажет адрес `"B4"`, ведущий оператора на cell, не имеющий отношения к числу. В случае `birzha-volumes` это особенно вредно — колонка B там зарезервирована под `"Объем итого"` и парсером ПРОПУСКАЕТСЯ (см. `birzha-volumes.ts:49`). То есть для volumes-трасы fallback указывает на cell, который специально игнорируется парсером.

Лучше явный маркер невалидной ячейки, чтобы trace был самодокументируем.

**Fix:**
```diff
- const volRange = volCells.length > 0 ? … : "B4";
+ const volRange = volCells.length > 0 ? … : "?"; // unknown
```
И в `NumberTrace` либо допустить `cell: "?"` (документировать), либо вообще не пушить trace-record, если cell неизвестен.

---

## Info

### IN-01: `sendMarkdown` — dead code

**File:** `src/bot.ts:233-247`
**Issue:** Функция `sendMarkdown` помечена `async` и не экспортируется; grep по проекту показывает что она не вызывается ни в одном модуле. Комментарий упоминает «финальный отчёт upload-pipeline», но upload-pipeline удалён в wave 6.
**Fix:** Удалить функцию целиком или явно пометить `// @deprecated` если планируется использование.

### IN-02: `parseByType` не имеет `default` ветки

**File:** `src/bot-bitum.ts:354-415`
**Issue:** `switch (type)` покрывает все 5 known типов, но если когда-нибудь `KnownBitumType` расширится (6-й тип) и кто-то забудет обновить `parseByType`, в runtime получим `return undefined` → дальше `parseResult.rowCount` упадёт с `TypeError: Cannot read properties of undefined`. TypeScript exhaustiveness check спасает на стадии компиляции — но не если `type as KnownBitumType` cast где-то скрыл `unknown`.
**Fix:**
```ts
default: {
  const _exhaustive: never = type;
  throw new Error(`[bitum] unhandled type: ${_exhaustive}`);
}
```

### IN-03: Internal tag `(REPORT-08)` выводится пользователю

**File:** `src/bitum/reporter.ts:348`
**Issue:** `lines.push("<b>⚠️ Цены расходятся (REPORT-08):</b>")` — внутренний task-tag из плана попадает в user-visible Telegram message. Оператор не знает, что такое REPORT-08, и tag добавляет шума.
**Fix:** Заменить на `"<b>⚠️ Цены расходятся между источниками:</b>"`.

### IN-04: Избыточная проверка в `handleBitumDocument` learning UX

**File:** `src/bot-bitum.ts:438`
**Issue:** `if (cls.confidence < 1 || cls.type === "unknown")` — `cls.type === "unknown"` всегда совпадает с `cls.confidence === 0` (см. classifier.ts:127-129). Условие избыточно, второе подвыражение никогда не «срабатывает само по себе» — оно покрывается первым. Не баг, но code smell.
**Fix:**
```diff
- if (cls.confidence < 1 || cls.type === "unknown") {
+ if (cls.confidence < 1) {
```

### IN-05: Stable refineries в «Прочие» — выводится только первый Татнефть

**File:** `src/bitum/reporter.ts:291-301`
**Issue:** Цикл проверяет `tatneft.length > 0` и затем берёт `tatneft[0]` — игнорирует остальные стабильные НПЗ Татнефти и других независимых. Если стабильны и Таиф-НК, и (гипотетически) ТАНЕКО, в отчёт попадёт только первый. Также независимые stable вообще не упоминаются — а это часть требования REPORT-05 «Цены остались на уровне».
**Fix:** Итерировать по всем stable и формировать строку «Цены на {N} НПЗ ({list}) остались на уровне …» — либо отдельной строкой на каждый канонический.

### IN-06: `BUILT_IN_SIGNATURES` `a3: ""` workaround

**File:** `src/bitum/signatures.ts:48-49`
**Issue:** Для `birzha_prices` и `birzha_volumes` явно прописано `a3: ""`. Из-за обхода в classifier.ts:54-56 пустая строка не считается match'ем (`sig.a3.length > 0` проверка), что корректно. Но `a3: ""` ничего не даёт сигнатуре — это noise в декларации, провоцирующий читателя думать «здесь что-то значимое».
**Fix:**
```diff
- { type: "birzha_prices", a1: "цена битум на бирже", a3: "" },
- { type: "birzha_volumes", a1: "объем битум на бирже", a3: "" },
+ { type: "birzha_prices", a1: "цена битум на бирже" },
+ { type: "birzha_volumes", a1: "объем битум на бирже" },
```

### IN-07: `handleBitumCallback` пустой catch ACK

**File:** `src/bot-bitum.ts:508-514`
**Issue:**
```ts
try {
  await tgFetch(token, "answerCallbackQuery", { callback_query_id: cb.id });
} catch {
  /* ignore ack failures */
}
```
Пустой catch без логирования. Если ack стабильно фейлит (например, токен невалиден), оператор никогда не узнает — confirm/cancel flow продолжит «работать», но в Telegram-клиенте у пользователя останется висеть spinner. В `src/bot.ts:670-676` симметричный catch ЕСТЬ `log.warn(...)` — здесь добавить такой же.
**Fix:**
```ts
} catch (err) {
  log.warn(`[bitum-bot] answerCallbackQuery failed: ${(err as Error).message}`);
}
```

### IN-08: Reporter `(нет данных)` для snapshot block без `<b>### …</b>` header

**File:** `src/bitum/reporter.ts:152`
**Issue:** Когда `bitumSnapshot` отсутствует, return — голый `<i>(нет данных: …)</i>` без структурного header'а как у `buildVolumesBlock` (`<b>### Объёмы биржевых торгов</b>\n<i>(нет данных)</i>`). Отчёт получается асимметричным — оператор видит «(нет данных)» без понимания, к какой секции это относится.
**Fix:** Добавить header:
```diff
- return "<i>(нет данных: ожидается bitum_price_new.xlsx — средняя цена БНД snapshot)</i>";
+ return "<b>### Средняя цена битума (snapshot)</b>\n<i>(нет данных: ожидается bitum_price_new.xlsx)</i>";
```

---

_Reviewed: 2026-05-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
