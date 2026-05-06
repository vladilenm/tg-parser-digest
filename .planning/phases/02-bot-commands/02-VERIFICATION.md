---
phase: 02-bot-commands
verified: 2026-05-06T12:45:00Z
status: human_needed
score: 12/12 must-haves verified (automated)
overrides_applied: 0
re_verification: null
human_verification:
  - test: "Реальный bot polling — 409 Conflict регрессия при `pm2 restart`"
    expected: "После `pm2 restart tg-parser` daemon стартует без 409 Conflict, очередь команд за время рестарта не теряется (deleteWebhook drop_pending_updates: false)"
    why_human: "Требует реальный TG_BOT_TOKEN, реальную очередь команд и фактический pm2-цикл — нельзя проверить unit-тестами"
  - test: "Реальный /channels от allowlist-пользователя"
    expected: "Бот возвращает в личке текущий список каналов из channels.json с нумерацией и счётчиком"
    why_human: "Нужен реальный bot token, реальный allowlist user, реальный обмен с Telegram API"
  - test: "Реальный /add_channel @newchannel + проверка следующего прогона"
    expected: "Бот отвечает «Добавлен @newchannel...», в channels.json появляется запись, в следующем прогоне 20:15 MSK канал участвует в pipeline"
    why_human: "Требует реальный обмен с Telegram + ожидание следующего cron-тика, либо ручной запуск pipeline"
  - test: "Реальный /remove_channel @ch с inline-подтверждением (confirm)"
    expected: "Бот показывает inline-кнопки «Удалить»/«Отмена»; нажатие «Удалить» убирает кнопки, текст меняется на «Удалён @ch», запись пропадает из channels.json"
    why_human: "Требует реальный Telegram-клиент для нажатия кнопки + проверка визуальной убранной inline-keyboard"
  - test: "Реальный /remove_channel @ch с inline-подтверждением (cancel)"
    expected: "Нажатие «Отмена» убирает кнопки, текст меняется на «Отмена удаления @ch», channels.json не меняется"
    why_human: "Требует реальный Telegram-клиент для нажатия кнопки"
  - test: "Не-allowlist пользователь пишет /channels — silent ignore"
    expected: "Бот молча игнорирует (никакого ответа), в логах daemon появляется `[bot] denied: from=<id> cmd=/channels`"
    why_human: "Требует реальный второй Telegram-аккаунт (не из allowlist) и просмотр pm2 logs для подтверждения формата лога"
  - test: "Graceful shutdown через SIGINT (Ctrl+C)"
    expected: "После Ctrl+C daemon последовательно: останавливает cron, останавливает bot polling (≤35s), ждёт активный pipeline-tick, exit 0"
    why_human: "Требует реальный запуск daemon и наблюдение последовательности логов «stopping cron and bot» → «[bot] polling stopped» → exit 0"
---

# Phase 02: Bot Commands Verification Report

**Phase Goal:** Добавить Telegram-бота с командами /channels, /add_channel, /remove_channel и интеграцией в daemon (одиночный TG_BOT_TOKEN, allowlist по числовому user ID, plain-text only ответы).

