# Phase 4: bitum-weekly-report - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 — это **весь milestone v5.0 «Битумный недельный отчёт»** в одной фазе. Покрывает все 28 BITUM-* требований из [.planning/REQUIREMENTS.md](../../REQUIREMENTS.md):

- **CLS-01..04** — xlsx-классификатор по содержимому (6 типов: `birzha_prices` | `birzha_volumes` | `fca_sellers` | `all_prices` | `bitum_price_new` | `unknown`), confidence ∈ [0, 1], inline-keyboard learning-loop при confidence < 1, имя файла = 0.
- **PARSE-01..06** — пять идемпотентных парсеров с Zod-валидацией и `errors[]` без падения.
- **REFINERY-01..02** — расширение `data/refineries.json` под полную битум-номенклатуру, детерминированный `getCompany(canonical)`.
- **REPORT-01..08** — структурный отчёт по [docs/bitum/algoritm.md](../../../docs/bitum/algoritm.md) §6: период, Σ объёмов + top-N, 3 группы (Роснефть/Газпромнефть/ЛУКОЙЛ) + Прочие и независимые, snapshot средней цены БНД, cross-check цен с warning.
- **TG-01..05** — `/bitum_status`, `/bitum_preview`, `/bitum_report` (с inline-keyboard публикации в `TG_CHANNEL_ID`), `/bitum_reset` (с подтверждением), ответ при загрузке xlsx (что распознал + метаданные + чек-лист).
- **MIGRATE-01..03** — [src/upload/](../../../src/upload/) → `src/bitum/` с алиасами команд `/summarize`→`/bitum_preview`, `/upload_status`→`/bitum_status` (одно deprecation-сообщение).

**Out of scope** для Phase 4 (см. REQUIREMENTS.md §Future): BITUM-OCR-01 (распознавание `Снимок экрана.jpg`), inline-keyboard выбора прошлой недели, `/bitum_undo`, автопостинг по cron, RSS cross-check, multi-sheet `all_prices.xlsx`.

</domain>

<decisions>
## Implementation Decisions

### Декомпозиция плана

- **D-01:** Один файл `04-01-PLAN.md` с внутренней wave-структурой — НЕ 5-7 отдельных PLAN.md. План делится на нумерованные wave-секции внутри одного документа; executor проходит wave-блоки последовательно, atomic-commit на каждую wave.
- **D-02:** Wave-структура (от foundation к UX, точные имена и порядок Claude уточнит при `/gsd-plan-phase`):
  1. **Foundation** — `src/bitum/types.ts` + `src/bitum/signatures.ts` (TS-таблица 6 типов) + `classifier.ts` (`classifyFile(buffer): { type, confidence, meta }`) + расширение `data/refineries.json` под REFINERY-01.
  2. **Parsers** — все 5 парсеров (`parseBirzhaPrices`, `parseBirzhaVolumes`, `parseFcaSellers`, `parseAllPrices`, `parseBitumPriceNew`) одной wave с Zod-схемами и `errors[]`.
  3. **Analyzer + Reporter** — расширение `analyzer.ts` (Σ|Δ| по 3 группам + Прочие, верификация цен REPORT-08) + новый `reporter.ts` (структурный HTML-отчёт по algoritm.md §6 с cell-trace `ReportResult.trace`).
  4. **LLM narrative** — рефактор `llm.ts` под гибридный scope (см. D-08): system-prompt пишет ТОЛЬКО framing-предложения, числа подставляет reporter программно.
  5. **Bot commands** — 4 битум-команды + xlsx upload response (TG-01..05) + inline-keyboard learning UX для classifier.
  6. **Migration** — `src/upload/` → `src/bitum/` + алиасы `/summarize`/`/upload_status` с deprecation warning + обновление импортов в [src/bot.ts](../../../src/bot.ts).
- **D-03:** Foundation wave (точные файлы) — Claude разрешит при `/gsd-plan-phase` из dependency-graph 28 REQ. Гарантия: classifier и signatures должны быть готовы до парсеров (парсеры вызываются только после `classifyFile` вернул type).
- **D-04:** Парсеры — все 5 в одной wave (один PLAN-блок). Их логика однородна (ExcelJS + `cellToDate`/`cellToNumber` + long-table из [src/upload/parser.ts](../../../src/upload/parser.ts)), дробить на 5 отдельных секций — оверхед.
- **D-05:** Миграция `src/upload/` → `src/bitum/` — последней wave. Сначала весь новый код пишется рядом со старым (новые файлы в `src/bitum/*`), потом финальная wave делает `git mv`, удаляет старую папку, обновляет импорты в `bot.ts`, добавляет алиасы команд `/summarize`/`/upload_status` с одноразовым deprecation-сообщением. Это даёт нулевой риск ломания работающего `/summarize` в процессе разработки.
- **D-06:** `src/upload/` НЕ остаётся re-export shim'ом — папка удаляется полностью в последней wave. Backward compat только на уровне команд бота (`/summarize` → `/bitum_preview` алиас), не на уровне модулей.

