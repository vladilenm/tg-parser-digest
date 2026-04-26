---
phase: 02-daemon-50
plan: 03
subsystem: config
tags: [yaml, channels, env, scale, placeholders]

# Dependency graph
requires: []
provides:
  - "channels.yaml: 50 записей (12 реальных + 38 плейсхолдеров со структурой { username, priority })"
  - ".env.example: CHANNEL_DELAY_MS=1750 (поднят с 1000)"
affects: [02-05-daemon, 02-07-readme]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PLACEHOLDER_NN stub pattern: безопасный skip через UsernameNotOccupiedError — pipeline pass-through, операционная замена"
    - "CHANNEL_DELAY_MS=1750 + jitter 0-500мс = avg ~2000мс — анти-FloodWait запас на 50 каналов"

key-files:
  created: []
  modified:
    - "channels.yaml"
    - ".env.example"

key-decisions:
  - "Плейсхолдеры PLACEHOLDER_01..38 с priority: 5 вместо блокирующего ожидания ручного списка — SCALE-01 структурный контракт закрыт, оператор заменяет в своём темпе без блокировки последующих планов"
  - "Структура каналов { username, priority } оставлена без изменений — поле priority по-прежнему резервное (не используется в MVP), pipeline loadChannelsYaml() не требует миграции"
  - "CHANNEL_DELAY_MS=1750 соответствует расчёту из docs/phase-2.md §5: 50 × ~2000мс = ~100с на прогон, комфортно для одного 20:00-прогона в день"
  - "Комментарий над CHANNEL_DELAY_MS оставлен как есть — формула та же, значение другое"

patterns-established:
  - "Stub-replace workflow для больших конфиг-списков: код-план закрывает структурный контракт плейсхолдерами, оператор заменяет их как отдельный human-action checkpoint"

requirements-completed: [SCALE-01, SCALE-02]

# Metrics
duration: ~2min
completed: 2026-04-22
---

# Phase 02 Plan 03: channels.yaml → 50 + CHANNEL_DELAY_MS=1750 Summary

**channels.yaml расширен с 12 до 50 записей (12 существующих нетронуты + 38 PLACEHOLDER_NN-стабов с priority: 5), CHANNEL_DELAY_MS поднят с 1000 до 1750 в .env.example — оба структурных контракта SCALE-01/SCALE-02 закрыты; замена плейсхолдеров на реальные username делегирована оператору как checkpoint:human-action (non-blocking).**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-22T07:29:25Z
- **Completed:** 2026-04-22T07:31:00Z (ориентировочно)
- **Tasks auto-completed:** 2 / 3 (Task 3 — checkpoint:human-action, non-blocking)
- **Files modified:** 2 (0 created, 2 modified)

## Accomplishments

- `channels.yaml`:
  - 12 реальных каналов сохранены в том же порядке и с теми же priority: `neftegazru`, `oilfornication`, `oil_gas_forum`, `neftianka`, `energytodaygroup`, `oilcapital`, `interfaxonline`, `tass_agency`, `rbc_news`, `kommersant`, `vedomosti`, `prime1`.
  - Добавлено ровно 38 записей `PLACEHOLDER_01..PLACEHOLDER_38` с `priority: 5`.
  - Обновлён вступительный комментарий: добавлен блок с пояснением семантики PLACEHOLDER_NN и безопасным skip-поведением через UsernameNotOccupiedError.
  - `yaml.parse()` валидирует файл; `channels.length === 50`.
- `.env.example`:
  - `CHANNEL_DELAY_MS=1000` → `CHANNEL_DELAY_MS=1750`.
  - Комментарий `# базовая задержка между каналами; к ней добавляется jitter 0–500мс` сохранён без изменений.
  - Все остальные ключи (TG_API_ID, TG_API_HASH, TG_SESSION, TG_BOT_TOKEN, TG_CHANNEL_ID, DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL, FETCH_WINDOW_HOURS, MAX_MESSAGES_PER_CHANNEL, LOG_LEVEL) нетронуты.

## Task Commits

1. **Task 1: Дополнить channels.yaml до 50 записей (38 плейсхолдеров)** — `487b23d` (feat)
2. **Task 2: Обновить CHANNEL_DELAY_MS в .env.example** — `c3e2492` (chore)
3. **Task 3: Оператор заменяет PLACEHOLDER_NN на реальные username** — `checkpoint:human-action` (non-blocking, awaiting operator)

