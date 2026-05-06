---
phase: 260506-dht
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/channels-store.ts
  - src/__tests__/channels-store.test.ts
  - package.json
  - package-lock.json
  - docs/CHANNELS.md
  - docs/RUNBOOK.md
  - docs/ABOUT.md
  - Dockerfile
  - .planning/PROJECT.md
  - .planning/REQUIREMENTS.md
  - channels.yaml
  - prod-channels.yaml
autonomous: true
requirements:
  - STORE-01
  - STORE-03
  - BOT-01
must_haves:
  truths:
    - "loadChannels() reads only channels.json — no YAML fallback path remains in source"
    - "ChannelEntrySchema accepts only { username }; priority field is gone from schema, fixtures, and consumer code"
    - "channels.yaml and prod-channels.yaml no longer exist on disk"
    - "package.json no longer declares the yaml dependency; package-lock.json refreshed via npm install"
    - "Operator docs (CHANNELS.md, RUNBOOK.md, ABOUT.md) reference channels.json (JSON syntax) instead of channels.yaml (YAML syntax)"
    - "tsc --noEmit passes; vitest run is green (channels-store.test.ts trims STORE-03 block, full suite stays at prior count minus 4 STORE-03 tests)"
    - "Repository-wide grep for YAML/priority remnants returns 0 hits in src/, docs/CHANNELS.md, docs/RUNBOOK.md, docs/ABOUT.md, Dockerfile, .planning/PROJECT.md, .planning/REQUIREMENTS.md"
  artifacts:
    - path: "src/channels-store.ts"
      provides: "JSON-only channels store; throws on missing channels.json"
      contains: "loadChannels"
    - path: "src/__tests__/channels-store.test.ts"
      provides: "Tests for STORE-01 + STORE-02 only (STORE-03 describe block removed, all priority fixtures stripped)"
    - path: "package.json"
      provides: "Dependency manifest without yaml package"
    - path: "channels.json"
      provides: "Single source of truth for channels (already on disk, untouched)"
  key_links:
    - from: "src/pipeline.ts"
      to: "src/channels-store.ts"
      via: "loadChannels()"
      pattern: "loadChannels\\(\\)"
    - from: "Dockerfile"
      to: "channels.json"
      via: "COPY channels.json ./"
      pattern: "COPY channels\\.json"
---

<objective>
Drop YAML completely from the channels storage layer and remove the unused `priority` field from
schema, fixtures, consumer references, and operator documentation. The post-migration state
(`channels.json` as sole source of truth) is already on disk; this quick task is the cleanup pass
that removes dead-code paths, dead deps, and stale docs.

Purpose: Reduce surface area (one runtime dep less, one fallback branch less, one optional field
less). Eliminates the misleading hint in BOT-01 spec about `priority` and the operator confusion
caused by docs still describing YAML syntax.

Output:
- `src/channels-store.ts` simplified to JSON-only loader with no YAML fallback and no priority field
- Tests trimmed (STORE-03 describe block removed, all priority fixtures stripped) and still green
- `yaml` dependency removed from `package.json`; `package-lock.json` refreshed
- `channels.yaml` and `prod-channels.yaml` deleted from working tree
- Operator docs updated to JSON syntax
- Stale planning-doc mentions of `priority` and `channels.yaml` cleaned up
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@./CLAUDE.md
@src/channels-store.ts
@src/__tests__/channels-store.test.ts
@src/pipeline.ts
@package.json
@docs/CHANNELS.md
@docs/RUNBOOK.md
@docs/ABOUT.md
@Dockerfile
@channels.json

<interfaces>
Current contracts (BEFORE cleanup) — extracted from src/channels-store.ts:

