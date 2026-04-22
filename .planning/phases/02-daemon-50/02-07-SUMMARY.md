---
phase: 02-daemon-50
plan: 07
subsystem: docs
tags: [readme, pm2, daemon, summary-log, docs-v2, esm-cjs]

# Dependency graph
requires:
  - plan: 02-05
    provides: "src/run.ts daemon — канонические log-строки 'daemon started, schedule: 0 20 * * * Europe/Moscow', 'received SIGINT, stopping cron', 'prev run still in progress — skipping tick' для цитирования в README"
  - plan: 02-06
    provides: "ecosystem.config.cjs — PM2 конфиг с kill_timeout=180000, на который ссылается секция README 'Запуск на VPS (PM2)'"
provides:
  - "README.md обновлён под v2.0 daemon-режим (DOC-01 + DOC-02 + DOC-03)"
  - "Секция '## Запуск на VPS (PM2)' с канонической командой pm2 start ecosystem.config.cjs и полным операционным playbook (DOC-01)"
  - "Секция '## Ежедневный summary-лог' с примером вывода logRunSummary и референсом полей (DOC-03)"
  - "Удалена старая секция '## Дисциплина запусков' — крон контролирует частоту (DOC-02)"
  - "Обновлён headline + 'Запуск в 3 команды' + 'Установка зависимостей' (4 deps вместо 3) — DEPLOY-02 documentation-side"
affects: [v2.0-VPS-deploy, phase-2-UAT, onboarding]

# Tech tracking
tech-stack:
  added:
    - "README v2.0 section patterns: VPS/PM2 playbook + summary-log spec"
  patterns:
    - "ecosystem-config ссылки в docs используют .cjs-расширение (а не .js) потому что проект в ESM-режиме — critical copy-paste correctness"
    - "README headline на основе target outcome ('ежедневный дайджест в закрытом канале') а не mechanism ('один скрипт')"
    - "Troubleshooting-айтемы для daemon-модели: ошибка канала = skipped + errors[] entry, а не exit 1 прогона"

key-files:
  created: []
  modified:
    - "README.md"

key-decisions:
  - "README использует `ecosystem.config.cjs` (не `.js` как в verbatim-плане) — Rule 1 Bug: фактический файл после Plan 06 deviation переименован в .cjs из-за `\"type\": \"module\"` в package.json. Copy-paste из README c `.js` привёл бы к тихой ошибке (module.exports в ESM-scope не экспортирует)."
  - "Новый §5 'Первый запуск daemon' явно описывает ожидаемый stdout (`[info] daemon started, schedule: 0 20 * * * Europe/Moscow`) — оператор имеет цитату для grep-подтверждения что daemon стартанул."
  - "Troubleshooting-айтем про FloodWait переписан под daemon-модель: один неудачный канал = skipped + errors[] + следующий tick завтра (не exit 1 прогона, как было в v1.0)."
  - "Секции '## Запуск на VPS (PM2)' и '## Ежедневный summary-лог' вставлены между '§5 Первый запуск daemon' и '## Как проверить' — логический порядок: локальный запуск → VPS-деплой → диагностический лог → приёмка."

patterns-established:
  - "При наличии deviation на уровне артефакта в предыдущем плане (renamed file), README-плагин должен ссылаться на фактическое имя файла, а не на plan-verbatim — иначе документация становится багом. Паттерн зафиксирован: предпочесть копируемую корректность плану."
  - "Sample-лог в README пишется с настоящими числами и реалистичными ошибками (FloodWait retry exhausted, network disconnect after 3 attempts, ChannelPrivateError) — оператор быстро сверяет свой pm2-лог с образцом."

requirements-completed: [DEPLOY-02, DOC-01, DOC-02, DOC-03]

# Metrics
duration: ~3min
completed: 2026-04-22
---

# Phase 02 Plan 07: README обновление под v2.0 daemon + PM2 + summary-лог Summary

**`README.md` обновлён под v2.0 daemon-режим: новый headline отражает ежедневный дайджест через daemon+node-cron+PM2, секция «Запуск в 3 команды» показывает `npm start` как long-running процесс с Ctrl+C, устаревшая «Дисциплина запусков» УДАЛЕНА (крон контролирует частоту), добавлены две новые секции: «## Запуск на VPS (PM2)» с 4 каноническими командами + «## Ежедневный summary-лог» с примером вывода `logRunSummary` и референсом полей; все PM2-команды используют `ecosystem.config.cjs` (не `.js`) — это ключевая deviation Rule 1, закрывающая copy-paste баг из Plan 06.**

