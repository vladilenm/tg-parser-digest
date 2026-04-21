# Requirements: tg-parser-demo

**Defined:** 2026-04-21
**Core Value:** За один `npm start` получить в закрытом Telegram-канале дайджест событий нефтегаза за последние 24 часа, в котором каждая цитата дословно присутствует в исходном посте.

## v1 Requirements

Требования для MVP. Каждое маппится на одну фазу в ROADMAP.md.

### Конфиг и окружение (CFG)

- [ ] **CFG-01**: `package.json` с `"type": "module"`, скриптами `login` (`tsx scripts/login.ts`) и `start` (`node --env-file=.env --import tsx src/run.ts`), dependencies: `telegram`, `openai`, `yaml`; devDependencies: `tsx`, `typescript`, `@types/node`
- [ ] **CFG-02**: `tsconfig.json` — `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `noEmit: true`
- [ ] **CFG-03**: `.env.example` со всеми переменными (TG_API_ID, TG_API_HASH, TG_SESSION, TG_BOT_TOKEN, TG_CHANNEL_ID, DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_BASE_URL, FETCH_WINDOW_HOURS, MAX_MESSAGES_PER_CHANNEL, CHANNEL_DELAY_MS, LOG_LEVEL) и комментариями, где их брать
- [ ] **CFG-04**: `channels.yaml` с 10–15 публичными `username` каналов российского нефтегаза/нефтехимии (`neftegazru`, `oilfornication` и аналогичные), поле `priority` зарезервировано
- [ ] **CFG-05**: `.gitignore` защищает `.env`, `node_modules/`, build-артефакты

### Сессия пользователя (AUTH)

- [ ] **AUTH-01**: `scripts/login.ts` создаёт `TelegramClient` с пустым `StringSession("")` и вызывает `client.start({ phoneNumber, phoneCode, password })` с интерактивным вводом через `readline`
- [ ] **AUTH-02**: После успешного логина скрипт печатает `client.session.save()` и завершает процесс; пользователь копирует значение вручную в `.env` как `TG_SESSION`

### Чтение каналов (FETCH)

- [ ] **FETCH-01**: `createClient()` инициализирует `TelegramClient` с `StringSession(TG_SESSION)` и правдоподобными `deviceModel`, `systemVersion`, `appVersion`, `langCode: "ru"`, `systemLangCode: "ru"`
- [ ] **FETCH-02**: `fetchLast24h(client, username, { limit, windowHours })` вычисляет `sinceUnix = Math.floor(Date.now()/1000) - windowHours*3600`, итерирует `client.iterMessages(username, { limit, offsetDate: 0, reverse: false })` и останавливается при `msg.date < sinceUnix`
- [ ] **FETCH-03**: Каждый пост возвращается как `{ channelUsername, messageId, postedAt, text, url }`, где `url = "https://t.me/" + username + "/" + messageId`
- [ ] **FETCH-04**: `FloodWaitError` обрабатывается глобально: `sleep(err.seconds*1000 + 2000)` и один retry; второй FloodWait подряд — прогон прерывается с exit 1 и записью в лог
- [ ] **FETCH-05**: `ChannelPrivateError`, `UsernameNotOccupiedError`, `UsernameInvalidError` логируются как warn и возвращают пустой массив — прогон продолжается со следующим каналом
- [ ] **FETCH-06**: Между каналами `await sleep(CHANNEL_DELAY_MS + randomInt(0, 500))`

### Суммаризация через DeepSeek (SUM)

- [ ] **SUM-01**: `summarize(posts)` вызывает `client.chat.completions.create` с моделью из `DEEPSEEK_MODEL`, `response_format: { type: "json_object" }` и одним батчем всех постов
- [ ] **SUM-02**: System-prompt фиксирует экстрактивность: `keyQuote` — дословная подстрока `text`, `summary` до 250 символов на русском, 3–6 групп по темам, не более 15 записей, строгий JSON без markdown
- [ ] **SUM-03**: Ответ валидируется вручную (`typeof` / `Array.isArray`) без zod — при отсутствии обязательных полей или невалидном JSON скрипт выходит с exit 1 и информативным сообщением
- [ ] **SUM-04**: `renderHtml(digest)` — inline-рендер строки с заголовками тем, буллетами, цитатой в `<i>` и ссылкой `<a href="...">`; пользовательский текст экранируется по `<`, `>`, `&`

### Доставка в канал (DELIVER)

- [ ] **DELIVER-01**: `sendToChannel(html)` отправляет `POST https://api.telegram.org/bot<TOKEN>/sendMessage` через встроенный `fetch` с `parse_mode: "HTML"`, `disable_web_page_preview: true`
- [ ] **DELIVER-02**: `chunkHtml(html, 4000)` режет длинный дайджест по закрывающим тегам/переносам строк, не разрывая HTML посередине
- [ ] **DELIVER-03**: Если частей больше одной — каждая префиксуется `(i/N)` в начале сообщения
- [ ] **DELIVER-04**: Неуспешный ответ Telegram (`res.ok === false`) бросает Error с HTTP-статусом и телом ответа — это попадает в глобальный catch

### Склейка и запуск (RUN)

