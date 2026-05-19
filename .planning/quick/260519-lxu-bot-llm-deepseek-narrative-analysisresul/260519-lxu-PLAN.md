---
phase: quick-260519-lxu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - data/refineries.json
  - src/upload/types.ts
  - src/upload/refineries.ts
  - src/upload/analyzer.ts
  - src/upload/renderer.ts
  - src/upload/llm.ts
  - src/bot.ts
  - src/__tests__/upload-refineries.test.ts
  - src/__tests__/upload-analyzer.test.ts
  - src/__tests__/upload-renderer.test.ts
  - src/__tests__/upload-llm.test.ts
autonomous: true
requirements:
  - LXU-01  # `company` field в RefineryEntry + сидирование 25 НПЗ из ground-truth xlsx (D-02)
  - LXU-02  # Analyzer группирует deltas по company с fallback="Независимые" (D-02)
  - LXU-03  # Renderer выводит структурный отчёт по компаниям (структурный канал НЕ ломается, D-01)
  - LXU-04  # /summarize команда → DeepSeek narrative → отдельное TG-сообщение (D-03, D-04)

must_haves:
  truths:
    - "После аплоада prices+fca в DM пользователю приходит структурный Markdown-отчёт, сгруппированный по company (включая «Независимые»)"
    - "Команда /summarize в DM перечитывает файлы текущей ISO-недели и присылает отдельное narrative-сообщение «🧠 Биржа …» + «🧠 FCA …»"
    - "Если в data/uploads/<currentWeek>/ нет пары prices+fca, /summarize отвечает «нужны prices+fca» и не зовёт DeepSeek"
    - "Если DeepSeek падает (после 1 retry), /summarize отвечает «❌ Не удалось получить LLM-сводку: <reason>. Структурный отчёт доступен в предыдущем сообщении.» и не валит polling"
    - "handleDocument (upload-pipeline) НЕ дёргает DeepSeek — narrative приходит ТОЛЬКО по явной /summarize"
    - "Narrative chunked по 4000 символов через тот же helper, что и структурный отчёт"
    - "`npm test` проходит зелёным — analyzer/renderer/llm покрыты vitest юнит-тестами"
  artifacts:
    - path: "data/refineries.json"
      provides: "25 НПЗ с полем company (4 холдинга + Независимые)"
      contains: "\"company\""
    - path: "src/upload/types.ts"
      provides: "RefineryEntry.company, RefineryDelta.company, CompanyGroup, AnalysisResult.byCompany"
      exports: ["RefineryEntry", "RefineryDelta", "CompanyGroup", "AnalysisResult"]
    - path: "src/upload/analyzer.ts"
      provides: "analyze() возвращает AnalysisResult с byCompany[]"
      contains: "byCompany"
    - path: "src/upload/renderer.ts"
      provides: "renderMarkdown рендерит секции по компаниям; exported chunkMarkdown"
      exports: ["renderMarkdown", "chunkMarkdown"]
    - path: "src/upload/llm.ts"
      provides: "buildLlmInput, buildSystemPrompt, callDeepseekNarrative, narrativeToChunks"
      exports: ["buildLlmInput", "buildSystemPrompt", "callDeepseekNarrative", "narrativeToChunks"]
    - path: "src/bot.ts"
      provides: "handleCommand роутит /summarize; reparseFromDisk доступен"
      contains: "/summarize"
    - path: "src/__tests__/upload-llm.test.ts"
      provides: "Юнит-тесты buildLlmInput + narrativeToChunks + callDeepseekNarrative (mock OpenAI)"
  key_links:
    - from: "src/upload/analyzer.ts"
      to: "data/refineries.json (company field)"
      via: "lookup canonical → company через RefineryEntry"
      pattern: "byCompany|company"
    - from: "src/upload/renderer.ts"
      to: "AnalysisResult.byCompany"
      via: "renderMarkdown итерирует byCompany"
      pattern: "byCompany"
    - from: "src/bot.ts (/summarize handler)"
      to: "src/upload/llm.ts"
      via: "import { buildLlmInput, callDeepseekNarrative, narrativeToChunks }"
      pattern: "from.*upload/llm"
    - from: "src/upload/llm.ts"
      to: "DeepSeek API (через openai SDK)"
      via: "client.chat.completions.create — те же env vars DEEPSEEK_API_KEY/BASE_URL/MODEL что и src/summarize.ts"
      pattern: "DEEPSEEK_API_KEY|DEEPSEEK_BASE_URL"
---

<objective>
Расширить upload-flow LLM-аналитической надстройкой: после аплоада xlsx бот продолжает присылать ФАКТИЧЕСКИЙ структурный отчёт (как сейчас), но теперь сгруппированный по компаниям-холдингам (РН, ГПН, ЛУКОЙЛ, НЗНП, Независимые). Поверх — отдельная команда `/summarize`, которая перечитывает файлы текущей ISO-недели, формирует structured JSON-вход (числа, не raw rows), отправляет в DeepSeek и присылает отдельным TG-сообщением narrative-сводку в двух секциях («🧠 Биржа — выводы по неделе» и «🧠 FCA — выводы по неделе»).

Purpose: дать читателю не только цифры (что мы уже умеем), но и интерпретацию недели в виде делового русского текста, без галлюцинаций (LLM получает только pre-aggregated числа, никакого free-text input от пользователя). Структурный отчёт остаётся «ground truth» — narrative идёт поверх, никогда не заменяет факты и не приходит без явной команды.

