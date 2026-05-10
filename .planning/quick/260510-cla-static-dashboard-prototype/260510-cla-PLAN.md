---
phase: quick-260510-cla
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/build-dashboard.ts
  - package.json
  - .gitignore
autonomous: false
requirements:
  - DASH-01
  - DASH-02
  - DASH-03
  - DASH-04
  - DASH-05

must_haves:
  truths:
    - "Запуск `npm run dashboard` пишет один файл `data/dashboard/index.html` без ошибок"
    - "Открытие index.html в браузере (file://) показывает дашборд без сетевых ошибок (кроме Chart.js с CDN)"
    - "Видны 4 виджета: line chart постов по дням (tg vs web), bar chart топ-15 источников, donut chart по категориям, лента событий"
    - "Лента событий фильтруется по категории, по тегу компании ([ЛУКОЙЛ]/[РОСНЕФТЬ]/[ГПН]) и по тексту поиска"
    - "Селектор диапазона (7д / 30д / all) перерисовывает все 4 виджета"
    - "Каждый item в ленте событий показывает summary, цитату и кликабельную ссылку на источник"
    - "Скрипт идемпотентен: повторный запуск на тех же данных даёт идентичный HTML по содержимому DATA"
  artifacts:
    - path: "scripts/build-dashboard.ts"
      provides: "Build script: читает data/raw/*.json + data/output/*.md, генерирует data/dashboard/index.html"
      min_lines: 200
    - path: "data/dashboard/index.html"
      provides: "Self-contained HTML с инлайновыми DATA + Chart.js CDN + vanilla JS"
      contains: "id=\"data\""
    - path: "package.json"
      provides: "npm script `dashboard`"
      contains: "\"dashboard\""
    - path: ".gitignore"
      provides: "Исключение генерируемых артефактов"
      contains: "/data/dashboard/"
  key_links:
    - from: "scripts/build-dashboard.ts"
      to: "src/paths.ts"
      via: "import { paths } from \"../src/paths.js\""
      pattern: "paths\\.(rawDir|outputDir|dataDir)"
    - from: "scripts/build-dashboard.ts"
      to: "data/raw/*.json"
      via: "fs.readdir + JSON.parse"
      pattern: "readdir.*rawDir"
    - from: "scripts/build-dashboard.ts"
      to: "data/output/*.md"
      via: "fs.readdir + regex parser"
      pattern: "readdir.*outputDir"
    - from: "data/dashboard/index.html"
      to: "https://cdn.jsdelivr.net/npm/chart.js"
      via: "<script src=...>"
      pattern: "cdn\\.jsdelivr\\.net/npm/chart\\.js"
---

<objective>
Собрать самодостаточный статический HTML-дашборд для визуализации накопленных
дайджестов без изменения существующего pipeline. Один build-скрипт
`scripts/build-dashboard.ts` читает `data/raw/*.json` (tg + web) и
`data/output/*.md` (готовые дайджесты), парсит структуру и генерирует
один файл `data/dashboard/index.html` со всеми данными inline и Chart.js,
подгруженным с CDN.

Purpose: dev-инструмент для оператора — видеть накопленную картину парсинга
без сервера, без БД, без новых runtime-зависимостей. Лежит в `scripts/`,
никак не пересекается с pipeline-кодом в `src/`.

Output:
- `scripts/build-dashboard.ts` — pure tsx, использует только `node:fs/promises`, `node:path`, `src/paths.ts`
- `data/dashboard/index.html` — self-contained артефакт (gitignored)
- `npm run dashboard` — запуск
- `.gitignore` дополнен `/data/dashboard/`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/paths.ts
@src/types.ts
@channels.json
@websites.json
@package.json
@tsconfig.json

<interfaces>
Извлечено из src/paths.ts. Использовать напрямую — изучать кодбазу не нужно.

From src/paths.ts (импорт через "../src/paths.js" из scripts/):
```typescript
export const paths = {
  get dataDir(): string;          // ${DATA_DIR} || "./data"
  get rawDir(): string;           // ${DATA_DIR}/raw
  get outputDir(): string;        // ${DATA_DIR}/output
  // прочие методы есть, но в этой задаче не нужны
};
```

From src/types.ts (для понимания формы — типы НЕ копировать, локально объявить свои):
```typescript
export interface Post {
  channelUsername: string;  // в файлах raw/*.json поле называется `username`!
  messageId: number;
  postedAt: string;         // в файлах raw/*.json поле называется `date`!
  text: string;
  url: string;
}
```
</interfaces>

<data_format_notes>
ВАЖНО — формат файлов на диске отличается от типа `Post`:

