# tg-parser-demo

## What This Is

Один исполняемый Node.js-скрипт, который читает 10–15 публичных Telegram-каналов по российскому нефтегазу/нефтехимии за последние 24 часа, прогоняет все посты через DeepSeek и отправляет экстрактивный HTML-дайджест в мой личный закрытый Telegram-канал. Запуск — руками (`npm start`) с рабочей машины, между запусками состояние не хранится.

## Core Value

За один `npm start` получить в закрытом канале дайджест событий нефтегаза за последние 24 часа, в котором **каждая цитата дословно присутствует в исходном посте** — без галлюцинаций LLM.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

Validated in Phase 1 (MVP дайджест, 2026-04-21):

- [x] Конфиг каналов и окружения: `channels.yaml` + `.env.example` читаются скриптом, 10–15 публичных каналов по `username`
- [x] Разовая генерация `TG_SESSION` через `npm run login` (StringSession, интерактивный ввод телефона/кода/2FA)
- [x] GramJS-клиент переиспользует сохранённую сессию и выглядит как обычный клиент (deviceModel/appVersion/langCode="ru")
- [x] `fetchLast24h(username)` собирает посты за `FETCH_WINDOW_HOURS` часов, останавливает итерацию по `msg.date < sinceUnix`, уважает `MAX_MESSAGES_PER_CHANNEL`
- [x] Последовательный обход каналов с jitter: `sleep(CHANNEL_DELAY_MS + randomInt(0, 500))` между каналами
- [x] Обработка `FloodWaitError`: один retry после `err.seconds*1000 + 2000`; второй подряд — прерывание прогона
- [x] Частные ошибки канала (`ChannelPrivateError`, `UsernameNotOccupiedError`, `UsernameInvalidError`) логируются и пропускают канал, прогон продолжается
- [x] Суммаризация одним батчем через DeepSeek (`deepseek-chat`, `response_format: json_object`), валидация ответа вручную (`typeof`/`Array.isArray`)
- [x] Проверка ядра экстрактивности: `keyQuote` каждой записи дайджеста — дословная подстрока исходного `text`
- [x] Server-side рендер JSON → HTML (заголовки тем, буллеты с `<i>`-цитатой и `<a>`-ссылкой), экранирование `<`, `>`, `&`
- [x] Доставка в приватный канал через `fetch` к Bot API `sendMessage`, `parse_mode: "HTML"`, нарезка на части по ~4000 символов с нумерацией `(i/N)`
- [x] Пустой день: если постов 0 — логируем `No posts in window`, выходим с кодом 0, DeepSeek и Telegram не дёргаем
- [x] README: запуск в 3 команды + дисциплина «не чаще одного прогона в 10–15 минут»

### Active

<!-- Current scope. Building toward these. -->

(Milestone MVP v1.0 завершён — нет активных требований. Следующий milestone ещё не определён.)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Persistent storage (SQLite/Postgres/pgvector) — MVP проверяет связку, дедуп и история оставлены на следующий milestone
- Дедупликация постов между запусками и между каналами — допускаем повтор одних и тех же новостей в дайджестах; частично гасится отбором «15 самых содержательных» моделью
- Классификатор направлений (бункеровка/масла/керосин/нефтехимия/битум) и компаний (TARGET/конкуренты) — темы генерирует сама LLM на каждом прогоне
- Embeddings (`text-embedding-3-small`) и Redis-кеш — не нужны без дедупа
- BullMQ/Redis/очереди/DLQ — прогоны одиночные, ретраев на уровне скрипта нет
- Docker / docker-compose — разовый запуск с ноутбука, docker не окупается
- Cron / systemd-таймер / GitHub Actions scheduled — запуск руками; когда понадобится расписание, обернём тот же скрипт снаружи
- Собственный бот-слушатель / webhooks — бот нужен только для `sendMessage`
- Приватные каналы по `invite hash` — поддерживаем только публичные по `username`
- Handlebars / внешние шаблонизаторы — inline-рендер строкой достаточен
- `LLMProvider` / `EmbeddingProvider` / `Deliverer` абстракции — один провайдер, прямой вызов, абстракции появятся когда будет второй кандидат
- Мульти-аккаунтная ротация TG-сессий — одна сессия, дисциплина запусков
- Ретраи на уровне прогона при падении DeepSeek/Telegram — выход `exit 1`, перезапуск оператором вручную
- Dashboard / RAG / сторонние интеграции (Bitsab и пр.) — вне MVP
- Автотесты — MVP проверяется руками по чек-листу приёмки (§11 spec-app.md)

## Context

