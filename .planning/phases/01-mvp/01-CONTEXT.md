# Phase 1: MVP дайджест - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Один исполняемый скрипт `src/run.ts`. По команде `npm start` (после разовой `npm run login`) читает 10–15 публичных Telegram-каналов за последние 24 часа через GramJS user-session, прогоняет все собранные посты одним батчем через DeepSeek (`deepseek-chat`, `response_format: json_object`) с экстрактивным промптом, рендерит результат в HTML и доставляет в приватный Telegram-канал через Bot API `sendMessage`. Закрыт 5 критериями приёмки из §11 spec-app.md.

Персистентность, дедуп, крон, Docker, БД, embeddings, классификатор, абстракции провайдеров — вне фазы (v2 / SPEC.md).

</domain>

<decisions>
## Implementation Decisions

### Серверная верификация `keyQuote` (дословность)

- **D-01:** После `JSON.parse` ответа DeepSeek и ручной валидации полей пайплайн **обязательно** прогоняет каждый `item.keyQuote` через серверную проверку принадлежности исходному `text` поста. Полагаться только на SYSTEM_PROMPT запрещено — это защита Core Value кодом, а не промптом.
- **D-02:** Алгоритм сравнения: `sourceText.includes(item.keyQuote.trim())`. Строго + `trim()` по краям цитаты; внутри цитаты — дословно (без `replace(/\s+/g, ' ')` и без case-insensitive). Это баланс между защитой от «перефразировок» LLM и устойчивостью к лишним пробелам по краям.
- **D-03:** Соответствие `item → post` восстанавливается по `item.url` (формата `https://t.me/{username}/{messageId}`) — обратный маппинг в `Map<url, Post>` на стороне рендера. Если `url` не матчится ни одному собранному посту, запись тоже скипается (LLM придумал ссылку).
- **D-04:** Реакция на нарушение: **skip + warn**. Запись исключается из дайджеста, `logger.warn` в stderr печатает `channel`, `messageId`, `keyQuote` и 60-символьный сниппет исходного `text`. Дайджест всё равно уходит из отфильтрованных записей. Exit 1 не используется: одна галлюцинация не должна ломать весь прогон.
- **D-05:** Нарушения **не** пишутся в файл (`./logs/*.jsonl`). Только stderr-лог. Соответствует MVP-принципу «без персистентности».

### Identity GramJS-клиента (anti-ban правдоподобность)

- **D-06:** Платформа-легенда: **Telegram Desktop на Windows 11** (самый массовый сценарий чтения RU-каналов). Конкретные значения в `TelegramClient`:
  - `deviceModel: "Desktop"`
  - `systemVersion: "Windows 11"`
  - `appVersion: "5.3.0 x64"`
  - `langCode: "ru"`
  - `systemLangCode: "ru"`
- **D-07:** Значения хранятся как **захардкоженные константы** в `src/telegram.ts` (не в `.env`, не в `channels.yaml`). Это «легенда», а не секрет — конфиг не должен её раздувать.
- **D-08:** `connectionRetries` и прочие GramJS-опции — **дефолты** (не переопределяем). Меньше кода, меньше скрытых зависимостей от частных фич GramJS. `useWSS` — дефолт.

### Оформление HTML-дайджеста

- **D-09:** **Шапка** дайджеста (перед первой секцией):
  ```
  <b>Нефтегаз — {DD MMM YYYY}</b>
  <i>{N} постов из {K} каналов за 24ч</i>
  
  ```
  (пустая строка между шапкой и первой секцией). `N` — общее число собранных постов; `K` — число каналов, откуда они собраны (не из `channels.yaml` — именно те, что дали ≥1 пост).
- **D-10:** **Заголовки тем** — строго `<b>Заголовок темы</b>`. Без emoji и без нумерации секций. LLM генерирует 3–6 тем сама (§8 spec-app.md).
- **D-11:** **Формат буллета** — одна строка:
  ```
  • {summary} — <i>«{keyQuote}»</i> — <a href="{url}">@{channel}</a>
  ```
  Один буллет = один факт. Компактность приоритетнее визуальной разбивки — экономит лимит 4096.
- **D-12:** **Разделитель между секциями** — одна пустая строка (`\n\n`). Без `─────` или `———`.
- **D-13:** **Экранирование** (per REQUIREMENTS.md SUM-04): пользовательский текст (`summary`, `keyQuote`, `channel`) экранируется по `<`, `>`, `&` перед вставкой в HTML-шаблон. `url` — не экранируется, но прогоняется через валидацию `URL()`. Рендер — чистая конкатенация строк, без Handlebars.

### Claude's Discretion

