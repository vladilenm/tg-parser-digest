---
phase: 01-storage-migration
reviewed: 2026-05-05T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/channels-store.ts
  - src/pipeline.ts
  - src/types.ts
  - src/__tests__/channels-store.test.ts
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 01-storage-migration: Code Review Report

**Reviewed:** 2026-05-05
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Миграция `channels.yaml → channels.json` с атомарной записью и in-process mutex реализована корректно. Самописный promise-chain mutex (`withLock`) написан грамотно: дублирование `op` в обоих slots `then(op, op)` гарантирует запуск ровно один раз независимо от состояния предыдущей операции, а хвост `result.then(noop, noop)` корректно поглощает rejection, чтобы следующий ожидающий не унаследовал ошибку. Атомарная запись через `.tmp + rename` соответствует паттерну `archive.ts:34-39`. Zod-схема (D-01/D-02) точна. Идемпотентность миграции обеспечивается `existsSync(CHANNELS_PATH)` гвардом + crash-safe `.tmp`-стратегией. ESM `.js`-суффиксы и type-only импорты соблюдены. Тесты концептуально покрывают critical-path (Promise.all на 2 и 10 concurrent mutate, throw-rollback, идемпотентность миграции).

Замечания касаются: (1) реального риска flakiness тестов из-за переживания module-level `lockChain` между тестами без явной синхронизации в `afterEach` — этот риск явно описан в plan-04 (T-01-16), но mitigation не имплементирован; (2) скрытого двойного логирования в тесте идемпотентности из-за того, что `logSpy` устанавливается до второго `loadChannels`, но первый вызов уже отработал в той же тестовой функции — нужно убедиться, что хелперы logger'а не кэшируют ничего глобально. Несколько info-замечаний о Zod strict-mode, обработке ENOENT в TOCTOU-окне миграции и стиле комментариев.

Никаких новых runtime-зависимостей не добавлено (соответствие constraints из CLAUDE.md). `package.json` не менялся.

## Warnings

### WR-01: Module-level `lockChain` переживает между тестами без явного дренажа

**File:** `src/__tests__/channels-store.test.ts:25-34`
**Issue:** `lockChain` объявлен на module-level в `channels-store.ts:103` и НЕ сбрасывается между тестами. Тестовая логика полагается на то, что каждый тест сам `await`'ит свои Promise.all, и chain «пустеет» к концу. Однако:

1. Если тест выбрасывает синхронно (например, `expect(() => loadChannels()).toThrow()` в STORE-01 группе) — никакой mutate в нём не вызывался, что OK; но тесты STORE-02 порядково идут после STORE-01, и при flakiness одного из тестов в STORE-02 (например, OS-уровень I/O лагает) хвост `lockChain` может ещё резолвиться в момент, когда `afterEach` уже сделал `process.chdir(ORIGINAL_CWD)` и `rmSync(workdir)`. Дальнейший `atomicWriteJson` этой запоздалой операции попадёт в исходный repo cwd — `./channels.json` в корне проекта.
2. План 01-04 явно описывает эту угрозу как T-01-16 и предлагает в качестве mitigation `await new Promise(r => setImmediate(r))` в `afterEach`, но в реализации это НЕ добавлено.

**Impact:** Потенциальная порча `./channels.json` в корне проекта при flaky-тесте; flaky CI; мусорные файлы в repo.

**Fix:** Добавить дренаж lockChain в afterEach. Можно через ре-экспорт служебного `await flushLockChain()` из channels-store, либо менее инвазивно — дождаться следующего тика event-loop:
```typescript
afterEach(async () => {
  // Дренаж pending mutate'ов: ждём, пока lockChain отработает все хвосты.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  process.chdir(ORIGINAL_CWD);
  rmSync(workdir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
```
Альтернативно — экспортировать internal helper `__resetLockChainForTests()` (с явным комментарием «only for tests») и вызывать его в `beforeEach`.

---

### WR-02: Тест идемпотентности миграции — `console.log` spy не покрывает первый вызов

**File:** `src/__tests__/channels-store.test.ts:223-234`
**Issue:** Тест проверяет, что второй `loadChannels()` НЕ вызывает миграцию через `vi.spyOn(console, "log")`, который ставится ПОСЛЕ первого вызова. Это правильная семантика для проверки «второй вызов не логирует», но есть тонкий пробел в покрытии: если в имплементации появится баг, при котором миграция случайно срабатывает дважды (например, кто-то добавит логику «дописать поля по умолчанию» внутри ветки JSON-чтения и она напечатает «migrated» в лог) — тест это поймает только если bug-message содержит подстроку `migrated`. Также: spy на `console.log` ловит только `log.info` (если он использует `console.log`), но `log.warn`/`log.error` могут идти через `console.error` — если когда-нибудь миграция-лог переедет на warn-уровень, тест ложно зазеленеет.

**Impact:** Хрупкий тест: устойчив к текущему поведению, но скрытно зависит от реализационных деталей `logger.ts`. Не блокирует phase, но снижает доверие к идемпотентности при будущих изменениях в logger.