**Plan metadata commit:** добавляется финальным коммитом после обновления STATE.md/ROADMAP.md.

## Files Created/Modified

- `channels.yaml` (modified, +81 строк) — 50 записей (12 реальных + 38 плейсхолдеров); расширенный вступительный комментарий (4 новых строки с описанием семантики PLACEHOLDER_NN).
- `.env.example` (modified, 1 строка) — `CHANNEL_DELAY_MS` 1000 → 1750.

## Decisions Made

- **PLACEHOLDER_NN как стабы вместо блокирующего ожидания списка**: структурный контракт SCALE-01 (50 записей) закрывается кодом немедленно, операционная работа (подбор 38 реальных каналов) делегируется оператору как non-blocking checkpoint. Это позволяет последующим планам (02-04 reconnect, 02-05 daemon, 02-06 pm2, 02-07 readme) выполняться без задержки на поиск каналов оператором.
- **priority: 5 для всех плейсхолдеров**: резервное поле, pipeline его пока не использует; оператор при замене может поднять priority по своему усмотрению (1 = главные, 5 = фоновые). Выбор 5 означает «не повышать приоритет» — ровно как хочется для неизвестных каналов.
- **CHANNEL_DELAY_MS=1750** (из docs/phase-2.md §5): база 1750мс + jitter 0-500мс даёт средний 2000мс между каналами; 50 × 2000мс = ~100с wall-time на прогон, что комфортно для одного 20:00-прогона в день и оставляет большой запас против FloodWait.
- **Комментарий CHANNEL_DELAY_MS оставлен как есть**: формула (`база + jitter 0–500мс`) не изменилась, только числовое значение. Менять текст комментария смысла нет — это бы добавило шум в diff без семантической пользы.
- **Вступительный комментарий channels.yaml расширен, не заменён**: первые 4 строки (про user-session/ChannelPrivateError/priority) сохранены, добавлен отдельный параграф про PLACEHOLDER_NN. Это уважает принцип «не ломать существующую документацию».

## Deviations from Plan

None — plan executed exactly as written. Action-блоки Task 1 и Task 2 прописаны вербатим; все acceptance criteria прошли с первой попытки:
- `grep -c "^  - username:" channels.yaml` = 50 ✓
- `grep -c "username: \"PLACEHOLDER_" channels.yaml` = 38 ✓ (именно записи, не упоминания)
- 12 существующих username findable через `grep -q` ✓
- `yaml.parse()` → `channels.length === 50` ✓
- `grep -q "PLACEHOLDER_NN" channels.yaml` ✓ (комментарий обновлён)
- `grep -q "^CHANNEL_DELAY_MS=1750$" .env.example` ✓
- `! grep -q "^CHANNEL_DELAY_MS=1000$" .env.example` ✓
- Все 11 остальных env-ключей на месте ✓

## Authentication Gates

None.

## Issues Encountered

None. Обе задачи — чисто конфигурационные, без зависимостей от инфраструктуры или внешних сервисов.

## Threat Flags

Нет — plan 02-03 не вводит новых внешних поверхностей:
- channels.yaml — конфиг-данные (список публичных username), не secret.
- .env.example — шаблон без реальных значений; реальный .env в `.gitignore`.
- Никаких новых сетевых эндпоинтов, auth-путей, файловых ACL или schema-изменений на trust boundaries.

## Known Stubs

**38 стабов в channels.yaml (`PLACEHOLDER_01`..`PLACEHOLDER_38`) — намеренные, задокументированные, non-blocking.**

| Stub | File | Line range | Reason |
|------|------|-----------|--------|
| `PLACEHOLDER_01..38` (38 штук) | `channels.yaml` | записи 13–50 | SCALE-01 структурный контракт закрыт; замена на реальные username делегирована оператору (checkpoint:human-action Task 3). Pipeline безопасно пропускает плейсхолдеры через `UsernameNotOccupiedError`. |

**Когда резолвятся:** оператор заменяет в рамках Task 3 перед первым 20:00-прогоном. Критерий резолва: `grep -c "username: \"PLACEHOLDER_" channels.yaml` = 0. Если часть плейсхолдеров останется до следующей итерации — это допустимо (summary-лог зафиксирует `skipped=N`, прогон завершится успехом).

