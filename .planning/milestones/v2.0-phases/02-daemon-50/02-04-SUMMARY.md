---
phase: 02-daemon-50
plan: 04
subsystem: telegram
tags: [typescript, esm, gramjs, reconnect, retry, reliability, flood-wait, exp-backoff]

# Dependency graph
requires:
  - plan: 02-01
    provides: "src/pipeline.ts per-channel try/catch ловит throw из fetchLast24h и пишет в RunSummary.errors[]"
  - plan: 02-02
    provides: "src/logger.ts — log.warn для строк 'reconnect attempt N/3 …' и 'FloodWait on …'"
  - "Phase 01 MVP: src/telegram.ts fetchLast24h (FloodWait ветка + ChannelPrivate skip), createClient, sleep"
provides:
  - "src/telegram.ts: fetchLast24h с reconnect retry — до 3 попыток exp backoff 1000/2000/4000мс (RELI-01)"
  - "Проброс `Error('network disconnect after 3 attempts')` наверх — pipeline ловит в per-channel try/catch (RELI-02)"
  - "Два независимых счётчика: floodRetried (bool) и reconnectAttempts (number 0..3) — не суммируются, не взаимоблокируются (RELI-03)"
affects: [02-05-daemon, 02-06-pm2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Два параллельных счётчика retry в одном while-loop: FloodWait-ветка и reconnect-ветка — разные if-блоки, каждый читает/пишет только свой счётчик"
    - "Network-error detection по message-substring (GramJS не экспортирует ConnectionError-класс): 'Not connected' | 'Disconnect' | 'TIMEOUT' | 'no data received' + client.connected === false fallback"
    - "await client.connect() обёрнут в try/catch — ошибка connect() игнорируется, следующая итерация внешнего loop снова зовёт tryFetch()"
    - "Exp backoff константой-массивом `RECONNECT_BACKOFF = [1000, 2000, 4000]` — детерминированно и читаемо; jitter намеренно не добавлялся (в отличие от jitter между каналами в pipeline.ts) — сетевая природа ошибки, не FloodWait"
    - "После исчерпания reconnect: throw new Error(...) с username в тексте — per-channel try/catch в pipeline.ts получает читаемую диагностику"

key-files:
  created: []
  modified:
    - "src/telegram.ts"

key-decisions:
  - "GramJS не экспортирует `ConnectionError` класс — детекция сетевых ошибок ТОЛЬКО через `err.message.includes(...)` + `client.connected === false` (research §6). Никакого `err instanceof ConnectionError`."
  - "Два независимых счётчика вместо общего `totalAttempts`: RELI-03 жёстко требует, чтобы 1 FloodWait + 3 reconnect = 4 итерации внешнего loop, а не 3 (общий max)"
  - "Без jitter в reconnect-ветке: backoff фиксированный 1/2/4 сек, т.к. это ответ на сетевой обрыв, не на антифлуд"
  - "`await client.connect()` обёрнут в `try { … } catch {}` — если connect падает, следующая итерация всё равно позовёт `tryFetch()`; это упрощает состояние (нет нужды откатывать reconnectAttempts++)"
  - "Сохранён FloodWait-retry через переименованный `floodRetried` (bool) — RELI-03 требует именно bool для FloodWait, не превращаем его в счётчик"

patterns-established:
  - "Для новых retry-веток в этом файле использовать тот же паттерн: отдельный счётчик + отдельный if-блок в общем catch; не объединять через ||"
  - "Строка `reconnect attempt N/3 for USERNAME, waiting Xms` — канонический формат для любого будущего reconnect-лога (референс для Success Criterion 4 ROADMAP)"

requirements-completed: [RELI-01, RELI-02, RELI-03]

# Metrics
duration: ~2min
completed: 2026-04-22
---

# Phase 02 Plan 04: GramJS reconnect retry в fetchLast24h Summary

**Добавлена reconnect-ветка в `fetchLast24h` (src/telegram.ts): до 3 попыток exp. backoff 1000/2000/4000мс с `await client.connect()` между попытками, независимая от FloodWait-retry; после исчерпания throw пробрасывается наверх и ловится per-channel try/catch в pipeline.ts.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-22T07:37:13Z
- **Completed:** 2026-04-22T07:38:56Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `fetchLast24h` получил reconnect-ветку: до 3 попыток с `RECONNECT_BACKOFF = [1000, 2000, 4000]` мс; между попытками `await client.connect()` (ошибка connect игнорируется, следующая итерация снова попробует `tryFetch`).
- Детекция сетевых ошибок через helper `isNetworkError(err)`: 4 message-substring + fallback `(client as ...).connected === false`.
- Старый boolean `retried` переименован в `floodRetried` — FloodWait-ветка работает ровно как раньше (один retry по `err.seconds*1000 + 2000`).
- Введён счётчик `reconnectAttempts: number = 0` — НЕ объединяется с `floodRetried` ни в одной строке; FloodWait-ветка не читает `reconnectAttempts` и наоборот. Трассировка сценария «1 FloodWait + 3 reconnect» даёт 4 итерации внешнего loop (RELI-03 гарантия).
- После исчерпания 3 reconnect-попыток: `throw new Error("${username}: network disconnect after 3 attempts (${errorMessage})")` — pipeline.ts ловит в per-channel try/catch, пишет в `RunSummary.errors[]`, прогон продолжается со следующим каналом.
- Публичная подпись `fetchLast24h(client, username, opts)` не изменена — `src/pipeline.ts` и `src/run.ts` не тронуты.
- `ChannelPrivateError` / `UsernameNotOccupiedError` / `UsernameInvalidError` ветка сохранена без изменений — warn + пустой массив, без retry.
- `npx tsc --noEmit` проходит с 0 ошибок.

## Task Commits

1. **Task 1: Добавить reconnect retry в fetchLast24h** — `434331d` (feat)

**Plan metadata commit:** добавляется финальным коммитом после обновления STATE.md/ROADMAP.md.

## Files Created/Modified

- `src/telegram.ts` (modified) — обновлён блок внешнего while-loop в `fetchLast24h` (строки 103-187). Добавлены: `const MAX_RECONNECT = 3`, `const RECONNECT_BACKOFF = [1000, 2000, 4000]`, локальная функция `isNetworkError`, `let reconnectAttempts = 0`, if-ветка `if (isNetworkError(err)) { … }` с логом `reconnect attempt N/3 for USERNAME, waiting Xms` и `await client.connect()` в try/catch. Удалён `let retried = false`, переименован в `let floodRetried = false`. Всё остальное (импорты, CLIENT_IDENTITY, createClient, sleep, randomInt, tryFetch, ChannelPrivate-ветка, FloodWait-ветка, публичная подпись) — без изменений.

## Branching Diagram (ветвление внутри catch)

```
catch (err)
  │
  ├── name === "ChannelPrivate..." / "UsernameNotOccupied..." / "UsernameInvalid..."
  │     OR errorMessage.includes("CHANNEL_PRIVATE" | "USERNAME_NOT_OCCUPIED" | "USERNAME_INVALID")
  │     → console.warn + return []                            (FETCH-05)
  │
  ├── err instanceof FloodWaitError || name === "FloodWaitError"
  │     ├── floodRetried === true  → console.error + throw err
  │     └── floodRetried === false → sleep(seconds*1000+2000)
  │                                  floodRetried = true
  │                                  continue                  (FETCH-04 / RELI-03)
  │
  ├── isNetworkError(err)  // "Not connected" | "Disconnect" | "TIMEOUT"
  │                         // | "no data received" | client.connected===false
  │     ├── reconnectAttempts >= MAX_RECONNECT(3) → throw Error("... after 3 attempts")  (RELI-02)
  │     └── reconnectAttempts < MAX_RECONNECT
  │           → console.warn("reconnect attempt N/3 for USERNAME, waiting Xms")
  │             sleep(RECONNECT_BACKOFF[reconnectAttempts])
  │             try { await client.connect() } catch {}
  │             reconnectAttempts++
  │             continue                                       (RELI-01)
  │
  └── (прочие ошибки) → throw err                              (поймает pipeline)
```

**RELI-03 гарантия**: FloodWait-ветка читает/пишет **только** `floodRetried`; reconnect-ветка читает/пишет **только** `reconnectAttempts`. Сценарий «1 FloodWait + 3 reconnect»:

1. FloodWaitError → `floodRetried = true`, `reconnectAttempts = 0` → sleep → continue. (итерация 1)
2. "Not connected" → `reconnectAttempts 0→1`, sleep 1000мс, connect → continue. (итерация 2)
3. "Not connected" → `reconnectAttempts 1→2`, sleep 2000мс, connect → continue. (итерация 3)
4. "Not connected" → `reconnectAttempts 2→3`, sleep 4000мс, connect → continue. (итерация 4)
5. "Not connected" → `reconnectAttempts >= 3` → throw. (итерация 5, но без retry-действия — сразу выход)

Итого: 4 retry-итерации (1 FloodWait + 3 reconnect), как требует RELI-03.

## Decisions Made

- **Детекция через `err.message.includes(...)` вместо `instanceof`**: GramJS не экспортирует `ConnectionError` класс (research §6 — подтверждено анализом `telegram/errors/index.js`). Fallback `(client as unknown as { connected?: boolean }).connected === false` покрывает случай, когда ошибка пришла с нетипичным текстом, но клиент явно дисконнектнут.
- **Два bool/number вместо общего `totalAttempts`**: `floodRetried` (bool) + `reconnectAttempts` (number 0..3) — каждая ветка читает/пишет только свой счётчик. Общий `totalAttempts` нарушил бы RELI-03 (ограничил бы «1 FloodWait + 3 reconnect» до суммы ≤3).
- **Backoff без jitter**: сетевой обрыв не требует рандомизации (в отличие от anti-flood jitter между каналами в pipeline.ts). Фиксированный `[1000, 2000, 4000]` мс — читаемо и детерминированно.
- **`await client.connect()` в `try/catch`**: если сам connect падает (редко, но возможно при глубоком network issue), мы не делаем ничего особенного — просто идём в следующую итерацию `while`, где `tryFetch()` снова попытается и снова попадёт либо в reconnect-ветку, либо в throw после исчерпания счётчика. Это упрощает state management: нет нужды откатывать `reconnectAttempts++`.
- **Формат лога `reconnect attempt N/3 for USERNAME, waiting Xms`**: жёстко зафиксирован планом как референс для Success Criterion 4 в ROADMAP. Будущий plan 02-07 (README / smoke-тест) на него ссылается.
- **Сообщение ошибки `"${username}: network disconnect after 3 attempts (${errorMessage})"`**: включает username для читаемой записи в `RunSummary.errors[]` (LOG-02/03) и оригинальный `errorMessage` — чтобы в логе были видны и тип сетевой ошибки, и канал.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Разбиение двух JSDoc-комментариев на отдельные строки**

- **Found during:** Task 1 (verification — acceptance criterion "RELI-03 structural independence")
- **Issue:** План верботимно предписывал код с двумя однострочными комментариями:
  - `// Ветка использует ТОЛЬКО floodRetried; reconnectAttempts не читается и не инкрементируется здесь.`
  - `// Ветка использует ТОЛЬКО reconnectAttempts; floodRetried не читается и не инкрементируется здесь.`

  При этом тот же план в acceptance-criteria требует `! grep -qE "floodRetried.*reconnectAttempts|reconnectAttempts.*floodRetried" src/telegram.ts` exit 0 — negative-grep по любой строке, где оба идентификатора встречаются вместе. Комментарии verbatim-кода попадали под этот grep и ломали acceptance-check.
- **Fix:** Разбил оба комментария на две строки — `floodRetried` остаётся в одной строке, упоминание «второго счётчика» (без имени переменной) — в следующей. Семантика комментариев идентична:
  - `// Ветка использует ТОЛЬКО floodRetried;`
  - `// второй счётчик (сетевой) не читается и не инкрементируется здесь.`
  - `// Ветка использует ТОЛЬКО reconnectAttempts;`
  - `// другой счётчик (FloodWait-retry) не читается и не инкрементируется здесь.`
- **Files modified:** src/telegram.ts
- **Verification:** `! grep -qE "floodRetried.*reconnectAttempts|reconnectAttempts.*floodRetried" src/telegram.ts` → exits 0 (PASS). `npx tsc --noEmit` → exits 0. Структурная независимость двух счётчиков **не затронута** — изменилось только разбиение на строки комментариев, сам код if-веток не менялся.
- **Committed in:** `434331d` (в составе первичного Write). Отдельного коммита не потребовалось.

---

**Total deviations:** 1 auto-fixed (1 blocking, косметическая).
**Impact on plan:** нулевой — функциональная семантика идентична verbatim-коду плана; изменена лишь раскладка комментариев, чтобы verify-grep мог отличить «два счётчика в одной ветке кода» (недопустимо по RELI-03) от «два счётчика, упомянутые в одном комментарии» (разрешено, т.к. это документация). План 02-01 использовал аналогичное решение с `process.exit` в комментарии — паттерн «переформулировать комментарий под negative-grep» уже установлен на Wave 1.

## Issues Encountered

None beyond the single auto-fixed blocking deviation above. Верботимный код плана применился cleanly через одну Edit-операцию; все 16 acceptance-grep прошли после косметической правки двух комментариев; tsc чист; публичная подпись не изменилась; `src/pipeline.ts` и `src/run.ts` не тронуты (`git diff --stat HEAD~1 HEAD -- src/run.ts src/pipeline.ts` пусто).

## Threat Flags

Нет. Plan 04 не вводит новых внешних поверхностей:
- Reconnect работает с уже существующим GramJS-client (создаётся в `runPipeline`), никаких новых endpoint'ов/auth paths/файловых доступов не появляется.
- `await client.connect()` использует уже заведённую StringSession (`TG_SESSION` из `.env`) — тот же trust boundary, что и в Phase 01.
- Exception message `"${username}: network disconnect after 3 attempts (${errorMessage})"` включает username канала (публичный, уже в `channels.yaml`) и текст сетевой ошибки (GramJS-контролируемый) — PII/secrets нет.

## Known Stubs

Нет. Все новые блоки кода функциональны и покрывают все three заявленных требования:
- RELI-01: reconnect-ветка с 3 попытками exp backoff реализована полностью.
- RELI-02: throw после исчерпания — pipeline ловит в уже существующем per-channel try/catch (plan 02-01).
- RELI-03: два независимых счётчика подтверждены структурным negative-grep + трассировкой сценария.

Никаких `TODO`, `FIXME`, placeholder-значений или hardcoded empty-состояний, flow-ящих в UI/логи, в diff нет.

## Verification Output

**Automated checks** (все из verify/acceptance-блоков Task 1 и plan-level verification прошли):

- `grep -q "reconnect attempt \${reconnectAttempts + 1}/\${MAX_RECONNECT} for \${username}, waiting \${delay}ms" src/telegram.ts` ✓
- `grep -q "const RECONNECT_BACKOFF = \[1000, 2000, 4000\]" src/telegram.ts` ✓
- `grep -q "const MAX_RECONNECT = 3" src/telegram.ts` ✓
- `grep -q "let floodRetried = false" src/telegram.ts` ✓
- `grep -q "let reconnectAttempts = 0" src/telegram.ts` ✓
- `grep -q "isNetworkError" src/telegram.ts` ✓
- `grep -q 'msg.includes("Not connected")' src/telegram.ts` ✓
- `grep -q 'msg.includes("Disconnect")' src/telegram.ts` ✓
- `grep -q 'msg.includes("TIMEOUT")' src/telegram.ts` ✓
- `grep -q 'msg.includes("no data received")' src/telegram.ts` ✓
- `grep -q "await client.connect()" src/telegram.ts` ✓
- `grep -q "network disconnect after" src/telegram.ts` ✓
- `grep -q "export async function fetchLast24h" src/telegram.ts` ✓ (подпись сохранена)
- `! grep -q "^  let retried = false;" src/telegram.ts` ✓ (старый retried удалён)
- `! grep -qE "floodRetried.*reconnectAttempts|reconnectAttempts.*floodRetried" src/telegram.ts` ✓ (RELI-03 structural)
- `grep -c "if (err instanceof FloodWaitError" src/telegram.ts` = 1 ✓ (FloodWait-ветка — отдельный if)
- `grep -c "if (isNetworkError(err))" src/telegram.ts` = 1 ✓ (reconnect-ветка — отдельный if)
- `npx tsc --noEmit` → 0 ошибок ✓

**Manual check — сценарии (словесная трассировка):**

1. **«1 FloodWait + 3 reconnect = 4 итерации»** (RELI-03 core): trace выше в Branching Diagram. Ни один if-блок не читает счётчик другой ветки.
2. **«Чистый reconnect»**: `floodRetried = false` всю дорогу; 3 попытки отрабатывают независимо; на 4-й throw.
3. **«Чистый FloodWait»**: `reconnectAttempts = 0` всю дорогу; 1 retry; на втором FloodWait — throw (без изменений от Phase 01).
4. **«ChannelPrivate»**: первая же итерация попадает в FETCH-05 ветку → `return []` без retry.
5. **«Неизвестная ошибка»**: ни один из 3 типов не сработал → `throw err` в конце catch → pipeline поймает.

## User Setup Required

None — никаких новых env vars, сервисов или внешних зависимостей не добавлено. `client.connect()` — метод уже-созданного `TelegramClient` из phase 01 `createClient()`.

## Next Phase Readiness

- **Ready for plan 02-05 (daemon entrypoint):** `fetchLast24h` теперь устойчив к сетевым сбоям, daemon-tick может полагаться на то, что `runPipeline()` завершится (либо с частичным успехом + errors[], либо cleanly) даже при обрыве TCP на одном из 50 каналов. Сценарий «дом просыпается через сутки, соединение зависло → reconnect отработал → прогон продолжается» — покрыт.
- **Ready for plan 02-06 (PM2 ecosystem):** PM2-рестарт не нужен при сетевом сбое одного канала; весь retry-handling локальный в fetchLast24h. PM2 берёт только fatal-падения процесса.
- **Ready for plan 02-07 (README smoke):** лог-строка `reconnect attempt N/3 for USERNAME, waiting Xms` — именно тот формат, который проверяется Success Criterion 4 в ROADMAP; README может ссылаться на неё как на ожидаемый вывод при временном обрыве сети.
- **No blockers for remaining wave 2 plans:** plan 02-05 / 02-06 / 02-07 не зависят структурно от plan 02-04 (зависимости только логические: daemon работает лучше с reconnect, но не требует его для функционального старта).

## Self-Check: PASSED

- **FOUND:** `src/telegram.ts` — модифицирован (строки 103-187 содержат новый блок reconnect)
- **FOUND:** commit `434331d` (Task 1: feat(02-04): add reconnect retry) — `git log --oneline -5` подтверждает
- **FOUND:** `.planning/phases/02-daemon-50/02-04-SUMMARY.md` (this file)
- **CONFIRMED:** `npx tsc --noEmit` exits 0
- **CONFIRMED:** `git diff --stat HEAD~1 HEAD -- src/run.ts src/pipeline.ts` пусто — ни run.ts, ни pipeline.ts не тронуты
- **CONFIRMED:** публичная подпись `export async function fetchLast24h(client, username, opts): Promise<Post[]>` не изменилась
- **CONFIRMED:** все 16 acceptance-grep и оба if-branch существуют в ровно одном экземпляре каждый

---
*Phase: 02-daemon-50*
*Completed: 2026-04-22*
