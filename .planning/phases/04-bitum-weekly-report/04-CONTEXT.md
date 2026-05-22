# Phase 4: bitum-weekly-report - Context

**Gathered:** 2026-05-22 (rewrite — supersedes 2026-05-21 version)
**Status:** Ready for planning

> **Этот документ полностью замещает предыдущую версию CONTEXT.md.** Предыдущие
> решения (D-01..D-14 от 2026-05-21) отменены — фаза переосмыслена в сторону
> упрощения. Старые артефакты (04-01-PLAN.md, 04-01-SUMMARY.md, 04-REVIEW.md,
> 04-VERIFICATION.md, 04-HUMAN-UAT.md) описывают **отменённую** реализацию и не
> являются input'ом для нового plan-phase.

<domain>
## Phase Boundary

Phase 4 — упрощённый битум-пайплайн «недельный отчёт». Заказчик за неделю
присылает в DM боту **4 xlsx-файла** (фиксированный набор типов, см. ниже). На
каждую загрузку бот спрашивает inline-keyboard'ом «что это за файл?» — без
автоклассификации. После того как накоплен пакет, оператор командой
`/bitum_report` получает в DM **превью** программного дайджеста (плоский список
движений + ручные числа из новой команды `/bitum_add`), подтверждает кнопкой —
и тот же контент уходит в `TG_CHANNEL_ID`.

**4 типа файлов (фиксированные, эквивалентны 4 кнопкам inline-keyboard):**

| Имя в UI/боте | Файл-эталон в `docs/examples/` | Роль |
|---|---|---|
| «Биржа суточная по NPZ» | `birzha — суточная по НПЗ.xlsx` | объёмы биржевых торгов |
| «Биржа цены NPZ» | `birzha — цены НПЗ.xlsx` | биржевые цены, time-series |
| «Битум таблица продавцы» | `BITUM — таблица продавцы.xlsx` | FCA цены продавцов |
| «Битум прайс» | `bitum_price — Сводная таблица_new.xlsx` | сводная таблица — источник дельт И reference для cross-check |

**In scope Phase 4:**
- Полное удаление существующего `src/bitum/*`, `src/bot-bitum.ts`, всех 18
  битум-vitest тестов в `src/__tests__/bitum-*.test.ts`, `data/uploads/2026-W19/`,
  `data/uploads/2026-W21/`, `data/bitum/signatures-learned.json` (если есть)
- Написать заново с нуля: `src/bitum/*` с 4 парсерами + storage + reporter +
  bot-handler (always-ask UX)
- 4 команды: `/bitum_status`, `/bitum_report` (preview → publish с подтверждением),
  `/bitum_reset` (обнуление текущей ISO-недели), новая `/bitum_add` (ручные пары
  label+value для дайджеста)
- Programmatic-репорт без LLM
- Плоский список движений (без группировки по холдингам Роснефть/ГПН/ЛУКОЙЛ)
- Cell-trace footer + partial-render warning

**Out of scope Phase 4:**
- Тип `all_prices` (старый `parseAllPrices`, signature, файл-пример
  `цены битум все ...xlsx`) — удаляется полностью
- Любая автоклассификация по содержимому (`classifier.ts`, `signatures.ts`,
  `learned-signatures.ts`) — выкидывается
- Learning-loop UX при low confidence
- Гибридный LLM в репортере (`llm.ts`)
- Группировка отчёта по холдингам (фиксированный порядок Роснефть → ГПН →
  ЛУКОЙЛ → Прочие отменён, отчёт плоский)
- OCR терминала, автопостинг по cron, RSS cross-check, multi-sheet `all_prices`,
  `/bitum_undo` — остаются в Future (REQUIREMENTS.md §Future)

</domain>

<decisions>
## Implementation Decisions

### Маппинг типов и удаление старого кода

- **D-01:** Зафиксировано ровно 4 типа файла — `birzha_volumes`, `birzha_prices`,
  `fca_sellers`, `bitum_price_new` (внутренние литералы остаются прежними для
  совместимости с `data/refineries.json` и фикстурами `docs/examples/`).
  Пользовательские имена в inline-keyboard — те, что заказчик называет в DM:
  «Биржа суточная по NPZ», «Биржа цены NPZ», «Битум таблица продавцы»,
  «Битум прайс».