**Fix:** Сделать проверку идемпотентности через файловый таймштамп вместо лог-spy:
```typescript
it("идемпотентность: второй loadChannels() НЕ переписывает channels.json", () => {
  writeYaml([{ username: "ch1" }]);
  loadChannels(); // первый — мигрирует
  const mtimeAfterFirst = statSync("./channels.json").mtimeMs;

  // Маленькая задержка, чтобы mtime мог отличиться при перезаписи
  const sleepUntil = Date.now() + 20;
  while (Date.now() < sleepUntil) { /* spin */ }

  loadChannels(); // второй — НЕ должен переписать файл
  const mtimeAfterSecond = statSync("./channels.json").mtimeMs;
  expect(mtimeAfterSecond).toBe(mtimeAfterFirst);
});
```
Или дополнить существующий тест проверкой mtime в дополнение к spy.

## Info

### IN-01: Zod-схема не использует `.strict()` — лишние поля в YAML тихо отбрасываются

**File:** `src/channels-store.ts:18-25`
**Issue:** `ChannelEntrySchema` и `ChannelsFileSchema` объявлены через `z.object({...})` без `.strict()`. По умолчанию Zod стрипует unknown keys (см. `.strip()` режим). Если оператор в `channels.yaml` записал ` - username: ch1\n   comment: "тест"`, после миграции в `channels.json` поле `comment` исчезнет без предупреждения. Это соответствует D-01 «schema 1:1, никаких extras», но потенциально удивляет оператора.

**Fix:** Добавить `.strict()` для явного отказа от extras с понятным error message:
```typescript
const ChannelEntrySchema = z.object({
  username: z.string().min(1),
  priority: z.number().int().optional(),
}).strict();
```
Альтернатива — оставить как есть и явно задокументировать в комментарии «Zod stripps unknown keys: extras YAML-полей теряются при миграции».

---

### IN-02: TOCTOU-окно при удалении YAML между двумя `existsSync`

**File:** `src/channels-store.ts:41-49`
**Issue:** Между `existsSync(CHANNELS_PATH)` (строка 41), `existsSync(YAML_FALLBACK_PATH)` (строка 43) и `readFileSync(YAML_FALLBACK_PATH, "utf8")` (строка 49) есть TOCTOU-окно. Если оператор удалит `channels.yaml` именно в этот наносекундный промежуток — `readFileSync` бросит сырой `ENOENT: no such file...` без обёртки `[channels-store]`-префикса, что нарушает консистентность error-сообщений.

**Impact:** Низкий — оператор один, ручные действия маловероятны. Но в edge-cases (filesystem на NFS, антивирус-сканер) возможен.

**Fix:** Обернуть `readFileSync` в try/catch и переформатировать сообщение:
```typescript
let yamlRaw: string;
try {
  yamlRaw = readFileSync(YAML_FALLBACK_PATH, "utf8");
} catch (err) {
  throw new Error(
    `[channels-store] failed to read ${YAML_FALLBACK_PATH}: ${(err as Error).message}`
  );
}
```

---

### IN-03: Отсутствует `fsync` перед `rename` в `atomicWriteJson`

**File:** `src/channels-store.ts:91-95`
**Issue:** `writeFileSync` не вызывает `fsync(2)` перед `renameSync`. POSIX гарантирует только metadata-уровень атомарности rename; содержимое нового inode после OS crash до flush'а буфера может быть пустым (старый файл при этом исчезает). Для use-case проекта (single-operator, manual restart, idempotent migration) — accept, но стоит знать.

**Fix:** Если когда-либо потребуется durability при power-loss:
```typescript
function atomicWriteJson(path: string, value: unknown): void {
  const tmp = path + ".tmp";
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, JSON.stringify(value, null, 2), 0, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
```
Текущий phase: оставить как есть (соответствует паттерну `archive.ts`).

---

### IN-04: Fisher-Yates shuffle мутирует массив, возвращённый из `loadChannels()`

**File:** `src/pipeline.ts:33-36`
**Issue:** `loadChannels()` возвращает `validated.channels` — это уже скопированный Zod'ом массив, поэтому мутация безопасна для текущего вызова. Однако стилистически: будущий читатель может ошибочно считать, что `loadChannels()` возвращает immutable snapshot и положиться на стабильный порядок. Документировать это явно НЕ помешает.

**Fix:** Добавить комментарий перед shuffle:
```typescript
// loadChannels() возвращает свежий массив (Zod stripps + копирует) — мутация in-place безопасна.
for (let i = channels.length - 1; i > 0; i--) {
  ...
}
```
Или сделать копию перед shuffle: `const shuffled = [...channels];` — для будущей защиты от случайных изменений в `channels-store`.

---

### IN-05: Помеченный `let lockChain` — потенциально удобно сделать `Object`-обёртку для тестируемости

**File:** `src/channels-store.ts:103`
**Issue:** `let lockChain: Promise<void> = Promise.resolve();` — module-level mutable state. Это by design (mutex должен быть single-instance per process), но затрудняет:
- Изоляцию тестов (см. WR-01).
- Multi-instance scenario (если phase 2 решит иметь два независимых mutex'а — для разных файлов).

**Fix:** Не нужно менять прямо сейчас (YAGNI), но рассмотреть в Phase 2 при добавлении бот-handler'ов:
```typescript
function createMutex() {
  let lockChain: Promise<void> = Promise.resolve();
  return {
    withLock<T>(op: () => Promise<T>): Promise<T> { /* ... */ },
    drain(): Promise<void> { return lockChain; },
  };
}
const channelsMutex = createMutex();
```
Фабричный паттерн позволил бы тестам ре-инстанциировать mutex и убрал бы skрытое глобальное состояние.

---

_Reviewed: 2026-05-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