**Verified:** 2026-05-06T12:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                              | Status     | Evidence                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `src/bot.ts` существует и экспортирует `startBot()`/`stopBot()`/`isBotPolling()`                                  | ✓ VERIFIED | bot.ts:494, 530, 538; tsc проходит; `grep -c "^export "` = 11                                                  |
| 2   | При отсутствии TG_BOT_TOKEN или BOT_ALLOWED_USER_IDS startBot warn'ит и возвращается без polling-loop'а (D-04)     | ✓ VERIFIED | bot.ts:495-510 — два guard'а: env-check + parseAllowlist().size===0; warn-формат корректный                   |
| 3   | На boot polling вызывается `deleteWebhook(drop_pending_updates: false)` ДО первого getUpdates (D-03)                | ✓ VERIFIED | bot.ts:455-457 — внутри pollLoop ДО while-цикла с pollOnce; также logged at line 458                           |
| 4   | Не-allowlist пользователь получает silent ignore (нет sendMessage / answerCallbackQuery) + log.info `[bot] denied:` | ✓ VERIFIED | bot.ts:227-231 (handleCommand), bot.ts:351-354 (handleCallbackQuery); тесты verify silent + log format        |
| 5   | `/channels` от allowlist-пользователя возвращает текущий список из `channels.json` (BOT-01)                        | ✓ VERIFIED | bot.ts:233-237 → listChannels() → loadChannels(); тесты handleCommand /channels проходят                       |
| 6   | `/add_channel @valid_username` валидирует regex и пишет через mutate(); duplicate возвращает «уже в списке» (BOT-02) | ✓ VERIFIED | bot.ts:238-266 → normalizeUsername + addChannel; idempotent тест проходит                                      |
| 7   | `/remove_channel @ch` от allowlist-пользователя показывает inline-кнопки «Удалить» и «Отмена» (BOT-03)              | ✓ VERIFIED | bot.ts:267-304 → sendReplyWithKeyboard с inline_keyboard; тест проверяет наличие callback_data                |
| 8   | callback_data формат `rm:<username>:confirm` / `rm:<username>:cancel` self-contained (D-11)                         | ✓ VERIFIED | bot.ts:292-293 (создание); bot.ts:317-326 (parseRemoveCallbackData); 7 тестов на парсер                        |
| 9   | После confirm: канал удалён через mutate, кнопки убраны (editMessageReplyMarkup []), текст обновлён (D-13/D-14)      | ✓ VERIFIED | bot.ts:380-410 — removeChannel + editMessageReplyMarkup → editMessageText; W-3 try/catch на каждый edit       |
| 10  | После cancel: channels.json не меняется, кнопки убраны, текст обновлён                                              | ✓ VERIFIED | bot.ts:376-378 (newText) + bot.ts:390-409 (edit), mutate НЕ вызывается; тест проверяет mockedMutate not called |
| 11  | `src/run.ts` запускает startBot fire-and-forget параллельно с cron, без блокировки (BOT-05)                         | ✓ VERIFIED | run.ts:63-81 — `void (async () => { try { await startBot(); ... } })()` после cron.schedule                    |
| 12  | На SIGINT/SIGTERM: stopBot() → wait isBotPolling (≤35s) → wait isRunning → process.exit(0)                          | ✓ VERIFIED | run.ts:84-102 — последовательность task.stop → stopBot → deadline-loop → pipeline wait → exit                  |

**Score:** 12/12 truths verified (automated)

### Required Artifacts

| Artifact                              | Expected                                                            | Status     | Details                                                            |
| ------------------------------------- | ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `src/bot.ts`                          | polling loop + auth + 3 commands + CRUD wrappers (≥150 LOC)         | ✓ VERIFIED | 540 LOC, 11 exports (parseAllowlist, normalizeUsername, parseRemoveCallbackData, listChannels, addChannel, removeChannel, handleCommand, handleCallbackQuery, startBot, stopBot, isBotPolling) |
| `.env.example`                        | секция `BOT_ALLOWED_USER_IDS` после `TG_CHANNEL_ID`, до `DEEPSEEK_API_KEY`, с инструкцией про @userinfobot | ✓ VERIFIED | Строки 24-31; формат-пример `12345678,87654321`; `TG_BOT_TOKEN` встречается ровно 1 раз (D-01) |
| `src/run.ts`                          | импорт `./bot.js`, fire-and-forget startBot, расширенный shutdown   | ✓ VERIFIED | 104 LOC; импорт line 9; IIFE lines 63-81; shutdown lines 84-102    |
| `src/__tests__/bot-handlers.test.ts`  | Vitest-suite ≥200 LOC, ≥12 describe-блоков                         | ✓ VERIFIED | 586 LOC; 13 describe-блоков; 45 тестов pass                        |
| `README.md`                           | секция «Команды бота» с 3 командами + BOT_ALLOWED_USER_IDS + @userinfobot | ✓ VERIFIED | Lines 143-181; полная секция с настройкой, командами, примерами, поведением при перезапуске, Out of Scope |

### Key Link Verification

