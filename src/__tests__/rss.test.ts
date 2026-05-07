// src/__tests__/rss.test.ts — Vitest для RSS / Atom flow (Phase 4).
// Покрывает: normalizeFeedItems на RSS 2.0 + Atom 1.0, отброс items без даты,
// CDATA / HTML-entities в title/description, fetchRssAsPosts date-фильтр через
// мок fetchSite + override Date.now(), маппинг RSS-item → Post.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { normalizeFeedItems, fetchRssAsPosts } from "../rss.js";
import * as webScraper from "../web-scraper.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  trimValues: true,
  removeNSPrefix: true,
});

// =============================================================================
// normalizeFeedItems — детект формата + извлечение полей
// =============================================================================
describe("normalizeFeedItems", () => {
  it("RSS 2.0: parses <item> with title, link, description, pubDate", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Test news</title>
      <link>https://example.com/news/1</link>
      <description>Description text</description>
      <pubDate>Wed, 07 May 2026 09:00:00 +0300</pubDate>
    </item>
  </channel>
</rss>`;
    const items = normalizeFeedItems(parser.parse(xml));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Test news");
    expect(items[0].link).toBe("https://example.com/news/1");
    expect(items[0].description).toBe("Description text");
    expect(items[0].pubDate.toISOString()).toBe("2026-05-07T06:00:00.000Z");
  });

  it("Atom 1.0: parses <entry> with link href= and published= and summary", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom news</title>
    <link rel="alternate" href="https://example.com/atom/1"/>
    <summary>Atom summary</summary>
    <published>2026-05-07T09:00:00+03:00</published>
  </entry>
</feed>`;
    const items = normalizeFeedItems(parser.parse(xml));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Atom news");
    expect(items[0].link).toBe("https://example.com/atom/1");
    expect(items[0].description).toBe("Atom summary");
    expect(items[0].pubDate.toISOString()).toBe("2026-05-07T06:00:00.000Z");
  });

  it("RSS: drops items without parseable pubDate", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>No date</title>
      <link>https://example.com/x</link>
    </item>
  </channel>
</rss>`;
    expect(normalizeFeedItems(parser.parse(xml))).toEqual([]);
  });

  it("RSS: drops items without title or link", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <link>https://example.com/x</link>
      <pubDate>Wed, 07 May 2026 09:00:00 +0300</pubDate>
    </item>
    <item>
      <title>No link</title>
      <pubDate>Wed, 07 May 2026 09:00:00 +0300</pubDate>
    </item>
  </channel>
</rss>`;
    expect(normalizeFeedItems(parser.parse(xml))).toEqual([]);
  });

  it("CDATA: extracts content from <description><![CDATA[...]]>", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>X</title>
      <link>https://example.com/x</link>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
      <pubDate>Wed, 07 May 2026 09:00:00 +0300</pubDate>
    </item>
  </channel>
</rss>`;
    const items = normalizeFeedItems(parser.parse(xml));
    expect(items[0].description).toBe("Hello world");
  });

  it("HTML stripping: removes tags and decodes basic entities", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>X</title>
      <link>https://example.com/x</link>
      <description>&lt;p&gt;Hello &amp; bye&lt;/p&gt;</description>
      <pubDate>Wed, 07 May 2026 09:00:00 +0300</pubDate>
    </item>
  </channel>
</rss>`;
    const items = normalizeFeedItems(parser.parse(xml));
    expect(items[0].description).toBe("Hello & bye");
  });

  it("Atom: <content> fallback when no <summary>", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>X</title>
    <link rel="alternate" href="https://example.com/x"/>
    <content>Long content here</content>
    <published>2026-05-07T09:00:00+03:00</published>
  </entry>
</feed>`;
    const items = normalizeFeedItems(parser.parse(xml));
    expect(items[0].description).toBe("Long content here");
  });

  it("returns empty for unknown format (no warn-throw)", () => {
    expect(normalizeFeedItems(parser.parse("<?xml version='1.0'?><root><foo>bar</foo></root>"))).toEqual([]);
  });

  it("returns empty for non-object input", () => {
    expect(normalizeFeedItems(null)).toEqual([]);
    expect(normalizeFeedItems(undefined)).toEqual([]);
    expect(normalizeFeedItems("not xml")).toEqual([]);
  });
});

// =============================================================================
// fetchRssAsPosts — мок fetchSite, проверяем date-фильтр + маппинг в Post
// =============================================================================
describe("fetchRssAsPosts", () => {
  const NOW = new Date("2026-05-07T09:00:00.000Z").getTime(); // anchor: today MSK ~12:00

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.WEB_RSS_WINDOW_HOURS;
  });

  it("filters items older than 24h (default window)", async () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Fresh</title>
      <link>https://example.com/fresh</link>
      <description>Fresh description</description>
      <pubDate>2026-05-07T08:00:00Z</pubDate>
    </item>
    <item>
      <title>Stale</title>
      <link>https://example.com/stale</link>
      <description>Stale description</description>
      <pubDate>2022-03-15T12:00:00Z</pubDate>
    </item>
  </channel>
</rss>`;
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue(xml);

    const posts = await fetchRssAsPosts({
      url: "https://example.com",
      name: "example",
      rss: "https://example.com/rss",
    });

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://example.com/fresh");
    expect(posts[0].channelUsername).toBe("example");
    expect(posts[0].text).toContain("Fresh");
    expect(posts[0].text).toContain("Fresh description");
  });

  it("returns [] when feed has 0 items in window", async () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Old</title><link>https://example.com/old</link>
    <pubDate>2020-01-01T00:00:00Z</pubDate>
  </item>
</channel></rss>`;
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue(xml);

    const posts = await fetchRssAsPosts({
      url: "https://example.com",
      rss: "https://example.com/rss",
    });
    expect(posts).toEqual([]);
  });

  it("WEB_RSS_WINDOW_HOURS overrides default", async () => {
    // 48-час окно — захватывает item возрастом 30h, который дефолтные 24h отбросили бы.
    process.env.WEB_RSS_WINDOW_HOURS = "48";
    const thirtyHoursAgo = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>30h old</title><link>https://example.com/x</link>
    <pubDate>${thirtyHoursAgo}</pubDate>
  </item>
</channel></rss>`;
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue(xml);

    const posts = await fetchRssAsPosts({
      url: "https://example.com",
      rss: "https://example.com/rss",
    });
    expect(posts).toHaveLength(1);
  });

  it("text = title + description joined by \\n\\n", async () => {
    const fresh = new Date(NOW - 60 * 60 * 1000).toISOString();
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Заголовок</title>
    <link>https://example.com/x</link>
    <description>Подробности</description>
    <pubDate>${fresh}</pubDate>
  </item>
</channel></rss>`;
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue(xml);

    const posts = await fetchRssAsPosts({
      url: "https://example.com",
      rss: "https://example.com/rss",
    });
    expect(posts[0].text).toBe("Заголовок\n\nПодробности");
  });

  it("text = title only when description empty", async () => {
    const fresh = new Date(NOW - 60 * 60 * 1000).toISOString();
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Только заголовок</title>
    <link>https://example.com/x</link>
    <pubDate>${fresh}</pubDate>
  </item>
</channel></rss>`;
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue(xml);

    const posts = await fetchRssAsPosts({
      url: "https://example.com",
      rss: "https://example.com/rss",
    });
    expect(posts[0].text).toBe("Только заголовок");
  });

  it("messageId is stable hash of link (non-zero, deterministic)", async () => {
    const fresh = new Date(NOW - 60 * 60 * 1000).toISOString();
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>X</title><link>https://example.com/news/abc</link>
    <pubDate>${fresh}</pubDate>
  </item>
</channel></rss>`;
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue(xml);

    const a = await fetchRssAsPosts({ url: "https://example.com", rss: "https://example.com/rss" });
    const b = await fetchRssAsPosts({ url: "https://example.com", rss: "https://example.com/rss" });
    expect(a[0].messageId).toBeGreaterThan(0);
    expect(a[0].messageId).toBe(b[0].messageId);
  });

  it("channelUsername falls back to hostname when name not set", async () => {
    const fresh = new Date(NOW - 60 * 60 * 1000).toISOString();
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>X</title><link>https://x.com/news</link>
    <pubDate>${fresh}</pubDate>
  </item>
</channel></rss>`;
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue(xml);

    const posts = await fetchRssAsPosts({
      url: "https://www.example.com",
      rss: "https://www.example.com/rss",
    });
    expect(posts[0].channelUsername).toBe("example.com");
  });

  it("returns [] on unrecognized content (parser tolerates garbage, normalize finds 0 items)", async () => {
    // fast-xml-parser is lenient — it doesn't throw on arbitrary text. We rely on
    // normalizeFeedItems to detect the absence of <rss>/<feed> root and return [].
    // Behaviorally this means a broken feed skips that site, doesn't blow up the whole run.
    vi.spyOn(webScraper, "fetchSite").mockResolvedValue("<<<not-xml>>>");

    const posts = await fetchRssAsPosts({
      url: "https://example.com",
      rss: "https://example.com/rss",
    });
    expect(posts).toEqual([]);
  });

  it("throws when site.rss not set (programming error)", async () => {
    await expect(
      fetchRssAsPosts({ url: "https://example.com" })
    ).rejects.toThrow(/site\.rss/);
  });
});
