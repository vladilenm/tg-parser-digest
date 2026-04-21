# Phase 1: MVP дайджест - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 01-mvp (MVP дайджест)
**Areas discussed:** Верификация keyQuote, Identity GramJS-клиента, Оформление HTML-дайджеста

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Верификация keyQuote | Core Value = дословность. Серверная проверка `text.includes(keyQuote)` сверх промпта. | ✓ |
| Список каналов YAML | Финальный список 10-15 username'ов в `channels.yaml`. | |
| Identity GramJS-клиента | `deviceModel`/`systemVersion`/`appVersion`/`langCode` — anti-ban легенда. | ✓ |
| Оформление HTML-дайджеста | Шапка, заголовки тем, формат буллета, разделители. | ✓ |

**User's choice:** Identity GramJS-клиента + Оформление HTML-дайджеста + Верификация keyQuote
**Notes:** Список каналов ушёл в deferred — это контент, оператор диктует его сам.

---

## Верификация keyQuote

### Q1: Делать ли серверную проверку keyQuote после парсинга JSON от DeepSeek?

| Option | Description | Selected |
|--------|-------------|----------|
| Да, обязательно (Recommended) | После JSON.parse для каждой item[] проверяем, что keyQuote есть в исходном post.text. Core Value защищён кодом. | ✓ |
| Нет, только промпт | Полагаемся на строгость SYSTEM_PROMPT и ручную проверку по §11. | |

**User's choice:** Да, обязательно

### Q2: Если keyQuote не найден дословно в исходном text — что делать с записью?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip + warn (Recommended) | Исключаем запись, logger.warn с channel+messageId+quote. Дайджест всё равно уходит, но чистый. | ✓ |
| Exit 1 весь прогон | Одна галлюцинация — весь дайджест не отправляется, оператор разбирается. | |
| Include + пометка | Запись включается, keyQuote помечается префиксом [недословно]. Компромисс. | |

**User's choice:** Skip + warn

### Q3: Насколько строго сравнивать keyQuote с text?

| Option | Description | Selected |
|--------|-------------|----------|
| Строго + trim (Recommended) | text.includes(keyQuote.trim()). Убираем пробелы по краям, остальное дословно. | ✓ |
| Абсолютно строго | text.includes(keyQuote) без трансформаций. | |
| Нормализация пробелов | Обе строки через replace(/\s+/g, ' ').trim(). Терпит переносы, но маскирует перефразировку. | |

**User's choice:** Строго + trim

### Q4: Куда сохранять нарушения keyQuote для разбора промпта?

| Option | Description | Selected |
|--------|-------------|----------|
| Только console.warn (Recommended) | logger.warn в stderr. Без файлов — в духе MVP. | ✓ |
| В файл на диске | ./logs/keyquote-violations-YYYY-MM-DD.jsonl. Надёжнее, но добавляет fs-логику. | |

**User's choice:** Только console.warn

---

## Identity GramJS-клиента

### Q1: Какую платформу эмулировать в TelegramClient?

| Option | Description | Selected |
|--------|-------------|----------|
| Telegram Desktop (Recommended) | deviceModel="Desktop", systemVersion="Windows 11", appVersion="5.3.0 x64". Самый массовый сценарий в RU. | ✓ |
| Telegram macOS | deviceModel="MacBook Pro", systemVersion="macOS 14.5", appVersion="10.13". Менее массово. | |
| Telegram iOS | deviceModel="iPhone 15 Pro", systemVersion="iOS 17.5", appVersion="10.13". Мобильный iOS из скрипта — чужеродно. | |

**User's choice:** Telegram Desktop

### Q2: Где хранить конкретные значения deviceModel/systemVersion/appVersion?

| Option | Description | Selected |
|--------|-------------|----------|
| Константы в src/telegram.ts (Recommended) | Захардкожены в коде. Не секрет — не стоит в .env. | ✓ |
| Через .env переменные | TG_DEVICE_MODEL/TG_SYSTEM_VERSION/TG_APP_VERSION. Гибко, но раздувает конфиг. | |