- [ ] **RUN-01**: `src/run.ts` экспортирует `main()`, который читает `channels.yaml`, создаёт GramJS client, вызывает `client.connect()`, последовательно собирает посты, вызывает `client.disconnect()`
- [ ] **RUN-02**: Если `posts.length === 0` — лог `No posts in window — skipping digest` и `process.exit(0)` без вызова DeepSeek и Telegram
- [ ] **RUN-03**: Иначе: `summarize(posts)` → `sendToChannel(html)` → `process.exit(0)`; глобальный `catch` логирует ошибку и делает `process.exit(1)`

### Документация и приёмка (OPS)

- [ ] **OPS-01**: `README.md` описывает запуск в 3 команды (`npm install` → `npm run login` → `npm start`), включая шаги «подписаться на каналы в TG-клиенте» и «добавить бота админом в приватный канал»; фиксирует дисциплину «не чаще одного прогона в 10–15 минут»
- [ ] **OPS-02**: Ручная приёмка по 5 критериям §11 spec-app.md: сбор <60с на 15 каналах без FloodWait, дословность `keyQuote`, корректная HTML-доставка (одним сообщением или пронумерованными частями), идемпотентность при повторном запуске через 15+ минут, корректная обработка «пустого дня»

## v2 Requirements

Отложено до следующего milestone (SPEC.md). Не в текущем roadmap.

### Персистентность и дедуп

- **DEDUP-01**: Postgres + pgvector для хранения эмбеддингов постов
- **DEDUP-02**: Дедуп между запусками и каналами по cosine similarity
- **DEDUP-03**: Embeddings через `text-embedding-3-small` с Redis-кешем

### Инфраструктура и расписание

- **INFRA-01**: Docker Compose для локальной инфры
- **INFRA-02**: Cron через `croner` или systemd-таймер на 20:00 MSK
- **INFRA-03**: BullMQ + Redis + воркеры + DLQ

### Классификация и шаблонизация

- **CLS-01**: Классификатор направлений (бункеровка / масла / керосин / нефтехимия / битум)
- **CLS-02**: Классификатор компаний (TARGET / конкуренты)
- **TPL-01**: Handlebars-шаблон дайджеста вместо inline-рендера

### Абстракции провайдеров

- **PROV-01**: Интерфейс `LLMProvider` — подмена DeepSeek на GigaChat / YandexGPT / локальный Qwen
- **PROV-02**: Интерфейс `EmbeddingProvider`
- **PROV-03**: Интерфейс `Deliverer` — множественные получатели
- **PROV-04**: Мульти-аккаунтная ротация TG-сессий

## Out of Scope

| Feature | Reason |
|---------|--------|
| Автотесты (unit/integration) | MVP проверяется ручным чек-листом §11; 1 оператор, 1 прогон — автоматизация тестов не окупается |
| Приватные каналы по invite-hash | Поддерживаем только публичные по `username` — упрощает `channels.yaml` и сессию |
| Дедуп между запусками (MVP) | Требует БД + эмбеддингов — вынесено в v2 (DEDUP-*) |
| Ретраи на уровне прогона при падении DeepSeek/Telegram | MVP принимает exit 1, оператор перезапускает руками |
| Собственный бот-слушатель / webhooks | Бот нужен только для `sendMessage`, incoming не читаем |
| Dashboard / RAG / сторонние интеграции (Bitsab) | Вне MVP, появятся при валидации ценности дайджеста |
| SPEC.md (Postgres/BullMQ/классификатор/крон) | Следующий milestone — §13 spec-app.md |

## Traceability

Заполнено gsd-roadmapper 2026-04-21 при создании ROADMAP.md. Все 26 v1-требований смаппены на **Phase 1: MVP дайджест** (пользователь явно запросил «сильно меньше чем coarse»; MVP — один скрипт, все требования связаны одним пайплайном `GramJS → DeepSeek → Bot API`, разбиение на фазы не даёт верифицируемой ценности).

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 1 | Pending |
| CFG-02 | Phase 1 | Pending |
| CFG-03 | Phase 1 | Pending |
| CFG-04 | Phase 1 | Pending |
| CFG-05 | Phase 1 | Pending |
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| FETCH-01 | Phase 1 | Pending |
| FETCH-02 | Phase 1 | Pending |
| FETCH-03 | Phase 1 | Pending |
| FETCH-04 | Phase 1 | Pending |
| FETCH-05 | Phase 1 | Pending |
| FETCH-06 | Phase 1 | Pending |
| SUM-01 | Phase 1 | Pending |
| SUM-02 | Phase 1 | Pending |
| SUM-03 | Phase 1 | Pending |
| SUM-04 | Phase 1 | Pending |
| DELIVER-01 | Phase 1 | Pending |
| DELIVER-02 | Phase 1 | Pending |
| DELIVER-03 | Phase 1 | Pending |
| DELIVER-04 | Phase 1 | Pending |
| RUN-01 | Phase 1 | Pending |
| RUN-02 | Phase 1 | Pending |
| RUN-03 | Phase 1 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26 (100%) ✓
- Unmapped: 0 ✓

**Per-category coverage:**
- CFG: 5/5 → Phase 1
- AUTH: 2/2 → Phase 1
- FETCH: 6/6 → Phase 1
- SUM: 4/4 → Phase 1
- DELIVER: 4/4 → Phase 1
- RUN: 3/3 → Phase 1
- OPS: 2/2 → Phase 1

---
*Requirements defined: 2026-04-21*
*Traceability updated: 2026-04-21 by gsd-roadmapper (all 26 → Phase 1)*