Output:
- `data/refineries.json` v2 — добавлено поле `company` ко всем 25 НПЗ.
- `src/upload/types.ts` — `RefineryEntry.company`, `CompanyGroup`, `AnalysisResult.byCompany`.
- `src/upload/refineries.ts` — `companyOf(canonical, dict)` helper.
- `src/upload/analyzer.ts` — analyze() возвращает дополнительно byCompany[].
- `src/upload/renderer.ts` — структурный Markdown сгруппирован по компаниям, chunkMarkdown экспортирован.
- `src/upload/llm.ts` (новый) — buildLlmInput / buildSystemPrompt / callDeepseekNarrative / narrativeToChunks.
- `src/bot.ts` — `/summarize` команда в handleCommand рядом с /upload_status.
- Юнит-тесты vitest для всех новых публичных функций.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@src/upload/types.ts
@src/upload/refineries.ts
@src/upload/analyzer.ts
@src/upload/renderer.ts
@src/upload/storage.ts
@src/bot.ts
@src/summarize.ts
@data/refineries.json
@src/__tests__/upload-refineries.test.ts
@src/__tests__/upload-analyzer.test.ts
@src/__tests__/upload-renderer.test.ts

<interfaces>
<!-- Извлечено из текущей кодовой базы; executor использует напрямую, без exploration. -->

From src/upload/types.ts (ДО плана):
```typescript
export interface RefineryEntry {
  canonical: string;
  aliases: string[];
}

export interface RefineryDelta {
  canonical: string;
  firstDate: Date; firstPrice: number;
  lastDate: Date;  lastPrice: number;
  deltaAbs: number; deltaPct: number;
  source: "birzha" | "fca";
}

export interface VolumeTotals {
  totalT: number;
  perRefinery: { canonical: string; totalT: number }[];
}

export interface AnalysisResult {
  periodStart: Date; periodEnd: Date;
  weekFolder: string; runAt: Date;
  deltas: RefineryDelta[];
  volumes?: VolumeTotals;
}
```

From src/upload/refineries.ts:
```typescript
export function loadRefineries(): RefineryEntry[];
export function normalizeRefinery(raw: string, dict: RefineryEntry[]): string;
```

From src/upload/storage.ts:
```typescript
export function isoWeekFolder(d: Date): string;          // "YYYY-Www"
export function weekDir(week: string): string;            // absolute path
export interface WeekStatus { hasPrices: boolean; hasVolumes: boolean; hasFca: boolean; lastRunAt: Date | null }
export function listWeek(week: string): WeekStatus;
```

From src/upload/renderer.ts:
```typescript
export function renderMarkdown(result: AnalysisResult): string[];  // ≤4000 chunks
// chunkMarkdown — internal, нужно экспортировать в Task 3 для reuse в llm.ts
```

From src/bot.ts:
```typescript
// existing helpers (paste-and-use)
async function sendPlain(token, chatId, text): Promise<void>;
async function sendMarkdown(token, chatId, text): Promise<void>;
async function reparseFromDisk(week, type, dict): Promise<ParsedRow[]>;  // internal — нужно расширить scope или продублировать в /summarize handler
function currentMskWeek(): string;  // "YYYY-Www" в MSK
export async function handleCommand(token, msg, allowlist): Promise<void>;
```

From src/summarize.ts (паттерн DeepSeek-вызова — paste-and-adapt в llm.ts):
```typescript
// env: DEEPSEEK_API_KEY (required), DEEPSEEK_BASE_URL (default "https://api.deepseek.com"),
//      DEEPSEEK_MODEL (default "deepseek-chat")
// client = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 1 });
// .chat.completions.create({ model, temperature: 0, response_format: { type: "json_object" }, messages: [...] })
// retry pattern: один retry на JSON parse fail / schema fail; на двойной fail → throw (caller ловит)
```

From docs/examples/цены битум все 30.04-08.05 - send2.xlsx (ground truth для company seeding):
- ООО «РН-Битум»: Ангарская НХК, Ачинский НПЗ ВНК, Куйбышевский НПЗ (Самарская группа), Новокуйбышевский НПЗ, Рязанская НПК, Саратовский НПЗ, Сызранский НПЗ, Уфимская группа НПЗ (РН-Башнефть), Ново-Уфимский НПЗ
- ООО «Газпромнефть-Битумные системы»: Газпромнефть-Омский НПЗ, Газпромнефть-Московский НПЗ, Ярославнефтеоргсинтез (ЯНОС)
- ООО «ЛЛК-ИНТЕРНЕШНЛ» (ЛУКОЙЛ): Нижегороднефтеоргсинтез (НОРСИ), Волгограднефтепереработка, Пермнефтеоргсинтез (если в текущем списке нет — оставить как есть)
- АО «НЗНП»: Новошахтинский НПЗ (НЗНП)
- «Независимые» (всё остальное в текущем data/refineries.json):
  МПК КРЗ, Сила Сибири, АБЗ Хохольский, Арсенал Юг, БТ СТРОЙСЕРВИС, Курский БТ, Мордовбитум,
  НПЗ Таиф-НК, Орскнефтеоргсинтез, Профнефтересурс, Сальский битумный терминал, Салаватнефтеоргсинтез
