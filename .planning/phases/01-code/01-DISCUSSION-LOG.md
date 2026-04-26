# Phase 1: Code — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 01-code
**Areas discussed:** Render flavor, Plan-grouping
**Areas deferred to Claude's Discretion:** Lifecycle ФС-state на сбоях, Alert поведение и edge-cases

---

## Pre-flight: Gray area selection

**Question:** Phase 1 серых зон вокруг implementation-выбора. Какие хочешь обсудить? (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Render flavor (HTML vs Markdown) | parse_mode + структура секций; влияет на summarize.ts/deliver.ts/data/output | ✓ |
| Lifecycle ФС-state | Когда писать hash-cache/raw/output на сбоях | |
| Alert поведение и edge-cases | sync/await, throttling, alert-on-alert-fail | |
| Plan-grouping внутри Phase 1 | Сколько PLAN.md и где границы | ✓ |

**User's choice:** Render flavor + Plan-grouping

---

## Render flavor

### Q1: parse_mode

| Option | Description | Selected |
|--------|-------------|----------|
| HTML (статус-кво v2.0) | parse_mode: HTML, переиспользуем escapeHtml/chunkHtml; data/output/*.md содержит HTML | ✓ |
| MarkdownV2 (буквально) | parse_mode: MarkdownV2; натуральный .md, но escape-ад спецсимволов | |
| Гибрид — Markdown source, HTML отправка | Рендерим Markdown, конвертируем в HTML; ARCH-02 «идентично» формально нарушается | |

**User's choice:** HTML (статус-кво v2.0)
**Notes:** Минимизация риска escape-багов на отраслевой лексике (числа с запятыми, формулы,
диапазоны). Полная преемственность с v2.0 deliver.ts. Запись `data/output/YYYY-MM-DD.md`
с HTML-разметкой принята как trade-off ради инварианта ARCH-02.

### Q2: Заголовки секций

| Option | Description | Selected |
|--------|-------------|----------|
| Чистый <b> как в v2.0 | <b>Бункер</b>, без emoji | |
| Emoji + <b> | <b>🚢 Бункер</b>, <b>🛢 Масла</b>, и т.д. | ✓ |
| <b> + счётчик items | <b>Бункер</b> <i>(3)</i> | |

**User's choice:** Emoji + <b>
**Notes:** Быстрый визуальный scan секций в мобильном Telegram. Конкретные emoji зафиксированы
в CONTEXT D-02 (🚢/🛢/✈️/⚗️/🛣/🏢) — можно поменять без последствий, это чисто визуально.

### Q3: Порядок секций

| Option | Description | Selected |
|--------|-------------|----------|
| Фиксированный порядок | Бункер → Масла → Керосин → Нефтехимия → Битум → Упоминания | ✓ |
| По убыванию items count | Самая активная тема дня — вверху | |

**User's choice:** Фиксированный порядок
**Notes:** Совпадает с порядком в REQUIREMENTS и intent-v3.0.md. Заказчик и оператор могут
сравнивать сводки между днями по постоянной структуре, без визуального «прыгания» секций.

### Q4: Блок «Упоминания компаний»

| Option | Description | Selected |
|--------|-------------|----------|
| Disjoint: в одном месте | Пост ИЛИ в категории, ИЛИ в mentions; без дублирования | |
| Overlap: в категорию + пометка в mentions | Пост в категории + ссылка-pointer в mentions | |
| Маркеры inline, блок — только орфаны | Префикс <b>[РОСНЕФТЬ]</b> в категории; mentions = только посты вне 5 категорий с упоминанием | ✓ |

**User's choice:** Маркеры inline, блок — только орфаны
**Notes:** Конкретный формат маркера: `<b>[РОСНЕФТЬ]</b> {summary}`. Множественные mentions
склеиваются: `<b>[РОСНЕФТЬ] [ЛУКОЙЛ]</b> {summary}`. Согласовано со STRUCT-03: посты вне
5 категорий И без mentions → drop; посты с mentions, но вне категорий → орфан-секция.

### Q5: Bullet format

| Option | Description | Selected |
|--------|-------------|----------|
| Переходим к Plan-grouping | Reuse v2.0 формат summarize.ts:179 без изменений | ✓ |
| Ещё вопросы по Render | Bullet/separator/mobile UX | |

**User's choice:** Переходим к Plan-grouping
**Notes:** Bullet `• {summary} — <i>«{keyQuote}»</i> — <a href="{url}">@{channel}</a>`
сохраняется. С маркером — `• <b>[РОСНЕФТЬ]</b> {summary} — <i>...`. Разделитель секций — \n\n.

---

## Plan-grouping

### Q1: Сколько PLAN.md

| Option | Description | Selected |
|--------|-------------|----------|
| 3 плана = 3 wave (Recommended) | По одной волне; каждый = верифицируемый кусок | |
| 6 планов = 6 категорий | Атомарные коммиты, но STRUCT без RENDER не тестируется | |
| 2 плана: code + обвязка | Wave1+Wave2 в один, Wave3 отдельно | |
| 1 mega-план (YOLO) | Все 14 REQ в одном; копирует v1.0/v2.0 паттерн | ✓ |

**User's choice:** 1 mega-план (YOLO)
**Notes:** YOLO согласуется с config.json `mode: "yolo"` и опытом v1.0 (26/26 чек-лист) /
v2.0 (20/20 REQ). Минимум plan-overhead в 2-day deadline. Wave-порядок ROADMAP сохраняется
как порядок task'ов внутри plan'а.

### Q2: Промежуточный manual-test чекпоинт

| Option | Description | Selected |
|--------|-------------|----------|
| Один финальный verify (Recommended) | YOLO до конца, npm start один раз для smoke в конце | ✓ |
| Smoke после Wave 1 | Прогнать npm start после STRUCT+RENDER, потом продолжить | |

**User's choice:** Один финальный verify (Recommended)
**Notes:** Чистый YOLO. Один локальный `npm start` после всех task'ов, затем `npx tsc --noEmit`
чистый. Риск принят: если LLM-промпт сломан — узнаем только после DEDUP/ARCH/ALERT.

---

## Claude's Discretion (recommended defaults в CONTEXT.md)

Эти области не выбраны для обсуждения, но planner и researcher имеют чёткие defaults
для них в CONTEXT.md (D-09 .. D-18). Если planner отклонится — отметит deviation.

### Lifecycle ФС-state на сбоях
- D-09 — порядок: fetch → write raw → load cache → dedup → LLM → render → send → write output → commit cache
- D-10 — даты MSK
- D-11 — re-run = перезапись

### Alert поведение
- D-12 — обёртка в `src/run.ts` (внешняя)
- D-13 — await, не fire-and-forget
- D-14 — без throttling в v3.0
- D-15 — alert-on-alert-fail → console.error + сдаёмся

### Технические детали
- D-16 — Zod в `src/schema.ts`, удаление ручной `validate()`
- D-17 — `src/dedup.ts` + `src/archive.ts` — отдельные модули
- D-18 — RUNBOOK сценарий: Симптом → Диагностика → Действие → Восстановление; CHANNELS — checklist

---

## Deferred Ideas

См. `01-CONTEXT.md` § Deferred. Сводка:

- Phase 2 (ACCEPT-01..02) — отдельная фаза-checkpoint после 7 календарных дней
- v3.1 backlog: alert throttling, Unicode NFC fix, console.warn cleanup
- v4.0: semantic dedupe + Postgres
