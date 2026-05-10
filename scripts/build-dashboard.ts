// scripts/build-dashboard.ts
// Build a self-contained static dashboard (data/dashboard/index.html) from
// accumulated raw posts (data/raw/*.json) and rendered digests (data/output/*.md).
//
// Pure dev-tool: ZERO new runtime deps, only node:fs/promises + node:path,
// reuses src/paths.ts so DATA_DIR override works (e.g. against parent volume).
//
// Run:  npx tsx scripts/build-dashboard.ts   (or `npm run dashboard`)
// Out:  ${DATA_DIR:-./data}/dashboard/index.html  (gitignored)

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "../src/paths.js";

// ---------- Types ----------

type Source = "tg" | "web";

interface RawPost {
  username: string;
  messageId: number;
  text: string;
  date: string; // ISO
  url: string;
  source: Source;
  fileDate: string; // YYYY-MM-DD (MSK), из имени файла
}

type Category =
  | "Бункер"
  | "Масла"
  | "Керосин"
  | "Нефтехимия"
  | "Битум"
  | "Компании";

type CompanyTag = "ЛУКОЙЛ" | "РОСНЕФТЬ" | "ГПН";

const CATEGORIES: readonly Category[] = [
  "Бункер",
  "Масла",
  "Керосин",
  "Нефтехимия",
  "Битум",
  "Компании",
] as const;

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

// ---------- Filename parsing ----------

interface ParsedName {
  date: string; // YYYY-MM-DD
  source: Source;
}

function parseFileDate(
  filename: string,
  ext: "json" | "md",
): ParsedName | null {
  const re = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})(-web)?\\.${ext}$`);
  const m = re.exec(filename);
  if (!m) return null;
  return { date: m[1]!, source: m[2] ? "web" : "tg" };
}

// ---------- Loaders ----------

async function loadAllPosts(): Promise<RawPost[]> {
  let entries: string[];
  try {
    entries = await readdir(paths.rawDir);
  } catch (err) {
    console.warn(`[dashboard] cannot read rawDir=${paths.rawDir}: ${(err as Error).message}`);
    return [];
  }

  const out: RawPost[] = [];
  for (const name of entries) {
    const parsed = parseFileDate(name, "json");
    if (!parsed) continue;
    const full = path.join(paths.rawDir, name);
    let raw: unknown;
    try {
      const text = await readFile(full, "utf8");
      raw = JSON.parse(text);
    } catch (err) {
      console.warn(`[dashboard] skip broken raw file ${name}: ${(err as Error).message}`);
      continue;
    }
    if (!Array.isArray(raw)) {
      console.warn(`[dashboard] skip non-array raw file ${name}`);
      continue;
    }
    for (const item of raw as Array<Record<string, unknown>>) {
      if (
        typeof item?.["username"] !== "string" ||
        typeof item?.["text"] !== "string" ||
        typeof item?.["date"] !== "string" ||
        typeof item?.["url"] !== "string"
      ) {
        continue;
      }
      out.push({
        username: item["username"] as string,
        messageId: Number(item["messageId"] ?? 0),
        text: item["text"] as string,
        date: item["date"] as string,
        url: item["url"] as string,
        source: parsed.source,
        fileDate: parsed.date,
      });
    }
  }
  return out;
}

// Section header: tg digests use `<b>🛢 #Масла</b>`, web digests use `<b>🛢 Масла</b>` (no #).
// Plan regex required `#`, but real web data omits it — make it optional so
// web events are picked up too (Rule 1: bug fix — strict regex would silently drop ~half of events).
const SECTION_RE =
  /^<b>[^<]*?(Бункер|Масла|Керосин|Нефтехимия|Битум|Компании)<\/b>\s*$/;

const ITEM_RE =
  /^•\s+(?:<b>\[(ЛУКОЙЛ|РОСНЕФТЬ|ГПН)\]<\/b>\s+)?(.+?)\s+—\s+<i>«([\s\S]+?)»<\/i>\s+—\s+<a href="([^"]+)">@?([^<]+)<\/a>\s*$/;

const EMPTY_SECTION = "<i>— нет упоминаний за сутки</i>";

