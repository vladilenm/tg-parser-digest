---
phase: quick-260506-dht
plan: 260506-dht
subsystem: storage
tags: [cleanup, channels-store, yaml-removal, priority-removal, deps-pruning, docs]
requires:
  - channels-store.ts (existing, JSON+YAML fallback at quick-260506-dht start)
  - channels.json on disk (already populated, sole source of truth post-migration)
provides:
  - JSON-only loadChannels() that throws if channels.json absent
  - ChannelEntrySchema accepting only { username }
  - 4 runtime deps in package.json (yaml removed)
  - operator docs aligned with channels.json (no YAML mentions)
affects:
  - src/channels-store.ts (loader simplified, ~80 LOC -> ~75 LOC after removing migration branch)
  - src/__tests__/channels-store.test.ts (15 tests -> 12 tests, STORE-03 block removed, priority stripped)
  - src/telegram.ts (1-line comment update)
  - package.json + package-lock.json (yaml dependency dropped)
  - channels.yaml + prod-channels.yaml (deleted)
  - docs/CHANNELS.md, docs/RUNBOOK.md, docs/ABOUT.md (operator-facing rewrites)
  - Dockerfile (COPY channels.json instead of channels.yaml)
  - .planning/PROJECT.md, .planning/REQUIREMENTS.md (planning notes refreshed)
tech-stack:
  added: []
  removed: [yaml ^2.5.0]
  patterns:
    - "channels_quarantine sibling-array pattern for JSON quarantine workflow (Zod default-strip behavior, no .strict())"
key-files:
  created: []
  modified:
    - src/channels-store.ts
    - src/__tests__/channels-store.test.ts
    - src/telegram.ts
    - package.json
    - package-lock.json
    - docs/CHANNELS.md
    - docs/RUNBOOK.md
    - docs/ABOUT.md
    - Dockerfile
    - .planning/PROJECT.md
    - .planning/REQUIREMENTS.md
  deleted:
    - channels.yaml
    - prod-channels.yaml
decisions:
  - "Quarantine workflow uses channels_quarantine sibling-array (Zod schema без .strict() — unknown keys silently stripped, безопасно)"
  - "src/telegram.ts comment had stale channels.yaml mention — fixed inline as part of Task 3 grep-gate cleanup (Rule 1 / scope-aligned)"
  - "src/__tests__/channels-store.test.ts comment in new missing-file test had channels.yaml literal — rewritten to reference quick-260506-dht context, keeping grep gate at 0 hits"
metrics:
  duration: "8m 17s"
  completed: "2026-05-06T07:00:36Z"
  tasks_completed: 3
  files_changed: 12 (10 modified + 2 deleted; channels.json untouched)
  lines_delta: "+102 / -387 (3 commits combined)"
  test_count: "channels-store: 15 -> 12 (-3); full suite: 41 -> 38 (-3)"
---

# Phase quick-260506-dht: Drop YAML Completely + Remove priority Field Summary

**One-liner:** Удалён YAML-фоллбек из channels-store и поле `priority` из схемы; зависимость `yaml` снята с package.json; 6 операторских/планинг-документов переведены на JSON.

## What Was Done

### Removed (dead code / dead deps / dead docs)

- **YAML fallback branch** в `loadChannels()` — `~40 LOC` миграционной логики `channels.yaml → channels.json` исчезли вместе с `import yaml`, `YAML_FALLBACK_PATH`, `log.info(...)` и неиспользуемым `import { log }`.
- **Поле `priority`** из `ChannelEntrySchema` — схема теперь `z.object({ username: z.string().min(1) })`.
- **STORE-03 describe-block** в `channels-store.test.ts` (4 теста auto-migration) и хелпер `writeYaml`.
- **Все `priority: N` фикстуры** в тестах (~10 occurrences).
- **`yaml ^2.5.0`** из `package.json` dependencies (теперь только 4: `node-cron`, `openai`, `telegram`, `zod`).
- **`channels.yaml`** и **`prod-channels.yaml`** с диска.