- **D-02:** Тип `all_prices` удаляется целиком — парсер
  `src/bitum/parsers/all-prices.ts`, ссылка в `types.ts`, built-in signature,
  тесты `bitum-parser-all-prices.test.ts`. Файл-пример
  `docs/examples/цены битум все ...xlsx` удаляется. Никаких dead-code заглушек.
- **D-03:** Существующий код фазы 4 удаляется **целиком** перед написанием
  нового:
  - `src/bitum/` (весь каталог)
  - `src/bot-bitum.ts`
  - Все 18 vitest-файлов `src/__tests__/bitum-*.test.ts`
  - `data/uploads/2026-W19/`, `data/uploads/2026-W21/`
  - `data/bitum/signatures-learned.json` (если присутствует)
  - bitum-related ветки в `src/bot.ts` (handleDocument bitum-branch, /bitum_*
    routing, импорты)
  - bitum-related setup в `src/run.ts` (если есть)
- **D-04:** Один файл `04-01-PLAN.md` с wave-структурой (как и в старом плане) —
  но waves под новый scope: foundation (types + storage + refineries) → 4
  парсера → reporter (плоский programmatic) → bot (always-ask UX + 4 команды) →
  тесты. Точная wave-сборка — на `/gsd-plan-phase`.

### Upload UX (always-ask)

- **D-05:** На каждую загрузку xlsx бот **всегда** отвечает inline-keyboard'ом
  с 4 кнопками («Биржа суточная по NPZ», «Биржа цены NPZ», «Битум таблица
  продавцы», «Битум прайс»). Никакой автоклассификации, никаких signatures,
  никакого filename-кеша. Кнопка «Отмена/Не битум» — 5-я, файл не сохраняется.
- **D-06:** После тапа кнопки бот:
  1. Сохраняет файл как `data/uploads/<ISO-week>/<type>.xlsx` (atomic .tmp + rename)
  2. Парсит соответствующим парсером
  3. Отвечает одним сообщением: «✅ Сохранено как `<type>.xlsx`. Период:
     DD.MM.YY–DD.MM.YY. Распознано N строк. Ошибок: K. Чек-лист недели: ✅✅❌❌»
- **D-07:** Если на эту ISO-неделю файл этого типа уже был — он **перезаписывается**
  без подтверждения. Это явное поведение «последняя загрузка побеждает».
  Логируем в `log.info` факт перезаписи (`{ week, type, prevSize, newSize }`).

### Bot commands

- **D-08:** Финальный набор битум-команд: 4 штуки.
  - `/bitum_status` — чек-лист текущей ISO-недели (✅/❌ по 4 типам + список
    pending ручных чисел из `/bitum_add`)
  - `/bitum_report` — строит programmatic-дайджест по имеющимся файлам, шлёт
    превью в DM с inline-keyboard «📤 Опубликовать / ❌ Отмена». На «Опубликовать»
    — `sendMessage` тем же контентом в `TG_CHANNEL_ID`. На «Отмена» — ничего.
  - `/bitum_reset` — обнуление текущей ISO-недели (xlsx + ручные числа) с
    подтверждением «✅ Сбросить / ❌ Отмена». Старые недели не трогает.
  - `/bitum_add <label>=<value>` (или похожий синтаксис — финальный формат на
    plan-phase) — добавление одной пары label+value в копилку ручных чисел
    текущей ISO-недели. Хранение: append-only json типа
    `data/uploads/<ISO-week>/manual-numbers.json` с atomic write.
- **D-09:** Отдельная команда `/bitum_preview` (была в старом CONTEXT) **не
  создаётся** — она дублировала бы report-flow без публикации. Если нужно
  превью без публикации — пользователь жмёт «❌ Отмена» на `/bitum_report`.

### Дайджест (programmatic, без LLM)

- **D-10:** Никакого LLM. `src/bitum/llm.ts` удаляется, DeepSeek не вызывается
  из bitum-flow вообще. Все строки в отчёте — programmatic шаблоны на основе
  ParsedRow* и AnalysisResult.