| From                                | To                                                | Via                                                    | Status   | Details                                                                  |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------------------------ |
| `src/bot.ts`                        | `src/channels-store.ts`                           | `import { mutate, loadChannels, type ChannelEntry }`  | ✓ WIRED  | bot.ts:4 — импорт; mutate вызван в addChannel/removeChannel              |
| `src/bot.ts`                        | `https://api.telegram.org/bot${token}`            | raw fetch (tgFetch)                                    | ✓ WIRED  | bot.ts:51 (TG_API const) + bot.ts:103 (fetch call); 4 endpoints used    |
| `src/bot.ts`                        | `src/logger.ts`                                   | `import { log }`                                       | ✓ WIRED  | bot.ts:5 — импорт; log.info/warn/error используется во всём файле       |
| `src/bot.ts /remove_channel handler` | `sendMessage with reply_markup`                   | inline_keyboard с двумя кнопками                       | ✓ WIRED  | bot.ts:290-302 (handleCommand) → bot.ts:140-154 (sendReplyWithKeyboard)  |
| `src/bot.ts callback_query handler`  | `removeChannel`                                   | вызов removeChannel(username)                          | ✓ WIRED  | bot.ts:380 — `await removeChannel(username)` в handleCallbackQuery       |
| `src/bot.ts callback_query handler`  | Telegram editMessageReplyMarkup + editMessageText | tgFetch для уборки кнопок и обновления текста          | ✓ WIRED  | bot.ts:391-408 — оба editMessage* вызова в собственных try/catch (W-3)   |
| `src/run.ts`                        | `src/bot.ts`                                      | `import { startBot, stopBot, isBotPolling } from './bot.js'` | ✓ WIRED  | run.ts:9 — импорт; все три используются                                 |
| `src/run.ts shutdown()`             | `src/bot.ts stopBot()`                            | вызов stopBot() перед wait isBotPolling                | ✓ WIRED  | run.ts:89 — stopBot(); run.ts:91-93 — deadline-wait isBotPolling()       |
| `src/__tests__/bot-handlers.test.ts` | `src/bot.ts`                                      | import 8 функций                                       | ✓ WIRED  | test.ts:7-17 — все 8 функций импортированы и используются                |
| `src/__tests__/bot-handlers.test.ts` | `src/channels-store.ts`                           | `vi.mock('../channels-store.js')`                       | ✓ WIRED  | test.ts:22-27 — vi.mock; mockedLoadChannels/mockedMutate (test.ts:29-30) |

### Data-Flow Trace (Level 4)

| Artifact                            | Data Variable        | Source                                       | Produces Real Data                                              | Status     |
| ----------------------------------- | -------------------- | -------------------------------------------- | --------------------------------------------------------------- | ---------- |
| `bot.ts listChannels()`             | `channels`           | `loadChannels()` из channels-store.ts        | Yes — читает из реального channels.json (Phase 1)              | ✓ FLOWING  |
| `bot.ts addChannel/removeChannel`   | (writes via mutate)  | `mutate(fn)` из channels-store.ts            | Yes — атомарная запись `.tmp + rename` под mutex'ом (Phase 1)   | ✓ FLOWING  |
| `bot.ts handleCommand`              | `msg.from`/`msg.text` | `pollOnce` → `getUpdates` от Bot API         | Yes — реальный fetch к https://api.telegram.org/bot${token}     | ✓ FLOWING  |
| `bot.ts pollLoop`                   | `lastOffset`          | `pollOnce` обновляет на `update_id + 1` (W-1)| Yes — корректное продвижение offset защищает от дублей          | ✓ FLOWING  |
| `bot.ts handleCallbackQuery`        | `cb.data`            | `pollOnce` → `getUpdates` callback_query     | Yes — payload включён в long-polling (`allowed_updates`)        | ✓ FLOWING  |
| `run.ts shutdown isBotPolling()`    | (lifecycle flag)     | bot.ts module-level `pollingActive`           | Yes — flag устанавливается в startBot finally / pollLoop exit   | ✓ FLOWING  |

### Behavioral Spot-Checks

