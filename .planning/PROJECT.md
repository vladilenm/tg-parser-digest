# Oil & Gas Intelligence Monitor

## What This Is

Внутренний пилот-сервис для B2B-заказчика из нефтегазового сектора. Каждый день в 20:00 MSK собирает публикации из ~10–15 отраслевых Telegram-каналов, классифицирует по 5 направлениям (бункеровка, масла, керосин/авиа, нефтехимия, битум), дедуплицирует и шлёт экстрактивный дайджест в закрытый Telegram-канал заказчика. Фокус — новости о целевой компании (TARGET) и её прямых конкурентах.

## Core Value

Дайджест приходит в 20:00 ± 1 минута MSK с проверяемыми по оригиналу цитатами, без галлюцинаций и без дубликатов — если это работает, пилот принят.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Ingest новых сообщений из списка TG-каналов в течение 60 секунд после публикации (GramJS user-session)
- [ ] Классификация: ≥85% accuracy по направлениям и ≥90% по компаниям на 50 вручную размеченных сэмплах
- [ ] Semantic dedupe через pgvector: одна новость из 3+ каналов схлопывается в одну запись дайджеста
- [ ] Экстрактивная суммаризация с verbatim `keyQuote` (100% на 20 случайных items)
- [ ] Ежедневный дайджест в 20:00 ± 1 минута MSK в закрытый канал (grammy bot), группировка по направлениям, лимит 7 на группу
- [ ] Idempotency дайджеста (повторный запуск за день — skip)
- [ ] 48 часов аптайма без ручного вмешательства на VPS
- [ ] Конфигурируемые: список каналов, имена TARGET/конкурентов, порог дедупа (0.90 default), cron

### Out of Scope

- Все 50 каналов — на MVP только 10–15, остальное на этапе 2
- Официальные сайты Роснефти/Лукойла/Газпрома и RSS — этап 2
- Отраслевые СМИ, конференции, СНГ-источники — этап 2
- Bitsab интеграция — этап 3
- Next.js/Metabase dashboard и RAG-ассистент — этап 3–4
- Мульти-аккаунтная ротация TG-сессий — один user-аккаунт на MVP
- On-prem деплой и локальный LLM (GigaChat/YandexGPT/Qwen) — абстракции есть, реализация на prod-этапе
- MarkdownV2 parse mode — слишком много эскейпинга, идём через HTML
- Чтение публичных каналов через Bot API — технически невозможно, только GramJS

## Context

- Полная техническая спецификация уже зафиксирована в [SPEC.md](../SPEC.md) (разделы 1–16): архитектура, стек, модель данных, конфиг, пошаговый план реализации (12 шагов), промпты классификации/суммаризации, критерии приёмки.
- [CLAUDE.md](../CLAUDE.md) фиксирует жёсткие требования (раздел 15 SPEC): идти по шагам 1→12, не хардкодить имена компаний, prompt caching обязателен, HTML parse mode, dedupe threshold в конфиге.
- Заказчик даст финальные артефакты на кикоффе: список TG-каналов, имя TARGET + 2–3 конкурентов, доступ к my.telegram.org (TG_API_ID/HASH), приватный канал с ботом-админом.
- После приёмки пилота фокус смещается на расширение источников (этап 2 из SPEC §16).
- Проект решает типичную задачу competitive intelligence в нефтегазе: отслеживание новостной повестки целевого рынка через готовые русскоязычные TG-каналы-агрегаторы.

## Constraints

- **Tech stack**: Node.js 20+, TypeScript 5, PostgreSQL 16 + pgvector, Redis, BullMQ, Drizzle ORM — зафиксировано в SPEC §3, менять без причины не надо
- **Timeline**: 1–2 недели на MVP до передачи пилота заказчику
- **LLM budget**: сознательно дёшево — Claude Haiku для classify, Sonnet только для summarize (где экстрактивность критична); prompt caching обязателен
- **Deployment**: VPS / cloud VM, docker compose или systemd, без Kubernetes
- **Telegram**: для чтения — только GramJS user-session (MTProto); для отправки — grammy bot API. Смешивать нельзя
- **LLM abstractions mandatory**: `LLMProvider` / `EmbeddingProvider` / `Deliverer` интерфейсы с первого дня — на prod-этапе будет замена Claude на GigaChat/YandexGPT/Qwen
- **Экстрактивность**: `keyQuote` — точная подстрока `rawText`; `rawText.includes(keyQuote)` обязательная проверка; retry при провале
- **Dedupe threshold 0.90**: стартовое значение, держать в конфиге (`DEDUPE_COSINE_THRESHOLD`), не хардкодить
- **TG message limit 4096 chars**: дайджест бьётся на части с нумерацией `(1/N)`
- **Security**: имена TARGET/конкурентов — только в env/config, никогда в коде

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GramJS для чтения + grammy для отправки | Bot API не читает публичные каналы, user-session не имеет удобного bot-API для рассылки | — Pending |
| Claude Haiku для classify, Sonnet для summarize | Экономия бюджета при сохранении экстрактивности там, где это критично | — Pending |
| OpenAI text-embedding-3-small (1536) | Дёшево и приемлемо работает с RU-текстом; dedupe — не точный матч | — Pending |
| pgvector HNSW index над items.embedding | Быстрый cosine search на окне 24 часа | — Pending |
| Drizzle ORM вместо Prisma | Лёгкий, нативно поддерживает pgvector через типизированную колонку | — Pending |
| LLMProvider/EmbeddingProvider/Deliverer интерфейсы с первого дня | Prod-этап требует замены Claude на on-prem LLM без переписывания бизнес-логики | — Pending |
| HTML parse mode в TG | MarkdownV2 требует эскейпинга десятков символов — источник багов | — Pending |
| VPS deployment, без K8s | MVP, одна нода, docker compose — минимум сложности для 48ч аптайма | — Pending |

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
*Last updated: 2026-04-20 after initialization*