- **D-11:** **Плоская структура отчёта** — без группировки по холдингам
  (Роснефть/Газпромнефть/ЛУКОЙЛ отменены как разделы). Все движения по
  предприятиям — единым списком. Сортировка внутри списка — на plan-phase
  (предположительно по |Δ| desc).
- **D-12:** Структура дайджеста (порядок блоков):
  1. **Period header** — «Битумный отчёт DD.MM.YY – DD.MM.YY»
  2. **Ручные числа** (если есть в `manual-numbers.json` для этой недели) —
     отдельный блок сразу после period header, в формате `<b>label:</b> value`
     построчно
  3. **Partial-render warning** (если загружены не все 4 типа) —
     «⚠️ Доступно X/4 типов: ... Отсутствуют: ...»
  4. **Объёмы биржевых торгов** (если есть `birzha_volumes`) — Σ + top-N НПЗ
  5. **Движения цен** — плоский список «`<b>НПЗ</b>: цена изменилась с A на B
     (Δ=+C ₽, +D%)»` или похожий формат (финальный текст — на plan-phase)
  6. **Cross-check warning** (если расхождение со «Битум прайс» > порога) —
     «⚠️ Расхождение цен: ...»
  7. **Cell-trace footer** — компактный `<code>` блок «Источники: birzha_prices.xlsx:
     70 чисел из B4..T18; ...» — сохраняем как в старом D-09.
- **D-13:** **Partial-render** сохраняется (как старый D-10): если присланы не все 4
  файла, дайджест собирается из того что есть, блоки требующие отсутствующие
  файлы — заменяются на «(нет данных: ожидается `<type>.xlsx`)». Команда
  `/bitum_status` остаётся источником правды «что не хватает».

### Команда `/bitum_add` — ручные числа

- **D-14:** Свободные пары `label=value` (опционально с unit-суффиксом — на
  plan-phase). Заказчик пишет что хочет, Claude не валидирует семантику. Pure
  pass-through в дайджест.
- **D-15:** Хранение: `data/uploads/<ISO-week>/manual-numbers.json` — массив
  объектов `{ label: string, value: string, addedAt: ISO timestamp }`. Atomic
  write (`.tmp + rename`) + in-process mutex (паттерн `channels-store.ts`).
- **D-16:** Появление в дайджесте — отдельным блоком в начале (после period
  header), формат `<b>label:</b> value` построчно. Если для недели нет ручных
  чисел — блок просто отсутствует, без placeholder'а.
- **D-17:** `/bitum_reset` обнуляет и xlsx, и `manual-numbers.json` для текущей
  недели. Команда удаления отдельной пары label+value в Phase 4 не планируется
  (если нужно — `/bitum_reset` + добавить заново; либо отдельная команда в
  будущей фазе).

### Cross-check со «Битум прайсом»

- **D-18:** Логика сверки (что именно сравниваем, какой порог расхождения для
  warning, формат сообщения) — **TBD на plan-phase**. Из обсуждения зафиксировано
  только направление: «Битум прайс» (`bitum_price_new`) — это и источник
  дельт, и reference, с которым сверяются цифры из трёх других файлов. Точные
  formulas + порог — задаст заказчик при /gsd-plan-phase.

### Хранилище и инфраструктура

- **D-19:** ISO-неделя как primary key — структура `data/uploads/<YYYY-Www>/`
  сохраняется. Внутри недели: 4 xlsx (`birzha_volumes.xlsx`, `birzha_prices.xlsx`,
  `fca_sellers.xlsx`, `bitum_price_new.xlsx`) + `manual-numbers.json`.
- **D-20:** Storage-слой пишется заново (`src/bitum/storage.ts`), но паттерны
  заимствуются из старого `src/upload/storage.ts` (который был удалён в
  прошлой реализации): `isoWeekFolder` (ISO 8601 Thursday-rule), atomic write,
  `findLatestWeekWithUploads`, `listWeek`. WeekStatus в новой версии — 4
  boolean флага (по 4 типам, не 5).

### Claude's Discretion (отложено на plan-phase)

Пользователь явно сказал «разберёмся на plan-phase» / «я напишу какие [вычисления]»:

