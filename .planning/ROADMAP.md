# Roadmap: tg-parser-demo

**Milestone:** v3.0 — Structured digest + persistence + Stage 1 acceptance
**Defined:** 2026-04-26
**Deadline:** 2 рабочих дня на код, 7-day smoke до 22.05.2026

## Overview

v2.0 поставил daemon на PM2, который читает 50 каналов и шлёт дайджест в 20:00 MSK —
но без структуры по направлениям, без кросс-прогонной дедупы и без acceptance-пакета
Этапа 1 договора. v3.0 закрывает эти три долга и создаёт доказательную базу для подписания
Акта Этапа 1 (Роснефть через ИП-посредника, 275к второго платежа).

Roadmap строится как **2 фазы: одна YOLO-фаза кода + один blocking checkpoint приёмки**.

**Обоснование 2-фазовой структуры (не 4):**
4 wave-группы из intent-v3.0.md — это отличная подсказка для **порядка планов внутри
фазы**, но не основание для 4 отдельных фаз. Причины:

1. **Дедлайн 2 рабочих дня**: каждая фаза-граница стоит дополнительных transition/review
   артефактов — при жёстком дедлайне это чистые потери. v2.0 доказал: YOLO-фаза с
   упорядоченными планами (7 планов, один прогон) быстрее, чем 4 миникоммита.
2. **Wave-группы не дают верифицируемого промежуточного артефакта**: RENDER без STRUCT не
   тестируется, DEDUP без ARCH теряет смысл (rolling cache нужно проверить вместе с
   архивами). Нет естественной delivery boundary между волнами.
3. **ACCEPT — структурно иная работа**: требует 7 календарных дней живого runtime после
   деплоя кода. Это не продолжение разработки, а human-checkpoint. Он физически не может
   начаться до завершения Phase 1 и запуска daemon на VPS.

Wave-порядок (STRUCT/RENDER → DEDUP/ARCH → ALERT/DOC) сохраняется как **порядок планов
внутри Phase 1**, что даёт тот же приоритет без фазовых потерь.

## Phases

- [ ] **Phase 1: Code** - Структурированный дайджест, дедупа, архивы, алерты, документация (14 REQ)
- [ ] **Phase 2: Accept** - 7-day smoke-acceptance + сборка пакета приёмки (blocking human-checkpoint)

## Phase Details

### Phase 1: Code
**Goal**: Daemon доставляет структурированный дайджест по 5 направлениям с deep-link,
кросс-прогонной дедупой, ФС-архивами, alert-ботом в личку владельца и оперативной
документацией — готов к 7-day smoke-acceptance
**Depends on**: Nothing (first phase of v3.0; v2.0 daemon on VPS is prerequisite operator action)
**Requirements**: STRUCT-01, STRUCT-02, STRUCT-03, RENDER-01, RENDER-02, RENDER-03, DEDUP-01, DEDUP-02, ARCH-01, ARCH-02, ALERT-01, ALERT-02, DOC-04, DOC-05
**Wave order for plans** (not phases — implementation priority within this phase):
  - Wave 1: STRUCT-01..03, RENDER-01..03 — критическая ценность, ранжированный дайджест
  - Wave 2: DEDUP-01..02, ARCH-01..02 — техническая зрелость, файловое состояние
  - Wave 3: ALERT-01..02, DOC-04..05 — наблюдаемость + оперативная документация
**Success Criteria** (what must be TRUE):
  1. Сводка в Telegram-канале Заказчика разбита на 5 именованных секций (бункер/масла/керосин/нефтехимия/битум) + блок «Упоминания компаний»; каждая пустая секция явно помечена `— нет упоминаний за сутки` — не молчит и не показывает undefined/null
  2. Каждый item в сводке содержит кликабельный deep-link `https://t.me/<channel>/<msgId>` ведущий на исходный пост в Telegram
  3. После `pm2 restart` (перезапуска daemon на VPS) новости из вчерашней сводки не появляются повторно в следующей — hash-cache пережил рестарт
  4. Файлы `data/raw/YYYY-MM-DD.json` и `data/output/YYYY-MM-DD.md` появляются в директории после каждого прогона daemon; `data/output/*.md` содержит тот же текст, что был отправлен в канал Заказчика
  5. Любая необработанная ошибка pipeline (DeepSeek timeout, Zod-мисматч после retry, сетевой сбой) порождает алерт в личку владельца за ≤60 секунд; в канал Заказчика на этой ошибке не уходит ничего
  6. `npx tsc --noEmit` завершается без ошибок на итоговом коде
**Plans**: TBD

### Phase 2: Accept
**Goal**: 7 последовательных суток daemon отдаёт сводку без ручного вмешательства,
acceptance-пакет собран и готов к передаче Заказчику для подписания Акта Этапа 1
**Depends on**: Phase 1 (shipped + daemon live on VPS) AND 7 calendar days of runtime
**Blocking checkpoint**: Phase 2 cannot begin until Phase 1 code is deployed and PM2 daemon
is running live on VPS. The 7-day window is calendar time, not implementation time.
**Requirements**: ACCEPT-01, ACCEPT-02
**Success Criteria** (what must be TRUE — human-runtime-verifiable, not code-verifiable):
  1. В директории `data/output/` присутствуют 7 файлов `YYYY-MM-DD.md` с последовательными датами (без пропусков) — каждый соответствует дню непрерывной работы daemon
  2. В `acceptance/` директории собраны: заполненное Приложение №2 договора (Отчёт), 7 скриншотов сводок из канала Заказчика (по одному за каждые сутки), лог-выписка `pm2 list` + `pm2 logs --lines 1000`, и 3 markdown-файла документации (RUNBOOK.md, CHANNELS.md, и третий — README или ABOUT)
  3. Оператор (владелец) может передать `acceptance/` директорию Заказчику (Роснефть через ИП-посредника) как доказательную базу для подписания Акта Этапа 1 договора №2020 и получения второго платежа 275к
**Plans**: TBD
**UI hint**: no

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Code | 0/TBD | Not started | - |
| 2. Accept | 0/TBD | Not started | - |

---
*Roadmap created: 2026-04-26 — v3.0 milestone, phase numbers reset from 1*
*Phase numbering: RESET mode (new milestone, start at 1)*
*Coverage: 16/16 v3.0 requirements mapped — Phase 1 (14 REQ) + Phase 2 (2 REQ)*
