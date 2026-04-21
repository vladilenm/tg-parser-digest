# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP дайджест

**Shipped:** 2026-04-21
**Phases:** 1 | **Plans:** 3 | **Sessions:** ~4–5 (за ~1 рабочий день)

### What Was Built

- Каркас ESM/TypeScript-проекта на Node.js 20.6+ с 3 runtime-зависимостями (`telegram`, `openai`, `yaml`), без шага сборки (`tsx`), `moduleResolution: bundler`, `strict: true`
- GramJS user-client с anti-ban identity (`Desktop`/`Windows 11`/`ru`), `fetchLast24h()` с остановкой итерации по `msg.date < sinceUnix`, FloodWait retry с `sleep(err.seconds*1000 + 2000)`, фильтрацией `ChannelPrivateError`/`UsernameNotOccupiedError`/`UsernameInvalidError` и jitter `CHANNEL_DELAY_MS + rand(0,500)` между каналами
- DeepSeek batch-суммаризация через OpenAI-совместимый SDK (`response_format: json_object`), экстрактивный промпт с обязательной дословностью `keyQuote`, серверная верификация через `Map<url, Post>` + `text.includes(keyQuote)`, inline HTML-рендер с экранированием `<`,`>`,`&`
- `src/deliver.ts` — `sendToChannel` через `fetch` к Bot API `sendMessage` + `chunkHtml(html, 4000)` с нумерацией `(i/N)`; `src/run.ts` — `main()` с пустым днём (`exit 0` до DeepSeek) и глобальным catch (`exit 1`); `README.md` с 3-командным запуском и дисциплиной «не чаще одного прогона в 10–15 минут»

**Итог:** ~651 LOC TypeScript в 6 модулях, 37 файлов изменено, 29 коммитов, все 26 требований passed 3-source cross-reference, 5/5 критериев §11 приёмки вручную.

### What Worked

- **Single-phase milestone по запросу пользователя** — пайплайн GramJS→DeepSeek→Bot API верифицируем только end-to-end; разбиение на 3–5 фаз дало бы искусственные границы. 3 плана внутри одной фазы обеспечили чекпоинты без раздувания.
- **Экстрактивный промпт + серверная верификация `keyQuote`** — базовая защита от галлюцинаций. Модель получает явное требование «дословная подстрока», а код режектит невалидные записи до отправки.
- **Три runtime-зависимости — не больше и не меньше** — `telegram`+`openai`+`yaml`. Каждую добавленную library надо было оправдать; отсутствие `dotenv`/`zod`/`dayjs` не стоило боли.
- **Ручная приёмка по §11 spec-app.md** — 5 конкретных булевых критериев, которые оператор прогоняет за 5 минут. Автотесты окупились бы только при CI; здесь чек-лист дешевле.
- **spec-app.md как source of truth** — §7 шаги, §8 промпт, §9 anti-ban, §11 приёмка были написаны до кода, что сняло 90% проектных вопросов в фазе планирования.

### What Was Inefficient

- **Двойная инициализация GSD** — в git log видны следы старой версии ROADMAP («docs: create roadmap (2 phases)» → удалено → «docs: create roadmap (1 phase)»). Пользователь запросил «сильно меньше» уже после первой попытки; потеряны ~15 минут на переделку.
- **REVIEW.md после факта** — 11 findings (WR-01…05 + IN-01…06) всплыли только в code review фазе. Магическая константа `Math.floor(max * 0.5)` в `chunkHtml`, повторяющийся каст `as unknown as { date?: number }`, NaN-валидация env — всё можно было увидеть до коммита. Не блокеры, но pre-commit lint пропустил.
- **`LOG_LEVEL` в `.env.example` без реализации** — задокументирован, но нигде не читается. Орфанный env key — результат копирования из draft без проверки grep-ом.
- **Unicode NFC vs NFD не учтён в keyQuote verify** — `text.includes(keyQuote)` чувствителен к нормализации; при копировании из Telegram возможны ложные срабатывания. Обнаружено code review, не unit-тестами (их нет).

### Patterns Established

- **3-source cross-reference для requirements coverage**: VERIFICATION.md + SUMMARY frontmatter + REQUIREMENTS.md traceability — детектирует и orphans, и drift. Стал стандартом для audit.
- **«Plan 1 || Plan 2 → Plan 3»** — параллелизация двух независимых планов (каркас, пайплайн) с последующим объединяющим планом (доставка+приёмка) минимизирует blocking. Работает при явных интерфейсах между планами.
- **`response_format: json_object` + ручная validation** вместо zod — для одного стабильного endpoint достаточно `typeof`/`Array.isArray`. Zod появится при втором провайдере.
- **YOLO-режим GSD для одной фазы** — auto-approved scope verification, skip gates. Нужно только когда milestone явно определён и нет open questions.

### Key Lessons

1. **Разбиение на фазы должно идти от верифицируемой ценности, не от «количества технологий»**. Один скрипт на 651 LOC — одна фаза, даже если он касается GramJS+DeepSeek+Bot API. Фаза закрыта, когда 5 критериев §11 пройдены вручную.
2. **Экстрактивность LLM — это про design, а не про prompt engineering**. Промпт говорит «keyQuote — подстрока text», но без серверной проверки через `Map<url, Post>` + `includes()` галлюцинации пройдут. Архитектурное решение > формулировка промпта.
3. **Audit через REVIEW.md полезен, но должен жить до Phase complete, не после**. 11 findings в v1.0 — все known-accepted, но IN-04 (silent skip медиа-постов) реально теряет данные. Pre-commit lint + REVIEW.md обязателен в v2.
4. **`.env.example` требует CI-проверки на orphan keys**. `LOG_LEVEL` задокументирован, но не прочитан — это documentation drift, который grep ловит за 1 секунду. Добавить в hooks.
5. **Milestone audit ≠ tech debt audit**. Аудит v1.0 passed (0 gaps, 0 unsatisfied), но 12 tech debt items требуют отдельного решения: backlog v2 / cleanup-фаза / accept. По умолчанию — backlog.

### Cost Observations

- Model mix: преимущественно Opus 4.7 (1M context) — фаза маленькая, compression не требовалось
- Sessions: ~4–5 (new-project → define-requirements → create-roadmap → plan-phase → execute-phase → verify → review → complete-milestone)
- Notable: план-фаза заняла больше времени чем execute из-за `spec-app.md` как источника правды — это хорошо (дешёвые итерации в плане, а не в коде)

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~4–5 | 1 | Initial MVP — GSD YOLO-режим, single-phase milestone по запросу пользователя |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 0 | — (ручная §11 приёмка) | 3 runtime deps (`telegram`, `openai`, `yaml`), 3 devDeps (`tsx`, `typescript`, `@types/node`) |

### Top Lessons (Verified Across Milestones)

*(Пока только один milestone — кросс-верификация появится после v1.1/v2.0.)*

1. Экстрактивность LLM достигается архитектурой (server-side verify), не только промптом — v1.0
2. Single-phase milestone оправдан, если пайплайн не даёт ценности в подмножествах — v1.0
