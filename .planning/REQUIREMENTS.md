# Requirements: tg-parser-demo

**Defined:** 2026-04-26
**Milestone:** v3.0 Structured digest + persistence + Stage 1 acceptance
**Core Value:** В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.
**Source spec:** [docs/intent-v3.0.md](../docs/intent-v3.0.md) (utter milestone-context, утверждён оператором 2026-04-26)
**Deadline:** 2 рабочих дня на код, 7-day smoke до 22.05.2026 (срок Этапа 1+2 договора №2020)

## v3.0 Requirements

Требования для milestone v3.0. Каждое REQ-ID мапится на ровно одну фазу в `ROADMAP.md`. Категории и нумерация — из `docs/intent-v3.0.md` (DOC- продолжает v2.0 DOC-01..03 → v3.0 начинает с DOC-04).

### Structured Digest (STRUCT)

- [ ] **STRUCT-01**: DeepSeek-prompt и `summarize.ts` возвращают строгий JSON с 5 направлениями (`bunker`, `oil`, `kerosene`, `petrochem`, `bitumen`) и блоком `mentions` с компаниями (`rosneft`, `lukoil`, `gazprom`); каждая позиция содержит `keyQuote`, `url`, `channel`
- [ ] **STRUCT-02**: Ответ DeepSeek валидируется Zod-схемой v3.0; при невалидной схеме выполняется retry x1 (повторный запрос с усилением требования формата); повторный fail → throw в pipeline (триггерит ALERT-02)
- [ ] **STRUCT-03**: Пост, который LLM не отнёс ни к одной из 5 категорий и без упоминаний 3 компаний, отбрасывается (drop, не fallback в «прочее»); количество отброшенных учитывается в `RunSummary.postsDropped`

### Render (RENDER)

- [ ] **RENDER-01**: JSON-ответ DeepSeek рендерится в Markdown с секциями по 5 направлениям + блок «Упоминания компаний»; пустые секции явно помечаются строкой `— нет упоминаний за сутки`
- [ ] **RENDER-02**: Каждая новость в Markdown содержит deep-link формата `https://t.me/<channel>/<msgId>` (вычисляется из `username` канала и `messageId` поста)
- [ ] **RENDER-03**: Сообщение длиной >4096 символов разбивается на сегменты с нумерацией `(i/N)` (порог снижен до ~4000 для запаса под Markdown-разметку); алгоритм нарезки сохраняет границы секций, не рвёт item посередине

### Deduplication (DEDUP)

- [ ] **DEDUP-01**: Каждый собранный пост нормализуется (lowercase, удаление эмодзи, удаление пунктуации, обрезка до первых 200 символов) и хешируется SHA-256; полученный hash используется как ключ дедупы; повторно встречающийся hash отбрасывается до отправки в LLM
- [ ] **DEDUP-02**: Хеши сохраняются в `data/hash-cache.json` с timestamp; cache rolling 14 дней — при загрузке записи старше 14 суток отфильтровываются; запись cache атомарная через `.tmp + rename`

### Archives (ARCH)

- [ ] **ARCH-01**: На каждом прогоне все собранные сообщения (до дедупа и LLM) сохраняются в `data/raw/YYYY-MM-DD.json` (массив объектов с `username`, `messageId`, `text`, `date`, `url`); атомарная запись через `.tmp + rename`
- [ ] **ARCH-02**: Финальная сводка, идентичная отправленной в Telegram, сохраняется в `data/output/YYYY-MM-DD.md` (Markdown того же содержания, что улетает Заказчику); атомарная запись через `.tmp + rename`

### Alerting (ALERT)

- [ ] **ALERT-01**: Отдельный alert-bot конфигурируется через `BOT_TOKEN_ALERTS` и `ALERTS_CHAT_ID` в `.env`; новый модуль `src/alert.ts` шлёт сообщения в личку владельца через Bot API `sendMessage`; добавлено в `.env.example` с пояснением
- [ ] **ALERT-02**: Pipeline-обёртка (вокруг `runPipeline()` в `src/run.ts`) ловит любую необработанную ошибку и шлёт алерт владельцу с полями `stage`, `error.message`, `runId`, `stack`; алерт уходит в течение 60 секунд после возникновения ошибки; в канал Заказчика на этой ошибке тишина

### Documentation (DOC)

