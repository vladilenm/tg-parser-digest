---
phase: 01-storage-migration
verified: 2026-05-05T16:48:30Z
status: human_needed
score: 7/7 must-haves verified (automated)
must_haves_passed:
  - "STORE-01: channels.yaml мигрирован в channels.json; pipeline читает каналы из JSON"
  - "STORE-02: атомарная запись channels.json через .tmp + rename с in-process mutex"
  - "STORE-03: auto-migration при старте daemon (если channels.json отсутствует — конвертирует из YAML)"
  - "SC#1 (truth): npm start запускается и pipeline читает channels из channels.json через store-API (loadChannels) — wiring подтверждён грепом и tsc"
  - "SC#2 (truth): при отсутствии channels.json daemon автоматически конвертирует YAML и продолжает работу — лог migrated проверен в vitest"
  - "SC#3 (truth): запись через channels-store никогда не оставляет файл повреждённым даже при concurrent mutate — vitest Promise.all (2 и 10 ops) зелёный, .tmp + rename + mutex"
  - "Все 15 vitest-тестов в channels-store.test.ts зелёные; полный suite 105/105"
gaps: []
human_verification:
  - test: "Smoke: npm run start:once в чистой среде без channels.json"
    expected: "Daemon стартует, печатает лог `[channels-store] migrated channels.yaml → channels.json (50 каналов)`, runPipeline проходит обычный 24h-цикл, доставляет дайджест в закрытый канал"
    why_human: "Требует TG_SESSION + DEEPSEEK_API_KEY + реального доступа к каналам; обычный automated smoke невозможен. End-to-end проверка SC#1 + SC#2 одновременно."
  - test: "Smoke: повторный npm run start:once после первого прогона"
    expected: "Лог `migrated` НЕ появляется; pipeline работает идемпотентно; channels.yaml на диске не тронут"
    why_human: "Требует реальный запуск daemon после первой миграции; vitest покрывает идемпотентность на module-level, но не подтверждает поведение на полном run.ts → tick → runPipeline пути"
  - test: "Manual concurrency: запустить два процесса параллельно (один cron-tick, второй вручную через CLI dry-run mutate)"
    expected: "channels.json остаётся валидным JSON, оба изменения видны после ожидания завершения"
    why_human: "Vitest симулирует concurrency внутри одного процесса (in-process mutex). Phase 2 добавит реальный второй процесс (бот) — до Phase 2 кросс-процессная race condition не воспроизводится; multi-process не входит в scope Phase 1, но оператор должен убедиться, что single-process daemon выживает быстрые повторные запуски"
---

# Phase 01-storage-migration Verification Report

