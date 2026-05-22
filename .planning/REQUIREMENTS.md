# Requirements: tg-parser-demo

**Defined:** 2026-05-21
**Revised:** 2026-05-22 (v5.1 — simplified bitum, full rewrite)
**Milestone:** v5.1 Битумный недельный отчёт (упрощённый pipeline)
**Core Value:** В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.

**Milestone v5.1 Goal:** Заказчик присылает 4 xlsx-файла (`birzha_volumes`, `birzha_prices`, `fca_sellers`, `bitum_price_new`) в DM боту в произвольном порядке; на каждую загрузку бот спрашивает inline-keyboard'ом из 4 кнопок «что это» (always-ask, без автоклассификации); накапливает недельный пакет в `data/uploads/<ISO-week>/`; команда `/bitum_add label=value` копит ручные числа в `manual-numbers.json`; по `/bitum_report` бот строит programmatic-дайджест и публикует в `TG_CHANNEL_ID` после подтверждения.

## v5.1 Requirements

> **Cancelled in v5.1 rewrite (D-02/D-05/D-09/D-11):** BITUM-CLS-01..04 (классификатор + learning), BITUM-PARSE-04 (all_prices), BITUM-REPORT-02..05 (группировка по холдингам), BITUM-TG-02 (/bitum_preview). См. `.planning/phases/04-bitum-weekly-report/04-CONTEXT.md` для обоснования.

### Парсеры (PARSE)

- [ ] **BITUM-PARSE-01**: `parseBirzhaPrices(buffer, dict): Promise<ParserResult<ParsedPriceRow>>` — читает row 3 (refinery names, idempotent strip "БНД-"), row 4..N (col A — дата, B..T — цены тыс.руб/т), `priceRub = cellValue * 1000`. Zod-валидация, не падает на битых ячейках.
- [ ] **BITUM-PARSE-02**: `parseBirzhaVolumes(buffer, dict): Promise<ParserResult<ParsedVolumeRow>>` — row 3 refinery names, row 4..N (col A — дата, B..T — объёмы тыс.т), `volumeT = cellValue * 1000`. Zod-валидация.
- [ ] **BITUM-PARSE-03**: `parseFcaSellers(buffer, dict): Promise<ParserResult<ParsedFcaRow>>` — A4..A26 (refinery + pointOfShipment), B (Region), C (price prev), D (price curr), E (Δ formula). Date = D3 (end-of-period). deltaWeek читается из E, fallback (D-C).
- [ ] **BITUM-PARSE-05**: `parseBitumPriceNew(buffer, dict): Promise<ParserResult<ParsedBitumPriceNewRow>>` — A "Дата", B "Пункт отгрузки", C "Компания", F "БНД - Цена недели" (string!), G "БНД - Изменение" ("не изм." / "▲ (+N)" / "▼ (-N)"). Row = `{date, refineryCanonical, refineryRaw, company, priceRub, deltaWeek}`. Источник истины для cross-check (REPORT-08).
- [ ] **BITUM-PARSE-06**: Все 4 парсера идемпотентны, Zod-валидация per-row, невалидная строка → `errors.push({rowNum, reason})`, парсер НЕ падает; pre-flight `worksheet.rowCount <= BITUM_MAX_ROWS` (env, default 2000) — T-04-02 DoS-cap.

### Холдинг-маппинг (REFINERY)

- [ ] **BITUM-REFINERY-01**: `data/refineries.json` содержит все НПЗ из 4 эталонных xlsx, с полем `company` (Роснефть / Газпромнефть / ЛУКОЙЛ / Татнефть / независимые). 29 entries на момент v5.1 первой итерации; coverage-test deferred (тесты отложены).
- [ ] **BITUM-REFINERY-02**: `normalizeRefinery(raw, dict)`: pure-функция, dict-аргументом, case-insensitive lookup по canonical+aliases; неизвестный → `{ canonical: trimmed_raw, matched: false }` (НЕ throw). `getCompany(canonical, dict)`: unknown → "независимые" (fallback).

### Сборка отчёта (REPORT)