```typescript
export const CHANNELS_PATH = "./channels.json";
const YAML_FALLBACK_PATH  = "./channels.yaml";   // REMOVE
const ChannelEntrySchema = z.object({
  username: z.string().min(1),
  priority: z.number().int().optional(),         // REMOVE
});
const ChannelsFileSchema = z.object({
  channels: z.array(ChannelEntrySchema).min(1),
});
export type ChannelEntry = z.infer<typeof ChannelEntrySchema>;
export function loadChannels(): ChannelEntry[];   // throws if file missing/invalid
export function saveChannels(channels: ChannelEntry[]): Promise<void>;
export function mutate(fn: (current: ChannelEntry[]) => Promise<ChannelEntry[]> | ChannelEntry[]): Promise<void>;
```

Target contracts (AFTER cleanup):

```typescript
export const CHANNELS_PATH = "./channels.json";
const ChannelEntrySchema = z.object({
  username: z.string().min(1),
});
const ChannelsFileSchema = z.object({
  channels: z.array(ChannelEntrySchema).min(1),
});
export type ChannelEntry = z.infer<typeof ChannelEntrySchema>;
export function loadChannels(): ChannelEntry[];   // throws if channels.json missing/invalid (no YAML fallback)
export function saveChannels(channels: ChannelEntry[]): Promise<void>;
export function mutate(fn: (current: ChannelEntry[]) => Promise<ChannelEntry[]> | ChannelEntry[]): Promise<void>;
```

Consumer (src/pipeline.ts) — verify-only, no edit:

```typescript
import { loadChannels, type ChannelEntry } from "./channels-store.js";
const channels: ChannelEntry[] = loadChannels();
// only `username` is read: const { username } = channels[i]!;
```
</interfaces>

