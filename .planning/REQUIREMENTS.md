# Requirements: tg-parser-demo

**Defined:** 2026-05-21
**Milestone:** v5.0 Битумный недельный отчёт
**Core Value:** В 20:00 MSK без вмешательства оператора получать в закрытом канале Заказчика структурированный дайджест нефтегаза за последние 24 часа, ранжированный по 5 направлениям и помеченный упоминаниями Роснефть/Лукойл/Газпром, в котором каждая цитата дословно присутствует в исходном посте — без галлюцинаций LLM, без повторов из вчерашних сводок, с полным архивом прогонов на ФС.

**Milestone Goal:** Заказчик присылает 3–5 xlsx-файлов в личку боту в произвольном порядке с произвольными именами; бот опознаёт каждый файл по содержимому (5 типов + unknown с learning-loop), копит «недельный пакет», по команде `/bitum_preview` / `/bitum_report` собирает аналитическую сводку по структуре из [docs/bitum/algoritm.md](../docs/bitum/algoritm.md) и публикует ответом в DM, либо после явного подтверждения — в `TG_CHANNEL_ID` (канал Заказчика).

## v5.0 Requirements

Requirements for milestone v5.0 «Битумный недельный отчёт». Каждый маппится на phase в `ROADMAP.md`. Базис: `src/upload/{detect,parser,refineries,storage,analyzer,renderer,llm}.ts` (v4.0 quick-задачи 260519-l11/lxu/nxc/tbo) расширяется до полноценного `src/bitum/*`.

### Классификация и приём файлов (CLS)

- [x] **BITUM-CLS-01**: Классификатор `classifyFile(buffer): { type, confidence, meta }` возвращает один из шести типов: `birzha_prices` | `birzha_volumes` | `fca_sellers` | `all_prices` | `bitum_price_new` | `unknown`. `confidence ∈ [0, 1]`, `meta` содержит обнаруженный sheet name + A1-маркер.
- [x] **BITUM-CLS-02**: Сигнатуры хранятся в `src/bitum/signatures.ts` как TypeScript-таблица (не JSON, не БД); каждая сигнатура содержит ожидаемые тексты A1/A3/B3 + (опционально) имена листов. A1-fast-path существующего `detectUploadType` — первая сигнатура.
- [x] **BITUM-CLS-03**: Если `confidence < 1` или `type = unknown` — бот НЕ сохраняет файл, шлёт inline-keyboard «birzha_prices / birzha_volumes / fca_sellers / all_prices / bitum_price_new / не битум»; ответ оператора дописывает новую сигнатуру в `data/bitum/signatures-learned.json` (append-only, атомарная запись `.tmp + rename`).
- [x] **BITUM-CLS-04**: Доверие имени файла = 0. Классификация только по содержимому (`buffer`, sheets, A1/A3/B3-маркеры). Имена файлов в логах допустимы, но в `classifyFile` не передаются.

### Парсеры (PARSE)

- [x] **BITUM-PARSE-01**: `parseBirzhaPrices(buffer): { rows: ParsedRow[], errors }` — нормализует шапку (`replace('БНД-', '')`), умножает значения цен на 1000 (тыс.→руб/тонн), возвращает long-table `[{ date, refineryCanonical, refineryRaw, priceRub }]`.
- [x] **BITUM-PARSE-02**: `parseBirzhaVolumes(buffer)` — нормализует шапку (`replace('Объем, тыс. тонн: ', '')`), умножает объёмы на 1000 (тыс.т→т), возвращает long-table `[{ date, refineryCanonical, refineryRaw, volumeT }]`.
- [x] **BITUM-PARSE-03**: `parseFcaSellers(buffer)` — читает long-format с колонками `Дата | Регион | Пункт отгрузки | БНД-*`, возвращает long-table FCA `[{ date, refineryCanonical, region, pointOfShipment, priceRub, source: "fca" }]`.
- [x] **BITUM-PARSE-04**: `parseAllPrices(buffer)` — берёт вкладку «исходник» (если есть), читает колонки `Пункт отгрузки | Наименование компании | Регион | Тип | Источник | Доставка | Топливо | Цена | Дата`; возвращает обогащённую long-table с готовым маппингом «Пункт отгрузки → Компания».
- [x] **BITUM-PARSE-05**: `parseBitumPriceNew(buffer)` — читает snapshot на дату с колонками `БНД - Цена недели | БНД - Изменение | ПБВ - Цена недели | ПБВ - Изменение`; возвращает структуру `{ date, bnd: { price, deltaAbs, deltaPct }, pbv: { price, deltaAbs, deltaPct } }` для блока верификации в отчёте.
- [x] **BITUM-PARSE-06**: Все парсеры идемпотентны (один и тот же buffer → один и тот же результат), Zod-валидация выходной схемы; невалидная строка → `errors.push({ rowNum, reason })`, парсер НЕ падает, продолжает обработку остальных строк.