| Behavior                                                  | Command                                          | Result                          | Status |
| --------------------------------------------------------- | ------------------------------------------------ | ------------------------------- | ------ |
| TypeScript strict проходит на всём проекте                | `npx tsc --noEmit`                               | exit 0, без ошибок              | ✓ PASS |
| Vitest test suite (весь проект) проходит                  | `npm test`                                       | 363/363 tests passed (18 files) | ✓ PASS |
| Bot-handlers test suite проходит изолированно             | `npx vitest run src/__tests__/bot-handlers.test.ts` | 45/45 tests passed              | ✓ PASS |
| Bot-handlers тест содержит 13 describe-блоков             | `grep -c "describe(" src/__tests__/bot-handlers.test.ts` | 13                       | ✓ PASS |
| `[bot] denied:` log format присутствует в коде            | `grep -n "\[bot\] denied:" src/bot.ts`           | 2 occurrences (handleCommand + handleCallbackQuery) | ✓ PASS |
| D-10 invariant: parse_mode НЕ используется                 | `grep "parse_mode" src/bot.ts`                   | 0 matches                       | ✓ PASS |
| W-1: offset advance `update_id + 1` присутствует          | `grep "update_id + 1" src/bot.ts`                | 1 match (line 435)              | ✓ PASS |
| Anti-supervisor invariant: НЕТ botSupervisor / 5000ms loop в run.ts | `grep -c "botSupervisor"; grep -E "setTimeout\(.*5000\)"` | 0 / 0           | ✓ PASS |
| TG_BOT_TOKEN в .env.example встречается ровно 1 раз (D-01) | `grep -c "TG_BOT_TOKEN" .env.example`            | 1                               | ✓ PASS |
| BOT_ALLOWED_USER_IDS присутствует в .env.example          | `grep -c "BOT_ALLOWED_USER_IDS" .env.example`    | 4 (заголовок + комментарий + пример + переменная) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s)              | Description                                                                                  | Status      | Evidence                                                                                                    |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| BOT-01      | 02-01, 02-04                | Просмотр списка каналов через `/channels`                                                    | ✓ SATISFIED | bot.ts:233-237 → listChannels() из bot.ts:164-169; тесты «handleCommand /channels» (test.ts:323-360) и «listChannels» (test.ts:266-282) |
| BOT-02      | 02-01, 02-04                | Добавление через `/add_channel <username>` с regex-валидацией                                | ✓ SATISFIED | bot.ts:238-266 → normalizeUsername (regex 5-32 chars) + addChannel (idempotent через mutate); тесты «handleCommand /add_channel» (test.ts:366-428) и «addChannel CRUD» (test.ts:223-240) |
| BOT-03      | 02-02, 02-04                | Удаление через `/remove_channel <username>` с inline-подтверждением                          | ✓ SATISFIED | bot.ts:267-304 (показ кнопок) + bot.ts:339-410 (handleCallbackQuery confirm/cancel); тесты «handleCommand /remove_channel» (test.ts:434-474), «handleCallbackQuery confirm» (test.ts:501-542), «handleCallbackQuery cancel» (test.ts:548-586), «parseRemoveCallbackData» (test.ts:183-217) |
| BOT-04      | 02-01, 02-04                | Allowlist по `BOT_ALLOWED_USER_IDS`                                                          | ✓ SATISFIED | bot.ts:69-79 (parseAllowlist), bot.ts:227-231 (handleCommand allowlist), bot.ts:351-354 (handleCallbackQuery allowlist); тесты «parseAllowlist» (test.ts:94-131), «handleCommand allowlist» (test.ts:288-317), «handleCallbackQuery allowlist» (test.ts:480-495) |
| BOT-05      | 02-01, 02-03                | Bot polling запускается в daemon-процессе без конфликта с GramJS                             | ✓ SATISFIED | bot.ts:454-457 (deleteWebhook drop_pending_updates: false → защита от 409 Conflict); run.ts:63-81 (fire-and-forget startBot параллельно с cron); run.ts:84-102 (graceful shutdown 35s deadline) |

**Coverage:** 5/5 v4.0 BOT requirements satisfied. Никаких ORPHANED requirement'ов — REQUIREMENTS.md mapping полный.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

**No anti-patterns detected.**

Проверено: TODO/FIXME/XXX/HACK/PLACEHOLDER, "placeholder"/"coming soon"/"not yet implemented", `return null`/`return {}`/`return []` без мотивации, hardcoded empty data, console.log-only stubs, parse_mode invariant.

### Human Verification Required

7 items требуют ручного smoke-теста в реальной среде с настроенным `TG_BOT_TOKEN` и `BOT_ALLOWED_USER_IDS`:

#### 1. 409 Conflict регрессия при `pm2 restart`

**Test:** Запустить daemon под PM2 (`pm2 start ecosystem.config.cjs`), отправить 2-3 команды боту, выполнить `pm2 restart tg-parser`, проверить что после рестарта команды НЕ потеряны (deleteWebhook drop_pending_updates: false).
**Expected:** В `pm2 logs` после рестарта появляется `[bot] deleteWebhook ok (drop_pending_updates=false)` и `[bot] polling started (allowlist size=N)`; накопленные команды обрабатываются.
**Why human:** Требует реальный TG_BOT_TOKEN, реальную очередь команд и фактический pm2-цикл — нельзя проверить unit-тестами.

#### 2. Реальный `/channels` от allowlist-пользователя

**Test:** Из аккаунта оператора (Telegram user.id в `BOT_ALLOWED_USER_IDS`) написать боту `/channels`.
**Expected:** Бот отвечает в личке plain-text сообщением вида «Каналов: N\n1. @ch1\n2. @ch2\n...» из текущего channels.json.
**Why human:** Нужен реальный bot token, реальный allowlist user, реальный обмен с Telegram API.

#### 3. Реальный `/add_channel @newchannel` + проверка следующего прогона

