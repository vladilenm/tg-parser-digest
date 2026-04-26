# Phase 1: Code — Context

**Gathered:** 2026-04-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Daemon (уже работает на cron `0 20 * * *` MSK под PM2 с v2.0) на следующем тике после деплоя
v3.0 отдаёт **структурированный** дайджест по 5 фиксированным направлениям
(бункер/масла/керосин/нефтехимия/битум) + блок «Упоминания компаний»
(Роснефть/Лукойл/Газпром, только орфаны вне 5 категорий) с deep-link `t.me/<channel>/<msgId>`
на каждый item. Кросс-прогонная дедупа через файловый SHA-256 hash-cache (rolling 14 дней).
ФС-архивы `data/raw/YYYY-MM-DD.json` и `data/output/YYYY-MM-DD.md`. Алерты в личку владельца
через отдельный Bot API на любую необработанную ошибку pipeline. RUNBOOK + CHANNELS
для оператора. Покрывает 14 REQ из v3.0 (STRUCT-01..03, RENDER-01..03, DEDUP-01..02,
ARCH-01..02, ALERT-01..02, DOC-04..05).

Не входит в Phase 1 (см. `REQUIREMENTS.md` § Out of Scope, переносы на v4.0+):
семантический dedupe, БД, веб-админка, верификация по официальным источникам,
автотесты, multi-tenancy, приватные каналы, абстракции `LLMProvider`/`Deliverer`.
ACCEPT-01..02 (7-day smoke + acceptance-пакет) — Phase 2, blocking checkpoint.

</domain>

<decisions>
## Implementation Decisions

### Render flavor (HTML, не Markdown buchstab)

- **D-01:** `parse_mode: HTML` сохраняется (статус-кво v2.0). Переиспользуем
  `escapeHtml()` (`src/summarize.ts:38`) и `chunkHtml()` (`src/deliver.ts:16`).
  Формулировку «Markdown-рендер» в REQUIREMENTS интерпретируем как
  «структурированный секционный рендер» (в противовес плоскому списку v1.0/v2.0).
  `data/output/YYYY-MM-DD.md` будет содержать HTML-разметку — ARCH-02 инвариант
  «байт-в-байт идентично отправленному» соблюдается.

- **D-02:** Заголовки секций — emoji + `<b>`, фиксированные:
  - `<b>🚢 Бункер</b>`
  - `<b>🛢 Масла</b>`
  - `<b>✈️ Керосин</b>`
  - `<b>⚗️ Нефтехимия</b>`
  - `<b>🛣 Битум</b>`
  - `<b>🏢 Упоминания компаний</b>`
  - Пустая секция: `<b>🚢 Бункер</b>\n<i>— нет упоминаний за сутки</i>`.

- **D-03:** Порядок секций — фиксированный, идентичный REQUIREMENTS/intent-v3.0.md:
  Бункер → Масла → Керосин → Нефтехимия → Битум → Упоминания компаний.
  Не сортируем по items count — оператору и Заказчику важно сравнивать сводки
  между днями по постоянной структуре.

- **D-04:** Блок «Упоминания компаний» — **только орфаны**.
  - Пост попадает в одну из 5 категорий ИЛИ в mentions, не в обе.
  - Если пост попал в категорию (например, «Битум») и упоминает Роснефть/Лукойл/Газпром,
    inline-маркер `<b>[РОСНЕФТЬ]</b>` (UPPERCASE, белый bold на фоне) добавляется
    префиксом перед `summary` в основной секции.
  - Блок «Упоминания компаний» содержит только посты, которые LLM отнёс ни к одной
    из 5 категорий, но содержат упоминание одной из 3 целевых компаний (т.е. посты,
    которые без mentions были бы отброшены по STRUCT-03).
  - Если орфанов нет — секция помечается `<i>— нет упоминаний за сутки</i>`.

- **D-05:** Формат буллета item — переиспользуем v2.0 (`src/summarize.ts:179`)
  без изменений, только с возможным префиксом-маркером:
  `• [{INLINE_MARKER }]?{summary} — <i>«{keyQuote}»</i> — <a href="{url}">@{channel}</a>`

