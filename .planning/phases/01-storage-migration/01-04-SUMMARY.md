---
phase: 01-storage-migration
plan: 04
subsystem: storage
tags: [tests, vitest, mutex, concurrency, migration]
dependency_graph:
  requires:
    - "01-01: channels-store.ts с loadChannels/saveChannels/mutate"
    - "01-02: lazy auto-migration внутри loadChannels"
  provides:
    - "src/__tests__/channels-store.test.ts: 15 vitest-тестов для STORE-01/02/03"
    - "Доказательство success criterion #3 ROADMAP (mutex concurrency)"
  affects:
    - "Phase 2: BOT-команды теперь могут полагаться на проверенную mutex-семантику mutate()"
tech_stack:
  added: []
  patterns:
    - "Test isolation: mkdtempSync(tmpdir) + process.chdir + rmSync afterEach"
    - "Console spy для verification log-сообщений (vi.spyOn(console, 'log'))"
    - "Promise.all stress test для проверки mutex (10 concurrent mutate)"
key_files:
  created:
    - "src/__tests__/channels-store.test.ts (240 LOC, 15 tests)"
  modified: []
decisions:
  - "Mutex-concurrency доказан через Promise.all из 2-х и из 10-ти mutate (failure mode при сломанном mutex — потеря записи на ≥1 порядок вероятнее, чем при двух)"
  - "Изоляция тестов через chdir в tmpdir (channels-store читает ./channels.json относительно cwd)"
  - "Spy на console.log (а не на log.info из ../logger.js), так как logger.ts использует console.log внутри"
metrics:
  duration: "~1 минута (single-task plan)"
  completed: "2026-05-05"
---

# Phase 1 Plan 04: Vitest для channels-store — Summary

