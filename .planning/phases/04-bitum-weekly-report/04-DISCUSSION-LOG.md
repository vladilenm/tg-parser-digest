# Phase 4: bitum-weekly-report - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.
>
> **Этот лог замещает версию от 2026-05-21.** Предыдущая итерация фазы (с
> автоклассификатором, learning-loop, группировкой по холдингам и гибридным LLM)
> отменена. Новый scope радикально проще — фиксированные 4 типа, always-ask UX,
> плоский programmatic-репорт, ручной ввод чисел через `/bitum_add`.

**Date:** 2026-05-22 (rewrite)
**Phase:** 04-bitum-weekly-report
**Trigger:** Заказчик пересмотрел задачу — «всё оказалось чуть проще, чем я думал».
Существующая реализация (commit `5faad4f` и ранее) принципиально не подходит
под новое понимание flow.

**Areas discussed:**
- Маппинг 4 типов файлов и судьба `all_prices`
- Upload UX (always-ask vs автоклассификация)
- Новая команда ручного ввода `/bitum_add` — scope
- Стратегия миграции (refactor vs full rewrite)
- Спецификация вычислений (defer/now)
- Размещение ручных чисел в дайджесте
- Структура итогового дайджеста (с холдингами vs плоский)
- LLM в репортере (сохранить vs убрать)
- Финальный набор битум-команд
- Что делать со старыми данными и тестами
- Cell-trace footer + partial-render

---

## Round 1: Core scope

### Q1.1: Маппинг 4 типов файлов и судьба `all_prices`?

| Option | Description | Selected |
|--------|-------------|----------|
| Маппинг верный, all_prices полностью удаляем | Парсер, signature, ссылка в types.ts, тесты, файл-пример — всё под нож | ✓ |
| Маппинг верный, all_prices оставить (dead code) | Безопаснее при откате, но мусор | |
| Маппинг другой — поправлю текстом | | |

**User's choice:** all_prices удаляется полностью. 4 фиксированных типа:
`birzha_volumes`, `birzha_prices`, `fca_sellers`, `bitum_price_new`.

---

### Q1.2: Что делать при загрузке xlsx — всегда спрашивать тип или запоминать?

| Option | Description | Selected |
|--------|-------------|----------|
| Всегда показывать inline-keyboard 4 кнопок | Никакой автоклассификации, никаких signatures, никакого learning. Каждый раз тап. | ✓ |
| Пред-выбрать по имени файла, спросить подтверждение | Гибрид: matching по containsCase + всё равно ждём тап | |
| Запомнить filename→type, в след раз пропустить | persistent map + риск рассинхрона | |

**User's choice:** Always-ask. Радикальное упрощение — кладёт классификатор,
сигнатуры и learning-UX целиком.

---

### Q1.3: Новая команда ручного ввода чисел `/bitum_add` — что вводится и где появляется в дайджесте?

| Option | Description | Selected |
|--------|-------------|----------|
| Свободные пары label+value | Заказчик пишет что хочет, Claude не валидирует. Гибко, без структуры. | ✓ |
| Фиксированные поля (БНД ₽/т, ПБВ ₽/т, дата) | Замена старому OCR-блоку. Жёстко, прозрачно. | |
| Один pre-formatted текст | Pass-through блок текстом | |
| Опишу формат текстом | | |

**User's choice:** Свободные пары label+value. Хранение пока обсудим на
plan-phase, но направление — массив `{ label, value }` в неделе.

---

### Q1.4: Как трогаем существующий код src/bitum/ + bot-bitum.ts?