- **Точные формулы вычислений** по каждому из 4 типов файлов (parser
  output → analyzer aggregations). Из старого CONTEXT можно подсмотреть, но
  не копировать слепо — упрощённая структура отчёта может позволить упростить
  и формулы.
- **Cross-check rule** (D-18) — что именно и как сравниваем «Битум прайс» с
  тремя базовыми файлами, какой порог расхождения (env var
  `BITUM_CROSS_CHECK_THRESHOLD` или хардкод).
- **Точный синтаксис `/bitum_add`** — `/bitum_add label=value`, `/bitum_add
  label value` (split по first space), multi-line через `\n`, какие escape-rules.
- **Сортировка движений в плоском списке** (D-11) — по |Δ| desc, по абсолютной
  цене desc, или хронологически.
- **Формат cell-trace footer** (D-12 §7) — какой уровень детализации (по файлу
  как в старом D-09 или построчно), какие unit-тесты на trace.
- **Что делать с pending preview в `/bitum_report`** если оператор не нажал
  ни «Опубликовать», ни «Отмена» — bytimeout или вечно висит callback_query.
- **Перезапись файла** (D-07) — нужно ли подтверждение или silent overwrite,
  если xlsx такого типа уже есть на эту неделю.
- **Структура `manual-numbers.json`** (D-15) — плоский массив или с группировкой
  (если когда-то понадобится /bitum_remove).
- **Расширение `data/refineries.json`** — словарь канонических НПЗ остаётся
  валидным (предыдущие расширения REFINERY-01 не отменяются), но проверить
  при plan-phase, что покрывает все НПЗ, встречающиеся в 4 эталонных файлах.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Главные спеки

- `docs/bitum/algoritm.md` — ОСТАЁТСЯ источником правды для §1-5 (формат
  исходных xlsx-файлов: БНД-/тыс.т множители, даты-serial, formula cells,
  long-table нормализация). **§6 ОТМЕНЁН** — структура отчёта в новой
  реализации плоская (см. D-11, D-12), не группируется по холдингам.
- `.planning/REQUIREMENTS.md` — 28 BITUM-* требований **существенно
  пересмотрены**: CLS-01..04 (классификатор + learning) отменены целиком,
  PARSE-04 (all_prices) удалён, REPORT-02..05 (группировка по холдингам)
  отменены. Актуальные: PARSE-01/02/03/05 (4 парсера остаются), PARSE-06
  (Zod-валидация), REFINERY-01/02 (словарь), REPORT-01/06/07/08 (period header,
  Σ/Δ flat, trace, cross-check), TG-01/03/04/05 (status/report/reset/upload-ack),
  MIGRATE-01..03 (но миграция теперь = full rewrite, не /upload→/bitum
  алиасы). При plan-phase обновить REQUIREMENTS.md под новый scope (отдельная
  задача в plan).
- `.planning/PROJECT.md` — Constraints не меняются (no DB, pure-функции,
  atomic write, no Telegraf, no web UI), Out of Scope расширяется (no LLM в
  bitum-flow, no auto-classification).

### Эталонные файлы (фикстуры для парсеров)

- `docs/examples/birzha — суточная по НПЗ.xlsx` — фикстура для парсера
  `birzha_volumes`. `_rev.xlsx` версия — нормализованная вручную, использовать
  как ground truth для unit-тестов.
- `docs/examples/birzha — цены НПЗ.xlsx` + `_rev.xlsx` — фикстура для
  `birzha_prices`.
- `docs/examples/BITUM — таблица продавцы.xlsx` + `_rev.xlsx` — фикстура для
  `fca_sellers`.
- `docs/examples/bitum_price — Сводная таблица_new.xlsx` — фикстура для
  `bitum_price_new` (теперь это сводная + reference для cross-check, а не
  snapshot средней цены БНД как было раньше).
- `docs/examples/цены битум все 08.05-15.05.xlsx` + `_rev.xlsx` — **больше
  не нужны**, удалить вместе с парсером.
- `docs/examples/Снимок экрана.jpg` — игнорируем (OCR в Future).

### Существующий код (re-use паттернов, НЕ копировать целиком)