- [ ] **BITUM-REPORT-01**: Period header `<b>Битумный отчёт DD.MM.YY – DD.MM.YY</b>` + manual numbers block (если есть) сразу после периода. Period вычисляется как min/max date across всех загруженных файлов.
- [ ] **BITUM-REPORT-06**: Блок «<b>Движения цен</b>» — плоский список изменений (D-11 — БЕЗ группировки по холдингам), sorted by `|deltaAbs|` desc, tiebreak refineryCanonical ASC. Каждая строка: `• <b>{refinery}</b> ({source}): {priceFrom} → {priceTo} ₽ (Δ {sign}{deltaAbs} ₽, {sign}{deltaPct}%)`. Источник (биржа / FCA / Битум прайс) указывается явно.
- [ ] **BITUM-REPORT-07**: Числа в отчёте экстрактивны — каждое значение соответствует ячейке исходного xlsx; reporter возвращает `trace: ReportTrace[]` с fileType/sheet/cellRange/numbersCount per file. Cell-trace footer в конце отчёта (формат: per-file compact, склейка `; `).
- [ ] **BITUM-REPORT-08**: Cross-check — для каждого refineryCanonical из `bitum_price_new`, найти same refinery в `birzha_prices` (последняя дата периода) и `fca_sellers` (последняя priceRub); рассчитать `|delta| / reference * 100`; если > `BITUM_CROSS_CHECK_THRESHOLD` (env, default 1.0) — push CrossCheckIssue в отчёт. Cross-check direction: `bitum_price_new` (источник истины) vs остальные.

### Telegram-команды (TG)

- [ ] **BITUM-TG-01**: `/bitum_status` — HTML-чек-лист текущей ISO-недели: 4 типа ✅/❌ + manualNumbersCount + lastUpdatedAt.
- [ ] **BITUM-TG-03**: `/bitum_report` — собирает programmatic-дайджест, шлёт превью в DM через `sendHtml` + `chunkHtml`, prepends inline-keyboard `📤 Опубликовать / ❌ Отмена`. Публикация в `TG_CHANNEL_ID` только после нажатия «Опубликовать». При «Отмене» — preview остаётся в DM, ничего не публикуется. Pending preview истекает через 15 мин (REPORT_TTL_MS).
- [ ] **BITUM-TG-04**: `/bitum_reset` — обнуляет текущую неделю (xlsx + manual-numbers.json) с обязательным inline-подтверждением `✅ Сбросить / ❌ Отмена`; ответ при успехе — число удалённых файлов.
- [ ] **BITUM-TG-05**: При любой загрузке xlsx (`handleDocument`) бот всегда отвечает inline-keyboard с 4 кнопками типов («Биржа суточная по NPZ» / «Биржа цены NPZ» / «Битум таблица продавцы» / «Битум прайс») + кнопкой «❌ Не битум / Отмена». После тапа: сохраняет файл как `data/uploads/<ISO-week>/<type>.xlsx` (atomic), парсит, отвечает чек-листом недели + parsed metadata (период, число строк, errors). НИКАКОЙ автоклассификации.
- [ ] **BITUM-TG-08**: `/bitum_add <label>=<value>` — добавляет одну пару в `manual-numbers.json` текущей ISO-недели; sanitize control chars + length cap 200 char; atomic write + in-process mutex per-week; pure pass-through (без семантической валидации); появляется в дайджесте отдельным блоком после period header.

### Миграция (MIGRATE)

- [ ] **BITUM-MIGRATE-01**: `src/bitum/*` написан с нуля под упрощённый scope (4 типа, no classifier, no LLM, плоский отчёт). Структура: `types.ts`, `storage.ts`, `manual-numbers.ts`, `refineries.ts`, `parsers/{birzha-volumes, birzha-prices, fca-sellers, bitum-price-new, shared, index}.ts`, `analyzer.ts`, `reporter.ts`, `index.ts`. Старые `src/upload/*` и предыдущая итерация `src/bitum/*` (с classifier/llm) удалены полностью. Никаких legacy-alias'ов команд.
- [ ] **BITUM-MIGRATE-02**: Все алиасы старых команд (`/summarize`, `/upload_status`, `/bitum_preview`) удалены из `src/bot.ts` без deprecation-периода. В меню Telegram (`setMyCommands`) присутствуют только новые 4 битум-команды + 3 канал-команды + start/help.
- [ ] **BITUM-MIGRATE-03**: `data/uploads/<week>/` хранит ровно 4 xlsx по фиксированным именам (`birzha_volumes.xlsx`, `birzha_prices.xlsx`, `fca_sellers.xlsx`, `bitum_price_new.xlsx`) + `manual-numbers.json` (массив `{label, value, addedAt}` для команды `/bitum_add`). Каталог `data/bitum/signatures-learned.json` удалён вместе с classifier-фичей.

## Future Requirements

Deferred to future release. Tracked but not in current milestone.

### OCR / Vision

- **BITUM-OCR-01**: Парсинг jpg/png со снимком экрана (например, средняя цена БНД 28336 ₽/т из терминала). Реализация через DeepSeek-VL или OpenAI vision API. Отложено до стабильного формата скриншотов.

### UX / Workflow

- **BITUM-TG-06**: Inline-keyboard выбор недели (если оператор хочет посмотреть отчёт за прошлую неделю вместо текущей).
- **BITUM-TG-07**: Команда `/bitum_undo` — отменить последнюю публикацию в канале Заказчика.
- **BITUM-AUTOSEND-01**: Автоматическая публикация `/bitum_report` по cron с предварительным алертом оператору.