Vitest-тесты (15 шт. в 3 describe-блоках) для `channels-store.ts`, покрывающие STORE-01/02/03 включая critical Promise.all mutex concurrency proof (success criterion #3 ROADMAP).

## Что сделано

**Создан** `src/__tests__/channels-store.test.ts` — 240 LOC, 15 vitest-тестов в 3 describe-группах:

### STORE-01: loadChannels (5 тестов)

| # | Тест | Что проверяет |
|---|------|---------------|
| 1 | читает массив каналов из валидного channels.json | Happy-path: возвращает правильную длину и содержимое |
| 2 | CHANNELS_PATH экспортируется как './channels.json' | Public API contract (D-10) |
| 3 | throws при битом JSON-синтаксисе (D-03) | Error message соответствует `[channels-store] failed to parse` |
| 4 | throws при пустом массиве каналов (Zod .min(1)) | Schema validation |
| 5 | throws при отсутствии username | Zod-валидация полей |

### STORE-02: saveChannels + mutex (6 тестов)

| # | Тест | Что проверяет |
|---|------|---------------|
| 1 | saveChannels пишет валидный JSON с двухпробельным отступом (D-04) | Format compliance + round-trip через loadChannels |
| 2 | после saveChannels старый .tmp не остаётся на диске | rename, не copy (D-04 атомарность) |
| 3 | **CRITICAL**: Promise.all из двух concurrent mutate сохраняет ОБА канала | **success criterion #3 ROADMAP** |
| 4 | стресс-тест: 10 concurrent mutate сохраняют все 10 добавлений | Mutex robustness под нагрузкой |
| 5 | при throw из fn внутри mutate — основной channels.json НЕ модифицируется | Atomicity при exception |
| 6 | после rejected mutate — следующая mutate-операция работает | Mutex не залипает после ошибки |

### STORE-03: auto-migration (4 теста)

| # | Тест | Что проверяет |
|---|------|---------------|
| 1 | при отсутствии json и наличии yaml — мигрирует и логирует | D-13 log message содержит `migrated channels.yaml → channels.json (N каналов)` |
| 2 | после миграции channels.yaml ОСТАЁТСЯ на диске | D-12 backup |
| 3 | идемпотентность: второй loadChannels() НЕ повторяет миграцию | Лог НЕ появляется на втором вызове |
| 4 | throws когда оба файла отсутствуют | D-13 error `no source file` |

## Test isolation strategy

Каждый тест:
1. `beforeEach`: `mkdtempSync(tmpdir)` → создаёт изолированную директорию.
2. `process.chdir(workdir)` → channels-store читает `./channels.json` относительно cwd, теперь это tmpdir.
3. Тест сам пишет нужные fixture-файлы (`writeJson` / `writeYaml` helpers).
4. `afterEach`: `process.chdir(ORIGINAL_CWD)` + `rmSync(workdir, { recursive: true, force: true })` + `vi.restoreAllMocks()`.

**Результат:** ноль артефактов в корне репо после прогона; тесты не интерферируют между собой через файловую систему.

**Module-level state:** `lockChain` переживает между тестами (by design для daemon), но это не флакает — каждый тест await'ит свои Promise.all-операции до конца, и `lockChain.then(...)` хвост гарантирует резолвится до `afterEach`.

## Mapping requirements → tests

| Requirement | Describe | Tests |
|-------------|----------|-------|
| STORE-01 | loadChannels (STORE-01) | 5 |
| STORE-02 | saveChannels + mutex (STORE-02) | 6 (включая critical Promise.all) |
| STORE-03 | auto-migration YAML→JSON (STORE-03) | 4 |
| **Total** | | **15** |

## Verification

```bash
$ npx vitest run src/__tests__/channels-store.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)
   Duration  129ms
```

**Full suite (без регрессий):**
```bash
$ npx vitest run
 Test Files  6 passed (6)
      Tests  105 passed (105)
   Duration  226ms
```

`npx tsc --noEmit` — exit code 0.

## Что НЕ сделано (out of scope этого plan'а)

- Integration test всего pipeline (run.ts → channels-store → telegram) — не нужен для STORE-* requirements; pipeline-wiring был в Plan 01-03.
- E2E tests с реальным GramJS — out of scope (требует TG_SESSION).
- Property-based testing (fast-check) — overkill для 3-функционального API.

## Locked decisions implemented

- D-03 (битый JSON throws): тест `throws при битом JSON-синтаксисе`
- D-04 (двухпробельный отступ): тест `saveChannels пишет валидный JSON с двухпробельным отступом`
- D-05 (mutex без deps): косвенно — package.json diff пустой
- D-06 (loadChannels без mutex): структура тестов — synchronous loadChannels работает в концурентных сценариях
- D-11 (lazy migration): тест `при отсутствии channels.json...`
- D-12 (yaml остаётся): тест `channels.yaml ОСТАЁТСЯ на диске`
- D-13 (both missing throws + log): тесты `throws когда оба файла отсутствуют` и `migrated channels.yaml → channels.json (N каналов)`

## Patterns established

- **`mkdtempSync` + `process.chdir`** — стандартный паттерн для тестирования модулей с relative paths (channels-store, в будущем archive.ts если понадобится).
- **`vi.spyOn(console, 'log').mockImplementation(() => {})`** — для verification лог-сообщений в коде, использующем `log.info` (внутренний console.log).
- **Promise.all stress test** — для proof mutex'а: 10 concurrent ops с assertion на точное количество элементов в финальном файле; failure mode (потеря) на порядки вероятнее false-positive чем 2-op test.

## Files modified

| File | Status | LOC |
|------|--------|-----|
| `src/__tests__/channels-store.test.ts` | created | 240 |

## Commit

| Task | Hash | Message |
|------|------|---------|
| 1 | d9de1b4 | test(01-04): add vitest suite for channels-store (STORE-01/02/03) |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- File `src/__tests__/channels-store.test.ts` exists ✓
- Commit d9de1b4 exists in `git log` ✓
- 15/15 tests pass via `npx vitest run` ✓
- Full suite 105/105 pass (no regressions) ✓
- `npx tsc --noEmit` exit 0 ✓
- `git diff package.json` empty (no new deps) ✓
