// scripts/discover-rss.ts — попытка найти RSS/Atom feed для каждого сайта
// в websites.json, у которого ещё нет поля `rss`.
// Запуск: `npm run discover:rss` (--env-file=.env подцепляется npm-скриптом).
//
// Что делает:
//   1) читает websites.json (без модификации);
//   2) для каждой записи без поля `rss`:
//      a) GET site.url, парсит <head><link rel="alternate" type="application/rss+xml|atom+xml">;
//      b) если не нашлось — пробует guess-кандидаты (/rss, /feed, /rss.xml, /feed.xml,
//         /news/rss, /rss/news/, /feed/, /atom.xml);
//      c) каждого кандидата валидирует: GET, проверка content-type или корня XML
//         (<?xml…><rss>… или <feed>…);
//   3) печатает одну строку JSON-fragment на каждый найденный feed — оператор
//      сам копирует в websites.json. **Файл не модифицируется.**
//
// Что НЕ делает:
//   - не трогает websites.json — всё чисто advisory;
//   - не пытается распарсить feed как pipelines (это уже делает src/rss.ts);
//   - не интегрируется с runtime — отдельная утилита.
//
// Зачем без write: feed может оказаться неподходящим (пресс-релизы блога вместо
// корпоративных новостей, низкое качество, иной язык) — оператор должен принять
// решение, а не доверить автоматике.

import { readFileSync } from "node:fs";
import { setTimeout as sleepMs } from "node:timers/promises";
import * as cheerio from "cheerio";
import { WebsitesFileSchema, isSafePublicUrl } from "../src/schema.js";

interface Candidate {
  url: string;
  source: string; // "head-link" | "guess /rss" | …
}

const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Inter-request pause to avoid hammering hosts. We hit each host ≤2 times
// (homepage + best candidate), so 800ms is plenty.
const PAUSE_BETWEEN_SITES_MS = 800;

// =============================================================================
// fetchWithTimeout — minimal SSRF-respecting fetch (host validated by caller).
// Возвращает { status, contentType, body } или throw.
// =============================================================================
async function fetchWithTimeout(
  url: string
): Promise<{ status: number; contentType: string; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "user-agent": USER_AGENT, "accept": "*/*" },
      signal: controller.signal,
      redirect: "follow", // Discovery — допускаем follow (за безопасностью следит isSafePublicUrl на каждом кандидате).
    });
    const body = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Извлекаем <link rel="alternate" type="application/{rss|atom}+xml">
// из <head> главной страницы.
// =============================================================================
function findHeadLinks(html: string, baseUrl: string): Candidate[] {
  const out: Candidate[] = [];
  try {
    const $ = cheerio.load(html);
    $("link[rel='alternate']").each((_i, el) => {
      const type = String($(el).attr("type") ?? "").toLowerCase();
      const href = String($(el).attr("href") ?? "").trim();
      if (!href) return;
      if (
        type.includes("application/rss+xml") ||
        type.includes("application/atom+xml") ||
        type.includes("application/feed+json")
      ) {
        try {
          const abs = new URL(href, baseUrl).toString();
          if (isSafePublicUrl(abs)) out.push({ url: abs, source: "head-link" });
        } catch {
          // bad href — skip
        }
      }
    });
  } catch {
    // bad html — skip
  }
  return out;
}

// =============================================================================
// Список «угадаек» — типичные пути для RSS у новостных сайтов.
// =============================================================================
const GUESS_PATHS = [
  "/rss",
  "/feed",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/rss/news.xml",
  "/rss/news/",
  "/news/rss",
  "/news/rss/",
  "/feed/news",
  "/feeds/news.xml",
  "/feeds/all.xml",
];

function buildGuessCandidates(siteUrl: string): Candidate[] {
  try {
    const u = new URL(siteUrl);
    const origin = `${u.protocol}//${u.host}`;
    return GUESS_PATHS.map((p) => ({ url: origin + p, source: `guess ${p}` }));
  } catch {
    return [];
  }
}

