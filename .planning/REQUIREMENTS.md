# Requirements: tg-parser-demo

**Defined:** 2026-05-05
**Milestone:** v4.0 Управление каналами + парсинг сайтов
**Core Value:** В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.

## v4.0 Requirements

Requirements for milestone v4.0 «Управление каналами + парсинг сайтов». Each maps to roadmap phases.

### Channel Management (BOT)

- [ ] **BOT-01**: Оператор/Заказчик может просмотреть текущий список каналов через `/channels` (username + priority)
- [ ] **BOT-02**: Оператор/Заказчик может добавить канал через `/add_channel <username>` с валидацией username
- [ ] **BOT-03**: Оператор/Заказчик может удалить канал через `/remove_channel <username>` с inline-подтверждением
- [ ] **BOT-04**: Бот отвечает только пользователям из allowlist (`BOT_ALLOWED_USER_IDS` в env)
- [ ] **BOT-05**: Bot polling запускается внутри daemon-процесса (рядом с cron) без конфликта с GramJS

### Storage Migration (STORE)

- [ ] **STORE-01**: `channels.yaml` мигрирован в `channels.json`; pipeline читает каналы из JSON
- [ ] **STORE-02**: Атомарная запись `channels.json` через `.tmp + rename` с in-process mutex
- [ ] **STORE-03**: Auto-migration при старте daemon (если `channels.json` отсутствует — конвертирует из YAML)

### Web Scraping (WEB)

- [ ] **WEB-01**: Daemon скрейпит список сайтов из `websites.json` (fetch + cheerio) в рамках ежедневного прогона
- [ ] **WEB-02**: Извлечённый контент проходит тот же DeepSeek pipeline (classify по 5 направлениям)
- [ ] **WEB-03**: Web-дайджест отправляется отдельным сообщением в канал Заказчика (не смешивается с TG-дайджестом)
- [ ] **WEB-04**: Валидация извлечённого контента (минимум 200 символов); невалидные страницы пропускаются с логом

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Channel Management (extended)

- **BOT-06**: Per-site CSS-селекторы в конфиге для точного извлечения контента
- **BOT-07**: Inline keyboard для выбора канала при удалении (вместо username в команде)

### Web Scraping (extended)

- **WEB-05**: @mozilla/readability как fallback extractor для сложных страниц
- **WEB-06**: Кросс-прогонная дедупа для web-контента (аналогично hash-cache для TG)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Bot framework (Telegraf/grammY) | 3 команды обслуживаются raw fetch polling (~80 строк); фреймворк добавляет 200-800 KB overhead |
| Webhook mode для бота | Требует внешний URL + SSL; polling достаточен для 2 пользователей |
| Headless browser (Playwright/Puppeteer) | Целевые сайты — статический HTML; cheerio покрывает потребность |
| Ролевая модель (admin/viewer) | Два пользователя с одинаковыми правами; RBAC избыточен |
| Web UI для управления каналами | Telegram-бот покрывает UX для оператора и Заказчика |
| База данных для хранения каналов | JSON-файл с mutex достаточен для ~50 каналов и 2 пользователей |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOT-01 | Phase 2 | Pending |
| BOT-02 | Phase 2 | Pending |
| BOT-03 | Phase 2 | Pending |
| BOT-04 | Phase 2 | Pending |
| BOT-05 | Phase 2 | Pending |
| STORE-01 | Phase 1 | Pending |
| STORE-02 | Phase 1 | Pending |
| STORE-03 | Phase 1 | Pending |
| WEB-01 | Phase 3 | Pending |
| WEB-02 | Phase 3 | Pending |
| WEB-03 | Phase 3 | Pending |
| WEB-04 | Phase 3 | Pending |

**Coverage:**
- v4.0 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-05*
*Last updated: 2026-05-05 — traceability mapped after roadmap creation*