## Performance

- **Duration:** ~3 min (171 сек wall-time)
- **Started:** 2026-04-22T07:54:19Z
- **Completed:** 2026-04-22T07:57:10Z
- **Tasks:** 3 auto executed (все три успешно, без checkpoint-пауз)
- **Files modified:** 1 (README.md)

## Accomplishments

- **Task 1 (docs):** Headline + «Запуск в 3 команды» + «Установка зависимостей» переписаны под daemon-режим. 4 runtime-зависимости (было 3). 7 из 7 acceptance-grep прошли. Commit `8d7b9ea`.
- **Task 2 (docs):** Секция «## Дисциплина запусков» УДАЛЕНА целиком (вместе с фразой «не чаще одного прогона в 10–15 минут»). §5 «Первый прогон» переписана как «§5. Первый запуск daemon» с 5 пронумерованными пунктами, описывающими daemon-поведение + Ctrl+C → graceful shutdown + reconnect-on-network-drop. Troubleshooting-айтем «Второй FloodWaitError» переписан под daemon-модель (skipped + errors[]). 9 из 9 acceptance-grep прошли. Commit `b9ce837`.
- **Task 3 (docs):** Добавлены ДВЕ новые секции верхнего уровня:
  - **## Запуск на VPS (PM2)** — npm install -g pm2, 5 пронумерованных setup-команд (включая все 4 обязательных: `pm2 start ecosystem.config.cjs`, `pm2 logs tg-parser`, `pm2 save`, `pm2 startup`), операционные команды (restart/reload/stop/delete), kill+resurrect flow, логи PM2, объяснение ключевых параметров ecosystem (kill_timeout=180000, max_restarts=10+min_uptime=30s, max_memory_restart=300M).
  - **## Ежедневный summary-лог** — сэмпл `[summary] runId=abc12345` с 50 каналами, 3 skipped, 412 collected, 5 deduped, delivered=true + errors-блок с 3 примерами (FloodWait retry exhausted, network disconnect, ChannelPrivateError). 7-пункт референс полей + quick-grep команда для последнего summary.
  - Порядок секций: §5 Первый запуск daemon (55) → ## Запуск на VPS PM2 (75) → ## Ежедневный summary-лог (120) → ## Как проверить (146) — все в возрастающем порядке. 11 из 11 acceptance-grep прошли + порядок секций проверен `awk` одностроком. Commit `59de634`.

## Task Commits

1. **Task 1: Обновить headline + «Запуск в 3 команды» + deps (3→4)** — `8d7b9ea` (docs)
2. **Task 2: Удалить «Дисциплина запусков» + переписать §5 + troubleshooting** — `b9ce837` (docs)
3. **Task 3: Добавить «Запуск на VPS (PM2)» + «Ежедневный summary-лог»** — `59de634` (docs)

**Plan metadata commit:** добавляется финальным коммитом после обновления STATE.md/ROADMAP.md/REQUIREMENTS.md.

## Files Created/Modified

- `README.md` (modified) — 10 секций верхнего уровня (было 8):
  - Headline переписан (target outcome + daemon/node-cron/PM2 упоминание)
  - §5 переименован («Первый прогон» → «Первый запуск daemon») и переписан
  - УДАЛЕНА `## Дисциплина запусков`
  - ДОБАВЛЕНА `## Запуск на VPS (PM2)` (45 строк)
  - ДОБАВЛЕНА `## Ежедневный summary-лог` (26 строк)
  - Обновлён Troubleshooting-айтем «Второй FloodWaitError»
  - Обновлён deps-абзац в «1. Установка зависимостей» (3 → 4)

## Diff-summary: что изменилось в ключевых секциях

### Headline (строки 1–5)

**Было:**
```
# tg-parser-demo

За один `npm start` получить в закрытом Telegram-канале HTML-дайджест событий
российского нефтегаза/нефтехимии за последние 24 часа, где каждая цитата
дословно присутствует в исходном посте — без галлюцинаций LLM.

Один Node.js-скрипт, запускается руками. Без БД, без Docker, без крона.
```

**Стало:**
```
# tg-parser-demo

Ежедневный (20:00 MSK) HTML-дайджест событий российского нефтегаза/нефтехимии
за последние 24 часа в закрытом Telegram-канале. Каждая цитата дословно
присутствует в исходном посте — без галлюцинаций LLM.

v2.0: `npm start` — long-running daemon на Node.js + node-cron; на VPS
работает под PM2. Без БД, без Docker, без внешнего крона — всё в одном процессе.
```