`data/raw/2026-MM-DD.json` (tg-посты, массив):
```json
[
  {
    "username": "lukoil_info",
    "messageId": 6184,
    "text": "...",
    "date": "2026-05-08T10:00:00.000Z",
    "url": "https://t.me/lukoil_info/6184"
  }
]
```

`data/raw/2026-MM-DD-web.json` (web-посты, массив):
```json
[
  {
    "username": "lukoil-timeline",
    "messageId": 0,
    "text": "...длинный плоский текст страницы...",
    "date": "2026-05-08T11:59:01.000Z",
    "url": "https://lukoil.ru/PressCenter/Timeline"
  }
]
```

Имя файла → дата (MSK). Разбирать ровно по имени `YYYY-MM-DD(-web)?.json`.

`data/output/2026-MM-DD.md` (HTML-дайджест tg) и `*-web.md` — НЕ markdown,
а Telegram-HTML с такой структурой:

```
<b>Нефтегаз — 8 мая 2026 г.</b>
<i>250 постов из 40 каналов за 24ч</i>

<b>🚢 #Бункер</b>
<i>— нет упоминаний за сутки</i>

<b>🛢 #Масла</b>
• Teboil расширяет линейку... — <i>«цитата»</i> — <a href="https://teboil.ru/news/">@teboil</a>

<b>🏢 #Компании</b>
• <b>[ЛУКОЙЛ]</b> Сотрудники ЛУКОЙЛа предложили... — <i>«цитата»</i> — <a href="https://t.me/lukoil_info/6184">@lukoil_info</a>
```

Правила парсинга:
- Заголовок секции: строка `<b>{emoji} #{Категория}</b>` — категории строго:
  `Бункер | Масла | Керосин | Нефтехимия | Битум | Компании`
- Пустая секция: `<i>— нет упоминаний за сутки</i>` — пропустить
- Item начинается с `• ` (U+2022 + пробел)
- Опциональный company-tag сразу после bullet: `<b>[ЛУКОЙЛ]</b>` /
  `<b>[РОСНЕФТЬ]</b>` / `<b>[ГПН]</b>`
- Затем summary до ` — <i>«`
- Цитата: `<i>«...»</i>` (russian quotes U+00AB / U+00BB)
- Источник: `<a href="URL">@username</a>` в конце строки

Регекс для item (один на всё, тестировать на 2026-05-08.md):
```
^•\s+(?:<b>\[(ЛУКОЙЛ|РОСНЕФТЬ|ГПН)\]<\/b>\s+)?(.+?)\s+—\s+<i>«(.+?)»<\/i>\s+—\s+<a href="([^"]+)">@?([^<]+)<\/a>\s*$
```

Категории и emoji (для donut chart):
- Бункер 🚢, Масла 🛢, Керосин ✈️, Нефтехимия ⚗️, Битум 🛣, Компании 🏢
</data_format_notes>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Build script — data loaders + MD digest parser</name>
  <files>scripts/build-dashboard.ts</files>
  <action>
Создать `scripts/build-dashboard.ts` со структурой ниже. В этой задаче — ТОЛЬКО
сбор данных и точка входа со stub'ом записи; HTML-генерация в Task 2.

1) Импорты (строго эти, никаких новых runtime-зависимостей):
```ts
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "../src/paths.js";
```

2) Локальные типы:
```ts
type Source = "tg" | "web";
interface RawPost {
  username: string;
  messageId: number;
  text: string;
  date: string;       // ISO
  url: string;
  source: Source;     // обогащаем при загрузке
  fileDate: string;   // YYYY-MM-DD (MSK), из имени файла
}
type Category = "Бункер" | "Масла" | "Керосин" | "Нефтехимия" | "Битум" | "Компании";
type CompanyTag = "ЛУКОЙЛ" | "РОСНЕФТЬ" | "ГПН";
interface DigestEvent {
  fileDate: string;
  source: Source;
  category: Category;
  company: CompanyTag | null;
  summary: string;
  quote: string;
  sourceUrl: string;
  sourceLabel: string;
}
interface DashboardData {
  generatedAt: string;
  dateRange: { from: string; to: string };
  posts: RawPost[];
  events: DigestEvent[];
  channels: string[];
  websites: string[];
}
```

3) `parseFileDate(filename)`: принимает basename, возвращает
   `{ date: "2026-05-08", source: "web" | "tg" } | null`. Регекс:
   `^(\d{4}-\d{2}-\d{2})(-web)?\.(json|md)$`. Не матчится — null.