### Plan-grouping (1 mega-плана YOLO)

- **D-06:** **1 PLAN.md** для Phase 1, покрывающий все 14 REQ.
  Разбиение на 6 категорий или 3 wave дало бы лишние plan-overhead коммиты
  внутри 2-day deadline без верифицируемой пользы (STRUCT без RENDER не виден,
  DEDUP без ARCH не проверяется).

- **D-07:** Wave-порядок ROADMAP сохраняется как **порядок task'ов внутри plan'а**:
  Wave 1 (STRUCT-01..03 + RENDER-01..03) → Wave 2 (DEDUP-01..02 + ARCH-01..02) →
  Wave 3 (ALERT-01..02 + DOC-04..05). Planner волен параллелить независимые
  task'и (например, DOC-04 и DOC-05 — два независимых markdown-файла; alert.ts —
  новый файл, не пересекается с pipeline).

- **D-08:** **Один финальный verify** в конце plan'а по всем 14 REQ. Промежуточный
  manual smoke после Wave 1 не делаем — чистый YOLO как v1.0/v2.0. Один локальный
  `npm start` после всех task'ов для validation, затем `npx tsc --noEmit` чистый
  (Success Criteria #6).

### Claude's Discretion

Эти решения не обсуждались, но имеют чёткие recommended defaults — planner и researcher
могут руководствоваться ими, корректировки welcome.

#### Lifecycle ФС-state на сбоях

- **D-09:** Порядок записи внутри `runPipeline()`:
  1. fetch всех каналов → собрать `allPosts[]`
  2. **Запись `data/raw/YYYY-MM-DD.json`** (атомарно `.tmp + rename`) — сразу после
     fetch, ДО dedup и LLM. Инвариант: «сырые данные за день сохранены, даже если
     остаток pipeline упал». Это даёт основу для post-mortem.
  3. Загрузка `data/hash-cache.json` (фильтрация записей старше 14 дней по timestamp)
  4. Dedup `allPosts` против hash-cache → `freshPosts[]`
  5. LLM-обработка `freshPosts` → DigestJson + Zod-валидация
  6. HTML-рендер
  7. `sendToChannel(html)` — доставка в Telegram
  8. **Только после успешной доставки**: запись `data/output/YYYY-MM-DD.md`
     (HTML-сводка идентична отправленной — ARCH-02) И запись `data/hash-cache.json`
     с новыми hashes.
  - Логика: hash-cache «съедает» посты только когда они реально доставлены —
    при сбое доставки на следующем тике LLM прогонит их заново. data/output
    появляется только если оператор и Заказчик действительно увидели сводку.

- **D-10:** Дата файлов — **MSK** (`Europe/Moscow`), не UTC. Cron-тик в 20:00 MSK,
  оператор ассоциирует «сводка за 26.04» с MSK-датой 26.04.

- **D-11:** Re-run за тот же день (если оператор вручную дёрнет `npm start` или
  PM2 рестарт случился ровно в 20:00) — **перезапись** `data/raw/*.json` и
  `data/output/*.md`. Инвариантного поведения «сводка за день одна» достаточно,
  retry — это retry, не новая сводка. Hash-cache rolling 14 дней предотвратит
  повторный показ постов.

#### Alert поведение

- **D-12:** Обёртка вокруг `runPipeline()` — в `src/run.ts` (внешняя точка входа,
  ловит весь tick), не внутри pipeline.ts. `tick()` делает try/catch async, на
  catch — `await sendAlert({stage, error.message, runId, stack})`.

- **D-13:** Alert send — **await** (не fire-and-forget). 60-секундное окно из ALERT-02
  гарантируется, даже если node-cron завершит process до отправки.

- **D-14:** Без throttling/dedup алертов в v3.0. Cron 1 раз в сутки → максимум 1 алерт
  в сутки. Спам не возможен. Throttle подключим, если 7-day smoke покажет шум
  (отложено в backlog для v3.1+).

- **D-15:** Alert-on-alert-fail — `console.error` без retry. Если сам alert-bot
  недоступен (network down, токен инвалид), писать в pm2 logs и сдаваться.
  Альтернативная цепочка наблюдаемости — `pm2 logs --err`, оператор её
  поднимает в RUNBOOK сценарии #5 (network down).

#### Технические детали

- **D-16:** Zod-схема живёт в `src/schema.ts` (новый файл) — отдельно от
  `summarize.ts`, чтобы prompt и validation эволюционировали независимо.
  Существующая ручная `validate()` в `src/summarize.ts:60-94` удаляется
  (заменяется Zod). Тип `DigestJson` в `src/types.ts` обновляется под новую
  структуру (5 категорий + mentions).

- **D-17:** Нормализация для DEDUP-01 живёт в новом `src/dedup.ts`
  (`normalize()`, `hashText()`, `loadHashCache()`, `saveHashCache()`).
  Архивирование — в новом `src/archive.ts` (`writeRaw()`, `writeOutput()`).
  Каждый module инкапсулирует ФС-операцию + атомарный `.tmp + rename`.

- **D-18:** RUNBOOK.md и CHANNELS.md — оперативная документация для оператора
  (владельца, не Заказчика). Структура каждого сценария RUNBOOK: **Симптом**
  → **Диагностика** → **Действие** → **Восстановление**. CHANNELS.md — checklist
  с командами (`vim channels.yaml`, `pm2 restart tg-parser`, шаги проверки
  user-аккаунта подписки).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone v3.0 spec и requirements
- `docs/intent-v3.0.md` — utter milestone-context, утверждён оператором 2026-04-26.
  Source-of-truth по всем REQ-ID и wave-структуре.
- `.planning/REQUIREMENTS.md` §«v3.0 Requirements» — 14 REQ Phase 1 с acceptance-формулировками
  (STRUCT-01..03, RENDER-01..03, DEDUP-01..02, ARCH-01..02, ALERT-01..02, DOC-04..05).
- `.planning/REQUIREMENTS.md` §«Out of Scope» — явные исключения для v3.0
  (semantic dedup, БД, веб-админка, multi-tenancy, абстракции, автотесты).
- `.planning/ROADMAP.md` § «Phase 1: Code» — Success Criteria 1-6, Wave-порядок планов,
  обоснование 2-фазовой структуры (не 4 wave-фаз).
- `.planning/PROJECT.md` § «Constraints» / «Key Decisions» — tech-stack pin
  (Node 20.6+, ESM, tsx, +zod = 5 runtime-deps), запрет на БД/Docker/тесты.

### v1.0 design-doc (частично актуально)
- `spec-app.md` §7-§9 — экстрактивный prompt и keyQuote-проверка (реализовано в v1.0,
  карьерится в v3.0 через Zod). §13 (Postgres+pgvector) **намеренно игнорируется** —
  отложено в v4.0+.

### v2.0 audit и known tech debt (carried into v3.0)
- `.planning/milestones/v2.0-MILESTONE-AUDIT.md` — статус v2.0 (code complete +
  HUMAN-UAT runtime gap, переходящий в v3.0 ACCEPT-01).
- `.planning/PROJECT.md` § «Known tech debt (carried)» — 12 v1.0 backlog items + 5 v2.0
  backlog. Из них в v3.0 не трогаем: Unicode NFC fix (IN-01), chunkHtml edge cases
  (новый Markdown-рендер v3.0 их не задевает), `console.warn/error` в `telegram.ts:134-152`
  (опционально подчистить если будем менять `telegram.ts` для STRUCT/RENDER).

### v1.0 ABOUT/история
- `docs/ABOUT.md` — high-level описание проекта на момент v1.0; обновим в DOC-05
  (или ACCEPT-02 в Phase 2) если нужно для acceptance-пакета.

### Существующий код (источник для adaptive planning)
- `src/types.ts` — типы `Post`, `DigestItem`, `DigestSection`, `DigestJson`, `RunSummary`.
  В v3.0 расширяются: `DigestJson` — фиксированные 5 категорий + блок mentions;
  `DigestItem` — добавить `mentions: ('rosneft'|'lukoil'|'gazprom')[]`;
  `RunSummary` — добавить `postsDropped: number`, `postsDeduped` теперь учитывает
  и in-memory, и hash-cache hits.
- `src/pipeline.ts:45` — `runPipeline()` остаётся точкой входа. In-memory dedup
  по `${username}:${messageId}` (line 61, 74-79) сохраняется как первая ступень.
  Insertion points: после fetch (write raw, line ~83), перед `summarize()` (dedup
  через hash-cache, line ~104), после `sendToChannel` (write output + write
  hash-cache, line ~106).
- `src/summarize.ts:10-32` — `SYSTEM_PROMPT` целиком переписывается под 5-категорийную
  структуру. `verifyExtractiveness()` (line 101-143) сохраняется (keyQuote-substring
  check остаётся защитой от галлюцинаций), но интегрируется с Zod-валидацией.
- `src/deliver.ts` — без изменений в API, только адаптация `chunkHtml()` если новые
  заголовки секций требуют корректировки разрыва между секциями.
- `src/run.ts:12-26` — `tick()` оборачивает `runPipeline()` try/catch; добавить
  `await sendAlert(...)` в catch.
- `src/logger.ts`, `src/telegram.ts` — без изменений.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `escapeHtml()` (`src/summarize.ts:38`) — переиспользуем без изменений для
  `summary`, `keyQuote`, `channel`, маркеров `[РОСНЕФТЬ]`.
- `chunkHtml()` (`src/deliver.ts:16`) — алгоритм разрыва по `\n\n`/`\n`/space
  работает; новые секции с emoji дают тот же `\n\n` разделитель — алгоритм не
  ломается.
- `verifyExtractiveness()` (`src/summarize.ts:101`) — серверная проверка
  `text.includes(keyQuote)` остаётся обязательной (Core Value: «каждая цитата
  дословно присутствует»). Известный риск Unicode NFC vs NFD (IN-01 backlog) —
  не блокирует, всплывёт по логам warn.
- `loadChannelsYaml()` (`src/pipeline.ts:21`) — без изменений; парсер channels.yaml.
- In-memory dedup `seen = Set<${username}:${messageId}>` (`src/pipeline.ts:61`) —
  оставляем как первую ступень (защита от двойного fetch внутри одного прогона);
  hash-cache становится второй ступенью (защита между прогонами).
- `RunSummary` (`src/types.ts:28`) и `logRunSummary` (`src/logger.ts`) — расширяем
  поля, не меняем интерфейс логирования.

### Established Patterns

- **Атомарная запись**: на ФС в Node.js — `writeFileSync(tmp) + renameSync(tmp, final)`.
  Используется для `data/raw`, `data/output`, `data/hash-cache.json`. Единый helper
  в `src/archive.ts` или вспомогательный `src/atomic.ts`.
- **Per-channel try/catch** (`src/pipeline.ts:71-89`) — паттерн «один канал упал —
  прогон продолжается». Не меняем; новые модули (dedup/archive/alert) следуют тому
  же принципу: ошибка локализована, не убивает соседнее.
- **ESM + tsx без сборки** (`package.json`): все импорты с `.js` расширением,
  `moduleResolution: bundler`, `strict: true`. Новые `src/schema.ts`, `src/dedup.ts`,
  `src/archive.ts`, `src/alert.ts` — тот же стиль.
- **Env-driven config** (`process.env.X ?? default`): `MAX_MESSAGES_PER_CHANNEL`,
  `CHANNEL_DELAY_MS`, и т.д. Новые env: `BOT_TOKEN_ALERTS`, `ALERTS_CHAT_ID`
  (ALERT-01 → `.env.example`), опционально `HASH_CACHE_TTL_DAYS=14` для DEDUP-02.
- **Логирование**: `log.info`/`log.warn`/`log.error` (`src/logger.ts`).
  `console.warn/error` оставшиеся в `telegram.ts:134-152` и `summarize.ts:113,123,174`
  — pre-existing tech debt v2.0, можно не трогать (опционально привести в порядок).
- **runId**: `crypto.randomUUID().slice(0, 8)` (`src/pipeline.ts:46`) — пробрасываем
  во все новые модули (alert.ts payload включает runId).

### Integration Points

- `src/pipeline.ts:83` — после fetch, до dedup → вставка `await writeRaw(allPosts, runId)`.
- `src/pipeline.ts:103` — перед `summarize(allPosts)` → вставка
  `const freshPosts = await dedupAgainstCache(allPosts)`.
- `src/pipeline.ts:106` — после `sendToChannel(html)` → вставка
  `await writeOutput(html, runId)` + `await commitHashCache(freshPosts)`.
- `src/run.ts:21` — внутри `catch (err)` → вставка
  `await sendAlert({stage: 'pipeline', message: err.message, runId, stack: err.stack})`.
- `src/summarize.ts` — целая `validate()` функция (lines 60-94) удаляется,
  заменяется на `import { DigestJsonSchema } from './schema.js'; DigestJsonSchema.parse(parsed)`.
- `package.json:dependencies` — добавить `"zod": "^3.x"`.
- `.env.example` — добавить `BOT_TOKEN_ALERTS=...` и `ALERTS_CHAT_ID=...` с
  пояснением «отдельный бот для алертов в личку владельца».
- `.gitignore` — добавить `data/` (всё содержимое) кроме `.gitkeep`.

</code_context>

<specifics>
## Specific Ideas

- Заголовки emoji-comprend подбираю «отраслевые», а не «модные» — кораблик 🚢 для
  бункера, нефтяная вышка 🛢 для масел, самолёт ✈️ для керосина (jet fuel), колба
  ⚗️ для нефтехимии, дорога 🛣 для битума, офис 🏢 для компаний-маркеров.
  Можно поменять без последствий — это чисто визуально.
- Inline-маркер `[РОСНЕФТЬ]` UPPERCASE bold перед summary — это паттерн вроде
  `[BREAKING]`/`[EXCLUSIVE]` из СМИ; для Заказчика-Роснефти это даст быстрый
  визуальный scan «где про нас».
- Префикс маркера: `<b>[РОСНЕФТЬ]</b> {summary}` — пробел между маркером и
  текстом, точка не нужна.
- Если пост имеет несколько mentions (одновременно Роснефть И Лукойл) — все
  маркеры подряд: `<b>[РОСНЕФТЬ] [ЛУКОЙЛ]</b> {summary}`.

</specifics>

<deferred>
## Deferred Ideas

Захвачено из обсуждения, относится к последующим фазам/милстоунам — не теряем, но
явно вне scope Phase 1.

- **Phase 2 (ACCEPT-01..02)**: 7-day smoke + acceptance-пакет — отдельная фаза-checkpoint,
  blocking. Здесь не трогаем; начинается ПОСЛЕ деплоя Phase 1 на VPS и накопления
  7 календарных дней data/output.
- **v3.1 backlog** — alert throttling/dedup, если 7-day smoke покажет шум.
- **v3.1 backlog** — Unicode NFC normalization в `keyQuote.includes()` (IN-01 v1.0),
  если в логах будут ложные drops.
- **v4.0** — semantic dedupe через embeddings, если SHA-256 даст ложные пропуски
  на 14-дневном окне.
- **v4.0** — Postgres + миграции, если ФС-state выйдет за пределы (>1GB data/raw,
  rolling >30 дней).
- **v3.1 опционально** — конвертация остаточных `console.warn/error` в `telegram.ts`
  и `summarize.ts` в `log.warn`/`log.error` (carried v2.0 backlog). Делается
  попутно, если task-инстанс затрагивает соответствующие строки.

</deferred>

---

*Phase: 01-code*
*Context gathered: 2026-04-26*