- `src/deliver.ts` — `chunkHtml(text, max)` (≤4000 разрыв `\n\n` → `\n` → `\s`)
  — переиспользовать для нарезки дайджеста по TG-лимиту.
- `src/paths.ts` — `paths.dataDir` resolver (ENV `DATA_DIR` или `./data`). Все
  xlsx и `manual-numbers.json` идут в `paths.dataDir/uploads/<week>/`.
- `src/channels-store.ts` — **референс-паттерн** in-process mutex + atomic
  `.tmp + rename` для `manual-numbers.json`.
- `src/logger.ts` — `log.info/error/warn` с `[ISO] [level]` — обязательно для
  всех битум-операций (upload, parse, report, publish, reset, add).
- `src/bot.ts` — `sendHtml`, `tgFetch`, callback_query handler (паттерн из
  `/remove_channel`) — для inline-keyboard 4 кнопок upload, подтверждения
  `/bitum_report` и `/bitum_reset`. **bitum-related ветки внутри `bot.ts`
  переписываются** (D-03).
- `src/__tests__/` — vitest pattern (зелёные не-битум тесты остаются), mock
  OpenAI больше не нужен для bitum-flow (D-10).

### Reference data

- `data/refineries.json` — словарь канонических НПЗ + поле `company`. **Остаётся
  валидным**, предыдущие расширения REFINERY-01 не отменяются. На plan-phase
  проверить покрытие 4 эталонными файлами.
- `data/uploads/2026-W19/`, `data/uploads/2026-W21/` — **удалить целиком** перед
  написанием нового кода (D-03). Не использовать как фикстуры.

### НЕ читать (отменённый референс)

- `src/bitum/*` — весь каталог удаляется, не использовать как референс
  архитектуры или паттернов.
- `src/bot-bitum.ts` — удаляется, не использовать как референс bot-UX.
- `src/__tests__/bitum-*.test.ts` — все 18 файлов удаляются, не использовать
  как референс тест-паттернов битума.