### Data / Verification

- **BITUM-REPORT-09**: Кросс-проверка цен с RSS-фидами (RUPEC и др.); расхождения подсвечиваются в отчёте.
- **BITUM-PARSE-07**: Поддержка xlsx с несколькими листами (multi-sheet).

## Cancelled in v5.1 (was v5.0)

| ID | Reason |
|----|--------|
| BITUM-CLS-01..04 | Always-ask UX (D-05) заменяет автоклассификацию + learning-loop полностью |
| BITUM-PARSE-04 | Тип `all_prices` целиком удалён (D-02); файл-пример удалён, парсер удалён |
| BITUM-REPORT-02..05 | Группировка по холдингам Роснефть/ГПН/ЛУКОЙЛ отменена (D-11) — отчёт плоский |
| BITUM-TG-02 | `/bitum_preview` отменён (D-09) — функция дублировала бы `/bitum_report` preview-mode |

## Out of Scope

Explicitly excluded for v5.1 (см. также `.planning/phases/04-bitum-weekly-report/04-CONTEXT.md` Out of Scope).

| Feature | Reason |
|---------|--------|
| Автоклассификация xlsx по содержимому (classifier + signatures + learning) | Always-ask UX — Заказчик готов тапать кнопку каждый раз |
| LLM в bitum-flow (DeepSeek narrative) | Programmatic-дайджест — числа экстрактивные, тексты шаблонные |
| Группировка отчёта по холдингам | Плоский список движений с sort by |Δ| desc — D-11 |
| Bot framework (Telegraf/grammY) | 4 битум-команды + 3 канал-команды = 7 handler'ов, raw fetch polling справляется |
| Веб-UI для битум-сводки | Telegram-бот покрывает UX |
| База данных | Файловое хранилище ISO-week справляется (4 xlsx × 50 недель) |
| OCR через Tesseract | OCR — в Future (BITUM-OCR-01) |
| Headless browser | Битум-отчёты приходят только как xlsx в v5.1 |
| Поддержка xlsx с макросами / VBA | Без макросов; ExcelJS не поддерживает |
| Multi-customer | Один Заказчик, один `TG_CHANNEL_ID` |
| Версионирование отчётов / diff | Отчёт всегда «свежий снимок» |
| Хранение Excel-формул в long-table | Парсеры читают вычисленные значения (`cell.value` / `cell.result`) |

## Traceability

Which phases cover which requirements. Updated 2026-05-22 after Phase 4 implementation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BITUM-PARSE-01 | 4 | Implementation complete, tests deferred |
| BITUM-PARSE-02 | 4 | Implementation complete, tests deferred |
| BITUM-PARSE-03 | 4 | Implementation complete, tests deferred |
| BITUM-PARSE-05 | 4 | Implementation complete, tests deferred |
| BITUM-PARSE-06 | 4 | Implementation complete, tests deferred |
| BITUM-REFINERY-01 | 4 | Implementation complete, tests deferred |
| BITUM-REFINERY-02 | 4 | Implementation complete, tests deferred |
| BITUM-REPORT-01 | 4 | Implementation complete, tests deferred |
| BITUM-REPORT-06 | 4 | Implementation complete, tests deferred |
| BITUM-REPORT-07 | 4 | Implementation complete, tests deferred |
| BITUM-REPORT-08 | 4 | Implementation complete, tests deferred |
| BITUM-TG-01 | 4 | Implementation complete, tests deferred |
| BITUM-TG-03 | 4 | Implementation complete, tests deferred |
| BITUM-TG-04 | 4 | Implementation complete, tests deferred |
| BITUM-TG-05 | 4 | Implementation complete, tests deferred |
| BITUM-TG-08 | 4 | Implementation complete, tests deferred |
| BITUM-MIGRATE-01 | 4 | Implementation complete, tests deferred |
| BITUM-MIGRATE-02 | 4 | Implementation complete, tests deferred |
| BITUM-MIGRATE-03 | 4 | Implementation complete, tests deferred |

**Coverage:**
- v5.1 requirements: 19 total (16 active BITUM-* + 3 MIGRATE; cancelled: 9 IDs из v5.0 — CLS-01..04, PARSE-04, REPORT-02..05, TG-02)
- Mapped to phases: 19 (all to Phase 4)
- Unmapped: 0
- Status: 19 «Implementation complete, tests deferred» (user override 2026-05-22 — следующая фаза добавит тесты)

---
*Requirements defined: 2026-05-21 (v5.0)*
*Requirements revised: 2026-05-22 (v5.1 — simplified bitum, full rewrite)*
*Phase numbering: v5.x continues from v4.0 (last phase = 3) → v5.x starts at Phase 4*