<scope_boundaries>
- DO NOT touch `channels.json` (already generated, this is the new source of truth).
- DO NOT touch `docs/strategy.md` (historical strategy notes — out of scope for this cleanup).
- DO NOT rewrite `.planning/ROADMAP.md` Phase 1 description (Phase 1 was historically about migration; the migration is now done — this is post-hoc cleanup, leave the roadmap text intact).
- DO NOT modify `src/pipeline.ts` consumer code (it never read `priority` — verify only).
- DO NOT remove `node_modules/yaml` manually — `npm install` after package.json edit handles it.
</scope_boundaries>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Strip YAML fallback + priority from channels-store and its tests</name>
  <files>src/channels-store.ts, src/__tests__/channels-store.test.ts</files>
  <behavior>
    After this task `vitest run src/__tests__/channels-store.test.ts` must:
    - Have NO `describe("auto-migration YAML→JSON (STORE-03)", ...)` block (4 tests removed)
    - Have NO `writeYaml` helper
    - Have NO `priority` field in any fixture, expectation, or mutate-callback (~10 occurrences)
    - Replace the dropped both-files-missing assertion with a "missing channels.json throws" assertion in the STORE-01 block
    - Keep all STORE-01 (load happy-path + Zod failures) and STORE-02 (atomic write + mutex concurrency) tests green
    - Final test count in this file: ~11 tests (was 15, minus 4 STORE-03; the new "missing channels.json throws" replaces the deleted both-files-missing test, so net change is -4)

    After this task `src/channels-store.ts` must:
    - Have NO `import yaml from "yaml"` line
    - Have NO `YAML_FALLBACK_PATH` constant
    - Have NO `priority` field in `ChannelEntrySchema`
    - `loadChannels()` throws `Error("[channels-store] channels.json not found at <path>")` when the file is missing (no YAML fallback branch)
    - Keep `atomicWriteJson`, `withLock`, `lockChain`, `saveChannels`, `mutate` unchanged in behavior
    - Top-level comment block (lines 1-5) updated to reflect new state
    - Stale doc-comment on `mutate` (line 138 referencing `{ username, priority }`) updated to `{ username }` only
    - If `log.info` call is removed (no migration log), the `log` import becomes unused — also remove it
  </behavior>
  <action>
    STEP A — Edit src/channels-store.ts:
    1. Remove `import yaml from "yaml";` (line 8).
    2. Remove `const YAML_FALLBACK_PATH = "./channels.yaml";` and its D-11 comment (lines 14-15).
    3. Remove the `priority: z.number().int().optional(),` line from `ChannelEntrySchema` (line 20). Schema becomes `z.object({ username: z.string().min(1) })`.
    4. Replace the entire `loadChannels()` function body (lines 40-80) with the JSON-only version below. Keep the JSDoc above but rewrite it to: "Прочитать channels.json и вернуть массив каналов. Throws если файл отсутствует или не проходит Zod-валидацию. D-06: без mutex — POSIX rename(2) гарантирует атомарность."

    ```typescript
    export function loadChannels(): ChannelEntry[] {
      if (!existsSync(CHANNELS_PATH)) {
        throw new Error(
          `[channels-store] channels.json not found at ${CHANNELS_PATH}`
        );
      }
      const raw = readFileSync(CHANNELS_PATH, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `[channels-store] failed to parse ${CHANNELS_PATH}: ${(err as Error).message}`
        );
      }
      const validated: ChannelsFile = ChannelsFileSchema.parse(parsed);
      return validated.channels;
    }
    ```

    5. Update the top-level comment block (lines 1-5). Replace with:

    ```typescript
    // src/channels-store.ts — хранилище списка Telegram-каналов в channels.json.
    // channels.json — единственный источник правды; YAML-фоллбек удалён вместе с auto-migration.
    // STORE-01 / STORE-02: атомарная запись + in-process mutex.
    // API: loadChannels (read, no mutex, throws если файла нет), saveChannels (atomic + mutex), mutate (read-modify-write + mutex).
    // CRUD-обёртки (addChannel/removeChannel) — Phase 2 (D-09, рядом с бот-handler'ами).
    ```

    6. Update the `mutate` JSDoc (line ~138): replace `mutate(channels => [...channels, { username, priority }])` with `mutate(channels => [...channels, { username }])`.

    7. After all edits, check whether `log` is still used: `grep -n "log\." src/channels-store.ts`. If zero matches, also remove `import { log } from "./logger.js";` (line 10).

    STEP B — Edit src/__tests__/channels-store.test.ts:
    1. Delete the entire `describe("auto-migration YAML→JSON (STORE-03)", () => { ... });` block (lines 191-240) AND the section-comment header above it (lines 187-189).
    2. Delete the `writeYaml` helper function (lines 44-54).
    3. Strip `priority` from every fixture and expectation:
       - Line 67: `{ username: "ch1", priority: 1 },` → `{ username: "ch1" },`
       - Line 72: `expect(result[0]).toEqual({ username: "ch1", priority: 1 });` → `expect(result[0]).toEqual({ username: "ch1" });`
       - Lines 91-95 (the "throws при отсутствии username" test) — keep the test but rewrite the bad-fixture so it has neither `username` nor `priority`:
         ```typescript
         it("throws при отсутствии username", () => {
           writeFileSync(
             "./channels.json",
             JSON.stringify({ channels: [{}] }),
             "utf8"
           );
           expect(() => loadChannels()).toThrow();
         });
         ```
       - Line 106: `await saveChannels([{ username: "ch1", priority: 1 }]);` → `await saveChannels([{ username: "ch1" }]);`
       - Line 112: `expect(loadChannels()).toEqual([{ username: "ch1", priority: 1 }]);` → `expect(loadChannels()).toEqual([{ username: "ch1" }]);`
       - Line 123: `writeJson([{ username: "base", priority: 0 }]);` → `writeJson([{ username: "base" }]);`
       - Lines 127-128: drop `, priority: 99` and `, priority: 100` from the two mutate callbacks.
    4. Add a new test inside the `describe("loadChannels (STORE-01)", ...)` block to cover the no-fallback contract:

    ```typescript
    it("throws если channels.json отсутствует — никакого YAML-фоллбека", () => {
      // tmpdir пустой; никакого channels.json (и никакого channels.yaml — он больше не используется).
      expect(() => loadChannels()).toThrow(/channels\.json not found/);
    });
    ```

    5. Update the file-header comment (lines 1-3) to:

    ```typescript
    // src/__tests__/channels-store.test.ts — Vitest для channels-store (Phase 1 STORE-01..02).
    // Покрывает: happy-path load, Zod failures, atomic write, mutex concurrency (Promise.all),
    // missing-file throw (no YAML fallback).
    ```

    STEP C — Verify locally:
    1. `npx tsc --noEmit` must pass with no errors.
    2. `npx vitest run src/__tests__/channels-store.test.ts` — all tests green; expect ~11 tests.
    3. `grep -nE "priority|YAML_FALLBACK_PATH|writeYaml|loadChannelsYaml" src/channels-store.ts src/__tests__/channels-store.test.ts` — must return zero matches. (Use a separate grep for the literal `from "yaml"` since shell-escaping double quotes inside grep alternation is fragile.)
    4. `grep -n 'from "yaml"' src/channels-store.ts` — must return zero matches.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run src/__tests__/channels-store.test.ts</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` clean
    - All tests in `src/__tests__/channels-store.test.ts` green (~11 tests)
    - Zero matches for `priority`, `YAML_FALLBACK_PATH`, `writeYaml`, `loadChannelsYaml`, `from "yaml"` across the two edited files
    - `loadChannels()` throws when `channels.json` is missing (verified by new test)
    - File-header comments reflect new state
  </done>
</task>

<task type="auto">
  <name>Task 2: Remove yaml dependency, delete YAML files, run npm install, verify full suite</name>
  <files>package.json, package-lock.json, channels.yaml, prod-channels.yaml</files>
  <action>
    1. Edit `package.json`:
       - Remove the line `"yaml": "^2.5.0",` from `dependencies` (line 20).
       - Final `dependencies` block must contain exactly: `node-cron`, `openai`, `telegram`, `zod`.
    2. Run `npm install` to refresh `package-lock.json` (drops `yaml` from the lockfile and prunes `node_modules/yaml`). Do NOT manually edit `package-lock.json`.
    3. Delete the YAML files from the working tree:
       - `rm /Users/vladilen/Documents/vscode/tg-parser-demo/channels.yaml`
       - `rm /Users/vladilen/Documents/vscode/tg-parser-demo/prod-channels.yaml`
    4. Run the full test suite: `npx vitest run` — every test in the project must pass (the suite count drops by ~4 due to STORE-03 removal in Task 1).
    5. Run `npx tsc --noEmit` — clean (the project no longer imports anything from `yaml`).
    6. Verify `yaml` is no longer a direct dep: `npm ls yaml` should NOT show `tg-parser-demo@0.1.0 ... └── yaml@2.x.x` as a direct dep. Transitive copies inside other packages are fine; top-level ownership must be gone.
    7. Sanity-check that the store still loads channels.json:
       `node --experimental-vm-modules --import tsx -e "import('./src/channels-store.ts').then(m => console.log(m.loadChannels().length))"`
       must print the channel count (44+ given current channels.json). If `--experimental-vm-modules` is not needed for tsx, drop it; the goal is just to invoke `loadChannels()` once successfully.

    NOTE: do NOT delete `channels.json` — it is the new source of truth and must remain on disk.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run && test ! -f channels.yaml && test ! -f prod-channels.yaml && test -f channels.json</automated>
  </verify>
  <done>
    - `package.json` no longer lists `yaml` under dependencies; only `node-cron`, `openai`, `telegram`, `zod` remain
    - `package-lock.json` refreshed (no top-level `yaml` entry)
    - `channels.yaml` and `prod-channels.yaml` removed from disk
    - `channels.json` still present
    - `npx vitest run` is fully green (whole project)
    - `npx tsc --noEmit` clean
    - `npm ls yaml` shows yaml is no longer a direct dependency
  </done>
</task>

<task type="auto">
  <name>Task 3: Update operator docs, Dockerfile, and planning notes to drop YAML/priority references</name>
  <files>docs/CHANNELS.md, docs/RUNBOOK.md, docs/ABOUT.md, Dockerfile, .planning/PROJECT.md, .planning/REQUIREMENTS.md</files>
  <action>
    Goal: every operator-facing and planning-facing doc must point at `channels.json` (JSON syntax) and never mention `priority`. CHANNELS.md needs a near-complete rewrite of YAML-shaped sections; other docs are surgical replacements.

    STEP A — Rewrite docs/CHANNELS.md (full rewrite of YAML-shaped sections):
    1. Header line 3: `Оперативная инструкция оператора по управлению channels.yaml.` → `Оперативная инструкция оператора по управлению channels.json.`
    2. Replace the "Структура channels.yaml" section (lines 11-22) with:

    ```markdown
    ## Структура channels.json

    ```json
    {
      "channels": [
        { "username": "oil_news_ru" },
        { "username": "bunker_market_ru" },
        { "username": "PLACEHOLDER_38" }
      ]
    }
    ```

    Корневой ключ `channels` — массив объектов с единственным обязательным полем `username` (строка, без префикса `@`). Никаких других полей в схеме нет (поле `priority` удалено как неиспользуемое).
    ```

    3. Section 1 "Добавление нового канала" (lines 24-50): replace `vim channels.yaml` with `vim channels.json` everywhere; replace the YAML insert example (`- username: new_channel_name`) with the JSON insert example: add `{ "username": "new_channel_name" }` to the `channels` array (mind trailing comma on the previous element).
    4. Section 2 "Проверка подписки" (lines 52-61): replace all `channels.yaml` mentions with `channels.json`.
    5. Section 3 "Удаление канала" (lines 65-77): rewrite to JSON terms — "удалить запись (весь объект `{ "username": ... }` из массива `channels`)"; drop the parenthetical "+ опциональную `priority:`" since the field no longer exists. Replace `vim channels.yaml` with `vim channels.json`.
    6. Section 4 "Карантин канала" (lines 80-95): JSON does not support inline comments. Before writing the rewrite, READ `src/channels-store.ts` and confirm `ChannelsFileSchema` does NOT call `.strict()` (current code does not). If it does not call `.strict()`, Zod by default strips unknown keys silently — so a sibling top-level key like `channels_quarantine` is safe. Rewrite quarantine guidance to:

    ```markdown
    Способ карантина без потери записи:
    1. Открыть `channels.json`.
    2. Перенести объект канала из массива `channels` в дополнительный массив `channels_quarantine` в том же файле:
       ```json
       {
         "channels": [
           { "username": "oil_news_ru" }
         ],
         "channels_quarantine": [
           { "username": "noisy_channel_ru" }
         ]
       }
       ```
    3. `pm2 restart tg-parser`. `loadChannels` читает только `channels`; ключ `channels_quarantine` Zod-схемой игнорируется.
    4. Через 7-14 дней либо вернуть запись обратно в `channels`, либо удалить окончательно.
    ```

    If `.strict()` IS present in the schema (it is not, but double-check), instead recommend a sibling file `channels.quarantine.json` outside the schema.

    7. Section 5 "Замена PLACEHOLDER_NN" (lines 98-115): replace YAML edit examples with JSON examples — e.g. `- username: PLACEHOLDER_05` → `{ "username": "PLACEHOLDER_05" }`, `- username: bunker_dispatch_ru` → `{ "username": "bunker_dispatch_ru" }`. Replace `vim channels.yaml` with `vim channels.json` everywhere.
    8. Footer line 117: bump to `*CHANNELS.md — обновлено 2026-05-06: переход на channels.json, удаление поля priority.*`

    STEP B — Surgical edits in docs/RUNBOOK.md:
    - Line 71: `удалить из channels.yaml` → `удалить из channels.json`
    - Line 72: `удалить запись из channels.yaml` → `удалить запись из channels.json`
    - Line 74: `pm2 restart tg-parser после правки channels.yaml.` → `pm2 restart tg-parser после правки channels.json.`

    STEP C — Surgical edits in docs/ABOUT.md (READ FIRST to confirm exact context, especially the YAML code block around lines 110-135):
    - Line 3: `channels.yaml` → `channels.json`
    - Line 14: `[channels.yaml](../channels.yaml)` → `[channels.json](../channels.json)`
    - Line 98: `каналы из [channels.yaml](../channels.yaml)` → `каналы из [channels.json](../channels.json)`
    - Line 110: `## Как правильно заполнять channels.yaml` → `## Как правильно заполнять channels.json`
    - Line 112: `[channels.yaml](../channels.yaml)` → `[channels.json](../channels.json)`
    - Line 135: `Допиши в channels.yaml:` → `Допиши в channels.json:`
    - If a YAML code block sample exists between lines 110-135, convert it to a JSON code block sample (single object `{ "username": "..." }` inside the `channels` array).

    STEP D — Surgical edits in Dockerfile:
    - Lines 18-19 (comment): `channels.yaml — дефолт-список; ... может прокинуть prod-channels.yaml через bind mount` → `channels.json — дефолт-список; ... может прокинуть prod-channels.json через bind mount`
    - Line 23: `COPY channels.yaml ./` → `COPY channels.json ./`

    STEP E — Surgical edits in .planning/PROJECT.md:
    - Line 12 (Constraints, runtime deps line): drop `, yaml` from `Runtime-зависимости ровно три: telegram (GramJS), openai (DeepSeek через OpenAI-совместимый SDK), yaml.`. Note the file may now list 4 deps (telegram, openai, node-cron, zod) — update accordingly to reflect actual package.json after Task 2.
    - Line 17: `Миграция channels.yaml → channels.json с программным CRUD` → `Хранение каналов в channels.json с программным CRUD (миграция с YAML завершена)`
    - Line 28: `Конфиг каналов и окружения: channels.yaml + .env.example` → `Конфиг каналов и окружения: channels.json + .env.example`
    - Line 48 (SCALE-01..02): `channels.yaml 50 каналов` → `channels.json 44+ каналов`
    - Line 59: `Миграция channels.yaml → channels.json; pipeline читает каналы из JSON` → `Хранение каналов в channels.json (миграция с YAML завершена); pipeline читает каналы из JSON`
    - Line 90: `обязан быть подписан на каждый канал из channels.yaml` → `обязан быть подписан на каждый канал из channels.json`

    STEP F — Surgical edits in .planning/REQUIREMENTS.md:
    - Line 13 (BOT-01): `(username + priority)` → `(username)` — drop priority from the description.
    - Line 21 (STORE-01): `channels.yaml мигрирован в channels.json; pipeline читает каналы из JSON` → `Каналы хранятся в channels.json; pipeline читает каналы из JSON (миграция с YAML завершена и YAML удалён)`.
    - Line 23 (STORE-03): mark obsolete: `~~Auto-migration при старте daemon~~ — OBSOLETE: миграция выполнена post-hoc, YAML-фоллбек удалён в quick-260506-dht.`

    STEP G — Verification gates (run from repo root):
    1. YAML grep gate (must be empty):
       `grep -rn "channels.yaml" src/ docs/CHANNELS.md docs/RUNBOOK.md docs/ABOUT.md Dockerfile .planning/PROJECT.md .planning/REQUIREMENTS.md`
    2. yaml-import grep gate (must be empty in src/):
       `grep -rn 'from "yaml"' src/`
    3. YAML_FALLBACK / loadChannelsYaml grep gate (must be empty in src/):
       `grep -rn "YAML_FALLBACK_PATH\|loadChannelsYaml" src/`
    4. priority grep gate (must be empty in src/):
       `grep -rn "priority" src/`

    NOTE: `docs/strategy.md` is intentionally OUT of scope per scope_boundaries — historical strategy notes remain as-is.
  </action>
  <verify>
    <automated>bash -c 'set -e; ! grep -rn "channels.yaml" src/ docs/CHANNELS.md docs/RUNBOOK.md docs/ABOUT.md Dockerfile .planning/PROJECT.md .planning/REQUIREMENTS.md && ! grep -rn "priority" src/ && ! grep -rn "YAML_FALLBACK_PATH" src/'</automated>
  </verify>
  <done>
    - All 6 doc/config files updated: CHANNELS.md, RUNBOOK.md, ABOUT.md, Dockerfile, .planning/PROJECT.md, .planning/REQUIREMENTS.md
    - YAML grep gate returns 0 hits across the 6 files + src/
    - priority grep gate returns 0 hits across src/
    - CHANNELS.md uses JSON code blocks throughout; quarantine workflow rewritten for JSON
    - REQUIREMENTS.md BOT-01 no longer mentions priority; STORE-03 marked obsolete
    - PROJECT.md runtime-deps line reflects actual current deps (no yaml)
  </done>