4) `async function loadAllPosts(): Promise<RawPost[]>`:
   - `readdir(paths.rawDir)`, фильтр через parseFileDate (только .json)
   - для каждого файла `JSON.parse(await readFile(...))` → массив
   - map в RawPost (источник `source`, `fileDate` из имени)
   - битый файл: `console.warn` + continue (не падать)

5) `async function loadAllEvents(): Promise<DigestEvent[]>`:
   - `readdir(paths.outputDir)`, фильтр (только .md)
   - для каждого: `text.split(/\r?\n/)`, итерация
   - tracker `currentCategory: Category | null`; обновлять при матче
     `^<b>[^<]*\s#(Бункер|Масла|Керосин|Нефтехимия|Битум|Компании)<\/b>$`
   - игнорировать `<i>— нет упоминаний за сутки</i>`
   - для строк, начинающихся с `• `, применять item-регекс из data_format_notes
   - не матчится — `console.warn(\`unparsed: ${line.slice(0,80)}\`)` + continue
   - `sourceLabel` нормализовать к виду `@username` (добавить @ если нет)

6) `async function loadConfigs()`: читает `channels.json` и `websites.json`
   из CWD (seed-defaults в корне репо). Возвращает `{ channels: string[], websites: string[] }`
   с уникальными usernames / names. Если websites нет `name` — fallback на host из URL.

7) `async function buildData(): Promise<DashboardData>`:
   - параллельно вызывает `loadAllPosts`, `loadAllEvents`, `loadConfigs`
   - `dateRange.from` = min, `to` = max среди объединения posts.fileDate ∪ events.fileDate
   - если нет ни одного post и ни одного event — throw `new Error("no data")`

8) `main()` (на этом этапе пишет stub):
```ts
async function main() {
  const data = await buildData();
  console.log(`[dashboard] posts=${data.posts.length} events=${data.events.length} range=${data.dateRange.from}..${data.dateRange.to}`);
  const outDir = path.join(paths.dataDir, "dashboard");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "index.html");
  await writeFile(outFile, `<!-- stub: ${data.events.length} events -->`, "utf8");
  console.log(`[dashboard] wrote ${outFile}`);
}
main().catch((err) => { console.error("[dashboard] FATAL:", err); process.exit(1); });
```

NOT в этой задаче: HTML-шаблон, Chart.js, виджеты, фильтры — это Task 2.

Цель: pragmatic, ~200-280 строк, без over-engineering.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | head -40</automated>
  </verify>
  <done>
- `scripts/build-dashboard.ts` создан, проходит `tsc --noEmit` без ошибок
- Ручной запуск `npx tsx scripts/build-dashboard.ts` выводит непустые числа posts/events/range
- На реальных данных репо (data/raw/2026-04-27..2026-05-08) парсер событий находит >= 20 записей с заполненными category/quote/sourceUrl
- Stub `data/dashboard/index.html` создан
  </done>
</task>

<task type="auto">
  <name>Task 2: HTML-шаблон с 4 виджетами + vanilla JS интерактив</name>
  <files>scripts/build-dashboard.ts</files>
  <action>
Расширить `scripts/build-dashboard.ts` функцией `renderHtml(data: DashboardData): string`,
которая возвращает один полный HTML-документ. Заменить stub в `main()`.

Структура HTML (строго в этом порядке):

```
<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<title>tg-parser dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>/* inline styles, ~80-120 строк */</style>
</head><body>
<header>
  <h1>Нефтегаз — дашборд парсинга</h1>
  <div class="meta">
    <span id="meta-info"></span>
    <select id="range">
      <option value="7">Последние 7 дней</option>
      <option value="30" selected>Последние 30 дней</option>
      <option value="all">Всё время</option>
    </select>
  </div>
</header>

<section class="grid">
  <div class="card"><h2>Посты по дням</h2><canvas id="chart-timeline"></canvas></div>
  <div class="card"><h2>Топ-15 источников</h2><canvas id="chart-sources"></canvas></div>
  <div class="card"><h2>Распределение по категориям</h2><canvas id="chart-categories"></canvas></div>
</section>

<section class="card">
  <h2>Лента событий</h2>
  <div class="filters">
    <select id="f-category"><option value="">Все категории</option>...</select>
    <select id="f-company">
      <option value="">Все компании</option>
      <option value="ЛУКОЙЛ">ЛУКОЙЛ</option>
      <option value="РОСНЕФТЬ">РОСНЕФТЬ</option>
      <option value="ГПН">ГПН</option>
    </select>
    <input id="f-search" type="search" placeholder="Поиск по тексту…">
    <span id="events-count"></span>
  </div>
  <ul id="events-list"></ul>
</section>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script id="data" type="application/json">__DATA__</script>
<script>/* app.js, ~150-200 строк */</script>
</body></html>
```

