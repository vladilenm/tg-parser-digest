# Phase 1: Foundation & Ingest - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 01-foundation-ingest
**Areas discussed:** Ingest edge cases, Catch-up при рестарте, Config reload стратегия

---

## Ingest Edge Cases

### Media-only сообщения без caption

| Option | Description | Selected |
|--------|-------------|----------|
| Пропускать на ingest | Если rawText пустой/whitespace — не вставляем в messages. Экономит DB/queue. Согласуется с raw_text NOT NULL | ✓ |
| Сохранять с пустым rawText | Пустить в queue, Phase 2 normalize отсечёт. Больше бесполезной нагрузки | |
| Сохранять с fallback-текстом | '[media: photo]' в rawText | |

**User's choice:** Пропускать на ingest
**Notes:** Согласуется с SPEC §5 (raw_text NOT NULL).

---

### Forwards без собственного комментария

| Option | Description | Selected |
|--------|-------------|----------|
| На ingest | GramJS event имеет forward flag + пустой caption — отсекаем до DB | ✓ |
| В Phase 2 normalize (как в SPEC §7.1) | Строго по SPEC. Истории полнее в messages, но тратится queue + embed API | |

**User's choice:** На ingest
**Notes:** Ранний отсев экономит LLM/embed бюджет.

---

### Edit events от Telegram

| Option | Description | Selected |
|--------|-------------|----------|
| Игнорировать | Подписываемся только на NewMessage. Правки редки в отраслевых каналах | ✓ |
| Обновлять messages.rawText | Ловим EditedMessage, UPDATE по (tg_channel_id, tg_message_id) | |
| Обрабатывать как новое сообщение | UPSERT даст skip из-за unique constraint | |

**User's choice:** Игнорировать
**Notes:** MVP — первая версия достаточна.

---

### Минимальная длина rawText на ingest

| Option | Description | Selected |
|--------|-------------|----------|
| Не отсекать на ingest | Всё непустое сохраняем. Фильтрация — classify.isRelevant | ✓ |
| <20 символов skip | Пороговый фильтр. Риск пропустить краткие но важные факты | |
| Настраиваемый порог в env | Гибко, но лишняя ручка для MVP | |

**User's choice:** Не отсекать на ingest
**Notes:** Ingest остаётся тупым и быстрым.

---

## Catch-up при рестарте

### Базовая стратегия при рестарте

| Option | Description | Selected |
|--------|-------------|----------|
| Ограниченный догон | Читаем историю канала за N часов (iterMessages), upsert сглаживает | |
| Полный догон с last seen | MAX(tg_message_id) + тянем всё новее. Риск FloodWait при долгом downtime | |
| Fresh start | Только новые сообщения с текущего момента | (initial) |

**User's first choice:** Fresh start
**Follow-up:** Уточнили про реальное поведение деплоя — переключились на вариант "всегда догон".

---

### Уточнение: поведение при рестарте (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Всегда догон на INGEST_CATCHUP_HOURS | Единая логика: при любом старте читаем N часов. Upsert гасит дубли | ✓ |
| Fresh start при рестарте, catchup только на первом старте | Дырки при деплое | |
| Умный: догон только если gap > N мин | Гибко, но доп сложность | |

**User's choice:** Всегда догон на INGEST_CATCHUP_HOURS
**Notes:** Проще логика, ничего не теряем при деплое/reboot.

---

### Окно catch-up

| Option | Description | Selected |
|--------|-------------|----------|
| 6 часов | Достаточно для типичных рестартов, env INGEST_CATCHUP_HOURS | — |
| 24 часа | Покрывает всё окно дайджеста | — |
| 1 час | Консервативно | — |

**User's choice:** Other — "6, 12 и 24 часа"
**Notes:** Интерпретация: конфигурируемое в env, типичные значения 6/12/24, default = 6.

---

### Где храним last seen tg_message_id

| Option | Description | Selected |
|--------|-------------|----------|
| MAX() из messages | SELECT MAX(tg_message_id) WHERE tg_channel_id=$1. Без отдельной таблицы | ✓ |
| Отдельная таблица channel_state | (tg_channel_id, last_seen_id, last_seen_at) — не в SPEC §5 | |
| Redis ingest:last_seen:{channel_id} | Быстро, но pg уже source-of-truth | |

**User's choice:** MAX() из messages
**Notes:** Одна точка правды, без расширения схемы.

---

### Поведение при первом старте

| Option | Description | Selected |
|--------|-------------|----------|
| Тянуть последние N часов | Первый дайджест сразу имеет контекст | ✓ |
| Старт с 'сейчас' | Первый дайджест может быть слабым | |

**User's choice:** Тянуть последние N часов

---

## Config Reload Стратегия

### channels.yaml изменился — что делает сервис

| Option | Description | Selected |
|--------|-------------|----------|
| Требует restart | Конфиг читается один раз при старте. Для MVP достаточно | ✓ |
| Hot-reload через file watcher | chokidar + переподписка. Race condition в listener | |
| SIGHUP сигнал | Классично для демонов, против ожидания в Node | |

**User's choice:** Требует restart
**Notes:** `docker compose restart` / `systemctl restart` приемлемо для 10-15 каналов.

---

### Валидация channels.yaml при старте

| Option | Description | Selected |
|--------|-------------|----------|
| Схема + проверка доступности | zod + GramJS getEntity. Незарезолвенный канал → warn+skip, не краш | ✓ |
| Только zod-схема | Узнаём про плохой username в runtime | |
| Strict: фейлим старт на любой проблеме | 1 мёртвый канал убивает весь сервис | |

**User's choice:** Схема + проверка доступности
**Notes:** Fault-tolerance важнее для 48ч аптайма.

---

### disabled каналы в channels.yaml

| Option | Description | Selected |
|--------|-------------|----------|
| Не подписываемся вообще | Skip в фильтре. Исторические messages остаются в БД | ✓ |
| Удалить из YAML = то же самое | Меньше полей, но теряется intent паузы | |

**User's choice:** Не подписываемся вообще
**Notes:** enabled: false = toggle паузы, исторические данные для дедупа сохраняются.

---

## Claude's Discretion

Делегировано планировщику / исполнителю:

- Форма pino-логов (base поля, child loggers)
- Структура `src/config/index.ts`
- Drizzle migration workflow — рекомендация: `generate+migrate` с коммитом SQL в `drizzle/migrations/`
- Точные параметры FloodWait backoff (base delay, jitter)
- Debounce 500ms реализация (per-channel vs global)
- HNSW параметры индекса (m, ef_construction)

---

## Deferred Ideas

- Hot-reload channels.yaml (chokidar)
- Таблица `channel_state` с per-channel метаданными
- Edit events → UPDATE messages.rawText
- Health endpoint `/health`
- Process topology split в prod (Phase 2 вопрос)
- Drizzle push vs generate+migrate — не обсуждено явно
- BullMQ job retention TTL — Phase 2
