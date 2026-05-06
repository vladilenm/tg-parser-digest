---
phase: 02-bot-commands
fixed_at: 2026-05-06T00:00:00Z
review_path: .planning/phases/02-bot-commands/02-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-06
**Source review:** .planning/phases/02-bot-commands/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (Critical: 0, Warning: 3)
- Fixed: 3
- Skipped: 0

Все три предупреждения из REVIEW.md (WR-01, WR-02, WR-03) применены и зафиксированы атомарными коммитами. Vitest полностью зелёный (365/365 тестов в 18 файлах), `tsc --noEmit` без ошибок. Info-замечания (IN-01..IN-06) вне scope (`fix_scope=critical_warning`) и оставлены без изменений.

## Fixed Issues

### WR-01: `parseAllowlist` принимает строки с числовым префиксом

**Files modified:** `src/bot.ts`, `src/__tests__/bot-handlers.test.ts`
**Commit:** be0e388
**Applied fix:** Заменён `Number.parseInt(s, 10)` на строгий regex-чек `/^[1-9]\d*$/` перед `Number(s)`. Теперь токены вида `"12345abc"` или `"12345 #comment"` отбрасываются полностью, а не «коэрсятся» в `12345`. Добавлены два unit-теста: `"12345abc" → Set()` и `"12345abc,67890" → Set([67890])`. Это устраняет тихое расширение allowlist'а на префиксное число при опечатке оператора в `BOT_ALLOWED_USER_IDS`.

### WR-02: `answerCallbackQuery` без try/catch перед `removeChannel`

**File modified:** `src/bot.ts`
**Commit:** 8c28ccd
**Applied fix:** Обёрнут вызов `tgFetch(... "answerCallbackQuery" ...)` в `try/catch` с `log.warn` при сбое. Теперь сетевой сбой ack не выбрасывает исключение наверх в `pollOnce`'s catch и **не блокирует выполнение `removeChannel(username)`**. Симметрично двум последующим `editMessage*`-блокам, которые уже имели свои try/catch'и. UX перестаёт быть путающим («нажал — ничего не произошло — повторил») при flaky-сети — основное действие выполняется как best-effort.

### WR-03: Mock `mutate()` в тестах не имитирует production-семантику

**File modified:** `src/__tests__/bot-handlers.test.ts`
**Commit:** 35ed6f7
**Applied fix:** Helper `withCurrentChannels` теперь захватывает результат `await fn(channels)` в module-level переменную `lastWrittenChannels`, имитируя production-mutate из `channels-store.ts:113-120`, который пишет на диск именно возвращённый `next`. Все четыре теста `addChannel`/`removeChannel` обновлены: к ним добавлены assertions `expect(lastWrittenChannels).toEqual(...)` для проверки финального состояния channels.json. Это закрывает false-positive risk: если кто-то сломает возвращаемое значение `addChannel`/`removeChannel`, но оставит правильный side-effect в closure'е, тесты теперь поймают регрессию.

## Verification

- **Typecheck:** `npx tsc --noEmit` — clean (0 errors).
- **Tests:** `npx vitest run` — 18 files / 365 tests / all passed.
- **Tests (target file):** `npx vitest run src/__tests__/bot-handlers.test.ts` — 47/47 passed (прирост +2 теста для WR-01).

## Out-of-Scope (Info-level, not fixed)

Согласно `fix_scope=critical_warning`, info-замечания IN-01..IN-06 не применялись:

- IN-01: write-on-no-op в `mutate()` — низкий приоритет, не критичность.
- IN-02: отсутствие `chat.type === 'private'` check — расхождение README vs реальность.
- IN-03: `lastOffset = 0` сбрасывается при рестарте — by design (D-03).
- IN-04: `denied:` лог без sanitization `cb.data` — low-risk noise potential.
- IN-05: тесты не вызывают `vi.unstubAllGlobals()` в afterEach — works in practice.
- IN-06: outer IIFE в `run.ts` без restart-loop'а — intentional дизайн.

При желании пересмотреть — отдельная итерация ревью с `fix_scope=all`.

---

_Fixed: 2026-05-06_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