- [ ] **DOC-04**: `docs/RUNBOOK.md` описывает 5 сценариев сбоя с пошаговыми действиями оператора: (1) DeepSeek возвращает 5xx, (2) Telegram FloodWait/rate-limit, (3) парсер не видит канал (ChannelPrivate/UsernameInvalid), (4) диск переполнен (data/ или pm2 logs), (5) network down на VPS
- [ ] **DOC-05**: `docs/CHANNELS.md` описывает full lifecycle канала: добавление в `channels.yaml`, проверка подписки user-аккаунта, удаление канала, карантин (временное отключение через priority/comment), процедура замены PLACEHOLDER_NN из v2.0

### Acceptance (ACCEPT)

- [ ] **ACCEPT-01**: 7 последовательных суток daemon отдаёт сводку в канал Заказчика без ручного вмешательства; ежедневный uptime подтверждается `pm2 logs`-выпиской и наличием `data/output/YYYY-MM-DD.md` за каждый из 7 дней
- [ ] **ACCEPT-02**: Acceptance-пакет собран в `acceptance/` директории: заполненное Приложение №2 договора (Отчёт), 7 скриншотов сводок из канала Заказчика, лог-выписка с uptime daemon (`pm2 list` + `pm2 logs --lines 1000`), 3 markdown-файла документации (RUNBOOK.md, CHANNELS.md, ABOUT.md или аналог)

## Future Requirements

Отложены на будущие milestone (v4.0+):

### Verification (Stage 2 договора, v4.0)

- **VERIFY-01**: Верификация цен/событий по официальным источникам (Минэнерго, СПИМЭКС, ФАС)
- **VERIFY-02**: Cross-check между Telegram-источниками и публичной отчётностью

### Semantic Dedupe (v4.0+)

- **PERSIST-01**: Postgres-хранилище постов/дайджестов (миграции, connection pool)
- **PERSIST-02**: Semantic dedupe через `text-embedding-3-small` + pgvector (если лексическая SHA-256 даст ложные пропуски)
- **PERSIST-03**: Расширение окна дедупы за 14 суток (зависит от наблюдаемой частоты повторов)

### Pricing (v5.0)

- **PRICE-01**: Подключение Bitsab или аналога для ценовых данных нефтепродуктов
- **PRICE-02**: Сопоставление новостных событий с движением цен

### Dashboard (v5.0)

- **DASH-01**: Веб-дашборд с историей сводок и метриками pipeline
- **DASH-02**: Графики uptime, drop-rate, частоты упоминаний компаний

### Training (Stage 3 договора, v7.0)

- **TRAIN-01**: Видео-обучение оператора Заказчика
- **TRAIN-02**: Обучающие материалы по добавлению/удалению каналов

### Abstractions

- **ABSTRACT-01**: `LLMProvider` интерфейс (появится когда будет второй провайдер)
- **ABSTRACT-02**: `Deliverer` интерфейс (появится когда понадобится вторая цель доставки)

### Scope Extensions

- **SCOPE-01**: Приватные каналы по invite hash
- **SCOPE-02**: Multi-tenancy (несколько TG-сессий/каналов доставки/Заказчиков)

## Out of Scope

Явно исключено из v3.0. Документируем, чтобы не разъехался scope под давлением дедлайна.