// =============================================================================
// looksLikeFeed — детект по content-type или по сигнатуре XML root.
// =============================================================================
function looksLikeFeed(contentType: string, body: string): boolean {
  const ct = contentType.toLowerCase();
  if (
    ct.includes("application/rss+xml") ||
    ct.includes("application/atom+xml") ||
    ct.includes("application/xml") ||
    ct.includes("text/xml")
  ) {
    return true;
  }
  // Эвристика по содержимому: первые ~500 байт должны содержать <rss или <feed.
  const head = body.slice(0, 500).toLowerCase();
  return /<rss[\s>]/.test(head) || /<feed[\s>]/.test(head);
}

// =============================================================================
// validateCandidate — fetch + check. Возвращает true если url отдаёт что-то
// похожее на feed.
// =============================================================================
async function validateCandidate(c: Candidate): Promise<boolean> {
  if (!isSafePublicUrl(c.url)) return false;
  try {
    const res = await fetchWithTimeout(c.url);
    if (res.status >= 400) return false;
    if (res.body.length < 50) return false; // empty / placeholder
    return looksLikeFeed(res.contentType, res.body);
  } catch {
    return false;
  }
}

// =============================================================================
// discoverFeed — для одного сайта возвращает первый валидный feed-URL или null.
// =============================================================================
async function discoverFeed(siteUrl: string): Promise<Candidate | null> {
  // 1) Тащим homepage и парсим <head>.
  let head: Candidate[] = [];
  try {
    const home = await fetchWithTimeout(siteUrl);
    if (home.status < 400 && home.body) {
      head = findHeadLinks(home.body, siteUrl);
    }
  } catch {
    // не смогли скачать — переходим к guess.
  }

  // Сначала проверяем head-link'и (они достовернее).
  for (const c of head) {
    if (await validateCandidate(c)) return c;
  }

  // 2) Guess-кандидаты — последовательно (no parallel, чтобы не задудосить хост).
  const guesses = buildGuessCandidates(siteUrl);
  for (const c of guesses) {
    if (await validateCandidate(c)) return c;
  }

  return null;
}

// =============================================================================
// main
// =============================================================================
async function main(): Promise<void> {
  const raw = readFileSync("./websites.json", "utf8");
  const parsed = JSON.parse(raw);
  const validated = WebsitesFileSchema.parse(parsed);

  const candidates = validated.websites.filter((w) => !w.rss);
  console.log(
    `[discover-rss] websites.json: ${validated.websites.length} total, ${candidates.length} without rss`
  );
  if (candidates.length === 0) {
    console.log("[discover-rss] all sites already have rss — nothing to do");
    return;
  }

  const found: Array<{ name?: string; url: string; rss: string; source: string }> = [];
  const notFound: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const site = candidates[i]!;
    const label = site.name ?? new URL(site.url).hostname.replace(/^www\./, "");
    process.stdout.write(`[${i + 1}/${candidates.length}] ${label} (${site.url}) ... `);
    const result = await discoverFeed(site.url);
    if (result) {
      console.log(`✓ ${result.url} (${result.source})`);
      found.push({
        name: site.name,
        url: site.url,
        rss: result.url,
        source: result.source,
      });
    } else {
      console.log("✗ not found");
      notFound.push(label);
    }
    if (i < candidates.length - 1) await sleepMs(PAUSE_BETWEEN_SITES_MS);
  }

  console.log("");
  console.log("───────────────────────────────────────────────────────────────");
  console.log(`Found: ${found.length}/${candidates.length}`);
  console.log("───────────────────────────────────────────────────────────────");

  if (found.length > 0) {
    console.log("");
    console.log("Skopируй нужные строки в websites.json (добавь поле rss к существующей записи):");
    console.log("");
    for (const f of found) {
      const namePart = f.name ? `"name": "${f.name}", ` : "";
      console.log(
        `  { "url": "${f.url}", ${namePart}"rss": "${f.rss}" },  // discovered via ${f.source}`
      );
    }
    console.log("");
  }

  if (notFound.length > 0) {
    console.log(`Без feed (${notFound.length}): ${notFound.join(", ")}`);
    console.log(
      "Эти сайты остаются на HTML-flow. Можно проверить вручную (Ctrl-F 'rss' в исходнике страницы)."
    );
  }
}

main().catch((err) => {
  console.error("[discover-rss] fatal:", err);
  process.exit(1);
});