### Холдинг-маппинг (REFINERY)

- [x] **BITUM-REFINERY-01**: `data/refineries.json` расширен полем `company` для всех canonical-НПЗ. Холдинги по спеку:
  - **Роснефть** ⇐ ООО «РН-Битум», ПАО «НК Роснефть», АО «АНПЗ ВНК», АО «АНХК», АО «РНПК», Саратовский НПЗ, Сызранский НПЗ, Ангарская НХК, Рязанская НПК, Ярославнефтеоргсинтез, Ачинский НПЗ ВНК, Ново-Уфимский НПЗ, Уфимская группа НПЗ
  - **Газпромнефть** ⇐ ООО «Газпромнефть-Битумные материалы», АО «ГАЗПРОМНЕФТЬ-МНПЗ», АО «ГАЗПРОМНЕФТЬ-ОНПЗ» (Московский НПЗ, Омский НПЗ)
  - **ЛУКОЙЛ** ⇐ Волгограднефтепереработка, Нижегороднефтеоргсинтез
  - **Татнефть** ⇐ Таиф-НК
  - **независимые** ⇐ всё остальное (МПК КРЗ, Сила Сибири, Профнефтересурс, АБЗ Хохольский, Арсенал Юг, Курский БТ, Орскнефтеоргсинтез, Мордовбитум, Новошахтинский НПЗ, Сальский битумный терминал, БТ СТРОЙСЕРВИС, и др.)
- [x] **BITUM-REFINERY-02**: `getCompany(canonical): "Роснефть" | "Газпромнефть" | "ЛУКОЙЛ" | "Татнефть" | "независимые"` — детерминированный lookup по словарю; неизвестный canonical → `"независимые"` (fallback).

### Сборка отчёта (REPORT)

Структура отчёта = [docs/bitum/algoritm.md](../docs/bitum/algoritm.md) §6 (формат отчёта).

- [x] **BITUM-REPORT-01**: Заголовок отчёта содержит период (`Период: DD MMM – DD MMM YYYY`), краткий summary недели (1–2 предложения, экстрактивный) и блок «на дату [last] средняя цена БНД составила [price] ₽/т ([deltaAbs] ₽/т, [deltaPct]% за неделю)» из `parseBitumPriceNew` snapshot.
- [x] **BITUM-REPORT-02**: Блок «Объёмы биржевых торгов» (вверху отчёта) — Σ объёма за период (тыс.т) + список по убыванию `topN` НПЗ с volume ≥ порога (по умолчанию topN=7); отдельно выделяется группа Роснефть и блок независимых из `parseBirzhaVolumes`.
- [x] **BITUM-REPORT-03**: Блок «Роснефть (Σ|Δ| = N ₽)» — сумма абсолютных дельт по группе; буллеты по каждому НПЗ с детализацией биржа/FCA («Саратовский НПЗ (FCA) вырос на +1 000 ₽ (до 28 000 ₽), а на бирже снизился на −2 ₽»). Источник цен указывается явно (биржа | прайс/FCA).
- [x] **BITUM-REPORT-04**: Блок «Газпромнефть» (после Роснефти) с той же структурой — Σ|Δ| + детализация Московский НПЗ / Омский НПЗ.
- [x] **BITUM-REPORT-05**: Блок «ЛУКОЙЛ» (после Газпромнефти) — Σ|Δ| + детализация; если нет движений → одно предложение «Цены остались на уровне [предыдущая дата]: [уровни]».
- [x] **BITUM-REPORT-06**: Блок «Прочие и независимые (Σ|Δ| = N ₽)» — все НПЗ вне трёх групп (Роснефть/Газпромнефть/ЛУКОЙЛ + Татнефть выделяется отдельной строкой при наличии движений); детализация изменившихся, перечень неизменившихся.
- [x] **BITUM-REPORT-07**: Числа в отчёте экстрактивны — каждое значение (цена, объём, дельта) должно соответствовать ячейке исходного xlsx (для верификации reporter возвращает trace с file/sheet/cell для каждого числа в отчёте); LLM используется только для нарратива (1–2 предложения summary), числа подставляются программно.
- [x] **BITUM-REPORT-08**: Cross-check: цены из `bitum_price_new` и `all_prices` (`bitum_price` колонка) сверяются с `fca_sellers` (если те же НПЗ присутствуют в обоих файлах); при расхождении > 1% — warning в отчёте с указанием источника-победителя.