### Формат отчёта и LLM scope

- **D-07:** Telegram `parse_mode=HTML` для всех битум-сообщений. Теги: `<b>`, `<i>`, `<code>`, `<a href>`. Паттерн `sendHtml` из [bot.ts](../../../src/bot.ts) (quick-260519-tbo) уже работает. Markdown V1 и V2 отвергнуты: V1 — нестабильный escape (v3.0 от него ушёл), V2 — нет существующего escape-хелпера в проекте.
- **D-08:** **Гибридный LLM scope** — numbers programmatic, framing-предложения LLM:
  - **Programmatic** (reporter подставляет из ParsedRow / AnalysisResult):
    - Period header («Период: DD MMM – DD MMM YYYY»)
    - Блок «на дату X средняя цена БНД составила Y ₽/т (+Z ₽/т, +W% за неделю)» из `parseBitumPriceNew` snapshot
    - Заголовки секций с Σ|Δ|: «`<b>Роснефть (Σ|Δ| = 3 795 ₽)</b>`»
    - Буллеты-движения с цифрами: «`Саратовский НПЗ (FCA) вырос на +1 000 ₽ (до 28 000 ₽)`»
    - «Объёмы биржевых торгов» — Σ + top-N с тыс.т
  - **LLM** (system-prompt с жёстким запретом выдумывать числа):
    - Top summary 1-3 предложения («За неделю цены на битум в основном росли...»)
    - Framing внутри блоков: «Ключевые движения:» / «Изменения только вниз:» / «Цены остались на уровне 30 апреля: A, B, C»
    - Closing «Остальные позиции остались на уровне начала периода» (LLM выбирает список из programmatic-данных, нумера читает из payload)
- **D-09:** REPORT-07 cell-trace — компактный `<code>...</code>` блок «Источники» в конце отчёта со сводкой ПО ФАЙЛУ (не построчно):
  ```
  Источники:
  • birzha_prices.xlsx: 70 чисел из B4..T18 (15 НПЗ × 15 дат)
  • bitum_price_new.xlsx: bnd 28 000 ₽ ← B4, pbv 30 500 ₽ ← D4
  • fca.xlsx: 65 чисел из B4..G15
  ```
  Reporter возвращает `{ html: string, trace: NumberTrace[] }`. Trace используется и для footer-рендера, и для unit-тестов (проверка что каждое число в отчёте маппится в `file!sheet.cell`).
- **D-10:** **Partial render при загрузке <5 типов** — `/bitum_preview` строит отчёт из имеющихся файлов, в начале сообщения ставит warning-блок:
  ```
  ⚠️ Доступно 3/5 типов: birzha_prices, fca_sellers, all_prices.
  Отсутствуют: birzha_volumes, bitum_price_new — соответствующие блоки пропущены.
  ```
  Блоки которые требуют недостающие данные (например, «средняя цена БНД» без `bitum_price_new`, «Объёмы биржи» без `birzha_volumes`) — пропускаются с одной строкой «(нет данных: ожидается `<type>.xlsx`)».

### Bot UX

- **D-11:** `/bitum_report` flow:
  1. Operator sends `/bitum_report`
  2. Bot строит отчёт по той же логике что `/bitum_preview`
  3. Bot шлёт превью в DM оператора + inline-keyboard «📤 Опубликовать в канал / ❌ Отмена»
  4. На «Опубликовать» — `sendMessage` в `TG_CHANNEL_ID` тем же контентом, в DM подтверждение «✅ Опубликовано: t.me/c/.../<msg_id>»
  5. На «Отмена» — отчёт остаётся в DM, в канал ничего не идёт