</task>

</tasks>

<verification>
After all 3 tasks complete, run the following gates from repo root:

1. **Type-check:** `npx tsc --noEmit` — must be clean.
2. **Full test suite:** `npx vitest run` — every test green; channels-store.test.ts has ~11 tests; full suite count is `(prior count) - 4`.
3. **Repository-wide YAML grep:** `grep -rn "channels.yaml\|YAML_FALLBACK_PATH\|loadChannelsYaml" src/ docs/CHANNELS.md docs/RUNBOOK.md docs/ABOUT.md Dockerfile .planning/PROJECT.md .planning/REQUIREMENTS.md` — must be empty.
4. **yaml import grep:** `grep -rn 'from "yaml"' src/` — must be empty.
5. **priority grep in src/:** `grep -rn "priority" src/` — must be empty.
6. **YAML files gone:** `ls channels.yaml prod-channels.yaml 2>&1 | grep -c "No such file"` — must equal `2`.
7. **channels.json present:** `test -f channels.json && echo OK` — must print `OK`.
8. **yaml not a direct dep:** `npm ls yaml` — must NOT show `tg-parser-demo` as the direct parent of `yaml`.
9. **Smoke runtime check:** `node --import tsx -e "import('./src/channels-store.ts').then(m => console.log('channels:', m.loadChannels().length))"` — must print a positive count (44+).
</verification>