### Rewritten (CHANNELS.md, ABOUT.md sample blocks, REQUIREMENTS.md notes)

- **`docs/CHANNELS.md`**: полный rewrite секций 1-5 — заменены все YAML-фрагменты на JSON, `vim channels.yaml` → `vim channels.json`. Карантин (секция 4) переписан для JSON: `channels_quarantine` sibling-key (валидно, потому что Zod-схема без `.strict()` молча игнорирует unknown keys). Footer обновлён.
- **`docs/ABOUT.md`**: section "Как правильно заполнять `channels.yaml`" → `channels.json`; YAML-пример `priority: 1` → JSON-пример `{ "username": "..." }`; правило #4 переформулировано про удаление `priority`; пример "Как добавить свой канал" сконвертирован в JSON-синтаксис.
- **`.planning/REQUIREMENTS.md`**: BOT-01 описание `(username + priority)` → `(username)`; STORE-01 теперь говорит "хранятся в channels.json (миграция с YAML завершена и YAML удалён)"; STORE-03 помечен `~~obsolete~~` со ссылкой на quick-260506-dht.

### Surgically updated (1-2 line replacements)

- **`docs/RUNBOOK.md`** L71-74: 4 mentions `channels.yaml` → `channels.json`.
- **`Dockerfile`** L18-19, L23: comment + `COPY channels.yaml` → `COPY channels.json`; bind-mount comment про `prod-channels.yaml` → `prod-channels.json`.
- **`.planning/PROJECT.md`** L12: runtime-deps line с 5 (`telegram, openai, yaml, node-cron, zod`) на 4 (`telegram, openai, node-cron, zod`) + явное упоминание удаления YAML в quick-260506-dht. L17, L28, L48, L59, L90: `channels.yaml` → `channels.json` + переформулировка "Миграция YAML→JSON" → "хранение в JSON (миграция завершена)".
- **`src/telegram.ts`** L2: comment-only fix (stale `channels.yaml` mention) — обнаружено и устранено grep-гейтом Task 3 STEP G.
- **`src/__tests__/channels-store.test.ts`** L88: comment в новом missing-file тесте переписан без литерала `channels.yaml`.

## Test Count Delta

| Scope | Before | After | Delta |
|---|---|---|---|
| `channels-store.test.ts` | 15 | 12 | -3 |
| Full suite (`vitest run`) | 41 | 38 | -3 |

Plan ожидал ~11 тестов в `channels-store.test.ts` ("net -4"), но фактический финальный count = 12. Расхождение: STORE-01 раньше включал тест "throws при отсутствии username" (5 тестов в STORE-01); этот тест сохранён (с переписанной фикстурой `[{}]` вместо `[{ priority: 1 }]`), плюс добавлен новый "throws если channels.json отсутствует" — итого STORE-01 вырос с 5 до 6 тестов. STORE-02 не изменился (6 тестов). 6 + 6 = 12. Это соответствует тильда-формулировке "~11" в плане и не нарушает success criteria.

## Verification Gates (final, post-Task-3)

| # | Gate | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` | clean |
| 2 | `npx vitest run` | 38 passed (2 files) |
| 3 | `grep "channels.yaml\|YAML_FALLBACK_PATH\|loadChannelsYaml"` в 7 scoped paths | 0 hits |
| 4 | `grep 'from "yaml"'` в src/ | 0 hits |
| 5 | `grep "priority"` в src/ | 0 hits |
| 6 | `ls channels.yaml prod-channels.yaml` | both `No such file` |
| 7 | `test -f channels.json` | OK |
| 8 | `npm ls yaml` | only transitive (`vitest > vite > yaml@2.8.3`) — top-level ownership gone |
| 9 | smoke: `loadChannels().length` | `45` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale `channels.yaml` mention in src/telegram.ts:2**
- **Found during:** Task 3 STEP G (verification-grep gate)
- **Issue:** Comment line `// Идентичность клиента ... НЕ в channels.yaml.` не был перечислен в плане, но нарушал grep-гейт (`grep -rn "channels.yaml" src/` returned 1 hit).
- **Fix:** Заменено `channels.yaml` → `channels.json` в comment.
- **Files modified:** `src/telegram.ts`
- **Commit:** `901b897` (вместе с Task 3)