- **D-12:** `/bitum_reset` — обнуляет ТОЛЬКО текущую ISO-неделю (`data/uploads/<week>/`), не трогает старые недели. Inline-keyboard «✅ Сбросить / ❌ Отмена». На «Сбросить» — `rm -rf data/uploads/<week>/` + ответ списком удалённых файлов. Не делает backup — операция явно деструктивная.
- **D-13:** TG-05 xlsx upload response — ОДНО сообщение (не два), включает: что распознал (type + confidence + meta), результат парсинга (период / число строк / число НПЗ / errors count), чек-лист недели (5 типов ✅/❌). При confidence < 1 — отдельное inline-keyboard сообщение со списком 6 типов вместо обычного response (см. D-14).
- **D-14:** Classifier learning UX (CLS-03) — при `confidence < 1 OR type = unknown`:
  1. Bot НЕ сохраняет файл
  2. Шлёт inline-keyboard: «birzha_prices / birzha_volumes / fca_sellers / all_prices / bitum_price_new / не битум»
  3. На выбор типа — дописывает сигнатуру (A1/A3/B3 + sheet name из meta) в `data/bitum/signatures-learned.json` (append-only, атомарная запись `.tmp + rename`), сохраняет файл как `<type>.xlsx` и отвечает обычным TG-05 response
  4. На «не битум» — отвечает «Не сохранено, не распознано как битум-файл»

### Claude's Discretion

Пользователь явно сказал «Claude решит при planning» для этих областей:

- **Foundation wave precise file list** — какие именно файлы в `src/bitum/*` в wave 1 (types.ts только или types.ts + signatures.ts + classifier.ts вместе). Решает `/gsd-plan-phase` из dependency-graph.
- **Парсинг `all_prices.xlsx`** — algoritm.md §5 описывает сложную ручную трансформацию (pivot + dedup холдингов вручную). Стратегия parser'а (raw парсинг «исходник»-вкладки + код-side агрегация vs парсить только «свод»-вкладку если она есть) — на усмотрение research+planning. Reference behavior: PARSE-04 ожидает long-table `{ Пункт отгрузки, Компания, Регион, Тип, Источник, Доставка, Топливо, Цена, Дата }` после нормализации.
- **Classifier confidence model** — гранулярность confidence ∈ [0, 1]: бинарная (1.0 при exact match, < 1 → unknown), ступенчатая (A1=1.0, A1+A3=0.7, partial=0.4), или весовая (сумма матчей фрагментов нормализованная). Researcher и planner выберут на основе того, насколько ложноположительные классификации (когда не битум-xlsx опознан как битум) опасны для последующих парсеров.
- **Cross-check threshold (REPORT-08)** — текстом REQ-REPORT-08 указано «> 1%», использовать это как порог по умолчанию, при необходимости вынести в `BITUM_CROSS_CHECK_THRESHOLD` env var. Решение о env vs хардкоде — planner.
- **Сохранение оригинальных имён файлов** — клиент шлёт «BITUM — таблица продавцы.xlsx», а сохраняем как `fca_sellers.xlsx`. Сохранять ли оригинальное имя в `meta` для логов — Claude решит при planning.
- **`signatures-learned.json` schema** — структура файла-аккумулятора (плоский массив vs группировка по type) и формат сравнения сигнатур при последующих классификациях.
- **`/bitum_report` cancel/timeout** — что делать с pending preview если оператор не нажал ни одну кнопку (бесконечный wait — не блокирует, callback_query может прийти в любой момент после рестарта; явный timeout не требуется по спеке).
- **`renderer.ts` vs `reporter.ts`** — стоит ли разносить старый `renderMarkdown` (плоский Σ|Δ| отчёт из v4.0 quick-260519-lxu) и новый структурный `renderBitumReport` (algoritm.md §6) в разные файлы или объединить.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Главные спеки

- `docs/bitum/algoritm.md` — ИСТОЧНИК ПРАВДЫ. §1-5 описывают исходный формат пяти xlsx-файлов и их нормализацию (БНД-/тыс.т множители, pivot-логика для `all_prices`). §6 — структура отчёта (формат сообщения в Telegram), эталонный пример от Заказчика.
- `.planning/REQUIREMENTS.md` — 28 BITUM-* требований сгруппированы по 6 областям (CLS / PARSE / REFINERY / REPORT / TG / MIGRATE). Each REQ-ID — атомарная проверяемая единица.
- `.planning/PROJECT.md` — Constraints (no DB, raw fetch polling, pure-функции с dict-аргументом, атомарная запись), Out of Scope (no Telegraf, no web UI, no OCR в v5.0).

### Существующий код (база v4.0, расширяется до v5.0)