### «Запуск в 3 команды» (строка 18)

**Было:** `npm start         # собрать за 24ч → DeepSeek → отправить в канал`
**Стало:** `npm start         # запустить daemon (ежедневно в 20:00 MSK); Ctrl+C — остановить`

### «1. Установка зависимостей» (строка 26)

**Было:** «ровно три runtime-зависимости: telegram, openai, yaml»
**Стало:** «четыре runtime-зависимости: telegram, openai, yaml, node-cron (добавлен в v2.0 для daemon-режима)»

### §5 (строки 55–73)

Полная переработка: заголовок «### 5. Первый прогон» → «### 5. Первый запуск daemon». 5-шаговое описание поведения daemon'а (стартап + ожидание + tick + summary + следующий tick), упоминание Ctrl+C graceful shutdown и reconnect-логики GramJS.

### «## Дисциплина запусков» — УДАЛЕНА

3 параграфа (FloodWait rationale + «не чаще одного прогона в 10–15 минут» + retry-поведение) удалены целиком. Крон теперь контролирует частоту — раз в сутки — без операторской дисциплины.

### Troubleshooting: «Второй FloodWaitError» (строки 170–175)

**Было:** «Второй FloodWaitError подряд → exit 1 … подожди 30–60 минут … соблюдай дисциплину»
**Стало:** «Второй FloodWaitError на одном канале в прогоне → канал skipped + errors[] → следующий tick завтра в 20:00 попробует. Массово → повысь CHANNEL_DELAY_MS до 2500мс»

### Новая секция «## Запуск на VPS (PM2)» (строки 75–118)