| Feature | Reason |
|---------|--------|
| Семантический dedupe через embeddings | Лексическая SHA-256 дедупа достаточна для повторов внутри 14-дневного окна одного оператора; embeddings + pgvector — отдельная инфраструктура, оправданная только при наблюдаемых ложных пропусках |
| Реляционная/векторная БД (Postgres/pgvector) | v3.0 закрывает дедуп и архив на ФС через `hash-cache.json` + `data/raw|output/*`; БД оправдана только при росте каналов/историй за пределы файлового подхода |
| Веб-админка для управления каналами | `docs/CHANNELS.md` + `channels.yaml` + ручной деплой PM2 покрывают operator-flow; админка — это второй сервис, не оправдана для одного оператора |
| Верификация по официальным источникам (Минэнерго/СПИМЭКС/ФАС) | Это Stage 2 договора → v4.0; в v3.0 фокус на структурированной выдаче и приёмке Этапа 1 |
| Bitsab/ценовые системы | Stage 5+ договора → v5.0; v3.0 не требует ценового контекста для приёмки Этапа 1 |
| Дашборды (Grafana/Metabase) | v5.0; v3.0 наблюдается через `pm2 logs` + alert-bot + `data/output/*.md` — достаточно для оператора и acceptance |
| Обучающие материалы для оператора Заказчика | Stage 3 договора → v7.0; в v3.0 пишем RUNBOOK + CHANNELS — это оперативная документация, не обучение |
| Multi-tenancy (несколько TG-сессий, несколько каналов доставки) | Один оператор, один Заказчик, один канал доставки + один alert-чат владельца — никакой мультитенантности |
| Приватные каналы по invite hash | Поддерживаем только публичные по `username`; private + invite-hash — отдельный инженерный путь, не оправдан в Stage 1 |
| Ретраи pipeline на падении DeepSeek/Telegram (помимо STRUCT-02 retry x1 на схеме) | Daemon ждёт следующий тик в 20:00 MSK; alert-bot уведомляет оператора немедленно — оператор решает рестарт вручную |
| Автотесты unit/E2E | v3.0 проверяется ручным smoke-pack + 7-day uptime acceptance; CI/тесты пока не подключаем (нет второго инженера) |
| Unicode NFC fix в `keyQuote.includes()` (IN-01 v1.0 backlog) | Не блокирует v3.0; всплывёт при наблюдении ложных drop'ов на Zod-валидации; перенос в backlog v3.1 |
| chunkHtml edge cases (v1.0 REVIEW warnings) | v1.0 backlog; v3.0 пишет новый Markdown-рендер (RENDER-03), эти кейсы не задеваются |
| Разворот `console.warn/error` → `log.*` в `telegram.ts:134-152` (v2.0 backlog) | Не блокирует v3.0; зачистить попутно если будем менять `telegram.ts` для STRUCT/RENDER задач |
| GitHub Actions/systemd таймер | `node-cron` внутри daemon уже планирует, вторая схема избыточна |
| Docker / docker-compose | PM2 + Node-runtime на VPS достаточно; Docker оправдан только при появлении второго сервиса |
| `LLMProvider`/`Deliverer` абстракции | Один DeepSeek, один канал доставки; абстракции появятся при появлении второго кандидата |
| RAG / сторонние интеграции | Вне v3.0 (как и в v1.0/v2.0 Out of Scope) |

## Traceability

Соответствие требований фазам. Заполняется `gsd-roadmapper`-агентом при создании ROADMAP.md.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STRUCT-01 | Phase TBD | Pending |
| STRUCT-02 | Phase TBD | Pending |
| STRUCT-03 | Phase TBD | Pending |
| RENDER-01 | Phase TBD | Pending |
| RENDER-02 | Phase TBD | Pending |
| RENDER-03 | Phase TBD | Pending |
| DEDUP-01 | Phase TBD | Pending |
| DEDUP-02 | Phase TBD | Pending |
| ARCH-01 | Phase TBD | Pending |
| ARCH-02 | Phase TBD | Pending |
| ALERT-01 | Phase TBD | Pending |
| ALERT-02 | Phase TBD | Pending |
| DOC-04 | Phase TBD | Pending |
| DOC-05 | Phase TBD | Pending |
| ACCEPT-01 | Phase TBD | Pending |
| ACCEPT-02 | Phase TBD | Pending |

**Coverage:**
- v3.0 requirements: 16 total
- Mapped to phases: 0 (pending roadmapper)
- Unmapped: 16 ⚠️ — будут смаплены `gsd-roadmapper` при создании ROADMAP.md

## Suggested wave structure (from intent-v3.0.md)

Подсказка для `gsd-roadmapper` — оператор предложил такую структуру в `docs/intent-v3.0.md`:

- **Wave 1 (parallel):** STRUCT-01..03, RENDER-01..03 — критическая ценность для Заказчика, ранжированный дайджест с deep-link
- **Wave 2 (parallel):** DEDUP-01..02, ARCH-01..02 — техническая зрелость, файловое состояние + дедуп
- **Wave 3 (parallel):** ALERT-01..02, DOC-04..05 — наблюдаемость + оперативная документация
- **Wave 4 (checkpoint):** ACCEPT-01..02 — 7-day smoke + сборка пакета приёмки (блокирующий human-checkpoint)

Roadmapper решает: одна YOLO-фаза с 4 wave-группами (по образцу v2.0) или 4 атомарных фазы. ACCEPT-* почти наверняка отдельная фаза-checkpoint после кода.

---
*Requirements defined: 2026-04-26*
*Source: docs/intent-v3.0.md (утверждено оператором 2026-04-26)*
*Traceability pending: ждёт gsd-roadmapper*