**User's choice:** Константы в src/telegram.ts

### Q3: langCode и systemLangCode — как задать?

| Option | Description | Selected |
|--------|-------------|----------|
| Оба "ru" (Recommended) | Консистентно с RU-оператором, читающим RU-каналы. §9 spec-app.md требует langCode="ru". | ✓ |
| langCode="ru", systemLangCode="en" | Смешанный вариант — UI на RU, система на EN. Spec фиксирует оба "ru". | |

**User's choice:** Оба "ru"

### Q4: Фиксировать ли также connectionRetries / timeout для GramJS-клиента?

| Option | Description | Selected |
|--------|-------------|----------|
| Дефолты GramJS (Recommended) | connectionRetries=5 (default), useWSS=false. Меньше кода, меньше скрытых зависимостей. | ✓ |
| connectionRetries=3 | Быстрее фейлим при сетевых проблемах. | |

**User's choice:** Дефолты GramJS

---

## Оформление HTML-дайджеста

### Q1: Шапка дайджеста — что в первой строке до секций?

| Option | Description | Selected |
|--------|-------------|----------|
| Дата + статистика (Recommended) | `<b>Нефтегаз — 21 апр 2026</b>\n<i>47 постов из 14 каналов за 24ч</i>\n\n`. Сразу контекст. | ✓ |
| Только дата | `<b>Дайджест 21 апр 2026</b>\n\n`. Минимализм. | |
| Без шапки | Сразу первая секция. Telegram показывает время отправки сам. | |

**User's choice:** Дата + статистика

### Q2: Заголовки тем — как оформить?

| Option | Description | Selected |
|--------|-------------|----------|
| `<b>Тема</b>` (Recommended) | Простой болд, без emoji. Читаемо, строго. | ✓ |
| `⚡ <b>Тема</b>` | Фиксированный emoji. Ярко, но однообразно. | |
| `1. <b>Тема</b>` | Нумерация секций. Полезно для длинного дайджеста. | |

**User's choice:** `<b>Тема</b>`

### Q3: Формат буллета — как связать summary, keyQuote и ссылку?

| Option | Description | Selected |
|--------|-------------|----------|
| Одной строкой (Recommended) | `• {summary} — <i>«{quote}»</i> — <a href="{url}">@{channel}</a>`. Компактно. | ✓ |
| Две строки | `• {summary}\n  ↳ <i>«{quote}»</i> — <a>@{channel}</a>`. Читаемее, но риск >4000. | |
| Три строки | `• <b>{summary}</b>\n  <i>«{quote}»</i>\n  <a>@{channel}</a>`. Максимально читаемо, но 3× места. | |

**User's choice:** Одной строкой

### Q4: Разделители между секциями?

| Option | Description | Selected |
|--------|-------------|----------|
| Пустая строка (Recommended) | `\n\n` между секциями. Telegram визуально разделит. | ✓ |
| Строка с тире | `─────` или `———` между секциями. Чёткий сплит, но шум. | |

**User's choice:** Пустая строка

---

## Claude's Discretion

- Точный формат даты в шапке (Intl.DateTimeFormat или ручной)
- Внутренняя реализация `chunkHtml(html, 4000)` (по каким тегам/переносам)
- Повторение шапки в каждой части `(i/N)` vs только в первой
- Обработка постов без текста / только медиа (скипать до LLM vs включать в батч)
- Формат логгера (console.* vs минимальный wrapper) и семантика `LOG_LEVEL`
- Печать `raw` ответа при невалидном JSON перед `exit 1`
- Валидация `url` перед включением в HTML

## Deferred Ideas

- Финальный список каналов `channels.yaml` (10-15 username'ов) — оператор диктует сам
- Обработка «пустых» постов (репост-только-медиа) — предварительно: skip до LLM
- Формат логирования и `LOG_LEVEL` semantics
- Дополнительные защитные проверки ответа DeepSeek (длины, число секций)
- v2: Persistence / DEDUP / INFRA / CLS / TPL / PROV / автотесты — следующий milestone