КРИТИЧНО — инжекция данных:
- НЕ использовать `<script>const DATA = ${JSON.stringify(data)}</script>` напрямую —
  ломается при наличии `</script>` в тексте постов.
- Положить JSON в `<script id="data" type="application/json">` и эскейпать `</` → `<\/`:
  `template.replace("__DATA__", JSON.stringify(data).replaceAll("</", "<\\/"))`.
- В клиенте: `const DATA = JSON.parse(document.getElementById("data").textContent);`

Стили (минимально, light theme, без фреймворка):
```css
body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 1400px;
       margin: 0 auto; padding: 16px; color: #222; background: #fafafa; }
header { display: flex; justify-content: space-between; align-items: baseline;
         flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.card { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px;
        padding: 16px; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
.filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
           margin-bottom: 12px; }
.filters input, .filters select { padding: 6px 8px; border: 1px solid #ccc;
           border-radius: 4px; font: inherit; }
.filters input { flex: 1; min-width: 200px; }
#events-list { list-style: none; padding: 0; max-height: 70vh; overflow-y: auto; margin: 0; }
#events-list li { padding: 10px 0; border-bottom: 1px solid #eee; }
.tag { display: inline-block; padding: 1px 6px; border-radius: 4px;
       background: #eef; font-size: 12px; margin-right: 6px; }
.tag.company { background: #ffeed8; }
.quote { color: #555; font-style: italic; margin: 4px 0; }
.src { font-size: 12px; }
.src a { color: #06c; text-decoration: none; }
canvas { max-height: 320px; }
h1 { margin: 0; font-size: 22px; }
h2 { margin: 0 0 12px; font-size: 16px; }
```

App-скрипт (vanilla, без билда):
```js
const DATA = JSON.parse(document.getElementById("data").textContent);
const CATEGORIES = ["Бункер","Масла","Керосин","Нефтехимия","Битум","Компании"];
const CAT_COLORS = {"Бункер":"#4e79a7","Масла":"#f28e2c","Керосин":"#e15759",
                    "Нефтехимия":"#76b7b2","Битум":"#59a14f","Компании":"#edc949"};

// state
const state = { rangeDays: 30, category: "", company: "", search: "" };

// fill #f-category options from CATEGORIES.

// "today" = max fileDate среди postов и events (исторические данные, не реальный today).
function maxDate() { /* string compare YYYY-MM-DD safe */ }
function inRange(d) {
  if (state.rangeDays === "all") return true;
  const today = maxDate();
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - Number(state.rangeDays));
  return d >= cutoff.toISOString().slice(0,10);
}

function recompute() {
  const posts = DATA.posts.filter(p => inRange(p.fileDate));
  const events = DATA.events.filter(e => inRange(e.fileDate));
  renderTimeline(posts);
  renderSources(posts);
  renderCategories(events);
  renderEventsList(events);
  document.getElementById("meta-info").textContent =
    `${DATA.dateRange.from} — ${DATA.dateRange.to} · ${posts.length} постов · ${events.length} событий`;
}

// Timeline: labels = sorted unique fileDates в окне; datasets = [{label:"Telegram",data:[...]},{label:"Веб",data:[...]}]
//   type: "line", x=category, y=count.
// Sources: top 15 по post count в окне; labels = usernames; type: "bar", indexAxis: "y" (горизонтальный).
// Categories: count событий по category; type: "doughnut"; labels=CATEGORIES; backgroundColor из CAT_COLORS.
// Все три — destroy+recreate при recompute (или dataset assign + .update()).

// renderEventsList: фильтры category/company/search (search регистронезависимый по summary+quote).
// debounce 150ms на input. Render через DOM API:
//   li = document.createElement("li");
//   const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = ev.category;
//   ... (textContent — не innerHTML, чтобы не было XSS из text постов).
//   const a = document.createElement("a"); a.href = ev.sourceUrl; a.textContent = ev.sourceLabel; a.target = "_blank"; a.rel = "noopener";

document.getElementById("range").addEventListener("change", e => {
  state.rangeDays = e.target.value === "all" ? "all" : Number(e.target.value);
  recompute();
});
document.getElementById("f-category").addEventListener("change", e => { state.category = e.target.value; renderEventsList(filteredEvents()); });
document.getElementById("f-company").addEventListener("change", e => { state.company = e.target.value; renderEventsList(filteredEvents()); });
document.getElementById("f-search").addEventListener("input", debounce(e => { state.search = e.target.value.toLowerCase(); renderEventsList(filteredEvents()); }, 150));

recompute();
```