Содержит (всё проверено grep'ом):
- `npm install -g pm2` — один раз глобально
- `pm2 start ecosystem.config.cjs` — **расширение .cjs, а не .js (ключевая deviation Rule 1)**
- `pm2 status`, `pm2 logs tg-parser`, `pm2 save`, `pm2 startup` — все 4 канонические pm2-команды
- Operations: restart (+ graceful flow SIGINT→exit 0→respawn), reload, stop, delete
- `pm2 kill && pm2 resurrect` с упоминанием `~/.pm2/dump.pm2`
- Log paths: `--out`, `--err`, `~/.pm2/logs/tg-parser-out.log`, `~/.pm2/logs/tg-parser-error.log`
- Explicit explanation что конфиг в `.cjs` из-за ESM-режима проекта
- 3 key params: kill_timeout=180000, max_restarts=10+min_uptime=30s, max_memory_restart=300M

### Новая секция «## Ежедневный summary-лог» (строки 120–144)

Содержит (всё проверено grep'ом):
- 10-строчный пример `[summary]` блока с runId, duration=58.4s, channels=50/47/3, posts collected=412 deduped=5, delivered=true, 3 примера errors
- 6-пункт референс полей
- Quick-grep команда для последнего summary: `pm2 logs tg-parser --out --nostream | grep -A 20 "\[summary\]" | tail -25`

## Подтверждение 4 команд pm2 документированы

| Команда                          | Строка README | Контекст                                         |
| -------------------------------- | ------------- | ------------------------------------------------ |
| `pm2 start ecosystem.config.cjs` | 84            | Setup step 1 (запуск daemon по конфигу)          |
| `pm2 logs tg-parser`             | 90            | Setup step 3 (tail -f stdout+stderr)             |
| `pm2 save`                       | 93            | Setup step 4 (persist для auto-resurrect)        |
| `pm2 startup`                    | 96            | Setup step 5 (systemd integration, нужны sudo)   |

Дополнительно: `pm2 status`, `pm2 restart tg-parser`, `pm2 reload tg-parser`, `pm2 stop tg-parser`, `pm2 delete tg-parser`, `pm2 kill`, `pm2 resurrect` — полный операционный playbook.

## Decisions Made

- **README использует `ecosystem.config.cjs`, не `.js`:** План (verbatim action-блок) предписывал `pm2 start ecosystem.config.js`. Фактический файл после Plan 06 deviation — `ecosystem.config.cjs` (из-за `"type": "module"` в package.json). Если бы README сохранил `.js`, любой оператор копирующий команду в VPS-терминал получил бы `Error: Cannot find module 'ecosystem.config.js'`. Rule 1 Bug Fix: документация обязана ссылаться на фактический артефакт, а не на plan-шаблон.
- **Добавлено явное объяснение `.cjs` в секции:** Одна строка «расширение `.cjs`, а не `.js`, потому что проект в ESM-режиме» — оператор понимает причину и не пытается переименовывать файл обратно.
- **5 пронумерованных пунктов в §5 Daemon-старт вместо абстрактного описания:** Operational concreteness — оператор видит точную ожидаемую stdout-строку `[<ISO>] [info] daemon started, schedule: 0 20 * * * Europe/Moscow` и может сверить свой вывод grep'ом (канонические log-строки зафиксированы в Plan 02-05 SUMMARY).
- **Troubleshooting FloodWait переписан на skipped+errors:** Семантика daemon-прогона фундаментально отличается от v1.0 one-shot. В v1.0 один канал-FloodWait валил весь прогон (exit 1); в v2.0 это локальный skip + errors[] entry + следующий tick завтра. Сохранение старой формулировки «подожди 30-60 минут и попробуй снова» противоречило бы новой реальности.
- **Порядок секций: §5 Daemon → PM2 → summary-лог → Приёмка:** Логический поток — сначала локальный запуск (знаешь ли как он выглядит), потом VPS-деплой (PM2 playbook), потом диагностика (summary-log), потом приёмка (5 критериев). Оператор может последовательно читать сверху вниз.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] README использует `ecosystem.config.cjs`, не `.js` как в verbatim-плане**

- **Found during:** Task 3 (action-блок, строки `pm2 start ecosystem.config.js` в вербатим-шаблоне)
- **Issue:** Plan 02-07 в action-блоке Task 3 (и в нескольких verbatim grep'ах acceptance-criteria) ссылался на `ecosystem.config.js`. Фактический файл в корне проекта — `ecosystem.config.cjs` (переименован в Plan 02-06 из-за Rule 3 deviation: `"type": "module"` в package.json делает `.js` ESM-файлом, `module.exports` в ESM-scope тихо не экспортирует объект — `require()` возвращает пустой модуль без ошибки). Если бы README сохранил `.js`, VPS-деплой через copy-paste команды из README провалился бы с `Error: Cannot find module './ecosystem.config.js'`.
- **Fix:** Все упоминания `ecosystem.config.js` в секции «## Запуск на VPS (PM2)» заменены на `ecosystem.config.cjs`:
  - `pm2 start ecosystem.config.cjs` — setup step 1
  - `Конфиг daemon'а — в ecosystem.config.cjs` — пояснение в конце секции
- **Дополнительно:** Добавлена одна строка explaining почему файл в `.cjs`: «расширение `.cjs`, а не `.js`, потому что проект в ESM-режиме — `"type": "module"` в `package.json`» — чтобы оператор понимал причину и не попытался переименовать обратно.
- **Files modified:** `README.md` (секция «## Запуск на VPS (PM2)»)
- **Verification:**
  - `grep -q "pm2 start ecosystem.config.cjs" README.md` → exit 0 (PASS)
  - `! grep -q "pm2 start ecosystem.config.js$" README.md && ! grep -q "pm2 start ecosystem.config.js " README.md` → exit 0 (PASS, нет stale `.js`-ссылок)
  - Канонический plan-level §2 grep: `grep -q "pm2 start ecosystem.config" README.md` → exit 0 (PASS — префикс присутствует)
- **Committed in:** `59de634` (Task 3 commit) — правка применена в момент создания секций, отдельного fix-коммита не потребовалось.

**Root cause:** User prompt явно флагировал эту deviation как important: «ecosystem config file is `ecosystem.config.cjs` (not `.js`) because the project is ESM». Plan 02-07 был написан ДО того, как Plan 02-06 deviation стала известна — план ссылался на плановое имя, а не на фактическое. Это классический пример того, почему per-plan deviation tracking должен pробрасываться в зависимые планы автоматически.

**Pattern:** documentation-планы должны ссылаться на фактические артефакты (извлечь имена из предыдущих SUMMARY.md), а не на verbatim-строки плана. Предлагаю в ретроспективе v2.0 добавить правило: «в documentation-планах использовать `{artifact_path_from_deps_summary}` плейсхолдер, резолвящийся при execution из SUMMARY.md зависимых планов».

---

**Total deviations:** 1 auto-fixed (1 bug fix, critical для copy-paste корректности).
**Impact on plan:** Нулевой — содержание и структура секций остались точно как в плане, изменено только имя файла. Все 11 Task 3 acceptance-grep + 4 plan-level verification прошли. План фактически улучшен — без этого fix README был бы бомбой замедленного действия для первого VPS-деплоя.

## Issues Encountered

Единственный блокер — deviation выше (имя файла). Разрешён inline в процессе Task 3 execution. Других проблем не возникало:

- 3 Edit-операции на README → все applied cleanly
- 27 acceptance-grep (7 в Task 1 + 9 в Task 2 + 11 в Task 3) → все прошли с первого раза
- Порядок секций автоматически проверен awk'ом (a=55 < b=75 < c=120 < d=146) — PASS
- Количество `## ` секций: 10 (было 8 + 2 новые - 0 удалённых на top-level; «Дисциплина запусков» была удалена, но взамен добавлены 2 новые) → net +2 как и ожидалось по плану §1

## Threat Flags

Нет новых threat-surfaces. README — чистая документация без исполняемого кода.

- Не раскрывает никаких секретов (`.env`-переменные упомянуты только по имени, без значений).
- Не ссылается на приватные endpoints — все URL публичные (my.telegram.org, BotFather, DeepSeek).
- pm2-команды в README — стандартный PM2 playbook, не содержит опасных флагов (`--force`, `--silent`, etc.).
- `pm2 startup` явно помечена как требующая sudo — оператор осознанно даёт elevated privileges.

Единственная security-рекомендация из самого README: «Не публикуй `TG_SESSION`» — сохранена без изменений в секции «3. Разовая генерация TG_SESSION».

## Known Stubs

Нет. Все новые секции содержат рабочие команды и реальные примеры:

- Все 4 pm2-команды (start, logs, save, startup) — реальные валидные PM2 CLI команды.
- Пример summary-лога содержит реалистичные числа (50 каналов, 47 succeeded, 3 skipped, 412 collected, 5 deduped, 58.4s duration) а не placeholder'ы.
- Errors-примеры используют реальные классы ошибок из кодовой базы: `FloodWait retry exhausted`, `network disconnect after 3 attempts` (из Plan 02-04), `ChannelPrivateError` (стандартная GramJS ошибка).

**Stub-scan по README.md:** нет «TODO», «FIXME», «coming soon», «placeholder», «not available» в новом контенте. Есть одно упоминание «TODO» в ранее существующей части — но это в Troubleshooting секции «DeepSeek вернул невалидный JSON»: «При повторе проблемы — открыть issue» — это не TODO-стаб, а инструкция для оператора.

## Verification Output

**Task 1 acceptance (7/7 PASS):**
- `grep -q "long-running daemon" README.md` ✓
- `grep -q "node-cron" README.md` ✓
- `grep -q "Ctrl+C — остановить" README.md` ✓
- `grep -q "четыре runtime-зависимости" README.md` ✓
- `! grep -q "ровно три runtime-зависимости" README.md` ✓
- `! grep -q "запускается руками" README.md` ✓
- `grep -q "20:00 MSK" README.md` ✓

**Task 2 acceptance (9/9 PASS):**
- `! grep -q "## Дисциплина запусков" README.md` ✓
- `! grep -q "не чаще одного прогона в 10" README.md` ✓
- `! grep -q "не чаще 1 прогона" README.md` ✓
- `grep -q "### 5. Первый запуск daemon" README.md` ✓
- `grep -q "daemon started, schedule: 0 20" README.md` ✓
- `grep -q "graceful shutdown" README.md` ✓
- `` grep -q "Второй \`FloodWaitError\` на одном канале в прогоне" README.md `` ✓
- `grep -q "CHANNEL_DELAY_MS" README.md` ✓
- `grep -q "reconnect" README.md` ✓

**Task 3 acceptance (11/11 PASS, с .cjs deviation):**
- `grep -q "^## Запуск на VPS (PM2)$" README.md` ✓
- `grep -q "pm2 start ecosystem.config.cjs" README.md` ✓ (**.cjs вместо .js — Rule 1 deviation**)
- `grep -q "pm2 logs tg-parser" README.md` ✓
- `grep -q "pm2 save" README.md` ✓
- `grep -q "pm2 startup" README.md` ✓
- `grep -q "kill_timeout: 180000" README.md` ✓
- `grep -q "^## Ежедневный summary-лог$" README.md` ✓
- `grep -q "\[summary\] runId=" README.md` ✓
- `grep -q "channels: total=50 succeeded=" README.md` ✓
- `grep -q "delivered=true" README.md` ✓
- `grep -q "deduped=" README.md` ✓
- Section ordering: `a=55 < b=75 < c=120 < d=146` ✓

**Plan-level verification (4/4 PASS):**
- §1: `grep -c "^## " README.md` = 10 ✓ (было 8 + 2 новых секции, удалена «Дисциплина запусков» → net +2)
- §2: Все 4 pm2-команды присутствуют (startup, save, logs tg-parser, start ecosystem.config) ✓
- §3: `! grep -q "не чаще" README.md` ✓ (старая дисциплина удалена целиком)
- §4: `[summary] runId=` + `delivered=true` оба присутствуют ✓

**Additional safety check:**
- `! grep -q "pm2 start ecosystem.config.js$" README.md && ! grep -q "pm2 start ecosystem.config.js " README.md` ✓ (нет stale `.js`-ссылок в pm2-командах)

## User Setup Required

Никакого setup'а — это documentation-only plan. README читается оператором как часть onboarding:

- Для локального запуска daemon: см. «Запуск в 3 команды» + «5. Первый запуск daemon».
- Для VPS-деплоя: см. «Запуск на VPS (PM2)» (требует SSH-доступ + `npm install -g pm2` + sudo для `pm2 startup`).
- Для диагностики: см. «Ежедневный summary-лог» + Troubleshooting.

**На phase-level UAT после Wave 4 (plans 02-05/02-06/02-07 completed):**
1. Прочесть README end-to-end, убедиться что логика документации соответствует actual behavior daemon'а.
2. Запустить локально `npm start`, сверить stdout с описанием в «5. Первый запуск daemon» (канонические строки цитируемы).
3. На VPS задеплоить по README секции «Запуск на VPS (PM2)» — команды должны работать copy-paste без модификаций (особенно с `.cjs` fix).
4. После первого реального tick в 20:00 MSK сравнить вывод с примером в «Ежедневный summary-лог» — поля должны совпадать по формату.

## Next Phase Readiness

- **Ready for Phase 2 UAT (user acceptance testing):** Последний плановый артефакт фазы — README — создан. Wave 4 завершён полностью. Все 20 требований Phase 2 документированы либо кодом, либо документацией.
- **Ready for v2.0 VPS-деплой:** README содержит end-to-end playbook от локального onboarding до VPS PM2-деплоя с автозапуском после reboot. Оператор имеет copy-paste инструкции.
- **Ready for phase-complete transition:** Все 7 plans из Phase 2 завершены (01: pipeline extract, 02: logger+RunSummary, 03: 50 channels, 04: reconnect, 05: daemon+cron+mutex, 06: PM2 ecosystem, 07: README). `/gsd-transition` для Phase 2 готов.
- **No blockers:** Единственный отложенный айтем этой фазы — Plan 02-05 Task 3 smoke-тест (human-verify), собираемый на phase-level UAT.

## Self-Check: PASSED

- **FOUND:** `README.md` — 10 секций верхнего уровня, 207 строк (было 134), все 27 acceptance-grep прошли.
- **FOUND:** commit `8d7b9ea` (Task 1: docs(02-07): update headline + 3-command section for daemon mode) — `git log --oneline -5` подтверждает.
- **FOUND:** commit `b9ce837` (Task 2: docs(02-07): rewrite section 5 for daemon + remove 'Дисциплина запусков') — `git log --oneline -5` подтверждает.
- **FOUND:** commit `59de634` (Task 3: docs(02-07): add 'Запуск на VPS (PM2)' + 'Ежедневный summary-лог' sections) — `git log --oneline -5` подтверждает.
- **FOUND:** `.planning/phases/02-daemon-50/02-07-SUMMARY.md` (этот файл, создаётся прямо сейчас).
- **CONFIRMED:** порядок секций в README: §5 Daemon (55) → ## VPS/PM2 (75) → ## summary-лог (120) → ## Как проверить (146) — awk-тест PASS.
- **CONFIRMED:** нет упоминаний `ecosystem.config.js` в pm2-командах README (только `.cjs`) — critical copy-paste correctness.
- **CONFIRMED:** все 4 канонические pm2-команды findable через grep: `pm2 start ecosystem.config.cjs`, `pm2 logs tg-parser`, `pm2 save`, `pm2 startup`.

---
*Phase: 02-daemon-50*
*Completed: 2026-04-22*