**2. [Rule 1 - Bug] Stale `channels.yaml` mention in test comment**
- **Found during:** Task 3 STEP G (verification-grep gate)
- **Issue:** Новый тест `"throws если channels.json отсутствует"` (Task 1) содержал в comment'е `(и никакого channels.yaml — он больше не используется)` — литерал нарушал scoped grep.
- **Fix:** Переписано на `— фоллбек был удалён в quick-260506-dht`.
- **Files modified:** `src/__tests__/channels-store.test.ts`
- **Commit:** `901b897` (вместе с Task 3)

### Worktree-environment Adjustments (not deviations from plan, but session bookkeeping)

- **Branch base mismatch**: На старте merge-base HEAD vs `0d3fe1b` дал `20214a3` — worktree оказался на divergent branch с устаревшей историей (без `src/channels-store.ts`). Сделан `git reset --hard 0d3fe1b...` для синхронизации с актуальным main. Перед reset — clean working tree, 0 work to preserve.
- **`channels.json` отсутствовал в worktree** (untracked в main repo): скопирован из `/Users/vladilen/Documents/vscode/tg-parser-demo/channels.json` для smoke-теста loadChannels.
- **`node_modules` отсутствовал**: первичная попытка `npm install` упала с EACCES на `~/.npm/_cacache/`; обход — `npm install --cache /tmp/npm-cache-dht`. Фактический эффект Task 2 (yaml удалён из package-lock + node_modules/yaml как top-level отсутствует) достигнут.
- **`.planning/quick/260506-dht-drop-yaml-completely-remove-priority-fie/`** не существовала в worktree (директория создана в main repo до спавна агента) — сделан `mkdir -p` и скопирован PLAN.md, чтобы записать SUMMARY.md рядом.

## Out of Scope (per plan `<scope_boundaries>`)

- `docs/strategy.md` оставлен нетронутым (исторические notes; всё ещё содержит 2 mention `channels.yaml`).
- `.planning/ROADMAP.md` Phase 1 description не переписан — Phase 1 исторически = миграция; quick-260506-dht — post-hoc cleanup.
- `src/pipeline.ts` не модифицирован — потребитель `loadChannels()` использует только `username` (verified, no `priority` access).
- `node_modules/yaml` не удалён руками — `npm install` после правки package.json сделал это сам.
- `channels.json` не модифицирован — single source of truth, существует на диске, неприкосновенен.

## Self-Check: PASSED

**Files created:**
- `MISSING` — no new files were created (this plan was pure cleanup; SUMMARY.md is the only new artifact)

**Files modified (verified on disk):**
- FOUND: `src/channels-store.ts`
- FOUND: `src/__tests__/channels-store.test.ts`
- FOUND: `src/telegram.ts`
- FOUND: `package.json`
- FOUND: `package-lock.json`
- FOUND: `docs/CHANNELS.md`
- FOUND: `docs/RUNBOOK.md`
- FOUND: `docs/ABOUT.md`
- FOUND: `Dockerfile`
- FOUND: `.planning/PROJECT.md`
- FOUND: `.planning/REQUIREMENTS.md`

**Files deleted (verified absent):**
- ABSENT: `channels.yaml`
- ABSENT: `prod-channels.yaml`

**Commits (verified in git log):**
- FOUND: `71dd3ed` — feat(quick-260506-dht): remove YAML fallback and priority field from channels-store
- FOUND: `032cdf7` — chore(quick-260506-dht): drop yaml dependency and delete YAML files
- FOUND: `901b897` — docs(quick-260506-dht): update operator docs and planning to reflect JSON-only storage

## Known Stubs

None — this is a pure-cleanup plan; no stubs introduced or remaining.
