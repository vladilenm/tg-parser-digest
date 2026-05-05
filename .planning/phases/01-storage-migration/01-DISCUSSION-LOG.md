# Phase 1: Storage Migration — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-05
**Phase:** 01-storage-migration
**Areas discussed:** JSON schema файла, Реализация mutex'а, Объём API channels-store (+ Auto-migration)

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| JSON schema файла | Структура channels.json: 1:1 как YAML / +audit-поля / +version-wrapper | ✓ |
| Реализация mutex'а | Самописный promise-chain / async-mutex / boolean+await-loop | ✓ |
| Auto-migration policy | Что делать с channels.yaml после миграции, lazy vs eager | (взято позже отдельным вопросом) |
| Объём API channels-store | loadChannels+saveChannels / полный CRUD / только loadChannels | ✓ |

**User's choice:** JSON schema, Mutex, API scope. Auto-migration был покрыт отдельным вопросом в конце (STORE-03 не оставляет выбора пропустить).

---

## JSON schema файла

### Q1: Какую схему channels.json делаем?

| Option | Description | Selected |
|--------|-------------|----------|
| 1:1 как YAML | `{ channels: [{ username, priority? }] }` — минимум изменений, YAGNI | ✓ |
| + audit-поля | + `addedBy`, `addedAt` под бот-аудит из Phase 2 | |
| + version-wrapper | `{ version: 1, channels: [...] }` под будущие миграции | |

**User's choice:** 1:1 как YAML (Recommended)
**Notes:** Соответствует YAGNI-принципу проекта. Бот в Phase 2 будет писать без расширения схемы; ре-открыть только при реальном требовании audit'а.

---

### Q2: Как валидируем схему при чтении channels.json?

| Option | Description | Selected |
|--------|-------------|----------|
| Zod-схема | zod уже в deps v3.0; ровные error messages | ✓ |
| Ручная (как сейчас) | typeof + Array.isArray + throw — 0 кода, мусорные ошибки | |

**User's choice:** Zod-схема (Recommended)
**Notes:** zod уже использовался в `src/schema.ts` для DeepSeek-ответов; channels-store применяет тот же паттерн.

---

### Q3: Что делаем, если channels.json есть, но Zod-валидация падает?

| Option | Description | Selected |
|--------|-------------|----------|
| Throw + alert | daemon ловит в tick(), шлёт alert через v3.0 alert.ts; оператор репейрит вручную | ✓ |
| Fallback на YAML | если YAML существует — читаем оттуда (warn в лог) | |

**User's choice:** Throw + alert (Recommended)
**Notes:** Fail loud — соответствует D-философии v3.0. Fallback маскировал бы расхождение «бот пишет JSON, pipeline читает YAML».

---

## Реализация mutex'а

### Q1: Как реализуем mutex для записи в channels.json?

| Option | Description | Selected |
|--------|-------------|----------|
| Самописный promise-chain | ~10 строк, 0 deps, легко тестируется | ✓ |
| Либа async-mutex | +1 runtime dep (~2KB), hardened API | |

**User's choice:** Самописный promise-chain (Recommended)
**Notes:** Сохраняет 5-deps-cap проекта. Ре-открыть, если самописный mutex даст ≥1 баг в Phase 2.

---

### Q2: Что именно mutex должен сериализовать?

| Option | Description | Selected |
|--------|-------------|----------|
| Только записи | loadChannels() читает без блокировки; mutate() через mutex | ✓ |
| Чтения и записи | все операции через mutex (paranoid) | |

**User's choice:** Только записи (Recommended)
**Notes:** Atomic POSIX rename(2) гарантирует, что reader увидит файл целиком (старая или новая версия, не половина). Cron-tick никогда не ждёт бота.

---

## Объём API channels-store

### Q1: Что входит в публичный API src/channels-store.ts в Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Load + write helpers | loadChannels + saveChannels + mutate(fn) — read-modify-write через mutex | ✓ |
| Полный CRUD | + addChannel/removeChannel в Phase 1 (без бот-вызывающего пути) | |
| Только loadChannels | mutex+save в Phase 2 — но это не закроет STORE-02 в Phase 1 | |

**User's choice:** Load + write helpers (Recommended)
**Notes:** CRUD-обёртки переезжают в Phase 2 рядом с кодом бота, который их единственный consumer. STORE-02 (mutex+atomic) закрыт в Phase 1 через `mutate()`.

---

## Auto-Migration (STORE-03)

### Q1: Когда и как срабатывает auto-migration channels.yaml → channels.json?

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy + сохранить YAML | в loadChannels(): нет JSON → читаем YAML, пишем JSON, YAML на диске остаётся | ✓ |
| Lazy + .bak из YAML | то же самое + rename channels.yaml → channels.yaml.bak | |
| Eager при старте daemon | src/run.ts проверяет до первого tick() | |

**User's choice:** Lazy + сохранить YAML (Recommended)
**Notes:** Идемпотентно (второй запуск увидит JSON и не будет мигрировать). YAML остаётся как backup — оператор сам решает, удалять ли. Никакого rename/bak — чистая операция без побочки.

---

## Claude's Discretion

Делегировано planner'у:
- Структура файла `channels-store.ts` (порядок функций, named vs default exports) — стиль существующих модулей.
- Имена internal-функций (`readChannelsFromDisk` etc.).
- Vitest unit tests — в `src/__tests__/channels-store.test.ts`, минимум 5 тестов (load happy-path, valid migration, идемпотентность, Zod-failure, mutex serialization).
- `.gitignore` статус `channels.json` — по аналогии с `channels.yaml`.

## Deferred Ideas

См. CONTEXT.md `<deferred>`. Ключевые отложенные идеи:
- CRUD-обёртки `addChannel`/`removeChannel`/`listChannels` — Phase 2.
- Audit-поля `addedBy`/`addedAt` — рассмотрено, отклонено по YAGNI.
- Version-wrapper схемы — отклонено, ре-открыть в v5+.
- Library `async-mutex` — отклонено ради 5-deps-cap.
- Eager migration в run.ts — отклонено.
- `channels.yaml.bak` rename — отклонено.