- Предыдущий `04-CONTEXT.md` (этот файл до перезаписи) и `04-01-PLAN.md`,
  `04-01-SUMMARY.md`, `04-REVIEW.md`, `04-VERIFICATION.md`,
  `04-HUMAN-UAT.md` — описывают отменённую реализацию.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/deliver.ts:chunkHtml`** — переиспользовать для нарезки дайджеста по
  4000 chars с префиксами `(i/N)`.
- **`src/paths.ts:paths.dataDir`** — единый resolver для всех путей данных.
- **`src/channels-store.ts`** — паттерн in-process mutex + atomic write для
  `manual-numbers.json`.
- **`src/logger.ts`** — структурный логгер; обязателен для всех битум-операций.
- **`src/bot.ts:sendHtml`/`tgFetch`/`callback_query handler`** — паттерны для
  inline-keyboard upload, `/bitum_report` подтверждения, `/bitum_reset`
  подтверждения.
- **`data/refineries.json`** — словарь НПЗ + `company`, остаётся валидным.

### Established Patterns

- **Pure-функции + dict-аргументом, без module-level singleton'ов** —
  обязательно для всех новых функций в `src/bitum/*` (паттерн
  `parseBirzhaPrices(buffer, dict)`, `buildReport(parsed, manualNumbers, dict)`).
- **Атомарная запись `.tmp + rename`** — для всех новых файлов (xlsx,
  manual-numbers.json).
- **Zod-валидация на output парсеров** — `ParserResult<T> = { rows, errors }`
  без падения при битых строках (паттерн из удалённого старого `src/bitum/parsers/`
  переносим в новый, но проверять на код-ревью что schemas совпадают со
  спекой algoritm.md §1-5).
- **HTML-output Telegram parse_mode=HTML, whitelist `<b>`, `<i>`, `<code>`,
  `<a href>`** — без `<br>`/`<h1>`/`<hr>`. Паттерн `sendHtml` из `bot.ts`.
- **callback_query handler с pending state в `Map<msgId, ...>`** — для upload
  inline-keyboard (msgId → uploaded file metadata) и `/bitum_report` (msgId →
  pending report content). Рестарт бота → теряются pending — acceptable.

### Integration Points

- **`src/run.ts`** (daemon tick) — bitum-pipeline **НЕ запускается** из
  daemon (как и раньше). Интеграция нулевая.
- **`src/bot.ts:handleDocument`** — единственная точка входа xlsx. После
  переписывания: `handleDocument` распознаёт xlsx (по mime/extension) →
  отвечает inline-keyboard'ом 4 кнопок → callback handler сохраняет + парсит
  + отвечает чек-листом.
- **`src/bot.ts:setMyCommands`** — добавить 4 новые команды (`/bitum_status`,
  `/bitum_report`, `/bitum_reset`, `/bitum_add`). Старые `/bitum_preview`,
  `/summarize`, `/upload_status` удаляются из меню целиком (в коде их уже нет
  после Phase 4 first attempt — проверить и удалить остатки если есть).
- **`src/bot.ts:handleStart`/`handleHelp`** — обновить под 4 битум-команды.

</code_context>

<specifics>
## Specific Ideas

- **«Битум прайс» одновременно источник дельт и reference** — заказчик в
  обсуждении сказал: «По нему мы будем делать нашу аналитику, высчитывать
  дельту. С четвертым, «Битум прайсом», мы будем сравнивать, всё ли у нас
  так же, как и там». Это значит cross-check не однонаправленный (другие
  файлы vs Битум прайс), а двунаправленный — точная семантика на plan-phase.
- **Inline-keyboard на каждую загрузку** — заказчик готов тапать кнопку
  каждый раз, его не раздражает повторение. Это упрощает код радикально.
- **Заказчик присылает 4 файла в произвольном порядке с произвольными
  именами** — соответствие имени → тип определяется кнопкой, не парсингом
  имени.
- **Ручные числа — для дополнительного контекста** — это не замена парсера
  bitum_price_new, а отдельный канал ввода (например, средняя цена БНД из
  терминала по скриншоту, который заказчик читает глазами).
- **Плоский список движений** — заказчик не хочет блочную структуру
  Роснефть/ГПН/ЛУКОЙЛ. Один блок «изменения цен», все НПЗ единым списком.

</specifics>

<deferred>
## Deferred Ideas

### Отложено на plan-phase

- **Спецификация вычислений** по каждому типу файла (parser output →
  analyzer aggregations) — заказчик опишет при /gsd-plan-phase.
- **Cross-check rule** (D-18) — что именно сравниваем со «Битум прайсом»,
  какой порог расхождения.
- **Точный синтаксис `/bitum_add`** (D-14) — `label=value` vs `label value`
  vs multi-line через `\n`.
- **Сортировка движений в плоском списке** (D-11) — по |Δ| desc или иначе.
- **Поведение перезаписи xlsx** (D-07) — silent overwrite или подтверждение.
- **Формат cell-trace footer** (D-12 §7) — детализация по файлу или построчно.

### Перенесены в Future (REQUIREMENTS.md §Future, не меняется)

- BITUM-OCR-01 — распознавание скриншотов терминала
- BITUM-TG-06 — inline-keyboard выбор недели (отчёт за прошлую неделю)
- BITUM-TG-07 — `/bitum_undo` (отмена последней публикации)
- BITUM-AUTOSEND-01 — автопостинг по cron
- BITUM-REPORT-09 — RSS cross-check
- BITUM-PARSE-07 — multi-sheet `all_prices` (но `all_prices` теперь out of scope
  целиком, не вернётся)

### Out of Scope (полностью, не возвращаемся)

- Автоклассификация xlsx по содержимому (classifier + signatures + learning)
- Гибридный LLM-narrative в репортере
- Группировка отчёта по холдингам Роснефть/ГПН/ЛУКОЙЛ
- Тип `all_prices` целиком (парсер + signature + файл-пример + тесты)
- Bot framework (Telegraf/grammY), web UI, БД, multi-customer, OCR, поддержка
  макросов/VBA, версионирование отчётов (как в `.planning/PROJECT.md` §Out of Scope)

</deferred>

---

*Phase: 04-bitum-weekly-report*
*Context gathered: 2026-05-22 (rewrite — supersedes 2026-05-21)*