**Phase Goal:** Pipeline и бот читают список каналов из `channels.json` с гарантией атомарных записей и нулевым риском race condition при одновременном обращении бота и cron
**Verified:** 2026-05-05T16:48:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                       | Status     | Evidence                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SC#1: `npm start` запускается, daemon читает каналы из `channels.json` и доставляет сводку — ни одна v3.0 функция не сломана                | ✓ VERIFIED | `src/run.ts:24` вызывает `runPipeline()`; `src/pipeline.ts:25` вызывает `loadChannels()` из `channels-store.ts`; pipeline сохранил Fisher-Yates shuffle (line 33), per-channel try/catch (52), dedup, archive, summarize, deliver. tsc и vitest зелёные. |
| 2   | SC#2: При отсутствии `channels.json` на старте daemon автоматически конвертирует `channels.yaml` и продолжает работу                        | ✓ VERIFIED | `src/channels-store.ts:41-66` — ветка lazy-migration с `existsSync(CHANNELS_PATH)` гвардом; вызывает `yaml.parse` → `ChannelsFileSchema.parse` → `atomicWriteJson` → `log.info(... migrated ...)`. Vitest STORE-03 (4 теста) зелёные.                                |
| 3   | SC#3: Запись в `channels.json` никогда не оставляет файл повреждённым (mutex + `.tmp + rename`)                                             | ✓ VERIFIED | `withLock` (line 109), `atomicWriteJson` (91), `.tmp + renameSync` (92-94). Vitest Promise.all (2 + 10 concurrent mutate) зелёный; throw inside mutate не модифицирует файл; mutex не залипает после reject.                                       |
| 4   | Модуль `src/channels-store.ts` экспортирует ровно три public-функции: `loadChannels`, `saveChannels`, `mutate`                                | ✓ VERIFIED | grep counts: `export function loadChannels` = 1, `export function saveChannels` = 1, `export function mutate` = 1. Никаких `addChannel`/`removeChannel` (D-09 deferred to Phase 2).                                                              |
| 5   | `pipeline.ts` больше не импортирует `yaml`/`readFileSync` напрямую и не содержит локального `interface ChannelEntry`/`ChannelsFile`         | ✓ VERIFIED | grep counts в `src/pipeline.ts`: `loadChannelsYaml` = 0, `^import yaml` = 0, `readFileSync` = 0, `interface ChannelEntry` = 0, `interface ChannelsFile` = 0, импорт из `./channels-store.js` = 1.                                                  |
| 6   | `src/types.ts:4` ссылается на `channels.json` (косметика)                                                                                   | ✓ VERIFIED | `grep "channels.json" src/types.ts` = 1 (line 4); `grep "channels.yaml" src/types.ts` = 0.                                                                                                                                                       |
| 7   | Vitest-тесты покрывают STORE-01/02/03 включая critical Promise.all concurrency proof; `npx vitest run` зелёный                              | ✓ VERIFIED | 3 describe-блока (STORE-01/02/03), 15 it() тестов, 4 Promise.all использования. Полный suite: 105/105 passing, 6 файлов.                                                                                                                          |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact                                | Expected                                                                                                                                          | Status     | Details                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `src/channels-store.ts`                 | store-API: `loadChannels`, `saveChannels`, `mutate`, `CHANNELS_PATH`, type `ChannelEntry`, atomic write helper, promise-chain mutex, lazy migration | ✓ VERIFIED | 154 строки; все 5 экспортов присутствуют; auto-migration ветка на lines 41-66; mutex withLock на 109-118       |
| `src/pipeline.ts`                       | runPipeline через store-API; удалены `loadChannelsYaml`, прямой `import yaml`, локальные интерфейсы                                               | ✓ VERIFIED | 134 строки (с 162 → -28); type-only `import { loadChannels, type ChannelEntry } from "./channels-store.js"` |
| `src/types.ts`                          | комментарий ссылается на `channels.json`                                                                                                          | ✓ VERIFIED | line 4: `// без "@", как в channels.json`                                                                     |
| `src/__tests__/channels-store.test.ts`  | 12+ vitest-тестов в 3 describe-блоках, изоляция через mkdtempSync+chdir, Promise.all concurrency proof                                            | ✓ VERIFIED | 240 строк, 15 тестов, 3 describe, 4 Promise.all уч., все зелёные                                              |

### Key Link Verification

| From                           | To                                  | Via                                                | Status   | Details                                                                              |
| ------------------------------ | ----------------------------------- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `pipeline.ts:runPipeline`      | `channels-store.ts:loadChannels`    | `import { loadChannels } from "./channels-store.js"` + call line 25 | ✓ WIRED  | `loadChannels()` is the only data source for `channels` array; downstream Fisher-Yates shuffle и per-channel loop работают идентично |
| `channels-store.ts:loadChannels` | `yaml.parse(channels.yaml)`       | lazy fallback ветка                                | ✓ WIRED  | line 52: `yamlParsed = yaml.parse(yamlRaw)` после `existsSync(CHANNELS_PATH)===false` гварда                                |
| `channels-store.ts:loadChannels` | `atomicWriteJson(CHANNELS_PATH)` | первый запуск пишет JSON                           | ✓ WIRED  | line 61: `atomicWriteJson(CHANNELS_PATH, validated)` синхронно после Zod validate    |
| `channels-store.ts:saveChannels/mutate` | `withLock(...)` mutex      | promise-chain mutex                                | ✓ WIRED  | lines 129, 146 обёрнуты в `withLock(async () => {...})`; mutex реальный, доказан Promise.all тестами |
| `channels-store.ts:atomicWriteJson` | `node:fs writeFileSync + renameSync` | .tmp + rename                                  | ✓ WIRED  | lines 92-94: writeFileSync(tmp) → renameSync(tmp, path)                              |
| `run.ts:tick`                  | `pipeline.ts:runPipeline`           | существующий вызов сохранён                        | ✓ WIRED  | `src/run.ts:24` `await runPipeline()` — не менялся в Phase 1                         |

### Data-Flow Trace (Level 4)