**Почему stub допустим:**
- План явно разделяет структурный (код) и операционный (подбор каналов) контракты.
- STATE.md фиксирует решение: «Список 38 новых каналов подбирает оператор, ревью перед мёржем».
- Phase 02 не блокируется: Tasks 02-04/05/06/07 зависят от структуры channels.yaml (50 записей, yaml.parse), а не от содержимого.

## Verification Output

**Automated checks** (Task 1 + Task 2 verify-блоки прошли):

Task 1:
- `grep -c "^  - username:" channels.yaml` → `50` ✓
- `grep -q "neftegazru"`, `grep -q "oilfornication"`, `grep -q "prime1"` — все ✓
- `grep -c "username: \"PLACEHOLDER_" channels.yaml` → `38` ✓
- `node --input-type=module -e "...yaml.parse...channels.length === 50..."` exits 0 ✓
- `grep -q "PLACEHOLDER_NN" channels.yaml` ✓

Task 2:
- `grep -q "^CHANNEL_DELAY_MS=1750$" .env.example` ✓
- `! grep -q "^CHANNEL_DELAY_MS=1000$" .env.example` ✓
- 11 env-ключей findable через `grep -q "^<KEY>="` ✓
- `grep -q "# базовая задержка между каналами" .env.example` ✓ (комментарий сохранён)

## User Setup Required

**Task 3 (checkpoint:human-action, non-blocking):**

Оператор:
1. Открывает `channels.yaml`.
2. Для каждой из 38 записей `- username: "PLACEHOLDER_NN"` находит реальный публичный канал российского нефтегаза/нефтехимии (тематики: нефтехимия, бункеровка, масла, битум, керосин, смежные отрасли) и заменяет PLACEHOLDER_NN на его username (без `@`).
3. Критерий: канал публичный (доступен по `t.me/USERNAME`), user-аккаунт из TG_SESSION подписан на него.
4. priority можно корректировать (1 = главные, 5 = менее приоритетные).
5. После замен: `grep -c "username: \"PLACEHOLDER_" channels.yaml` должен печатать `0`; `grep -c "^  - username:" channels.yaml` = 50.

**Resume signal:** `approved` (все 38 заменены) или `skip` (часть плейсхолдеров остаётся до следующей итерации — тоже валидный вариант, phase не блокируется).

**Последствия отсутствия замены:** на первом 20:00-прогоне summary-лог зафиксирует `channels: total=50 succeeded=12 skipped=38` и 38 ошибок `UsernameNotOccupiedError` в `errors[]`. Это допустимо как временное состояние, но теряется смысл расширения до 50 каналов.

## Next Phase Readiness

- **Ready for plan 02-04 (GramJS reconnect retry):** зависит только от структуры pipeline/logger — не от содержимого channels.yaml.
- **Ready for plan 02-05 (daemon entrypoint):** daemon вычитывает channels.yaml через `loadChannelsYaml()`; 50-запись структура корректна для обоих вариантов (плейсхолдеры и реальные username).
- **Ready for plan 02-06 (PM2):** CHANNEL_DELAY_MS=1750 в .env.example — единственная env-зависимость, закрыта.
- **Ready for plan 02-07 (README):** можно документировать 50 каналов и 1750мс задержку.
- **SCALE-01** закрыт структурно; замена плейсхолдеров — операционная работа, не блокирует phase.
- **SCALE-02** закрыт полностью.

## Self-Check: PASSED

- **FOUND:** `channels.yaml` (50 записей, yaml.parse() подтвердил)
- **FOUND:** `.env.example` с `CHANNEL_DELAY_MS=1750`
- **FOUND:** commit `487b23d` (Task 1) in `git log --oneline`
- **FOUND:** commit `c3e2492` (Task 2) in `git log --oneline`
- **FOUND:** `.planning/phases/02-daemon-50/02-03-SUMMARY.md` (this file)
- **CONFIRMED:** 12 реальных username присутствуют через `grep -q` (все 12 прошли проверку)
- **CONFIRMED:** 38 PLACEHOLDER_NN записей через `grep -c "username: \"PLACEHOLDER_"` = 38
- **CONFIRMED:** CHANNEL_DELAY_MS=1000 удалён полностью, заменён на 1750

---
*Phase: 02-daemon-50*
*Completed: 2026-04-22*