### Telegram-команды (TG)

- [x] **BITUM-TG-01**: `/bitum_status` — выводит текущее состояние недели (ISO-week) + чек-лист 5 типов (✅/❌ по каждому) + lastRunAt; заменяет `/upload_status`.
- [x] **BITUM-TG-02**: `/bitum_preview` — собирает отчёт по структуре algoritm.md и отправляет ответом в DM оператора/Заказчика; НЕ публикует в канал. Заменяет `/summarize`.
- [x] **BITUM-TG-03**: `/bitum_report` — собирает отчёт, показывает preview в DM + inline-keyboard «📤 Опубликовать в `TG_CHANNEL_ID` / ❌ Отмена»; публикует в канал ТОЛЬКО после нажатия «Опубликовать». При «Отмене» — отчёт остаётся в DM, ничего не публикуется.
- [x] **BITUM-TG-04**: `/bitum_reset` — обнуляет текущую неделю (удаляет `data/uploads/<week>/`) с обязательным inline-подтверждением «✅ Сбросить / ❌ Отмена»; ответ при успехе — список удалённых файлов.
- [x] **BITUM-TG-05**: При любой загрузке xlsx (`handleDocument`) ответ владельцу содержит: что распознал (type + confidence), метаданные (период / число строк / число заводов / errors count), чек-лист недели (как `/bitum_status`).

### Миграция (MIGRATE)

- [x] **BITUM-MIGRATE-01**: `src/upload/*` рефакторится в `src/bitum/*`: `detect.ts` → `classifier.ts` (с поддержкой 6 типов), `parser.ts` сплитится на 5 per-type парсеров, `analyzer.ts` дорастает до `byCompany` группировки и Σ|Δ| метрик, `renderer.ts` пишет полную структуру algoritm.md (не Markdown-сводку). Импорты в `src/bot.ts` обновлены.
- [x] **BITUM-MIGRATE-02**: Старые алиасы команд: `/summarize` → `/bitum_preview`, `/upload_status` → `/bitum_status`; алиас отвечает одним deprecation-сообщением «Команда переименована в /bitum_preview. В v6.0 будет удалена.» + делает то же действие. После v5.x release `/summarize` и `/upload_status` удаляются.
- [x] **BITUM-MIGRATE-03**: `data/uploads/<week>/` остаётся, добавляются ровно файлы новых типов: `all_prices.xlsx`, `bitum_price_new.xlsx`; `data/bitum/signatures-learned.json` создаётся при первом learning-event.

## Future Requirements

Deferred to future release. Tracked but not in current milestone.

### OCR / Vision

- **BITUM-OCR-01**: Парсинг jpg/png со снимком экрана (например, средняя цена БНД 28336 ₽/т из терминала). Реализация через DeepSeek-VL или OpenAI vision API. Отложено до стабильного формата скриншотов.

### UX / Workflow

- **BITUM-TG-06**: Inline-keyboard выбор недели (если оператор хочет посмотреть отчёт за прошлую неделю вместо текущей).
- **BITUM-TG-07**: Команда `/bitum_undo` — отменить последнюю публикацию в канале Заказчика (через editMessageText или sendMessage с «отмена предыдущей сводки»).
- **BITUM-AUTOSEND-01**: Автоматическая публикация `/bitum_report` по cron (например, понедельник 09:00 MSK) с предварительным алертом оператору; cancel-window 30 мин для отмены.