- `src/upload/types.ts` — `UploadType`, `RefineryEntry` (с полем `company`), `ParsedRow`, `RefineryDelta`, `CompanyGroup`, `AnalysisResult`. Все типы Bitum-pipeline должны быть совместимы (через расширение `UploadType` до 6 значений + новые подтипы для `bitum_price_new` snapshot).
- `src/upload/detect.ts` — `detectUploadType(wb): UploadType | null` по A1-маркеру (case-insensitive, prefix-match). 3 маркера: «цена битум на бирже» / «объем битум на бирже» / «битум цены продавцов fca». Это **первые 3 сигнатуры** для `src/bitum/signatures.ts`.
- `src/upload/parser.ts` — `parseWorkbook(buffer, type, dict)` диспатчит на `parseBirzhaPrices` / `parseBirzhaVolumes` / `parseFca`. ExcelJS + `cellToDate` (с поддержкой 1900-system serial) + `cellToNumber` (с поддержкой formula cells `{ result }`) + `cellToString` (с richText). Этот код **сохраняется в новых парсерах** (фактически переименование `parseFca` → `parseFcaSellers` + 2 новых).
- `src/upload/refineries.ts` — `loadRefineries()` ищет json в `paths.dataDir/refineries.json` или `./data/refineries.json`. `normalizeRefinery(raw, dict)` — case-insensitive поиск по canonical + aliases. `getCompany(canonical, dict)` — детерминированный lookup по полю `company`, fallback на «независимые». **Не трогать**, только расширить словарь данными из REFINERY-01.
- `src/upload/storage.ts` — `isoWeekFolder(date)` ISO 8601 (Thursday-rule), `saveUpload(buf, type, week)` атомарная запись `.tmp + rename`, `listWeek(week): WeekStatus` (флаги для 3 типов), `findLatestWeekWithUploads()` (lex-max папки с ≥1 xlsx), `writeLastRun(week, runAt)`. **Расширить `WeekStatus` до 5 флагов** (hasBirzhaPrices/hasBirzhaVolumes/hasFcaSellers/hasAllPrices/hasBitumPriceNew).
- `src/upload/analyzer.ts` — `analyze(prices, fca, volumes, dict): AnalysisResult` с `deltasFor` (first→last per canonical) + `groupDeltasByCompany` (Σ|Δ|, sorted desc) + `volumeTotals`. **Расширить под REPORT-02..06** (отдельная группировка Прочие и независимые с явным выделением Татнефть, cross-check REPORT-08).
- `src/upload/renderer.ts` — `renderMarkdown(result): string[]` с `chunkMarkdown` (≤4000 chars, разрыв `\n\n` → `\n`, префикс `(i/N)`). **Заменить** на HTML-рендерер (см. D-07); `chunkMarkdown` алгоритм переиспользовать как `chunkHtml` (паттерн из [src/deliver.ts](../../../src/deliver.ts)).
- `src/upload/llm.ts` — `buildLlmNarrative(result, opts): Promise<string[]>` с `NARRATIVE_SYSTEM_PROMPT` (Telegram HTML, ≈300-600 слов). **Рефактор** под D-08: новый prompt пишет ТОЛЬКО framing-предложения, payload содержит уже-готовый programmatic-отчёт с placeholder-местами для LLM-вставок.
- `src/bot.ts` — `handleDocument` (раздел detect+save+analyze+sendMarkdown), `handleSummarizeCommand` (раздел LLM-narrative), `/upload_status`, `setMyCommands` (7 команд), `BOT_ALLOWED_USER_IDS` allowlist, `sendHtml`/`sendMarkdown` helpers. **Расширить** под 4 битум-команды + xlsx response (TG-05) + classifier learning inline-keyboard (CLS-03) + алиасы.

### Утилиты и инфраструктура

- `src/deliver.ts` — `chunkHtml(text, max)` (≤4000 разрыв `\n\n` → `\n` → `\s`) — переиспользовать для HTML-нарезки битум-отчёта.
- `src/paths.ts` — `paths.dataDir` resolver (ENV `DATA_DIR` или `./data`). Все xlsx и signatures-learned.json идут в `paths.dataDir/bitum/*`.
- `src/channels-store.ts` — паттерн in-process mutex + атомарная запись `.tmp + rename` для `signatures-learned.json`.
- `src/logger.ts` — `log.info`/`log.error`/`log.warn` с `[ISO] [level]`. Структурный логгер для всех битум-операций.
- `src/__tests__/` — vitest pattern (2450 тестов зелёные), unit-тесты на mock OpenAI + fixtures из `docs/examples/`.

