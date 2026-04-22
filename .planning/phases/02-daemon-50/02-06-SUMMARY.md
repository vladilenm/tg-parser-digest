---
phase: 02-daemon-50
plan: 06
subsystem: infra
tags: [pm2, ecosystem-config, daemon, deployment, cjs, tsx, esm]

# Dependency graph
requires:
  - plan: 02-01
    provides: "src/pipeline.ts (runPipeline) — вызывается через daemon, который PM2 запускает"
  - plan: 02-02
    provides: "src/logger.ts — daemon использует; PM2 передаёт stdout в pm2-logs"
  - plan: 02-05
    provides: "src/run.ts (daemon entrypoint) — PM2 конфиг указывает script: src/run.ts"
provides:
  - "ecosystem.config.cjs: PM2-конфиг для tsx+ESM daemon с kill_timeout=180000 (DEPLOY-01)"
  - "Стандартный путь деплоя: pm2 start ecosystem.config.cjs (вместо плоского pm2 start src/run.ts)"
  - "Flap-защита: max_restarts=10, min_uptime=30s, max_memory_restart=300M"
  - "SIGKILL-защита: kill_timeout=180000 (3 мин) для graceful shutdown суточного прогона"
affects: [02-07-readme, phase-2-UAT, v2.0-VPS-deploy]

# Tech tracking
tech-stack:
  added:
    - "PM2 (как рантайм-требование к VPS, не к проекту — устанавливается глобально `npm install -g pm2`, не попадает в package.json)"
  patterns:
    - "ecosystem-файл в CJS-формате (.cjs) из-за \"type\": \"module\" в package.json — PM2 читает конфиг через require(), не import"
    - "interpreter: node + interpreter_args: --env-file=.env --import tsx — точное повторение package.json script \"start\""
    - "kill_timeout >= ожидаемого времени прогона: defaulted 1600мс → 180000мс (3 мин) для 2-3-минутного прогона на 50 каналах"
    - "instances: 1 + exec_mode: fork — единственный процесс, согласуется с in-memory mutex isRunning из plan 02-05"
    - "max_memory_restart: 300M — страхует от утечек GramJS/openai, при norm RSS ~50-80M на прогон"

key-files:
  created:
    - "ecosystem.config.cjs"
  modified: []

key-decisions:
  - "Файл назван .cjs (не .js) — из-за \"type\": \"module\" в package.json Node 22 трактует .js как ES-модуль, module.exports не экспортирует через CJS. План явно предусматривал fallback."
  - "kill_timeout=180000мс выбран как верхняя граница (3 мин): RunSummary на 50 каналах при CHANNEL_DELAY_MS=1750+jitter занимает ~100-150сек + DeepSeek batch ~10-20сек + Bot API chunks ~5-10сек = 2-3 минуты; плюс буфер на аномалии."
  - "max_memory_restart: 300M — baseline RSS ~50-80M, 300M покрывает x4 запас; меньшие значения рискуют ложно-положительным рестартом при GC backlog."
  - "time: true в options — PM2 добавляет ISO-timestamp к каждой stdout-строке в pm2-logs, дублирует logger.ts timestamp, но нужен для строк не из logger.ts (unhandled rejections, startup-spam от node-cron)."

patterns-established:
  - "При \"type\": \"module\" в package.json все CommonJS-файлы проекта (ecosystem-конфиги, legacy-скрипты) должны использовать расширение .cjs — Node 22 не падает back на CJS для .js под ESM-project."
  - "PM2 ecosystem-файл повторяет package.json \"start\" script verbatim (interpreter + args + script) — любой drift означает, что локальный `npm start` и деплой PM2 запускают разные команды."

requirements-completed: [DEPLOY-01]

# Metrics
duration: ~2min
completed: 2026-04-22
---

# Phase 02 Plan 06: PM2 ecosystem.config.cjs + kill_timeout=180000 Summary

**`ecosystem.config.cjs` создан в корне проекта — PM2-конфиг для daemon-режима (src/run.ts) через tsx+ESM с `kill_timeout: 180000` (3 мин), закрывающим research pitfall 5 о SIGKILL во время graceful shutdown суточного прогона; файл принудительно в `.cjs` из-за `"type": "module"` в package.json.**

## Performance