| Option | Description | Selected |
|--------|-------------|----------|
| Refactor in-place: оставить 3 парсера и WeekStatus, выкинуть classifier+signatures+learning, переписать handleDocument | Безопасно для зелёных тестов парсеров, минимум изменений | |
| Удалить всё (src/bitum/* + bot-bitum.ts), написать заново | Чистый старт, нет легаси-багов. Дорого по времени, но scope упростился настолько, что переписать ≤ refactor | ✓ |
| Refactor + переименование типов в human-readable (birzha_daily, bitum_price_summary) | + миграция storage paths старых недель | |

**User's choice:** Full rewrite — выкидываем `src/bitum/*`, `bot-bitum.ts`,
все 18 битум-тестов, обе старые недели (W19, W21).

---

## Round 2: Report structure + new command placement

### Q2.1: Спецификация вычислений (что считаем по 3 базовым файлам и как сверяем со «Битум прайсом») — описать сейчас или отложить?

| Option | Description | Selected |
|--------|-------------|----------|
| Опишу сейчас в чате | Полный спек в обсуждении, фиксируем в CONTEXT как locked decisions | |
| Отложить до plan-phase | TBD в CONTEXT; Claude задаст focused-вопросы при /gsd-plan-phase по каждому типу | ✓ |
| Берём старую спеку algoritm.md §6 как есть | Алгоритм правильный, меняется только upload flow | |

**User's choice:** Defer. Это превращает D-18 (cross-check) и точные formulas
в «Claude's Discretion» секцию CONTEXT.md.

---

### Q2.2: Где в дайджесте появляются ручные пары label+value из новой команды?

| Option | Description | Selected |
|--------|-------------|----------|
| Отдельный блок в начале (после period header) | Похоже на старый OCR-блок «На дату X средняя цена БНД...» | ✓ |
| Отдельный блок в конце | Не отвлекает от главных цифр | |
| Отдельным вторым сообщением | Два разных поста в TG канале | |

**User's choice:** В начало, после period header.

---

### Q2.3: Структура итогового дайджеста (блоки, порядок, группировка)?

| Option | Description | Selected |
|--------|-------------|----------|
| Как docs/bitum/algoritm.md §6 (БНД snapshot → Объёмы → Роснефть → ГПН → ЛУКОЙЛ → Прочие) | Без изменений, только БНД snapshot теперь из ручной команды | |
| Упростить — без группировки по холдингам, плоский список движений | Один блок «изменения цен», все НПЗ единым списком | ✓ |
| Новая структура — опишу | | |

**User's choice:** Плоский список. Это отменяет старый D-02 (фиксированный
порядок холдингов) и упрощает analyzer (нет нужды в `byCompanyFixedOrder`,
группировке Татнефть, выделении «Прочие»).

---

## Round 3: LLM + commands + cleanup + footer

### Q3.1: Гибридный LLM в репортере (DeepSeek пишет framing-фразы, programmatic подставляет числа) — сохраняем или выкидываем?

| Option | Description | Selected |
|--------|-------------|----------|
| Убрать LLM целиком — только programmatic репорт | Плоский список движений не требует narrative. Детерминистично, без галлюцинаций, без DeepSeek-ключа в bitum-flow | ✓ |
| Оставить гибрид (старый D-08) | Держим llm.ts, но с плоским форматом он меньше пользы | |

**User's choice:** Убрать LLM целиком. `src/bitum/llm.ts` под нож, DeepSeek
не вызывается из bitum-flow.

---

### Q3.2: Набор битум-команд в новой версии?

| Option | Description | Selected |
|--------|-------------|----------|
| /bitum_status + /bitum_report (preview→publish) + /bitum_reset + новая /bitum_add | Старые 4 + добавили одну. /bitum_preview выкидываем — он был дублем report-flow без publish | ✓ |
| /bitum_status + /bitum_preview + /bitum_report + /bitum_reset + /bitum_add | Сохранить preview как отдельную команду | |
| Предложу другой набор текстом | | |

**User's choice:** 4 команды (без preview). Превью получается через
`/bitum_report` → «❌ Отмена».

---

### Q3.3: data/uploads/2026-W19/ + старые vitest-тесты src/bitum/__tests__/ — что делаем?

| Option | Description | Selected |
|--------|-------------|----------|
| Удалить всё (старые недели + все 18 битум-тестов), пишем с нуля | Максимально чистый старт. Новые фикстуры из docs/examples/ при plan-phase | ✓ |
| Удалить тесты, сохранить W19 как ручную тест-фикстуру | Smoke-тест после переписывания, но требует переименования fca.xlsx → fca_sellers.xlsx | |
| Сохранить и тесты и данные, адаптировать | Риск дохлых тестов про classifier/learning | |

**User's choice:** Полное удаление. `data/uploads/2026-W19/`,
`data/uploads/2026-W21/`, все 18 файлов `src/__tests__/bitum-*.test.ts`.

---

### Q3.4: Cell-trace footer («Источники: birzha_prices.xlsx: 70 чисел из B4..T18») и partial-render («Доступно 3/4 типов») — оставляем или режем?

| Option | Description | Selected |
|--------|-------------|----------|
| Оставляем оба — trace в footer + partial-render warning | Как старый D-09 + D-10. Trace помогает верифицировать, partial работает при неполных данных | ✓ |
| Режем trace, оставляем partial-render | Trace = визуальный шум в финале | |
| Режем оба — максимальный минимализм | Дайджест только при полном пакете, иначе ошибка | |

**User's choice:** Оба остаются. Это сохраняет D-09 (trace footer) и D-10
(partial render) из старого CONTEXT.md как D-12 §7 и D-13 в новом.

---

## Claude's Discretion (отложено на plan-phase)

- Точные формулы вычислений по 4 типам файлов
- Cross-check rule между 3 базовыми файлами и «Битум прайсом» (порог, направление)
- Точный синтаксис `/bitum_add` (`label=value` vs `label value` vs multi-line)
- Сортировка движений в плоском списке (по |Δ| desc / по абсолюту / хронологически)
- Поведение перезаписи xlsx (silent overwrite vs подтверждение)
- Формат cell-trace footer (по файлу vs построчно)
- Поведение pending preview в `/bitum_report` (timeout vs вечный wait)
- Структура `manual-numbers.json` (плоский массив vs с группировкой)
- Расширение `data/refineries.json` под 4 эталонных файла

## Deferred Ideas

См. полный список в `04-CONTEXT.md` <deferred> секции — без изменений к
текущему обсуждению (Future REQUIREMENTS.md §Future, Out of Scope PROJECT.md).