async function loadAllEvents(): Promise<DigestEvent[]> {
  let entries: string[];
  try {
    entries = await readdir(paths.outputDir);
  } catch (err) {
    console.warn(`[dashboard] cannot read outputDir=${paths.outputDir}: ${(err as Error).message}`);
    return [];
  }

  const out: DigestEvent[] = [];
  for (const name of entries) {
    const parsed = parseFileDate(name, "md");
    if (!parsed) continue;
    const full = path.join(paths.outputDir, name);
    let text: string;
    try {
      text = await readFile(full, "utf8");
    } catch (err) {
      console.warn(`[dashboard] skip broken digest ${name}: ${(err as Error).message}`);
      continue;
    }

    let currentCategory: Category | null = null;
    for (const lineRaw of text.split(/\r?\n/)) {
      const line = lineRaw.trimEnd();
      if (!line) continue;

      const sec = SECTION_RE.exec(line);
      if (sec) {
        const cat = sec[1] as Category;
        currentCategory = CATEGORIES.includes(cat) ? cat : null;
        continue;
      }

      if (line === EMPTY_SECTION) continue;
      if (!line.startsWith("• ")) continue;
      if (currentCategory == null) {
        console.warn(`[dashboard] item without section in ${name}: ${line.slice(0, 80)}`);
        continue;
      }

      const m = ITEM_RE.exec(line);
      if (!m) {
        console.warn(`[dashboard] unparsed: ${line.slice(0, 100)}`);
        continue;
      }
      const [, companyMaybe, summary, quote, url, label] = m;
      const sourceLabel = label!.startsWith("@") ? label! : `@${label!}`;

      out.push({
        fileDate: parsed.date,
        source: parsed.source,
        category: currentCategory,
        company: (companyMaybe as CompanyTag | undefined) ?? null,
        summary: summary!.trim(),
        quote: quote!.trim(),
        sourceUrl: url!,
        sourceLabel,
      });
    }
  }
  return out;
}

// ---------- Configs ----------

interface Configs {
  channels: string[];
  websites: string[];
}

async function loadConfigs(): Promise<Configs> {
  const channels = new Set<string>();
  const websites = new Set<string>();

  // channels.json + websites.json — seed-defaults в корне репо (CWD).
  // Not fatal if missing: dashboard все равно собирается из raw/output.
  try {
    const text = await readFile(path.resolve("./channels.json"), "utf8");
    const parsed = JSON.parse(text) as { channels?: Array<{ username?: string }> };
    for (const c of parsed.channels ?? []) {
      if (typeof c?.username === "string" && c.username) channels.add(c.username);
    }
  } catch (err) {
    console.warn(`[dashboard] channels.json not loaded: ${(err as Error).message}`);
  }

  try {
    const text = await readFile(path.resolve("./websites.json"), "utf8");
    const parsed = JSON.parse(text) as {
      websites?: Array<{ url?: string; name?: string }>;
    };
    for (const w of parsed.websites ?? []) {
      if (typeof w?.name === "string" && w.name) {
        websites.add(w.name);
      } else if (typeof w?.url === "string" && w.url) {
        try {
          websites.add(new URL(w.url).host);
        } catch {
          websites.add(w.url);
        }
      }
    }
  } catch (err) {
    console.warn(`[dashboard] websites.json not loaded: ${(err as Error).message}`);
  }

  return {
    channels: [...channels].sort(),
    websites: [...websites].sort(),
  };
}

// ---------- Aggregation ----------

async function buildData(): Promise<DashboardData> {
  const [posts, events, configs] = await Promise.all([
    loadAllPosts(),
    loadAllEvents(),
    loadConfigs(),
  ]);

  if (posts.length === 0 && events.length === 0) {
    throw new Error(
      `no data: rawDir=${paths.rawDir} outputDir=${paths.outputDir} are empty or missing. ` +
        `Run pipeline first or set DATA_DIR to a populated volume.`,
    );
  }

  const allDates = new Set<string>();
  for (const p of posts) allDates.add(p.fileDate);
  for (const e of events) allDates.add(e.fileDate);
  const sorted = [...allDates].sort();
  const from = sorted[0]!;
  const to = sorted[sorted.length - 1]!;

  return {
    generatedAt: new Date().toISOString(),
    dateRange: { from, to },
    posts,
    events,
    channels: configs.channels,
    websites: configs.websites,
  };
}

// ---------- HTML rendering ----------

const STYLES = `
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif; max-width: 1400px; margin: 0 auto; padding: 16px; color: #222; background: #fafafa; }
header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.card { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
.filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.filters input, .filters select { padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font: inherit; background: #fff; }
.filters input { flex: 1; min-width: 200px; }
#range { padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font: inherit; background: #fff; }
#events-list { list-style: none; padding: 0; max-height: 70vh; overflow-y: auto; margin: 0; }
#events-list li { padding: 10px 0; border-bottom: 1px solid #eee; }
#events-list li:last-child { border-bottom: none; }
#events-count { color: #666; font-size: 12px; margin-left: auto; }
.tag { display: inline-block; padding: 1px 6px; border-radius: 4px; background: #eef; font-size: 12px; margin-right: 6px; color: #234; }
.tag.company { background: #ffeed8; color: #6a3c00; }
.tag.source { background: #e8f5e9; color: #2e5a32; }
.summary { margin-top: 4px; }
.quote { color: #555; font-style: italic; margin: 4px 0; padding-left: 10px; border-left: 3px solid #ddd; }
.src { font-size: 12px; color: #888; }
.src a { color: #06c; text-decoration: none; }
.src a:hover { text-decoration: underline; }
canvas { max-height: 320px; }
h1 { margin: 0; font-size: 22px; }
h2 { margin: 0 0 12px; font-size: 16px; color: #333; }
.meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
#meta-info { color: #555; font-size: 13px; }
.empty { color: #999; padding: 16px; text-align: center; font-style: italic; }
`;