| Artifact                | Data Variable                | Source                                                                                  | Produces Real Data | Status      |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------- | ------------------ | ----------- |
| `pipeline.ts` `channels` | `ChannelEntry[]`             | `loadChannels()` → `ChannelsFileSchema.parse(JSON.parse(channels.json))`                | ✓ Real (validated by Zod, .min(1) enforced) | ✓ FLOWING   |
| `channels-store.ts` migration `validated.channels` | `ChannelEntry[]` | `yaml.parse(readFileSync(channels.yaml))` → `ChannelsFileSchema.parse`               | ✓ Real (50 каналов в `channels.yaml` на диске)  | ✓ FLOWING   |
| `mutate(fn)` `next`     | `ChannelEntry[]`             | `loadChannels()` внутри mutex → `await fn(current)` → `atomicWriteJson(payload)`        | ✓ Real (round-trip Zod → disk → Zod подтверждён vitest round-trip тестом) | ✓ FLOWING   |

### Behavioral Spot-Checks

| Behavior                                                                       | Command                                       | Result                          | Status |
| ------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------- | ------ |
| TypeScript compiles                                                            | `npx tsc --noEmit`                            | exit 0, no output               | ✓ PASS |
| Vitest suite (full)                                                            | `npx vitest run --no-coverage`                | 105/105 tests passing in 6 files | ✓ PASS |
| `channels.json` НЕ закоммичен (соответствует gitignore-стратегии runtime data) | `ls channels.json`                            | "No such file or directory" — это by design: миграция создаст файл при первом `npm start` | ✓ PASS (ожидаемое поведение) |
| `channels.yaml` существует (источник для миграции)                              | `ls channels.yaml`                            | 2915 bytes, exists since Apr 30 | ✓ PASS |
| End-to-end runPipeline smoke                                                    | `npm run start:once`                          | требует TG_SESSION + API ключи  | ? SKIP (см. human verification) |

### Requirements Coverage

| Requirement | Source Plan(s)                | Description                                                                                       | Status      | Evidence                                                                                                                        |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| STORE-01    | 01-01, 01-03, 01-04           | `channels.yaml` мигрирован в `channels.json`; pipeline читает каналы из JSON                      | ✓ SATISFIED | `pipeline.ts:25` использует `loadChannels()` из `channels-store.ts`; vitest STORE-01 группа (5 тестов) зелёная; все ссылки на `channels.yaml` в pipeline удалены |
| STORE-02    | 01-01, 01-04                  | Атомарная запись `channels.json` через `.tmp + rename` с in-process mutex                         | ✓ SATISFIED | `atomicWriteJson` (lines 91-95), `withLock` (109-118), Promise.all (2 и 10 ops) тесты зелёные                                   |
| STORE-03    | 01-02, 01-04                  | Auto-migration при старте daemon (если `channels.json` отсутствует — конвертирует из YAML)        | ✓ SATISFIED | `loadChannels()` lines 41-66: lazy migration ветка с `existsSync` гвардом; vitest STORE-03 группа (4 теста) зелёная             |

**Orphaned requirements:** None — все 3 STORE-* ID из REQUIREMENTS.md покрыты планами и реализацией.

### Anti-Patterns Found

