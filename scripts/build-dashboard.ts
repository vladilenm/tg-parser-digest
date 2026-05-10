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

// ---------- Main (Task 1: stub output; Task 2 will replace with full HTML) ----------

async function main(): Promise<void> {
  const data = await buildData();
  console.log(
    `[dashboard] posts=${data.posts.length} events=${data.events.length} ` +
      `range=${data.dateRange.from}..${data.dateRange.to}`,
  );

  const outDir = path.join(paths.dataDir, "dashboard");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "index.html");

  await writeFile(
    outFile,
    `<!-- stub: ${data.events.length} events, ${data.posts.length} posts -->`,
    "utf8",
  );
  console.log(`[dashboard] wrote ${outFile}`);
}

main().catch((err: unknown) => {
  console.error("[dashboard] FATAL:", err);
  process.exit(1);
});