### Reference data

- `data/refineries.json` v2 — уже содержит поле `company` для 25 канонических НПЗ. Расширить под спеку REFINERY-01: добавить «РН-Битум», «АНПЗ ВНК», «РНПК», «АНХК», «Газпромнефть-Битумные материалы», «Газпром нефтехим Салават», и др. (полный список в REQ-REFINERY-01).
- `data/uploads/2026-W19/` — пример рабочей недели с 3 xlsx (birzha_prices.xlsx + birzha_volumes.xlsx + fca.xlsx). Smoke-тест: после migration команда `/bitum_preview` должна давать отчёт по этим файлам.
- `docs/examples/` — оригиналы 4 xlsx от Заказчика + `_rev.xlsx` версии после ручной нормализации по algoritm.md §1-5. **Использовать в unit-fixture'ах** для парсеров.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/upload/refineries.ts`** — `normalizeRefinery` + `getCompany` уже работают, только расширить `data/refineries.json` словарь.
- **`src/upload/storage.ts`** — `isoWeekFolder`, `saveUpload`, `findLatestWeekWithUploads`, `writeLastRun` — переиспользуются 1:1, расширяется только `WeekStatus` под 5 типов.
- **`src/upload/analyzer.ts`** — `deltasFor`, `groupDeltasByCompany`, `volumeTotals` — переиспользуются, расширяется выделение Прочие+Татнефть и cross-check.
- **`src/upload/parser.ts`** — `cellToDate` (включая Excel serial), `cellToNumber` (включая formula `{ result }`), `cellToString` (включая richText), `loadWorkbook` — переиспользуются всеми 5 парсерами.
- **`src/deliver.ts`** — `chunkHtml` для нарезки HTML-отчёта по 4000 chars с префиксами `(i/N)`.
- **`src/bot.ts`** — `sendHtml`, `tgFetch`, callback_query handler (для `/remove_channel` inline-keyboard) — паттерны для битум-команд и classifier learning UX.
- **`src/channels-store.ts`** — паттерн in-process mutex + атомарная запись для `signatures-learned.json`.

### Established Patterns

