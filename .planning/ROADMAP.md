# Roadmap: tg-parser-demo

**Milestone:** v4.0 — Управление каналами + парсинг сайтов
**Defined:** 2026-05-05

## Overview

v3.0 поставил структурированный дайджест с дедупой, архивами и алертами. v4.0 добавляет
два независимых блока: программное управление списком каналов через Telegram-бота (вместо
ручного редактирования YAML) и парсинг веб-сайтов с доставкой отдельной веб-сводки в тот
же канал Заказчика. Основа — миграция хранилища каналов с YAML на JSON с in-process mutex,
после чего все три ветки (хранилище, бот, скрейпер) сходятся в единый pipeline.

## Phases

- [ ] **Phase 1: Storage Migration** - Миграция channels.yaml → channels.json с mutex-защитой и атомарной записью
- [ ] **Phase 2: Bot Commands** - Telegram-бот с тремя командами управления каналами и allowlist-авторизацией
- [ ] **Phase 3: Web Scraping** - Скрейпинг веб-сайтов через cheerio с DeepSeek pipeline и отдельной доставкой

## Phase Details

### Phase 1: Storage Migration
**Goal**: Pipeline и бот читают список каналов из `channels.json` с гарантией атомарных записей и нулевым риском race condition при одновременном обращении бота и cron
**Depends on**: Nothing (first phase of v4.0)
**Requirements**: STORE-01, STORE-02, STORE-03
**Success Criteria** (what must be TRUE):
  1. `npm start` запускается, daemon читает каналы из `channels.json` и доставляет сводку — ни одна из v3.0 функций не сломана
  2. При отсутствии `channels.json` на старте daemon автоматически конвертирует `channels.yaml` и продолжает работу без ручного вмешательства оператора
  3. Запись в `channels.json` через `channels-store` никогда не оставляет файл в повреждённом состоянии — даже при одновременном обращении (mutex + `.tmp + rename`)
**Plans**: TBD

### Phase 2: Bot Commands
**Goal**: Оператор и Заказчик управляют списком каналов через три команды Telegram-бота (`/channels`, `/add_channel`, `/remove_channel`) без доступа посторонних пользователей, polling-цикл работает внутри daemon без конфликта с GramJS
**Depends on**: Phase 1
**Requirements**: BOT-01, BOT-02, BOT-03, BOT-04, BOT-05
**Success Criteria** (what must be TRUE):
  1. Отправка `/channels` из аккаунта оператора или Заказчика возвращает актуальный список каналов (username + priority); любой другой пользователь получает отказ без исключения в daemon
  2. `/add_channel @newchannel` добавляет канал в `channels.json`, daemon использует его при следующем прогоне в 20:00 MSK
  3. `/remove_channel @channel` с подтверждением через inline-кнопку удаляет канал из `channels.json`; отмена — список не меняется
  4. Перезапуск daemon через `pm2 restart` не создаёт 409 Conflict и не теряет очередь команд бота
**Plans**: 4 plans
- [ ] 02-01-PLAN.md — Bot core (polling + auth + /channels + /add_channel + CRUD wrappers + .env.example)
- [ ] 02-02-PLAN.md — /remove_channel с inline-keyboard и callback_query handler
- [ ] 02-03-PLAN.md — Daemon integration (run.ts: bot supervisor + graceful shutdown)
- [ ] 02-04-PLAN.md — Vitest тесты для bot-handlers + README «Команды бота»

### Phase 3: Web Scraping
**Goal**: Ежедневный прогон дополняется скрейпингом сайтов из `websites.json`; веб-контент проходит тот же DeepSeek-pipeline и доставляется отдельным сообщением в канал Заказчика после TG-дайджеста
**Depends on**: Phase 1
**Requirements**: WEB-01, WEB-02, WEB-03, WEB-04
**Success Criteria** (what must be TRUE):
  1. После прогона в канале Заказчика появляются два отдельных сообщения: TG-дайджест (как прежде) и веб-дайджест по тем же 5 направлениям
  2. Недоступный или пустой сайт (< 200 символов текста) пропускается с записью в лог — pipeline не падает и TG-дайджест доставляется в любом случае
  3. Извлечённые цитаты в веб-дайджесте присутствуют дословно в HTML исходной страницы (экстрактивная проверка аналогична TG-дайджесту)
**Plans**: TBD
**UI hint**: no

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Storage Migration | 0/TBD | Not started | - |
| 2. Bot Commands | 0/TBD | Not started | - |
| 3. Web Scraping | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-05 — v4.0 milestone, phase numbers reset from 1*
*Phase numbering: RESET mode (new milestone, start at 1)*
*Coverage: 12/12 v4.0 requirements mapped — Phase 1 (3 REQ) + Phase 2 (5 REQ) + Phase 3 (4 REQ)*