### Data / Verification

- **BITUM-REPORT-09**: Кросс-проверка цен с RSS-фидами (RUPEC и др.); расхождения подсвечиваются в отчёте.
- **BITUM-PARSE-07**: Поддержка xlsx с несколькими листами (например, `all_prices.xlsx` с вкладками «исходник» + «Лист1» + «свод» — парсить все, не только «исходник»).

## Out of Scope

Explicitly excluded for v5.0.

| Feature | Reason |
|---------|--------|
| Bot framework (Telegraf/grammY) для битум-команд | 4 битум-команды + 3 канал-команды = 7 handler'ов общего размера ~200 строк; raw fetch polling из v4.0 справляется |
| Веб-UI для битум-сводки | Telegram-бот покрывает UX оператора и Заказчика; преимуществ от веба нет |
| База данных для битум-данных | Файловое хранилище ISO-week справляется; ≤5 xlsx в неделю × 50 недель ≈ 250 файлов |
| Headless browser / OCR через Tesseract | Битум-отчёты приходят только как xlsx в v5.0; OCR — в Future |
| LLM для извлечения чисел из xlsx | Числа экстрактивны из ячеек; LLM только для нарратива (1–2 предложения summary) |
| Поддержка xlsx с макросами / VBA | Спека Заказчика — без макросов; ExcelJS не поддерживает в любом случае |
| Multi-customer | Один Заказчик, один `TG_CHANNEL_ID`; multi-tenancy не нужен (см. v3.0 Out of Scope) |
| Версионирование отчётов / diff между прогонами | Отчёт всегда «свежий снимок»; история ведётся через git-историю самих xlsx-файлов в `data/uploads/` |
| Хранение Excel-формул в long-table | Парсеры читают вычисленные значения (`cell.value`); формулы не сохраняются |
| Backward-compat `data/uploads/` для битума | Переиспользуем существующую ISO-week-структуру; ничего не мигрируем |

## Traceability

Which phases cover which requirements. Updated during roadmap creation (Phase TBD).

| Requirement | Phase | Status |
|-------------|-------|--------|
| BITUM-CLS-01 | TBD | Complete |
| BITUM-CLS-02 | TBD | Complete |
| BITUM-CLS-03 | TBD | Complete |
| BITUM-CLS-04 | TBD | Complete |
| BITUM-PARSE-01 | TBD | Complete |
| BITUM-PARSE-02 | TBD | Complete |
| BITUM-PARSE-03 | TBD | Complete |
| BITUM-PARSE-04 | TBD | Complete |
| BITUM-PARSE-05 | TBD | Complete |
| BITUM-PARSE-06 | TBD | Complete |
| BITUM-REFINERY-01 | TBD | Complete |
| BITUM-REFINERY-02 | TBD | Complete |
| BITUM-REPORT-01 | TBD | Complete |
| BITUM-REPORT-02 | TBD | Complete |
| BITUM-REPORT-03 | TBD | Complete |
| BITUM-REPORT-04 | TBD | Complete |
| BITUM-REPORT-05 | TBD | Complete |
| BITUM-REPORT-06 | TBD | Complete |
| BITUM-REPORT-07 | TBD | Complete |
| BITUM-REPORT-08 | TBD | Complete |
| BITUM-TG-01 | TBD | Complete |
| BITUM-TG-02 | TBD | Complete |
| BITUM-TG-03 | TBD | Complete |
| BITUM-TG-04 | TBD | Complete |
| BITUM-TG-05 | TBD | Complete |
| BITUM-MIGRATE-01 | TBD | Complete |
| BITUM-MIGRATE-02 | TBD | Complete |
| BITUM-MIGRATE-03 | TBD | Complete |

**Coverage:**
- v5.0 requirements: 28 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 28 (will be 0 after `/gsd-new-milestone` roadmap step)

---
*Requirements defined: 2026-05-21*
*Milestone v5.0 — Битумный недельный отчёт*
*Phase numbering: continues from v4.0 (last phase = 3) → v5.0 starts at Phase 4*