const APP_JS = `
(function () {
  "use strict";
  const dataEl = document.getElementById("data");
  const DATA = JSON.parse(dataEl.textContent);
  const CATEGORIES = ["Бункер","Масла","Керосин","Нефтехимия","Битум","Компании"];
  const CAT_COLORS = { "Бункер":"#4e79a7","Масла":"#f28e2c","Керосин":"#e15759","Нефтехимия":"#76b7b2","Битум":"#59a14f","Компании":"#edc949" };

  // Fill category filter dropdown.
  const fCat = document.getElementById("f-category");
  for (const c of CATEGORIES) {
    const o = document.createElement("option"); o.value = c; o.textContent = c; fCat.appendChild(o);
  }

  const state = { rangeDays: 30, category: "", company: "", search: "" };
  const charts = { timeline: null, sources: null, categories: null };

  function maxDate() {
    let m = "";
    for (const p of DATA.posts) if (p.fileDate > m) m = p.fileDate;
    for (const e of DATA.events) if (e.fileDate > m) m = e.fileDate;
    return m || DATA.dateRange.to || "";
  }
  function minusDays(ymd, days) {
    const d = new Date(ymd + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0,10);
  }
  function inRange(d) {
    if (state.rangeDays === "all") return true;
    const today = maxDate();
    if (!today) return true;
    const cutoff = minusDays(today, Number(state.rangeDays) - 1);
    return d >= cutoff && d <= today;
  }

  function uniqueSortedDates(items) {
    const s = new Set(); for (const it of items) s.add(it.fileDate);
    return Array.from(s).sort();
  }

  function renderTimeline(posts) {
    const labels = uniqueSortedDates(posts);
    const tg = labels.map(d => 0), web = labels.map(d => 0);
    const idx = new Map(labels.map((d,i)=>[d,i]));
    for (const p of posts) {
      const i = idx.get(p.fileDate); if (i == null) continue;
      if (p.source === "tg") tg[i]++; else web[i]++;
    }
    const ctx = document.getElementById("chart-timeline").getContext("2d");
    if (charts.timeline) charts.timeline.destroy();
    charts.timeline = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [
        { label: "Telegram", data: tg, borderColor: "#0088cc", backgroundColor: "rgba(0,136,204,0.1)", tension: 0.2, fill: true },
        { label: "Веб",      data: web, borderColor: "#7a3f9d", backgroundColor: "rgba(122,63,157,0.1)", tension: 0.2, fill: true },
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function renderSources(posts) {
    const counts = new Map();
    for (const p of posts) counts.set(p.username, (counts.get(p.username) || 0) + 1);
    const top = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,15);
    const labels = top.map(x=>x[0]); const data = top.map(x=>x[1]);
    const ctx = document.getElementById("chart-sources").getContext("2d");
    if (charts.sources) charts.sources.destroy();
    charts.sources = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Постов", data, backgroundColor: "#4e79a7" }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function renderCategoriesChart(events) {
    const counts = CATEGORIES.map(c => events.filter(e => e.category === c).length);
    const colors = CATEGORIES.map(c => CAT_COLORS[c]);
    const ctx = document.getElementById("chart-categories").getContext("2d");
    if (charts.categories) charts.categories.destroy();
    charts.categories = new Chart(ctx, {
      type: "doughnut",
      data: { labels: CATEGORIES, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 1, borderColor: "#fff" }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" } } }
    });
  }

  function filteredEvents() {
    const q = state.search;
    return DATA.events.filter(e => {
      if (!inRange(e.fileDate)) return false;
      if (state.category && e.category !== state.category) return false;
      if (state.company  && e.company  !== state.company ) return false;
      if (q) {
        const hay = (e.summary + " \\u0001 " + e.quote).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderEventsList(events) {
    const ul = document.getElementById("events-list");
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    document.getElementById("events-count").textContent = events.length + " событий";
    if (events.length === 0) {
      const li = document.createElement("li"); li.className = "empty"; li.textContent = "Ничего не найдено по фильтрам"; ul.appendChild(li);
      return;
    }
    // Sort newest first.
    const sorted = events.slice().sort((a,b) => a.fileDate < b.fileDate ? 1 : a.fileDate > b.fileDate ? -1 : 0);
    const frag = document.createDocumentFragment();
    for (const ev of sorted) {
      const li = document.createElement("li");

      const tagCat = document.createElement("span"); tagCat.className = "tag"; tagCat.textContent = ev.category; tagCat.style.background = (CAT_COLORS[ev.category] || "#eef") + "33"; tagCat.style.color = "#222";
      li.appendChild(tagCat);

      if (ev.company) {
        const tc = document.createElement("span"); tc.className = "tag company"; tc.textContent = ev.company; li.appendChild(tc);
      }
      const tagSrc = document.createElement("span"); tagSrc.className = "tag source"; tagSrc.textContent = ev.source === "web" ? "веб" : "tg"; li.appendChild(tagSrc);

      const tagDate = document.createElement("span"); tagDate.className = "tag"; tagDate.textContent = ev.fileDate; li.appendChild(tagDate);

      const summary = document.createElement("div"); summary.className = "summary"; summary.textContent = ev.summary; li.appendChild(summary);

      const quote = document.createElement("div"); quote.className = "quote"; quote.textContent = "«" + ev.quote + "»"; li.appendChild(quote);

      const srcDiv = document.createElement("div"); srcDiv.className = "src";
      const a = document.createElement("a"); a.href = ev.sourceUrl; a.textContent = ev.sourceLabel; a.target = "_blank"; a.rel = "noopener noreferrer";
      srcDiv.appendChild(a);
      li.appendChild(srcDiv);

      frag.appendChild(li);
    }
    ul.appendChild(frag);
  }

  function recompute() {
    const posts = DATA.posts.filter(p => inRange(p.fileDate));
    const events = filteredEvents();
    const eventsRange = DATA.events.filter(e => inRange(e.fileDate));
    renderTimeline(posts);
    renderSources(posts);
    renderCategoriesChart(eventsRange);
    renderEventsList(events);
    document.getElementById("meta-info").textContent =
      DATA.dateRange.from + " — " + DATA.dateRange.to + " · " + posts.length + " постов · " + eventsRange.length + " событий в окне";
  }

  function debounce(fn, ms) {
    let t = null;
    return function (e) { if (t) clearTimeout(t); t = setTimeout(() => fn(e), ms); };
  }

  document.getElementById("range").addEventListener("change", function (e) {
    state.rangeDays = e.target.value === "all" ? "all" : Number(e.target.value);
    recompute();
  });
  document.getElementById("f-category").addEventListener("change", function (e) {
    state.category = e.target.value; renderEventsList(filteredEvents());
  });
  document.getElementById("f-company").addEventListener("change", function (e) {
    state.company = e.target.value; renderEventsList(filteredEvents());
  });
  document.getElementById("f-search").addEventListener("input", debounce(function (e) {
    state.search = e.target.value.toLowerCase(); renderEventsList(filteredEvents());
  }, 150));

  // Set default range selector to 30 (matches state.rangeDays).
  document.getElementById("range").value = "30";
  recompute();
})();
`;