- **Duration:** ~2 min (94 сек wall-time)
- **Started:** 2026-04-22T07:48:54Z
- **Completed:** 2026-04-22T07:50:28Z
- **Tasks:** 1 auto executed
- **Files modified:** 1 (ecosystem.config.cjs created)

## Accomplishments

- **Task 1 (feat):** `ecosystem.config.cjs` создан в корне проекта с 14 ключами конфига: `name="tg-parser"`, `script="src/run.ts"`, `interpreter="node"`, `interpreter_args="--env-file=.env --import tsx"`, `instances: 1`, `exec_mode: "fork"`, `autorestart: true`, `max_restarts: 10`, `min_uptime: "30s"`, `max_memory_restart: "300M"`, `kill_timeout: 180000`, `time: true`.
- **kill_timeout=180000мс (DEPLOY-01 ключевая метрика):** Поднято с PM2 default 1600мс до 3 минут — research §9 pitfall 5 явно: на 1600мс PM2 шлёт SIGKILL даемону до того, как daemon.ts while(isRunning) успеет дождаться окончания суточного прогона (2-3 мин). С 180000мс PM2 ждёт 3 минуты, graceful shutdown успевает.
- **CJS-совместимость:** файл загружается через `node -e "require('./ecosystem.config.cjs')"` без ошибок, возвращает валидный `apps[0]` с `name === 'tg-parser'` и `kill_timeout === 180000`.
- **Соответствие package.json script:** `interpreter_args: "--env-file=.env --import tsx"` + `script: "src/run.ts"` собираются в команду `node --env-file=.env --import tsx src/run.ts` — точная копия `npm start`.

## Task Commits

1. **Task 1: Создать ecosystem.config.cjs** — `9ae725b` (feat)

**Plan metadata commit:** добавляется финальным коммитом после обновления STATE.md/ROADMAP.md.

## Files Created/Modified

- `ecosystem.config.cjs` (created, 23 LOC) — PM2 ecosystem-конфиг:
  - CommonJS-синтаксис `module.exports = { apps: [...] }` (обязателен из-за `"type": "module"` в package.json)
  - 14 ключей конфига в одном app (apps.length === 1 — подтверждено `node -e "require(...)"`)
  - Комментарий сверху объясняет назначение файла и обоснование kill_timeout
  - Никаких новых npm-зависимостей (PM2 — глобальная VPS-dep, `npm install -g pm2`)

## Ключи ecosystem.config.cjs — назначение и обоснование