**Test:** Отправить боту `/add_channel @testchannel123`, проверить ответ + содержимое channels.json + дождаться 20:15 MSK тика (или запустить tick вручную через `npm run start:once` если такой скрипт есть).
**Expected:** Бот отвечает «Добавлен @testchannel123. Будет использован в следующем прогоне в 20:15 MSK.»; в channels.json появляется запись `{"username": "testchannel123"}`; в следующем прогоне канал участвует в pipeline.
**Why human:** Требует реальный обмен с Telegram + ожидание следующего cron-тика, либо ручной запуск pipeline.

#### 4. Реальный `/remove_channel @ch` (confirm)

**Test:** Отправить боту `/remove_channel @testchannel123`, нажать кнопку «Удалить».
**Expected:** Бот показывает inline-кнопки «Удалить»/«Отмена»; после нажатия «Удалить» кнопки исчезают, текст сообщения меняется на «Удалён @testchannel123.»; запись пропадает из channels.json.
**Why human:** Требует реальный Telegram-клиент для нажатия кнопки + проверка визуальной убранной inline-keyboard.

#### 5. Реальный `/remove_channel @ch` (cancel)

**Test:** Отправить боту `/remove_channel @somechannel`, нажать кнопку «Отмена».
**Expected:** Кнопки исчезают, текст меняется на «Отмена удаления @somechannel.»; channels.json не меняется.
**Why human:** Требует реальный Telegram-клиент для нажатия кнопки.

#### 6. Не-allowlist пользователь — silent ignore

**Test:** Из второго Telegram-аккаунта (НЕ из allowlist) написать боту `/channels`.
**Expected:** Бот молча игнорирует (никакого ответа); в `pm2 logs tg-parser` появляется `[bot] denied: from=<id> cmd=/channels`.
**Why human:** Требует реальный второй Telegram-аккаунт (не из allowlist) и просмотр pm2 logs для подтверждения формата лога.

#### 7. Graceful shutdown через SIGINT (Ctrl+C)

**Test:** Запустить `npm start` локально, нажать Ctrl+C.
**Expected:** Логи в порядке: `received SIGINT, stopping cron and bot` → `[bot] polling stopped` → exit 0; всё за <35s если нет активного pipeline'а.
**Why human:** Требует реальный запуск daemon и наблюдение последовательности логов «stopping cron and bot» → «[bot] polling stopped» → exit 0.

### Gaps Summary

**Автоматическая проверка не выявила пропусков.**

- Все 12 observable truths верифицированы через комбинацию: чтение исходников + 363 unit-теста (вкл. 45 на bot-handlers) + tsc strict + grep-инварианты.
- Все 5 BOT-XX requirements (BOT-01..BOT-05) удовлетворены, evidence привязан к строкам кода и тестам.
- Все 5 артефактов на месте, размеры в норме, exports корректные.
- 10/10 ключевых wiring-связей подтверждены вручную (gsd-tools verify key-links дал false-negatives на bot.ts→bot.ts intra-file ссылках; ручная проверка через grep дала PASS).
- 6/6 data-flow trace levels подтверждены — listChannels читает из реального channels.json через Phase 1 mutate, getUpdates от Bot API даёт реальные обновления, lastOffset продвигается через `update_id + 1`.
- Anti-patterns: 0 (нет TODO, нет placeholder'ов, нет parse_mode, нет supervisor-loop'а в run.ts).
- Behavioral spot-checks: 10/10 PASS (tsc, npm test, grep-инварианты).

### Что не покрыто автотестами (требует human-UAT)

Сценарии, требующие реального обмена с Telegram Bot API: 409 Conflict при pm2 restart, реальные команды от allowlist/non-allowlist пользователей, нажатие inline-кнопок confirm/cancel, graceful shutdown через SIGINT. Это явно объявлено в Plan 04 как «covered ручным smoke-cheklist в HUMAN-UAT» — соответствует scope plan'а.

### Документационная заметка (не gap)

ROADMAP.md §«Phase 2» Success Criteria #1 говорит «возвращает актуальный список каналов (username + priority)» — но field `priority` был удалён из проекта в коммитах `5e6c19f chore: strip stale priority field from channels.json` и `910250f docs(quick-260506-dht): drop YAML completely + remove priority field`. Текущая `ChannelEntry` в `channels-store.ts:14-22` имеет только `username`. Это документационный drift в ROADMAP, не gap реализации — listChannels корректно отображает `@username`.

---

_Verified: 2026-05-06T12:45:00Z_
_Verifier: Claude (gsd-verifier)_