function renderHtml(data: DashboardData): string {
  // CRITICAL: do NOT inline JSON via template substitution that could collide
  // with `</script>` inside post text. Embed in <script type="application/json">
  // and escape `</` -> `<\/` in the payload — JSON.parse handles it transparently.
  const payload = JSON.stringify(data).replaceAll("</", "<\\/");

  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<title>tg-parser dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLES}</style>
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
  <div class="card"><h2>Посты по дням (tg vs веб)</h2><canvas id="chart-timeline"></canvas></div>
  <div class="card"><h2>Топ-15 источников</h2><canvas id="chart-sources"></canvas></div>
  <div class="card"><h2>Распределение по категориям</h2><canvas id="chart-categories"></canvas></div>
  <div class="card">
    <h2>Сводка</h2>
    <p style="color:#555;">Каналов в seed: ${data.channels.length}<br>Веб-источников в seed: ${data.websites.length}<br>Сгенерировано: ${data.generatedAt}</p>
  </div>
</section>

<section class="card">
  <h2>Лента событий</h2>
  <div class="filters">
    <select id="f-category"><option value="">Все категории</option></select>
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
<script id="data" type="application/json">${payload}</script>
<script>${APP_JS}</script>
</body></html>
`;
}

// ---------- Main ----------

async function main(): Promise<void> {
  const data = await buildData();
  console.log(
    `[dashboard] posts=${data.posts.length} events=${data.events.length} ` +
      `range=${data.dateRange.from}..${data.dateRange.to}`,
  );

  const html = renderHtml(data);
  const outDir = path.join(paths.dataDir, "dashboard");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "index.html");
  await writeFile(outFile, html, "utf8");
  console.log(
    `[dashboard] wrote ${outFile} (${(html.length / 1024).toFixed(1)} KB)`,
  );
}

main().catch((err: unknown) => {
  console.error("[dashboard] FATAL:", err);
  process.exit(1);
});