- ПРАВИЛО (D-02): если НПЗ не привязан к холдингу — `company: "Независимые"` (строка, не null).
</interfaces>

</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Расширить refineries.json + RefineryEntry полем `company`</name>
  <files>data/refineries.json, src/upload/types.ts, src/upload/refineries.ts, src/__tests__/upload-refineries.test.ts</files>
  <behavior>
    - `RefineryEntry` имеет required-поле `company: string` (НЕ optional, НЕ nullable — `string` всегда, fallback "Независимые").
    - `loadRefineries()` возвращает entries с непустым `company` для каждого; если в JSON `company` отсутствует → throw с понятным сообщением (валидация на парсинге).
    - Новая pure-функция `companyOf(canonical: string, dict: RefineryEntry[]): string` — case-insensitive lookup по canonical (НЕ по alias — alias уже нормализован раньше); если canonical не найден в dict → возвращает "Независимые".
    - `data/refineries.json` v2: 25 существующих entries сохранены, у каждого добавлено `company`. Привязка по ground-truth (docs/examples xlsx):
      * "ООО «РН-Битум»" — Ангарская НХК, Ачинский НПЗ ВНК, Рязанская НПК, Саратовский НПЗ, Сызранский НПЗ, Уфимская группа НПЗ, Ново-Уфимский НПЗ
      * "ООО «Газпромнефть-Битумные системы»" — Газпромнефть-Омский НПЗ, Газпромнефть-Московский НПЗ, Ярославнефтеоргсинтез
      * "ООО «ЛЛК-ИНТЕРНЕШНЛ»" — Нижегороднефтеоргсинтез, Волгограднефтепереработка
      * "АО «НЗНП»" — Новошахтинский НПЗ
      * "Независимые" — остальные (МПК КРЗ, Сила Сибири, АБЗ Хохольский, Арсенал Юг, БТ СТРОЙСЕРВИС, Курский БТ, Мордовбитум, НПЗ Таиф-НК, Орскнефтеоргсинтез, Профнефтересурс, Сальский битумный терминал, Салаватнефтеоргсинтез)
    - Тесты:
      * `companyOf("Газпромнефть-Омский НПЗ", dict)` → "ООО «Газпромнефть-Битумные системы»"
      * `companyOf("газпромнефть-омский нпз", dict)` (lowercase) → тот же холдинг
      * `companyOf("Сила Сибири", dict)` → "Независимые"
      * `companyOf("Неизвестный НПЗ", dict)` → "Независимые" (fallback)
      * `companyOf("", dict)` → "Независимые"
      * `loadRefineries()` возвращает ≥25 entries, у каждого `company` непустая строка.
      * Существующие тесты `normalizeRefinery` остаются зелёными (refactor — добавляем поле, контракт normalizeRefinery не меняется).
  </behavior>
  <action>
    **D-02 implementation.**

    1. Обнови `src/upload/types.ts`:
       ```typescript
       export interface RefineryEntry {
         canonical: string;
         company: string;        // NEW — всегда непустая, fallback "Независимые"
         aliases: string[];
       }
       ```

    2. Перепиши `data/refineries.json` — bump `version: 2`, добавь `company` к каждому из 25 entries по mapping выше. ВАЖНО: не меняй `canonical` и `aliases` существующих записей — только добавь поле. Никаких новых НПЗ в этот task не добавляй.

    3. В `src/upload/refineries.ts`:
       - В `loadRefineries()` после `JSON.parse` пройди по `parsed.refineries` и убедись что у каждой entry `typeof e.company === "string" && e.company.length > 0`. Если нет → throw `Error("[refineries] entry missing 'company' field: " + e.canonical)`.
       - Добавь pure-функцию:
         ```typescript
         export function companyOf(canonical: string, dict: RefineryEntry[]): string {
           const needle = canonical.trim().toLowerCase();
           if (!needle) return "Независимые";
           for (const e of dict) {
             if (e.canonical.toLowerCase() === needle) return e.company;
           }
           return "Независимые";
         }
         ```
       - НЕ трогай `normalizeRefinery` (контракт стабилен).

    4. Расширь `src/__tests__/upload-refineries.test.ts` блоком `describe("companyOf", () => { ... })` с кейсами из behavior. Добавь в `loadRefineries` test проверку что у первого entry есть `.company` непустой строкой.

    5. **Проверь**: `npm test` зелёный.
  </action>
  <verify>
    <automated>npm test -- src/__tests__/upload-refineries.test.ts</automated>
  </verify>
  <done>
    - data/refineries.json v2, у каждой entry поле `company` (string, никогда null/undefined).
    - companyOf() pure, без I/O, fallback на "Независимые".
    - npm test зелёный на upload-refineries.test.ts (+ остальные не сломаны).
    - Существующая логика normalizeRefinery / loadRefineries (модификация только дополняющая) работает как раньше.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Analyzer — группировка deltas по компаниям</name>
  <files>src/upload/types.ts, src/upload/analyzer.ts, src/__tests__/upload-analyzer.test.ts</files>
  <behavior>
    - Новый тип `CompanyGroup`:
      ```typescript
      export interface CompanyGroup {
        company: string;                    // "ООО «РН-Битум»" | "Независимые" | …
        birzha: RefineryDelta[];            // только source="birzha", отсортированы по abs(deltaAbs) desc
        fca: RefineryDelta[];               // только source="fca",    отсортированы по abs(deltaAbs) desc
        totalVolumeT: number;               // сумма volumeT по всем НПЗ в группе (0 если volumes отсутствуют)
        absDeltaSum: number;                // sum(|deltaAbs|) по birzha+fca — для сортировки самих компаний
      }
      ```
    - `AnalysisResult` дополнен полем `byCompany: CompanyGroup[]` — отсортирован по `absDeltaSum` desc; пустые группы (где обе birzha и fca пустые И totalVolumeT=0) **исключаются**.
    - Старое поле `deltas: RefineryDelta[]` остаётся (backwards compat для тестов; renderer перейдёт на byCompany в Task 3, но deltas всё равно нужен для unit-тестов analyzer'а и потенциального дашборда).
    - Analyzer принимает `dict: RefineryEntry[]` как **новый required-аргумент** (или загружает через `loadRefineries()` сам — выбери первое: pure-функция, dict пробрасывается). Сигнатура:
      ```typescript
      export function analyze(
        prices: ParsedRow[], fca: ParsedRow[],
        volumes: ParsedRow[] = [],
        dict: RefineryEntry[] = []   // если пустой → companyOf вернёт "Независимые" для всех
      ): AnalysisResult
      ```
      Дефолт `dict=[]` сохраняет backwards-compat для существующих analyzer-тестов (они тогда увидят всё в группе "Независимые" — это допустимо).
    - Тесты:
      * `byCompany` собран корректно: dict с 3 НПЗ (A→Holding1, B→Holding1, C→Holding2), prices+fca дают по дельте на каждый → 2 группы; Holding1.birzha содержит A и B, отсортированы по |Δ| desc.
      * Сортировка компаний по `absDeltaSum` desc: группа с большим суммарным |Δ| идёт первой.
      * НПЗ не в dict → попадает в группу "Независимые" с теми же дельтами.
      * Пустая группа НЕ попадает в byCompany.
      * `totalVolumeT` корректно агрегируется когда передан volumes-набор.
      * Существующие тесты analyzer'а (которые не передают dict) продолжают работать — `deltas[]` тот же; byCompany содержит одну группу "Независимые".
  </behavior>
  <action>
    **D-02 + LXU-02 implementation.**

    1. В `src/upload/types.ts` добавь `CompanyGroup` (см. behavior) и расширь `AnalysisResult`:
       ```typescript
       export interface AnalysisResult {
         periodStart: Date; periodEnd: Date;
         weekFolder: string; runAt: Date;
         deltas: RefineryDelta[];       // BC-compat — остаётся
         byCompany: CompanyGroup[];     // NEW — пустые группы исключены, sort desc по absDeltaSum
         volumes?: VolumeTotals;
       }
       ```

    2. В `src/upload/analyzer.ts`:
       - Импортируй `companyOf` из `./refineries.js`, тип `RefineryEntry` из `./types.js`.
       - Измени сигнатуру `analyze(prices, fca, volumes=[], dict: RefineryEntry[] = [])`.
       - После того как собрал `birzhaDeltas` и `fcaDeltas` (и `volumes` если есть):
         ```typescript
         // Build per-canonical volume map (uses already-computed volumes if any).
         const volByCanonical = new Map<string, number>();
         if (result.volumes) {
           for (const v of result.volumes.perRefinery) volByCanonical.set(v.canonical, v.totalT);
         }
         // Group by company.
         const groups = new Map<string, CompanyGroup>();
         const ensure = (company: string): CompanyGroup => {
           let g = groups.get(company);
           if (!g) { g = { company, birzha: [], fca: [], totalVolumeT: 0, absDeltaSum: 0 }; groups.set(company, g); }
           return g;
         };
         for (const d of birzhaDeltas) { const g = ensure(companyOf(d.canonical, dict)); g.birzha.push(d); g.absDeltaSum += Math.abs(d.deltaAbs); }
         for (const d of fcaDeltas)    { const g = ensure(companyOf(d.canonical, dict)); g.fca.push(d);    g.absDeltaSum += Math.abs(d.deltaAbs); }
         // Add volumes — даже если у НПЗ нет дельты (например только в volumes файле), всё равно учитываем в группе.
         for (const [canonical, totalT] of volByCanonical) {
           const g = ensure(companyOf(canonical, dict));
           g.totalVolumeT += totalT;
         }
         // Sort items inside groups.
         for (const g of groups.values()) {
           g.birzha.sort((a,b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs));
           g.fca.sort   ((a,b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs));
         }
         // Filter empty + sort companies.
         const byCompany = [...groups.values()]
           .filter(g => g.birzha.length > 0 || g.fca.length > 0 || g.totalVolumeT > 0)
           .sort((a,b) => b.absDeltaSum - a.absDeltaSum);
         result.byCompany = byCompany;
         ```

    3. В `src/__tests__/upload-analyzer.test.ts` добавь блок `describe("analyze — byCompany grouping", () => { … })`:
       - mini-dict с 3 НПЗ (canonical "A","B","C", company "H1","H1","H2", aliases []).
       - prices: A 100→120, B 50→60, C 200→180.
       - assert: `res.byCompany.length === 2`, первая группа H1 (absDeltaSum=20+10=30) или H2 (|Δ|=20)? — H1=30 > H2=20 → H1 first. Внутри H1.birzha[0].canonical === "A" (|Δ|=20 > 10).
       - дополнительный тест: НПЗ "Unknown" не в dict → попадает в группу "Независимые" с правильной дельтой.
       - дополнительный тест: dict не передан (`analyze(prices, [])` старая сигнатура) → byCompany имеет одну группу "Независимые" со всеми дельтами.

    4. **Проверь**: `npm test` зелёный (analyzer + остальные).
  </action>
  <verify>
    <automated>npm test -- src/__tests__/upload-analyzer.test.ts src/__tests__/upload-refineries.test.ts</automated>
  </verify>
  <done>
    - AnalysisResult.byCompany собран, отсортирован, пустые группы исключены.
    - companyOf используется для маппинга; "Независимые" fallback покрыт тестом.
    - Старый deltas[] не сломан (backwards compat).
    - npm test зелёный.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Renderer переводим на byCompany + экспортируем chunkMarkdown</name>
  <files>src/upload/renderer.ts, src/__tests__/upload-renderer.test.ts, src/bot.ts</files>
  <behavior>
    - `renderMarkdown(result: AnalysisResult): string[]` теперь рендерит секции по компаниям:
      ```
      *Битум — сводка за 2026-04-30..2026-05-08*
      Прогон: 2026-05-19 18:00 MSK
      Папка: 2026-W19

      *ООО «РН-Битум»*
      _Биржа:_
      Ангарская НХК: 33750₽ → 33500₽   Δ −250 ₽ (−0.7%)
      Саратовский НПЗ: 31000₽ → 31200₽   Δ +200 ₽ (+0.6%)
      _FCA:_
      Ангарская НХК: 33000₽ → 33000₽   Δ 0 ₽ (0%)
      _Объём (биржа):_ 6.10 т

      *ООО «Газпромнефть-Битумные системы»*
      …

      *Независимые*
      …
      ```
      Правила:
      * Заголовок компании `*Company name*` (Markdown bold).
      * Подсекция `_Биржа:_` показывается ТОЛЬКО если `group.birzha.length > 0`.
      * Подсекция `_FCA:_` — аналогично для `group.fca`.
      * Подсекция `_Объём (биржа):_ X.XX т` — ТОЛЬКО если `group.totalVolumeT > 0`.
      * Внутри подсекции — строки `canonical: firstPrice₽ → lastPrice₽   Δ ±N ₽ (±X%)`. Тэг `[birzha]`/`[fca]` теперь избыточен (контекст из заголовка) — **убираем**.
      * Между группами компаний пустая строка (`\n\n`) — это граница для chunkMarkdown.
    - Глобальная секция «Объёмы» (старый код после строки 95 renderer.ts) **удаляется** — объёмы теперь внутри company-блоков. result.volumes остаётся в типе (тесты analyzer-volumes не ломаем), но renderer его больше не использует напрямую.
    - `chunkMarkdown` экспортируем (`export function chunkMarkdown(...)`) — нужен в llm.ts (Task 4) для chunking narrative.
    - `(i/N)` префиксы при N>1 — остаются как есть.
    - Тесты renderer.ts обновляются под новый формат:
      * Smoke: при пустом byCompany → выводится "Нет данных по компаниям" (или аналог) — НЕ throw.
      * Группа РН-Битум выводит подсекцию "Биржа:" если хоть одна дельта source="birzha".
      * Группы упорядочены как в byCompany (не сортируем повторно).
      * При `totalVolumeT > 0` — строка "Объём (биржа):" присутствует.
      * Chunking: 200 deltas в одной "Независимые" группе → parts.length > 1, каждая часть ≤4000.
    - В `src/bot.ts` импорт `renderMarkdown` остаётся, handleDocument не меняется (он передаёт `analyze(prices, fca, volumes, dict)` — здесь критично: ДОБАВИТЬ `dict` 4-м аргументом, иначе байты собьются в "Независимые").
  </behavior>
  <action>
    **LXU-03 implementation.**

    1. В `src/upload/renderer.ts`:
       - Поменяй `chunkMarkdown` с `function` на `export function chunkMarkdown`.
       - Удали константу `VOLUMES_TOP_N` и старый блок «*Объёмы*» в `renderBody`.
       - В `renderDeltaLine` убери `[${d.source}]` suffix (теперь источник из подсекции).
       - Полностью перепиши `renderBody(result)`:
         ```typescript
         function renderBody(result: AnalysisResult): string {
           const lines: string[] = [];
           lines.push(`*Битум — сводка за ${fmtDate(result.periodStart)}..${fmtDate(result.periodEnd)}*`);
           lines.push(`Прогон: ${fmtMsk(result.runAt)}`);
           lines.push(`Папка: ${result.weekFolder}`);
           lines.push("");
           if (result.byCompany.length === 0) {
             lines.push("_Нет данных по компаниям._");
             return lines.join("\n");
           }
           for (const g of result.byCompany) {
             lines.push(`*${g.company}*`);
             if (g.birzha.length > 0) {
               lines.push("_Биржа:_");
               for (const d of g.birzha) lines.push(renderDeltaLine(d));
             }
             if (g.fca.length > 0) {
               lines.push("_FCA:_");
               for (const d of g.fca) lines.push(renderDeltaLine(d));
             }
             if (g.totalVolumeT > 0) {
               lines.push(`_Объём (биржа):_ ${fmtT(g.totalVolumeT)}`);
             }
             lines.push("");  // пустая строка между группами — boundary для chunkMarkdown
           }
           // Trim trailing empty line.
           while (lines.length > 0 && lines[lines.length-1] === "") lines.pop();
           return lines.join("\n");
         }
         ```

    2. В `src/__tests__/upload-renderer.test.ts` адаптируй существующие тесты под новый формат:
       - Build `AnalysisResult` с заполненным `byCompany` (один holding с двумя deltas). Можешь оставить вспомогательную `makeDelta` как есть.
       - Старые проверки `expect(text).toContain("[birzha]")` → удалить (этот тэг убран).
       - Старые проверки `expect(text).toMatch(/Объёмы/)` → заменить на `expect(text).toMatch(/Объём \(биржа\):/)`.
       - Добавь тесты:
         * рендер двух компаний с заголовками `*РН-Битум*` и `*ГПН-БС*` в нужном порядке.
         * При пустом byCompany — текст содержит "Нет данных".
       - chunking-тест: 200 deltas в одной группе → parts.length > 1, каждая ≤4000.

    3. В `src/bot.ts` (handleDocument блок 5 «If prices + fca both present → re-parse from disk and analyze»):
       - Замени `const result = analyze(pricesRows, fcaRows, volumeRows);` на
         `const result = analyze(pricesRows, fcaRows, volumeRows, dict);`
         (dict уже в scope — `const dict = loadRefineries();` строкой выше).
       - НИЧЕГО другого в handleDocument не трогай.

    4. **Manual smoke check (после кода):** перечитай `src/bot.ts:handleDocument`; убедись что path аплоада prices → save → if pair → analyze(…, dict) → renderMarkdown → sendMarkdown остаётся ровно тем же по структуре, только теперь dict проброшен.

    5. **Проверь:** `npm test` зелёный целиком (renderer + analyzer + refineries + остальные).
  </action>
  <verify>
    <automated>npm test</automated>
  </verify>
  <done>
    - renderMarkdown выводит секции по компаниям, без глобального блока «Объёмы».
    - chunkMarkdown экспортирован для reuse в llm.ts.
    - bot.handleDocument передаёт dict в analyze() — структурный отчёт после аплоада по-прежнему работает и теперь сгруппирован.
    - npm test зелёный.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: LLM-модуль + /summarize команда</name>
  <files>src/upload/llm.ts, src/bot.ts, src/__tests__/upload-llm.test.ts</files>
  <behavior>
    - Новый модуль `src/upload/llm.ts` с публичным API:
      ```typescript
      export interface LlmInputCompany {
        name: string;
        birzha: { refinery: string; firstPrice: number; lastPrice: number; deltaAbs: number; deltaPct: number; totalVolumeT?: number }[];
        fca:    { refinery: string; firstPrice: number; lastPrice: number; deltaAbs: number; deltaPct: number }[];
      }
      export interface LlmInput {
        period: { from: string; to: string; days: number };   // ISO "YYYY-MM-DD"
        companies: LlmInputCompany[];
      }

      export function buildLlmInput(result: AnalysisResult): LlmInput;
      export function buildSystemPrompt(): string;
      export interface DeepseekClientLike {
        chat: { completions: { create: (opts: any) => Promise<any> } };
      }
      export async function callDeepseekNarrative(
        input: LlmInput,
        client?: DeepseekClientLike  // optional — для DI в тестах
      ): Promise<string>;             // возвращает raw markdown narrative
      export function narrativeToChunks(narrative: string): string[];  // ≤4000 каждая
      ```
    - `buildLlmInput`:
      * `period.from = fmtDate(result.periodStart)`, `period.to = fmtDate(result.periodEnd)`, `period.days = Math.round((periodEnd-periodStart)/86400000) + 1`.
      * Для каждой group в `result.byCompany`: маппит birzha/fca в плоские объекты (без Date). В birzha опционально приклеивается `totalVolumeT` (только если есть entry в `volumeTotals.perRefinery` для этого canonical).
      * Если `byCompany` пуст — `companies: []`.
    - `buildSystemPrompt()` возвращает ровно тот же текст при каждом вызове (детерминистично; не зависит от runtime). Содержит:
      * Роль: «Ты — аналитик-сводщик битумного рынка».
      * Правило: «Используй ТОЛЬКО числа из user-message, никаких других данных».
      * Структуру вывода:
        - Опциональный вводный абзац: «За период X→Y (N дней) — N компаний, M НПЗ».
        - **🧠 Биржа — выводы по неделе** — 1-2 абзаца + опционально буллеты «Топ-3 росты», «Топ-3 падения», обязательно упоминание объёмов где totalVolumeT > 0.
        - **🧠 FCA — выводы по неделе** — 1-2 абзаца, без объёмов (в FCA их нет).
      * Стиль: фактический деловой русский, без эмодзи кроме `🧠` в заголовках.
      * Формат: **plain markdown text** (не JSON). Никаких ```code-fence```.
    - `callDeepseekNarrative`:
      * Если `client` не передан — создаёт `new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com", timeout: 120_000, maxRetries: 1 })`. Throw `Error("DEEPSEEK_API_KEY не задан")` если env отсутствует.
      * model = `process.env.DEEPSEEK_MODEL ?? "deepseek-chat"`, temperature=0, БЕЗ `response_format` (нам нужен plain markdown).
      * messages: `[{role:"system", content: buildSystemPrompt()}, {role:"user", content: JSON.stringify(input)}]`.
      * Retry policy: один retry на сетевую ошибку из `.create()`. На двойной fail — throw.
      * Возвращает `completion.choices[0]?.message?.content ?? ""`; если пусто → throw `Error("DeepSeek вернул пустой ответ")`.
    - `narrativeToChunks(text)`: внутри импортирует `chunkMarkdown` из `../upload/renderer.js` и вызывает с лимитом 4000 - PREFIX_RESERVE. При N>1 префиксует `(i/N)\n`. (Можно ВЫНЕСТИ chunkMarkdown в shared helper, но проще импортнуть из renderer'а — экспорт уже добавлен в Task 3.)

    - В `src/bot.ts` в `handleCommand` добавляется ветка `/summarize`:
      1. `const week = currentMskWeek();`
      2. `const status = listWeek(week);`
      3. Если `!status.hasPrices || !status.hasFca`:
         `await sendReply(token, chatId, msg.message_id, "Для /summarize нужны оба файла за ${week}: prices=${status.hasPrices?'✅':'❌'}, fca=${status.hasFca?'✅':'❌'}. Загрузи недостающий xlsx и повтори.");` → return.
      4. Иначе:
         * `await sendPlain(chatId, "⏳ Готовлю LLM-сводку…");`
         * `const dict = loadRefineries();`
         * `const pricesRows = await reparseFromDisk(week, "birzha_prices", dict);`
         * `const fcaRows = await reparseFromDisk(week, "fca", dict);`
         * `const volumeRows = status.hasVolumes ? await reparseFromDisk(week, "birzha_volumes", dict) : [];`
         * `const result = analyze(pricesRows, fcaRows, volumeRows, dict);`
         * `const input = buildLlmInput(result);`
         * **try** `const narrative = await callDeepseekNarrative(input);` `const chunks = narrativeToChunks(narrative);` `for (const c of chunks) await sendMarkdown(chatId, c);`
         * **catch (err)** `await sendPlain(chatId, "❌ Не удалось получить LLM-сводку: ${msg.slice(0,300)}. Структурный отчёт доступен в предыдущем сообщении.");` `log.error(...)`.
      5. handleDocument **НЕ ТРОГАЕМ**.
      6. pollOnce **НЕ ТРОГАЕМ**.
    - **Важно:** функция `reparseFromDisk` сейчас module-private в bot.ts (см. строки 383-391). Её НЕ нужно экспортировать — `/summarize` живёт в том же файле, она доступна локально.

    - Юнит-тесты `src/__tests__/upload-llm.test.ts`:
      * `buildLlmInput` — приёмочные кейсы:
        - AnalysisResult с двумя компаниями + volumes → корректная shape (`period.days`, `companies[].birzha[].totalVolumeT` где применимо).
        - Пустой byCompany → `companies: []`.
        - period.days считается корректно (включая edge: периодStart === периодEnd → days=1).
      * `buildSystemPrompt` — содержит ключевые маркеры: "🧠 Биржа", "🧠 FCA", "ТОЛЬКО числа", "plain markdown" (или эквивалент).
      * `narrativeToChunks` — короткий → 1 часть; длинный (>4000) → N>1 частей, каждая ≤4000, все начинаются с `(i/N)\n`.
      * `callDeepseekNarrative` с **mock client**:
        - Успех: client.chat.completions.create resolves с `{choices:[{message:{content:"narrative text"}}]}` → возвращает "narrative text".
        - Сетевая ошибка → retry → успех → возвращает результат retry.
        - Двойная ошибка → throw с сообщением последней ошибки.
        - Пустой content → throw `"DeepSeek вернул пустой ответ"`.
  </behavior>
  <action>
    **D-03 + D-04 + LXU-04 implementation.**

    1. Создай `src/upload/llm.ts` с публичным API из behavior. Структура:
       ```typescript
       import OpenAI from "openai";
       import { log } from "../logger.js";
       import { chunkMarkdown } from "./renderer.js";
       import type { AnalysisResult } from "./types.js";

       // types: LlmInputCompany, LlmInput, DeepseekClientLike

       export function buildLlmInput(result: AnalysisResult): LlmInput { /* ... */ }
       export function buildSystemPrompt(): string { return [/* lines */].join("\n"); }
       export async function callDeepseekNarrative(input, client?) {
         // resolve client
         // build messages
         // try .create(); catch → retry once; catch → throw
         // validate non-empty content; return content
       }
       const NARRATIVE_CHUNK_LIMIT = 4000;
       const NARRATIVE_PREFIX_RESERVE = 80;
       export function narrativeToChunks(narrative: string): string[] {
         const raw = chunkMarkdown(narrative, NARRATIVE_CHUNK_LIMIT - NARRATIVE_PREFIX_RESERVE);
         if (raw.length === 1) return raw;
         const n = raw.length;
         return raw.map((p, i) => `(${i+1}/${n})\n${p}`);
       }
       ```
       Для `buildLlmInput`: волюм-маппинг проще всего через `result.volumes?.perRefinery` — собрать `Map<canonical, totalT>`, и при формировании `birzha` items приклеивать `totalVolumeT` если canonical есть в карте. (Альтернатива — использовать `group.totalVolumeT`, но это сумма по компании, а нам нужно per-refinery. Map по volumes лучше.)

    2. Расширь `src/bot.ts`:
       - Добавь импорты в шапку: `import { buildLlmInput, callDeepseekNarrative, narrativeToChunks } from "./upload/llm.js";`
       - В `handleCommand` после блока `if (cmd === "/upload_status")` добавь `if (cmd === "/summarize") { … }` с логикой из behavior.
       - Используй **существующие** `sendPlain`, `sendMarkdown`, `sendReply`, `reparseFromDisk`, `loadRefineries`, `currentMskWeek`, `listWeek`, `analyze` — все они уже импортированы или live в том же файле.
       - try/catch вокруг callDeepseekNarrative обязателен — на fail отправляй plain-сообщение с диагностикой и пишите `log.error("[bot] /summarize llm error: " + err.message)`. НЕ throw наверх — pollOnce не должен ловить эту ошибку (она ожидаемая и уже обработана).

    3. Создай `src/__tests__/upload-llm.test.ts` с vitest. Для mock OpenAI client сделай простой объект:
       ```typescript
       const mockClient = {
         chat: { completions: {
           create: vi.fn().mockResolvedValue({ choices: [{ message: { content: "narrative test" }}]})
         }}
       };
       ```
       Прогон кейсов из behavior. **НЕ зови реальный DeepSeek.**

    4. **Manual smoke (опишите в SUMMARY):**
       * `npm start:once` или вручную через бота: после аплоада prices+fca → структурный отчёт по компаниям приходит как раньше.
       * Шлю `/summarize` в DM → бот отвечает "⏳ Готовлю LLM-сводку…" → через ~5-15с приходит narrative с заголовками 🧠 Биржа и 🧠 FCA.
       * Удаляю один из xlsx → шлю `/summarize` → отвечает "Для /summarize нужны оба файла…" без вызова DeepSeek.
       * Стопаю интернет / порчу DEEPSEEK_API_KEY → шлю `/summarize` → отвечает "❌ Не удалось получить LLM-сводку: …".

    5. **Проверь:** `npm test` зелёный целиком.
  </action>
  <verify>
    <automated>npm test</automated>
  </verify>
  <done>
    - src/upload/llm.ts экспортирует buildLlmInput, buildSystemPrompt, callDeepseekNarrative, narrativeToChunks; OpenAI client пр инициализируется лениво внутри callDeepseekNarrative.
    - /summarize ветка в bot.handleCommand: gated на allowlist (выше уже отфильтрован), вызывает llm-pipeline, на fail — fallback message без crash polling.
    - handleDocument не изменён (кроме строки analyze(…, dict) добавленной в Task 3).
    - Юнит-тесты llm.ts покрывают buildLlmInput, buildSystemPrompt, narrativeToChunks, callDeepseekNarrative (4 кейса: success, retry-success, double-fail, empty-content).
    - npm test зелёный.
  </done>
</task>

</tasks>

<verification>
- `npm test` — все vitest зелёные (включая existing + новые upload-llm.test.ts).
- Структурный (фактический) отчёт после аплоада xlsx **по-прежнему приходит** в DM (regression check). Теперь он сгруппирован по компаниям.
- `/summarize` в DM от allowlist-юзера:
  * При наличии prices+fca в текущей ISO-неделе → narrative приходит отдельным сообщением (1+ chunk).
  * При отсутствии файла → понятный отказ без вызова DeepSeek.
  * При сетевой ошибке DeepSeek → понятный отказ без crash polling.
- `/summarize` от не-allowlist юзера → silent ignore (gated на самом верху handleCommand, ничего не делаем).
- Никаких новых runtime-deps в package.json (`openai` уже есть).
- handleDocument в bot.ts НЕ дёргает DeepSeek (D-01: LLM-narrative ТОЛЬКО по явной команде).
- `npm test` зелёный.
</verification>

<success_criteria>
- D-01 honored: структурный отчёт после аплоада не заменён, остаётся фактическим; LLM-narrative — отдельный модуль, отдельная команда, отдельное TG-сообщение.
- D-02 honored: поле `company` в каждой entry data/refineries.json (sting, fallback "Независимые"); analyzer группирует по company.
- D-03 honored: триггер — `/summarize`, не auto-after-upload; читает текущую ISO-неделю.
- D-04 honored: narrative приходит отдельным sendMarkdown (или chain'ом chunk'ов), не дописывается к структурному отчёту; используется тот же chunking-helper (chunkMarkdown через renderer.ts).
- Все 4 коммита проходят `npm test` зелёным.
- Никаких deferred идей в плане: нет авто-LLM после аплоада, нет alias-based company lookup'а, нет хранения narrative в файле — всё in-memory как было решено.
</success_criteria>

<output>
After completion, create `.planning/quick/260519-lxu-bot-llm-deepseek-narrative-analysisresul/260519-lxu-SUMMARY.md` describing:
- Final shape of LlmInput (JSON contract that goes to DeepSeek).
- Sample narrative output (paste 1 real response from manual smoke).
- Sample structural report по компаниям (paste 1 real response).
- Confirmation что handleDocument не зовёт DeepSeek (cite line numbers).
- Any deviations from the plan.
</output>