- **Shipped v1.0**: ~651 LOC TypeScript в 6 модулях (`src/run.ts`, `src/telegram.ts`, `src/summarize.ts`, `src/deliver.ts`, `src/types.ts`, `scripts/login.ts`) + `README.md` + `channels.yaml` + `.env.example`. Три runtime-зависимости (`telegram`, `openai`, `yaml`) — как и планировалось. Timeline: 2026-04-20 → 2026-04-21 (~1 рабочий день, 29 коммитов).
- **Приёмка v1.0**: все 5 критериев §11 пройдены вручную (OPS-02 approved, VERIFICATION.md passed 26/26). Audit `v1.0-MILESTONE-AUDIT.md` подтвердил 0 gaps, 0 unsatisfied, 0 broken flows; 12 items tech debt (edge cases + doc drift) known-accepted.
- **Тематика**: российский нефтегаз и нефтехимия (каналы вроде `neftegazru`, `oilfornication`). Промпт DeepSeek настроен на русскоязычную ленту и специфику отрасли (бункеровка, масла, керосин, нефтехимия, битум — возможные будущие направления классификатора).
- **Пользовательская сессия**: user-аккаунт, чей `TG_SESSION` лежит в `.env`, обязан быть подписан на каждый канал из `channels.yaml` — иначе GramJS бросит `ChannelPrivateError`. Это дисциплина оператора, не код.
- **Anti-ban дисциплина**: 7 пунктов из §9 spec-app.md реализованы в коде — persistent StringSession, ограниченное окно, последовательность+jitter, FloodWait-обработка с одним retry, правдоподобный клиент (`Desktop/Windows 11/ru`), дисциплина частоты запусков зафиксирована в README.
- **Known tech debt (v1.0)**: 5 Warnings + 6 Info в `01-REVIEW.md` (chunkHtml edge cases, `.gitignore` неполный glob, NaN env validation, Unicode NFC-чувствительность в `keyQuote` verify, `LOG_LEVEL` задокументирован но не читается) — все known-accepted, кандидаты в backlog v2.
- **Целевой документ `SPEC.md`** из §13 spec-app.md намеренно игнорируется — это план-мечта на следующий milestone (Postgres+pgvector+дедуп+крон+классификатор), сейчас им не занимаемся.

## Constraints

- **Tech stack**: Node.js 20.6+ (нужен `--env-file`), TypeScript без шага сборки (`tsx`), ESM, `moduleResolution: bundler`, `strict: true`. Runtime-зависимости ровно три: `telegram` (GramJS), `openai` (DeepSeek через OpenAI-совместимый SDK), `yaml`.
- **Нет БД, нет Redis, нет Docker, нет cron** — один процесс, один запуск, без внешней инфры.
- **Один оператор, один потребитель** — я запускаю, я читаю в закрытом канале. Никакого multi-tenancy.
- **Telegram API limits**: окно чтения ≤24ч, ≤50 сообщений на канал по умолчанию, задержка между каналами ≥1с + jitter, не чаще одного прогона в 10–15 минут (дисциплина).
- **DeepSeek**: один батч-запрос на прогон, `response_format: json_object`, модель выбирает не более 15 записей в итоговом дайджесте.
- **Telegram Bot API**: лимит 4096 символов на сообщение — режем с запасом ~4000 и нумеруем части.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Ручной запуск, без крона | Нужна самая дешёвая проверка связки GramJS→LLM→Telegram; расписание добавим когда появится стабильный sender | ✓ Good — v1.0 доказал пайплайн на ручных прогонах, cron/scheduler отложен до v2 по-прежнему оправданно |
| Только MVP, SPEC.md отложен | Все усложнения (Postgres, pgvector, BullMQ, классификатор) окупаются только после подтверждённой ценности дайджеста | ✓ Good — MVP в ~651 LOC за 1 день; SPEC.md-абстракции окупятся только после реального использования v1.0 |
| GramJS user-session вместо Bot API для чтения | Bot API не видит историю произвольных публичных каналов; user-session с правдоподобными `deviceModel` — единственный рабочий путь | ✓ Good — `Desktop/Windows 11/ru` identity работает, FloodWait на первом прогоне не наблюдался |
| DeepSeek как единственный LLM | Дешёвый, OpenAI-совместимый SDK, русский язык — подходит; абстракция `LLMProvider` появится когда появится второй провайдер | ✓ Good — `response_format: json_object` сработал, один батч-запрос на прогон достаточен |
| Экстрактивный промпт с обязательной дословностью `keyQuote` | Защита от галлюцинаций на отраслевой лексике; `keyQuote` проверяется вручную по исходному `text` | ⚠️ Revisit — серверная проверка через `Map<url, Post>` + `includes()` даёт ложные несовпадения при Unicode NFC vs NFD (IN-01 в REVIEW) |
| Без тестов в MVP | Проверка — ручной чек-лист из 5 критериев §11; 1 оператор, 1 прогон в день, автоматизация тестов окупится на следующем milestone | ✓ Good — §11 приёмка пройдена вручную без провалов; автотесты — кандидат в v2 если появится CI |
| Без персистентности между запусками | Повтор одних и тех же новостей допустим; дедуп требует БД и эмбеддингов, что выходит за MVP | — Pending — реальная частота повторов в дайджестах оценится только после нескольких дней эксплуатации |
| YOLO-режим GSD с одной фазой вместо 3–5 | Пользователь явно запросил «сильно меньше чем coarse»; пайплайн GramJS→DeepSeek→Bot API не даёт верифицируемой ценности в подмножествах | ✓ Good — все 26 требований прошли 3-source cross-reference (VERIFICATION + SUMMARY + REQUIREMENTS) без orphans |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-21 after v1.0 milestone complete*