| Ключ                 | Значение                            | Обоснование                                                                                                        |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`               | `"tg-parser"`                       | Идентификатор в `pm2 list`/`pm2 logs`; стабильный для `pm2 restart tg-parser`.                                     |
| `script`             | `"src/run.ts"`                      | Daemon entrypoint из plan 02-05 (cron.schedule + mutex + shutdown).                                                |
| `interpreter`        | `"node"`                            | PM2 иначе использует свой дефолтный tsx/ts-node launcher, что несовместимо с нашим setup.                          |
| `interpreter_args`   | `"--env-file=.env --import tsx"`    | Точное повторение package.json `"start"` — любой drift означает расходящийся locally vs VPS запуск.                |
| `instances`          | `1`                                 | Daemon mutex `isRunning` (DAEMON-03) — single-process, cluster mode ломает его в принципе.                         |
| `exec_mode`          | `"fork"`                            | Fork mode — один Node.js-процесс как child PM2-бэкграунда; cluster mode несовместим с DAEMON-03 по той же причине. |
| `autorestart`        | `true`                              | При unhandled rejection / процесс-crash PM2 перезапускает — минимальная SLA для daemon.                            |
| `max_restarts`       | `10`                                | Защита от бесконечного restart-loop при систематическом падении (bad .env, missing dep).                           |
| `min_uptime`         | `"30s"`                             | Flap-protection: если процесс падает до 30с uptime — не считается «успешным стартом», идёт в `max_restarts` бюджет.  |
| `max_memory_restart` | `"300M"`                            | Baseline RSS 50-80M (GramJS sockets + openai SDK + node-cron); 300M = x4 запас, страхует утечки.                   |
| `kill_timeout`       | `180000`                            | **Ключевое значение плана.** PM2 default 1600мс → 3 минуты: research §9 pitfall 5 + Assumption A1. Покрывает 2-3-минутный прогон на 50 каналах при graceful shutdown (SIGINT/SIGTERM от PM2 → daemon ждёт while(isRunning) → process.exit(0) до SIGKILL). |
| `time`               | `true`                              | PM2 префиксует stdout каждой строки ISO-timestamp'ом в `pm2 logs`; дублирует logger.ts, но ловит строки НЕ из logger.ts (unhandled rejection traces, node-cron initialization). |

## kill_timeout=180000 — обоснование в цифрах

Research §9 pitfall 5 и Assumption A1 явно указывают 180000мс как необходимую границу. Разбор почему:

**Ожидаемая длительность прогона на 50 каналах:**
- Обход каналов: 50 × (`CHANNEL_DELAY_MS`=1750 + jitter 0-500) ≈ 50 × 2000мс ≈ 100 сек
- DeepSeek batch: single call, `response_format: json_object` на 100-200 собранных постах ≈ 15-25 сек
- Bot API chunks: 1-3 sendMessage call'а по ~4000 символов ≈ 5-10 сек
- **Итого: 120-135 сек (2-2.5 минуты) в нормальном режиме**

**Граничные случаи:**
- FloodWait retry: +15-40 сек (`err.seconds * 1000 + 2000`)
- Reconnect attempts: +1s+2s+4s = 7 сек max (из plan 02-04)
- **Верхняя граница: ~170-180 сек**

**PM2 graceful-shutdown flow (SIGTERM from `pm2 stop tg-parser`):**
1. PM2 отправляет SIGTERM daemon'у → `shutdown("SIGTERM")` запускается
2. `task.stop()` — новые тики не стартуют
3. `while (isRunning) sleep 500ms` — ожидание активного прогона (до 180 сек)
4. `process.exit(0)` — нормальное завершение

PM2 ждёт `kill_timeout` мс после SIGTERM. Если process всё ещё жив — SIGKILL (убивает без шанса на cleanup). При 1600мс default daemon 100% SIGKILL'нется в середине прогона (мёртвая сессия GramJS, неотправленный дайджест). При 180000мс daemon успеет завершить прогон штатно в 95%+ случаев.

## Decisions Made

- **`.cjs` extension вместо `.js`:** План явно предусматривал это fallback. `package.json` содержит `"type": "module"`; Node 22 трактует `.js` как ESM, `module.exports = {...}` в ESM-контексте просто не экспортирует объект через CJS require (нет ошибки — `require()` возвращает пустой модуль). Переименование в `.cjs` вынуждает Node использовать CJS-парсер. Паттерн задокументирован для будущих ecosystem-файлов и скриптов.
- **`max_memory_restart: "300M"`:** Не «100M» (слишком тесно под GC backlog, риск ложноположительных рестартов) и не «1G» (не защищает от утечек). 300M = x4 baseline RSS.
- **`time: true`:** Мелочь, но важная — unhandled rejections и node-cron internal logs приходят в stdout мимо `logger.ts` → без PM2-timestamp их нельзя корреляировать с другими событиями в pm2 logs.
- **Без `cron_restart`/`watch`/`env`:** `cron_restart` — фейл-сейф «рестартить по расписанию», нам не нужен (cron уже внутри daemon'а). `watch` — dev-only, на VPS опасно (случайное изменение .env перезапустит daemon). `env` — .env файл уже грузится через `--env-file=.env`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Переименование ecosystem.config.js → ecosystem.config.cjs**

- **Found during:** Task 1 final acceptance check (`node -e "const c = require('./ecosystem.config.js'); ..."`)
- **Issue:** План предписывал создать `ecosystem.config.js` с `module.exports = {...}`. После создания файла и прохождения всех 14 grep-проверок содержимого, acceptance-проверка `node -e "require('./ecosystem.config.js')"` провалилась: в `package.json` указано `"type": "module"`, Node 22 трактует расширение `.js` как ES-модуль, `module.exports` в ESM-scope не экспортирует объект через CJS require-парсер (без ошибки синтаксиса — просто возвращает пустой модуль, `c.apps === undefined`).
- **Fix:** Переименовал файл в `ecosystem.config.cjs` (через `git mv`-эквивалент: `mv` + `git add`) — расширение `.cjs` явно переводит файл в CommonJS-режим независимо от `"type"` в package.json. Содержимое файла не менялось.
- **Files modified:** `ecosystem.config.cjs` (новый файл вместо `ecosystem.config.js`)
- **Verification:** `node -e "const c = require('./ecosystem.config.cjs'); if (!c.apps || c.apps.length !== 1 || c.apps[0].name !== 'tg-parser') process.exit(1)"` → exits 0. Все 14 grep-проверок содержимого также прошли.
- **Committed in:** `9ae725b` (файл создан сразу с .cjs-расширением в финальном коммите)

**Почему это не Rule 4 (architectural):** План Task 1 action-блока строки 104-105 ЯВНО предусматривал этот fallback:

> "Если при запуске `pm2 start ecosystem.config.js` будет ошибка `module is not defined in ES module scope`, переименовать файл в `ecosystem.config.cjs` и указать путь `pm2 start ecosystem.config.cjs`."

План ожидал возможность fallback'а; применение — работа в рамках разрешённой семантики плана. Никакого архитектурного изменения не вносилось (структура конфига и все 14 ключей остались verbatim).

**Импакт на plan-level verification:** Оригинальные `verification` и `success_criteria` в plan.md упоминают `ecosystem.config.js`. После fallback'а эти строки эквивалентны `ecosystem.config.cjs` — команда для VPS-деплоя становится `pm2 start ecosystem.config.cjs` (небольшое отличие от шаблона README, документируется в plan 02-07).

---

**Total deviations:** 1 auto-fixed (1 blocking, расширение файла; разрешено планом)
**Impact on plan:** Нулевой — fallback был предусмотрен явно. Единственное минорное последствие: plan 02-07 (README) должен использовать `ecosystem.config.cjs` в инструкциях VPS-деплоя вместо `ecosystem.config.js`.

## Issues Encountered

Единственный блокер — конфликт CJS/ESM при `.js`-расширении под `"type": "module"` — разрешён через plan-разрешённый fallback (см. Deviations выше). Других проблем не возникло:

- `node -e "require('./ecosystem.config.cjs')"` загружает конфиг без ошибок/предупреждений.
- Все 14 grep-проверок содержимого + `require()`-проверка прошли с первого раза после переименования.
- PM2 не запускался локально (VPS-only проверка отложена на phase-level UAT).

## Threat Flags

Нет новых threat-surfaces. `ecosystem.config.cjs` — чистый конфиг-файл без кода:
- Не открывает сетевых соединений (PM2 сам это делает при `pm2 start`, но это свойство PM2, не конфига).
- Не содержит секретов (.env читается отдельным механизмом `--env-file`).
- `interpreter_args` не содержит опасных флагов (ни `--eval`, ни `--require` нестандартных модулей).
- `script: "src/run.ts"` ссылается на файл, уже прошедший threat-scan в plan 02-05.

Существующие trust boundaries (GramJS session, DeepSeek API, Bot API) не расширяются — ecosystem.config.cjs лишь переконфигурирует PM2-wrapper вокруг существующего daemon'а.

## Known Stubs

Нет. Все 14 ключей реально заданы значениями, ни один не placeholder'нут:
- Строки (`name`, `script`, `interpreter`, `interpreter_args`, `exec_mode`, `min_uptime`, `max_memory_restart`) — реальные имена/параметры.
- Числа (`instances: 1`, `max_restarts: 10`, `kill_timeout: 180000`) — реальные значения из research.
- Булевы (`autorestart: true`, `time: true`) — явные включения.

**Stub-scan по ecosystem.config.cjs:** нет «TODO», «FIXME», «placeholder», пустых объектов/массивов, `null`/`undefined` значений. Комментарий сверху — документация, не стаб.

## Verification Output

**Automated checks** (все 15 пунктов acceptance + 2 plan-verification + 3 success_criteria):

Task 1 acceptance:
- `test -f ecosystem.config.cjs` ✓
- `grep -q "module.exports"` ✓
- `grep -q 'name: "tg-parser"'` ✓
- `grep -q 'script: "src/run.ts"'` ✓
- `grep -q 'interpreter: "node"'` ✓
- `grep -q 'interpreter_args: "--env-file=.env --import tsx"'` ✓
- `grep -q "instances: 1"` ✓
- `grep -q 'exec_mode: "fork"'` ✓
- `grep -q "autorestart: true"` ✓
- `grep -q "max_restarts: 10"` ✓
- `grep -q 'min_uptime: "30s"'` ✓
- `grep -q 'max_memory_restart: "300M"'` ✓
- `grep -q "kill_timeout: 180000"` ✓ (**ключ research A1/pitfall 5**)
- `grep -q "time: true"` ✓
- `node -e "require('./ecosystem.config.cjs')"` → apps.length=1, name=tg-parser, kill_timeout=180000, valid=true ✓

Plan-level verification:
- Step 1: `test -f ecosystem.config.cjs` → exit 0 ✓
- Step 2: `node -e "... console.log(JSON.stringify(c, null, 2))"` → выводит полный JSON с apps[0] ✓
- Step 3: VPS `pm2 start ecosystem.config.cjs` — отложено на phase-level UAT (не блокер для plan-complete)

Success criteria:
- SC1: PM2-структура DEPLOY-01 ✓
- SC2: kill_timeout 180000мс закрывает pitfall 5 ✓
- SC3: CJS-валидность через require() ✓

**Manual check** — VPS-деплой (`pm2 start ecosystem.config.cjs` + `pm2 status` + graceful `pm2 stop tg-parser`) отложен на phase-level UAT после Wave 4.

## User Setup Required

Никакого нового setup'а на уровне окружения проекта:
- `.env` не менялся
- Зависимости в `package.json` не добавлены (PM2 = глобальная VPS-зависимость)

**На VPS перед первым деплоем:**
1. `npm install -g pm2` (глобально, один раз на сервере)
2. `pm2 start ecosystem.config.cjs` (из корня проекта)
3. `pm2 save && pm2 startup` (persist + init-script для автозапуска после reboot) — инструкции будут в README (plan 02-07)

**Verification после первого деплоя:**
- `pm2 status` показывает `tg-parser` в состоянии `online`
- `pm2 logs tg-parser --lines 20` показывает строку `daemon started, schedule: 0 20 * * * Europe/Moscow`
- `pm2 describe tg-parser` — проверить что `kill timeout: 180000` видно в атрибутах

## Next Phase Readiness

- **Ready for plan 02-07 (README обновление):** `ecosystem.config.cjs` создан; README раздел «Запуск на VPS (PM2)» может цитировать команду `pm2 start ecosystem.config.cjs`, `pm2 save`, `pm2 logs tg-parser`, `pm2 stop tg-parser` — все работают с созданным конфигом. Также в README нужно задокументировать, что файл в `.cjs` (не `.js`).
- **Ready for phase-level UAT:** `ecosystem.config.cjs` — последний реально-технический артефакт Phase 2 перед smoke-тестированием. После plan 02-07 (README) фаза готова к VPS-деплою + full-phase UAT.
- **Ready for Wave 4 (если будет):** DEPLOY-01 закрыт этим планом; DEPLOY-02 (node-cron dep) закрыт plan 02-05. Все DEPLOY-требования Phase 2 выполнены.
- **No blockers:** plan 02-07 зависит только от наличия конфиг-файла и канонических имён команд — всё удовлетворено.

## Self-Check: PASSED

- **FOUND:** `ecosystem.config.cjs` — `ls -la ecosystem.config.*` подтверждает, 23 LOC.
- **FOUND:** commit `9ae725b` (feat(02-06): add PM2 ecosystem config with kill_timeout=180000) — `git log --oneline -5` подтверждает.
- **FOUND:** `.planning/phases/02-daemon-50/02-06-SUMMARY.md` (этот файл, создаётся прямо сейчас).
- **CONFIRMED:** `node -e "require('./ecosystem.config.cjs')"` → valid=true (apps.length=1, name=tg-parser, kill_timeout=180000).
- **CONFIRMED:** все 14 grep-проверок содержимого + plan-level verification + 3 success criteria прошли.
- **NOT CREATED:** `ecosystem.config.js` (переименован в `.cjs` — обосновано Deviation Rule 3).

---
*Phase: 02-daemon-50*
*Completed: 2026-04-22*