- Точный формат даты шапки (например, `"21 апр 2026"` через `Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })` — но можно и по-другому).
- Внутренняя реализация `chunkHtml(html, 4000)` — по каким тегам/переносам резать, при условии, что **не рвём HTML посередине тега** и каждая часть самодостаточна (per DELIVER-02).
- Нужно ли шапку повторять в каждой части `(i/N)` или только в первой — Claude решает при имплементации, исходя из UX.
- Обработка постов без текста или с пустым `text` (репост-только-медиа) — скипать до LLM или включать в батч. Рекомендуется скипать (LLM всё равно не извлечёт `keyQuote` из пустого текста и получит серверный skip). Финальное решение — в плане.
- Формат логирования: `console.log/warn/error` vs минимальный wrapper с уровнями из `LOG_LEVEL`. Без внешних логгеров (`pino`, `winston`) — зависимости ровно три (`telegram`, `openai`, `yaml`).
- Обработка невалидного JSON от DeepSeek сверх SUM-03 (`exit 1`): печатать ли `raw` ответ перед выходом — Claude решает, но **без** сохранения в файл.
- Валидация `url` перед включением в HTML (конструктор `URL()` или regex) — имплементация на усмотрение.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Полная спецификация MVP (source of truth)
- `spec-app.md` — упрощённая версия проекта целиком. Всё, не покрытое decisions выше, берётся отсюда.
- `spec-app.md` §7 — шаги реализации (`package.json`/`tsconfig.json`, `scripts/login.ts`, `src/telegram.ts`, `src/summarize.ts`, `src/deliver.ts`, `src/run.ts`).
- `spec-app.md` §8 — SYSTEM_PROMPT для DeepSeek и JSON-схема ответа (`generatedAt`, `sections[].items[] = { summary, keyQuote, url, channel }`).
- `spec-app.md` §9 — чек-лист anti-ban (7 пунктов): persistent StringSession, ограниченное окно, последовательность+jitter, FloodWait-обработка, частные ошибки каналов, правдоподобный клиент, дисциплина частоты запусков.
- `spec-app.md` §11 — 5 критериев приёмки MVP (сбор <60с, дословность, HTML-доставка, идемпотентность, пустой день).
- `spec-app.md` §13 — out of scope / дорожная карта на следующий milestone (игнорируется в Phase 1).

### Project-level контекст и ограничения
- `.planning/PROJECT.md` — Vision, Constraints, Key Decisions, Out of Scope. Зафиксирован стек ровно 3 runtime-зависимостей и запрет на БД/Docker/крон/тесты.
- `.planning/REQUIREMENTS.md` — 26 v1-требований (CFG-01..05, AUTH-01..02, FETCH-01..06, SUM-01..04, DELIVER-01..04, RUN-01..03, OPS-01..02) с трассировкой на Phase 1. v2-требования (DEDUP/INFRA/CLS/TPL/PROV) — вне MVP.
- `.planning/ROADMAP.md` — Phase 1 goal, Success Criteria (5 пунктов), Suggested Plan Decomposition (3 плана: каркас+сессия → пайплайн → доставка+README).
- `.planning/STATE.md` — Accumulated Context, Risks/Watchlist (FloodWait, дословность `keyQuote`, лимит 4096 символов).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
Нет. Репозиторий пуст (кроме `.planning/` и `spec-app.md`). Весь код пишется с нуля.

### Established Patterns
Не применимо (первый код). Патерны задаются этой фазой и закрепляются для будущих milestone'ов.

### Integration Points
Первый код. Точки интеграции — внешние API:
- **Telegram MTProto** через GramJS (user-session, `iterMessages`, `FloodWaitError`)
- **DeepSeek API** через `openai` SDK (OpenAI-совместимый endpoint, `response_format: json_object`)
- **Telegram Bot API** через встроенный `fetch` (`POST /bot{token}/sendMessage`, `parse_mode: "HTML"`)
- **Node.js 20.6+** `--env-file=.env` (без `dotenv`) и `--import tsx` (без шага сборки)

</code_context>

<specifics>
## Specific Ideas

- **«Core Value защищается кодом, не промптом»** — серверная проверка `keyQuote` не опциональна, даже если промпт идеальный.
- **«Telegram Desktop Windows 11 — самая массовая легенда в RU»** — выбор платформы продиктован anti-ban правдоподобностью, а не вкусом.
- **«Строгий HTML без emoji в заголовках»** — дайджест читается одним оператором, визуальный шум не нужен; `<b>Тема</b>` + `<i>цитата</i>` + `<a>@channel</a>` — достаточный контраст.
- **«Компактный однострочный буллет»** — экономит лимит 4096 Bot API, 15 записей должны помещаться в 1–2 части максимум.
- **«Шапка как контекст-превью»** — `N постов из K каналов за 24ч` сразу даёт оператору sense of охвата, без открытия исходников.

</specifics>

<deferred>
## Deferred Ideas

Собранные в ходе обсуждения идеи, которые *не* обсуждались глубоко, но известны и явно оставлены на имплементатора/следующий milestone:

- **Финальный список каналов `channels.yaml`** — оператор готовит список 10–15 username'ов самостоятельно перед первым `npm start` (`neftegazru`, `oilfornication` как стартовые, остальные диктует оператор). В CFG-04 зафиксирован формат и примеры — конкретные username'ы не относятся к коду.
- **Обработка «пустых» постов (репост-только-медиа, text=""/undefined)** — не обсуждалось отдельно. Предварительный вектор — скипать до LLM (см. Claude's Discretion D-09). Окончательно фиксируется в плане.
- **Формат логирования и семантика `LOG_LEVEL`** — Claude's Discretion; без внешних логгеров.
- **Дополнительные защитные проверки ответа DeepSeek** (например, bound на `summary.length ≤ 250`, лимит 15 записей, sections 3–6) — в SUM-03 есть общая «ручная валидация», но детали на план.
- **Персистентность, дедуп по cosine similarity, Postgres+pgvector, BullMQ, крон, классификатор направлений, `LLMProvider`/`Deliverer` абстракции, Handlebars-шаблон, мульти-аккаунтная ротация сессий, Dashboard/RAG** — следующий milestone (v2 / SPEC.md), out of scope MVP.
- **Автотесты** — ручной чек-лист §11 в MVP; автоматизация окупится на следующем milestone.

### Reviewed Todos (not folded)

Нет — `gsd-tools todo match-phase 1` вернул 0 совпадений.

</deferred>

---

*Phase: 01-mvp*
*Context gathered: 2026-04-21*