- **Pure-функции + dict-аргументом, без module-level singleton'ов** — обязательно для всех новых функций в `src/bitum/*` (паттерн `normalizeRefinery(raw, dict)`, `analyze(prices, fca, volumes, dict)`).
- **Lazy client creation для DeepSeek** — паттерн из [llm.ts:142-153](../../../src/upload/llm.ts#L142-L153) и [summarize.ts](../../../src/summarize.ts) с `temperature: 0`, `maxRetries: 1`, env DEEPSEEK_*.
- **Атомарная запись `.tmp + rename`** — паттерн `saveUpload` ([storage.ts:52-63](../../../src/upload/storage.ts#L52-L63)) и `writeLastRun` ([storage.ts:149-156](../../../src/upload/storage.ts#L149-L156)) для всех новых файлов (xlsx, signatures-learned.json, last-run.json).
- **Zod-валидация на output парсера** — нет существующего паттерна в `src/upload/`, но есть в [src/schema.ts](../../../src/schema.ts) (digest validation). Перенести подход на parser output schemas.
- **HTML-output с `chunkHtml` и префиксом `(i/N)`** — паттерн `renderMarkdown` ([renderer.ts:160-169](../../../src/upload/renderer.ts#L160-L169)), адаптируется под HTML.
- **callback_query handler с pending state** — паттерн `/remove_channel` (см. [bot.ts](../../../src/bot.ts), grep `callback_query`) — для `/bitum_report` подтверждения и classifier learning UX.

### Integration Points

- **`src/run.ts`** (daemon tick) — bitum-pipeline НЕ запускается из daemon (битум-flow только по пользовательской команде). Интеграция нулевая, daemon продолжает 20:00 MSK прогон без изменений.
- **`src/bot.ts:handleDocument`** — единственная точка входа xlsx upload. После Phase 4: `handleDocument` дёргает `classifyFile` (из `src/bitum/classifier.ts`) вместо `detectUploadType`; на `confidence < 1` рисует inline-keyboard вместо сохранения; на `confidence == 1` сохраняет + парсит + строит TG-05 response.
- **`src/bot.ts:handleSummarizeCommand`** — переименовать в `handleBitumPreviewCommand`, `/summarize` оставить как alias с deprecation msg (MIGRATE-02).
- **`src/bot.ts:setMyCommands`** — расширить с 7 до 9 команд: добавить `/bitum_status`, `/bitum_preview`, `/bitum_report`, `/bitum_reset`, оставить старые `/summarize`/`/upload_status` как deprecated алиасы. Возможно стоит убрать deprecated из `setMyCommands` чтобы они не висели в Telegram-меню (только handler в `handleCommand`).
- **`src/bot.ts:handleStart`/`handleHelp`** — обновить под битум-flow (см. quick-260519-na3 ReplyKeyboard 2×2).

</code_context>

<specifics>
## Specific Ideas

- **Эталонный формат отчёта** — Заказчик предоставил полный пример в `docs/bitum/algoritm.md` §6 (период 30 апреля – 8 мая 2026 г.). Reporter ДОЛЖЕН воспроизводить эту структуру 1:1 с правильным порядком блоков: top summary → блок «средняя цена БНД» → «Объёмы биржевых торгов» → «Роснефть» → «Газпромнефть» → «ЛУКОЙЛ» → «Прочие и независимые».
- **Сортировка холдингов** — фиксированный порядок Роснефть → Газпромнефть → ЛУКОЙЛ → Прочие (не по Σ|Δ| desc как делает существующий `analyzer.byCompany`). Это разрыв с текущим поведением; flag это в plan-phase.
- **Татнефть выделяется внутри «Прочие»** — algoritm.md §6 показывает: «Цены на НПЗ Таиф-НК остались на уровне 30 апреля 30 000 ₽» — отдельной строкой в блоке Прочие.
- **Цвета/эмодзи в HTML** — не требуются спекой. Без emoji в самом отчёте; только в служебных сообщениях бота (✅/❌ для чек-листа, ⚠️ для warning, 📤/❌ для inline-keyboard).
- **Trace footer пример из спеки нет** — Заказчик не упоминал явно «откуда числа». Решение D-09 (компактный `<code>` блок по файлу) — наша инициатива для расширенной верификации, не блокирует UX.
- **Партиция `partial render` в Заказчик не описывал** — Заказчик предполагает, что присылаются все 5 файлов. Наш partial-режим (D-10) — defensive UX для случаев когда оператор забыл или прислал не всё. В принципе чек-лист `/bitum_status` отвечает на этот вопрос «что не хватает».

</specifics>

<deferred>
## Deferred Ideas

### Перенесены в Future (REQUIREMENTS.md §Future)

- **BITUM-OCR-01** — распознавание `Снимок экрана.jpg` (средняя цена БНД из терминала). В Phase 4 этот файл игнорируется; средняя цена берётся из `parseBitumPriceNew` snapshot.
- **BITUM-TG-06** — inline-keyboard выбор недели (отчёт за прошлую неделю).
- **BITUM-TG-07** — `/bitum_undo` (отмена последней публикации).
- **BITUM-AUTOSEND-01** — автопостинг `/bitum_report` по cron в понедельник 09:00 MSK.
- **BITUM-REPORT-09** — RSS cross-check (RUPEC).
- **BITUM-PARSE-07** — multi-sheet `all_prices.xlsx` (парсить «исходник» + «Лист1» + «свод», не только одну).

### Не обсуждались в Phase 4 (но могут всплыть в planning)

- **Cross-check threshold env var** — REPORT-08 указывает «> 1%», planner решит вынести в env или захардкодить.
- **`signatures-learned.json` review workflow** — нет UX для оператора посмотреть/удалить learned-сигнатуры. Defer до появления первых ложно-выученных.
- **Production rollout strategy для миграции** — REPORT.md планирует deprecation `/summarize` и `/upload_status` к v5.x release; точная дата релиза не определена. Алиасы живут до явного решения «убираем».
- **Snapshot изображения отчёта (PNG via quickchart)** — quick-260519-ojk/swc был выпилен (chart.ts остался на полке). В Phase 4 НЕ возвращаем графики, отчёт только текстовый HTML.

### Out of Scope (полностью)

См. полный список в REQUIREMENTS.md §Out of Scope: bot framework (Telegraf/grammY), web UI, БД, multi-customer, OCR через Tesseract, LLM для извлечения чисел из xlsx, поддержка макросов/VBA, версионирование отчётов.

</deferred>

---

*Phase: 04-bitum-weekly-report*
*Context gathered: 2026-05-21*