Sanity в renderHtml на сервере:
- Никакой HTML-эскейп серверной стороны не нужен — данные едут JSON-ом.
- Единственная санитизация — `</` → `<\/` в JSON-payload.

Заменить stub в `main()`:
```ts
const html = renderHtml(data);
const outFile = path.join(paths.dataDir, "dashboard", "index.html");
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, html, "utf8");
console.log(`[dashboard] wrote ${outFile} (${(html.length/1024).toFixed(1)} KB)`);
```
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | head -40 &amp;&amp; npx tsx scripts/build-dashboard.ts 2>&amp;1 | tail -5 &amp;&amp; test -s data/dashboard/index.html &amp;&amp; grep -q 'id="data"' data/dashboard/index.html &amp;&amp; grep -q "cdn.jsdelivr.net/npm/chart.js" data/dashboard/index.html &amp;&amp; grep -q "chart-timeline" data/dashboard/index.html &amp;&amp; grep -q "events-list" data/dashboard/index.html &amp;&amp; echo OK</automated>
  </verify>
  <done>
- `renderHtml` интегрирован, `main()` пишет полный HTML
- `tsc --noEmit` чистый
- Файл `data/dashboard/index.html` >= 50 KB (вместе с inline DATA)
- В файле присутствуют: `id="data"`, `cdn.jsdelivr.net/npm/chart.js`, `chart-timeline`, `chart-sources`, `chart-categories`, `events-list`
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: npm script + .gitignore + ручная проверка в браузере</name>
  <what-built>
1. Добавить в `package.json` в секцию `"scripts"` строку:
   `"dashboard": "tsx scripts/build-dashboard.ts"`
   (без `--env-file=.env` — скрипт его не использует; и без `node --import tsx`,
    т.к. достаточно прямого `tsx`. Все остальные скрипты не трогать.)

2. Добавить в `.gitignore` под существующей секцией `# Runtime data archives`
   явное правило (на случай если data/ когда-нибудь раскоммитят):
   ```
   # Generated dashboard artifact (dev-tool, не версионируется)
   /data/dashboard/
   ```

3. Прогнать `npm run dashboard` и убедиться, что:
   - Команда завершается с кодом 0
   - В консоли видны строки `[dashboard] posts=N events=M range=...` и `[dashboard] wrote .../index.html (XXX.X KB)`
   - `git status` НЕ показывает `data/dashboard/` (gitignored)
  </what-built>
  <how-to-verify>
Откройте `data/dashboard/index.html` в браузере (двойной клик в Finder или
`open data/dashboard/index.html`). Проверьте:

1. Заголовок «Нефтегаз — дашборд парсинга» виден
2. Под заголовком — meta-строка вида `2026-04-27 — 2026-05-08 · N постов · M событий` и select с диапазонами
3. 3 графика отрисованы (line / bar / doughnut), все с непустыми данными
4. Лента событий показывает >= 20 элементов; у каждого видно: tag категории,
   опц. company-tag (если есть), summary, цитата, кликабельная ссылка
5. Смена селектора диапазона (7 / 30 / all) перерисовывает все 3 графика и meta
6. Поиск в ленте по слову (например, «Лукойл» или «нафта») сужает список
7. Фильтр по категории и фильтр по компании работают (можно сочетать)
8. Кликабельные ссылки открываются в новой вкладке (target=_blank)
9. В DevTools Console — нет красных ошибок (Chart.js network OK с CDN)
10. Файл открывается с file:// без HTTP-сервера

Если что-то из 1–10 не работает — отчитаться, какой пункт сломан, и предложить починку.
  </how-to-verify>
  <resume-signal>Напишите "approved" если всё ок, либо опишите проблему.</resume-signal>
</task>

</tasks>

<verification>
- `npx tsc --noEmit -p tsconfig.json` чистый
- `npm run dashboard` завершается с кодом 0
- `data/dashboard/index.html` существует, >= 50 KB
- Файл содержит: `id="data"`, `cdn.jsdelivr.net/npm/chart.js`, все 3 canvas-id, `events-list`
- `git status --porcelain | grep data/dashboard` — пусто (gitignored)
- Браузерная проверка пройдена (Task 3 checkpoint)
</verification>

<success_criteria>
- ОДИН npm-скрипт (`npm run dashboard`) собирает self-contained HTML
- Никаких новых runtime-зависимостей в package.json
- Pipeline (`src/`) не тронут
- HTML открывается через file:// и показывает 4 рабочих виджета
- Лента событий фильтруется по категории, компании и тексту
</success_criteria>

<output>
After completion, create `.planning/quick/260510-cla-static-dashboard-prototype/260510-cla-SUMMARY.md`
</output>