| File                                  | Line   | Pattern                                          | Severity | Impact                                                                                                                                            |
| ------------------------------------- | ------ | ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/channels-store.test.ts` | 25-34  | Module-level `lockChain` без явного дренажа в afterEach | ⚠️ Warning  | Описано в `01-REVIEW.md` WR-01: при flaky-I/O запоздалый mutate может попасть в исходный repo cwd после `process.chdir(ORIGINAL_CWD)`. На текущий момент 105/105 тестов проходят стабильно — но это потенциальный риск flakiness. Mitigation предложен в REVIEW (drain через `setImmediate` в afterEach) — НЕ имплементирован. |
| `src/__tests__/channels-store.test.ts` | 223-234 | Idempotency тест полагается только на console.log spy | ⚠️ Warning  | Описано в `01-REVIEW.md` WR-02: тест не проверяет mtime файла, поэтому скрытое второе перезаписывание `channels.json` в идентичный байт-в-байт snapshot тест не поймает (если когда-нибудь логирование `migrated` переедет на другой level). На сейчас функционально корректно. |
| `src/channels-store.ts`               | 18-25  | Zod-схема без `.strict()` — extras silently stripped | ℹ️ Info     | `01-REVIEW.md` IN-01: соответствует D-01 (1:1 с YAML), но потенциально удивляет оператора если в YAML есть лишние поля. Не блокирует goal.        |
| `src/channels-store.ts`               | 41-49  | TOCTOU-окно между `existsSync` и `readFileSync` | ℹ️ Info     | `01-REVIEW.md` IN-02: edge-case (NFS, антивирус). Single-operator, manual ops — accept.                                                          |
| `src/channels-store.ts`               | 91-95  | Нет `fsync` перед `rename`                       | ℹ️ Info     | `01-REVIEW.md` IN-03: соответствует паттерну `archive.ts:34-39`. Power-loss durability не требуется по PROJECT.md scope.                          |
| `src/pipeline.ts`                     | 33-36  | Fisher-Yates мутирует массив из `loadChannels()` | ℹ️ Info     | `01-REVIEW.md` IN-04: безопасно (Zod возвращает свежий массив), но стиль может ввести в заблуждение читающего.                                    |

**Итого:** 0 blockers, 2 warnings (оба известны и описаны в REVIEW), 4 info. Ни один не блокирует достижение goal.

### Human Verification Required

#### 1. End-to-end smoke test первой миграции

**Test:** `npm run start:once` в среде, где удалён `channels.json` (есть только `channels.yaml`)
**Expected:**
- В stdout появляется лог `[channels-store] migrated ./channels.yaml → ./channels.json (N каналов)` (где N = 50, по числу записей в `channels.yaml`)
- Создаётся `./channels.json` с двухпробельным JSON (50 объектов с `username`/`priority?`)
- `channels.yaml` остаётся на диске нетронутым
- runPipeline отрабатывает обычный 24h-цикл, доставляет HTML-дайджест в закрытый канал Заказчика
**Why human:** Требует TG_SESSION + DEEPSEEK_API_KEY + сетевой доступ к каналам Telegram + Bot Token для доставки. Vitest покрывает миграцию изолированно, но end-to-end интеграция SC#1 + SC#2 на реальном стенде требует ручного запуска оператором.

#### 2. Идемпотентность миграции на full daemon

**Test:** После Test 1 повторно запустить `npm run start:once`
**Expected:**
- Лог `migrated` НЕ появляется
- Pipeline работает идентично (тот же runId workflow, тот же дайджест если за 24h ничего нового)
- `channels.json` mtime не меняется (опционально — `stat channels.json` до и после)
**Why human:** Vitest покрывает идемпотентность на module-level (тест в STORE-03), но не подтверждает поведение на полном `run.ts → tick → runPipeline → loadChannels` пути. Кроме того, REVIEW WR-02 отмечает, что тест полагается на console.log spy — оператор видит реальный stdout, что более жёсткая проверка.

#### 3. Спокойствие mutex'а под бытовым stress'ом

**Test:** Запустить два быстрых `npm run start:once` подряд (или в фоне), не дожидаясь завершения первого; убедиться, что `channels.json` остаётся валидным JSON
**Expected:**
- `cat channels.json | jq .` парсится без ошибок после обоих запусков
- В логах либо `prev run still in progress — skipping tick` (от `isRunning` гварда в run.ts), либо два полных прогона без повреждения JSON
**Why human:** Vitest симулирует concurrency через Promise.all внутри ОДНОГО процесса. Cross-process race condition (два независимых node-процесса, конкурирующих за `channels.json`) не покрыт vitest'ом — но и не требуется по scope Phase 1 (PM2 forks=1, single-process daemon). Реальный multi-process тест ожидает Phase 2 (бот + cron в одном процессе). До Phase 2 оператор должен убедиться, что в single-process сценарии файл не повреждается.

### Gaps Summary

**Нет gaps, блокирующих achievement цели Phase 1.** Все 3 STORE-* requirements закрыты, все 7 наблюдаемых истин (3 SC из ROADMAP + 4 из must_haves планов) подтверждены автоматическими проверками. Tsc и vitest зелёные (105/105). Wiring через `pipeline.ts → channels-store.ts → fs/atomic+mutex` работает; auto-migration реализован lazy внутри `loadChannels()` с правильным `existsSync` гвардом и логированием.

Однако статус **`human_needed`**, не `passed`, по двум причинам:

1. **End-to-end интеграция требует реальных credentials.** SC#1 в ROADMAP требует «`npm start` ... доставляет сводку — ни одна v3.0 функция не сломана». Доставка проверяется только через реальный run с TG_SESSION + DEEPSEEK_API_KEY + Bot Token, который недоступен в automated verification.

2. **Идемпотентность миграции на full daemon path** покрыта vitest на module-level, но не на полном `run.ts → tick → runPipeline → loadChannels`. Низкий риск (vitest изолирует именно `loadChannels`), но операторская проверка нужна перед merge'ом Phase 1 → main.

Известные warnings из `01-REVIEW.md` (WR-01 mutex drain, WR-02 idempotency mtime) — НЕ блокируют goal; это технический долг для будущего refactor'а, не функциональные дефекты.

---

*Verified: 2026-05-05T16:48:30Z*
*Verifier: Claude (gsd-verifier)*