<success_criteria>
- `loadChannels()` source contains no YAML fallback branch and no `import yaml` line
- `ChannelEntrySchema` accepts only `{ username }`; the schema and all test fixtures are priority-free
- `package.json` dependencies = exactly `node-cron`, `openai`, `telegram`, `zod`; lockfile refreshed
- `channels.yaml` and `prod-channels.yaml` removed from working tree; `channels.json` retained
- All 6 documentation/config files updated to reflect JSON-only state
- All verification gates above return their expected results (0 hits / clean / green)
</success_criteria>

<output>
After completion, create `.planning/quick/260506-dht-drop-yaml-completely-remove-priority-fie/260506-dht-SUMMARY.md` covering:
- What was removed (YAML fallback, priority field, yaml dep, 2 YAML files)
- What was rewritten (CHANNELS.md sections 1-5, quarantine flow)
- What was surgically updated (RUNBOOK lines 71-74, ABOUT lines 3/14/98/110/112/135, Dockerfile lines 18-19/23, PROJECT.md lines 12/17/28/48/59/90, REQUIREMENTS.md lines 13/21/23)
- Test count delta (channels-store.test.ts: 15 → 11; full suite: -4)
- Note: ROADMAP.md Phase 1 description was intentionally NOT rewritten — Phase 1 historically described migration; this quick task is post-hoc cleanup, the historical context is preserved
- Note: `docs/strategy.md` was intentionally NOT touched — historical strategy notes
</output>
