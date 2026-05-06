import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  verifyExtractiveness,
  renderHtml,
  groupByBucket,
  chunkArray,
} from "../summarize.js";
import type { Post, DigestJson, DigestItem } from "../types.js";
import type { ClassificationEntry } from "../summarize.js";

// ---------------------------------------------------------------------------
// Minimal test fixtures helpers
// ---------------------------------------------------------------------------

function makePost(overrides: Partial<Post> & { url: string; text: string }): Post {
  return {
    channelUsername: "testchannel",
    messageId: 1,
    postedAt: "2026-05-04T10:00:00Z",
    ...overrides,
  };
}

function makeItem(overrides: Partial<DigestItem> & { url: string; keyQuote: string }): DigestItem {
  return {
    category: "bunker",
    summary: "Test summary",
    channel: "testchannel",
    mentions: [],
    ...overrides,
  };
}

function makeDigest(overrides: Partial<DigestJson> = {}): DigestJson {
  return {
    generatedAt: "2026-05-04T10:00:00Z",
    bunker: [],
    oil: [],
    kerosene: [],
    petrochem: [],
    bitumen: [],
    mentions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// describe("escapeHtml")
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("escapes & to &amp;", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes < to &lt; and > to &gt;", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("leaves quotes unchanged", () => {
    expect(escapeHtml('"hello"')).toBe('"hello"');
  });

  it("escapes combined HTML: <b>&</b>", () => {
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});

// ---------------------------------------------------------------------------
// describe("verifyExtractiveness")
// ---------------------------------------------------------------------------

describe("verifyExtractiveness", () => {
  it("keeps item when keyQuote is exact substring of post.text", () => {
    const post = makePost({ url: "https://t.me/channel/1", text: "Цена нефти выросла на 5%." });
    const item = makeItem({ url: "https://t.me/channel/1", keyQuote: "Цена нефти выросла" });
    const digest = makeDigest({ bunker: [item] });

    const { digest: result, droppedCount } = verifyExtractiveness(digest, [post]);

    expect(droppedCount).toBe(0);
    expect(result.bunker).toHaveLength(1);
    expect(result.bunker[0]).toEqual(item);
  });

  it("drops item when keyQuote is NOT a substring of post.text", () => {
    const post = makePost({ url: "https://t.me/channel/2", text: "Обычный пост без совпадений." });
    const item = makeItem({ url: "https://t.me/channel/2", keyQuote: "этого текста нет в посте" });
    const digest = makeDigest({ bunker: [item] });

    const { digest: result, droppedCount } = verifyExtractiveness(digest, [post]);

    expect(droppedCount).toBe(1);
    expect(result.bunker).toHaveLength(0);
  });

  it("drops item when url is not found in posts map", () => {
    const post = makePost({ url: "https://t.me/channel/3", text: "Некий текст." });
    const item = makeItem({ url: "https://t.me/channel/999", keyQuote: "Некий текст" });
    const digest = makeDigest({ bunker: [item] });

    const { digest: result, droppedCount } = verifyExtractiveness(digest, [post]);

    expect(droppedCount).toBe(1);
    expect(result.bunker).toHaveLength(0);
  });

  it("handles multiple items across categories: drops only invalid, keeps valid", () => {
    const post1 = makePost({ url: "https://t.me/ch/1", text: "Авиакеросин подорожал." });
    const post2 = makePost({ url: "https://t.me/ch/2", text: "Мазут в Новороссийске." });

    const validItem = makeItem({
      url: "https://t.me/ch/1",
      keyQuote: "Авиакеросин подорожал",
      category: "kerosene",
    });
    const invalidItem = makeItem({
      url: "https://t.me/ch/2",
      keyQuote: "этого нет в тексте",
      category: "bunker",
    });

    const digest = makeDigest({ kerosene: [validItem], bunker: [invalidItem] });

    const { digest: result, droppedCount } = verifyExtractiveness(digest, [post1, post2]);

    expect(droppedCount).toBe(1);
    expect(result.kerosene).toHaveLength(1);
    expect(result.bunker).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// describe("renderHtml")
// ---------------------------------------------------------------------------

describe("renderHtml", () => {
  const posts: Post[] = [
    makePost({ url: "https://t.me/ch1/1", channelUsername: "ch1", text: "Бункер текст" }),
    makePost({ url: "https://t.me/ch1/2", channelUsername: "ch1", text: "Второй пост" }),
    makePost({ url: "https://t.me/ch2/1", channelUsername: "ch2", text: "Третий пост" }),
  ];

  const bunkerItem: DigestItem = {
    category: "bunker",
    summary: "Бункер подорожал",
    keyQuote: "Бункер текст",
    url: "https://t.me/ch1/1",
    channel: "ch1",
    mentions: ["rosneft"],
  };

  const digest = makeDigest({ bunker: [bunkerItem] });

  it("header contains post count and channel count", () => {
    const html = renderHtml(digest, posts);
    expect(html).toContain("3 постов из 2 каналов за 24ч");
  });

  it("empty category shows placeholder text", () => {
    const html = renderHtml(digest, posts);
    expect(html).toContain("<i>— нет упоминаний за сутки</i>");
  });

  it("renders mention prefix [РОСНЕФТЬ] for item with rosneft mention", () => {
    const html = renderHtml(digest, posts);
    expect(html).toContain("<b>[РОСНЕФТЬ]</b>");
  });

  it("renders deep link <a href=...> for the item", () => {
    const html = renderHtml(digest, posts);
    expect(html).toContain('<a href="https://t.me/ch1/1">');
  });
});

// ---------------------------------------------------------------------------
// describe("groupByBucket")
// ---------------------------------------------------------------------------

describe("groupByBucket", () => {
  const post1 = makePost({ url: "https://t.me/ch/1", channelUsername: "ch", text: "Bunker text" });
  const post2 = makePost({ url: "https://t.me/ch/2", channelUsername: "ch", text: "Oil text", messageId: 2 });
  const post3 = makePost({ url: "https://t.me/ch/3", channelUsername: "ch", text: "Rosneft text", messageId: 3 });
  const post4 = makePost({ url: "https://t.me/ch/4", channelUsername: "ch", text: "Irrelevant", messageId: 4 });
  const post5 = makePost({ url: "https://t.me/ch/5", channelUsername: "ch", text: "Not classified", messageId: 5 });

  const classifications: ClassificationEntry[] = [
    { url: "https://t.me/ch/1", category: "bunker", mentions: [] },
    { url: "https://t.me/ch/2", category: "oil", mentions: ["rosneft"] },
    { url: "https://t.me/ch/3", category: null, mentions: ["lukoil"] },
    { url: "https://t.me/ch/4", category: null, mentions: [] },
    // post5 has no classification entry at all
  ];

  const posts = [post1, post2, post3, post4, post5];

  it("routes post with category=bunker to bunker bucket", () => {
    const buckets = groupByBucket(classifications, posts);
    expect(buckets.get("bunker")).toEqual([post1]);
  });

  it("routes post with category=oil to oil bucket", () => {
    const buckets = groupByBucket(classifications, posts);
    expect(buckets.get("oil")).toEqual([post2]);
  });

  it("routes post with category=null and mentions=[lukoil] to mentions bucket", () => {
    const buckets = groupByBucket(classifications, posts);
    expect(buckets.get("mentions")).toEqual([post3]);
  });

  it("excludes post with category=null and empty mentions from all buckets", () => {
    const buckets = groupByBucket(classifications, posts);
    for (const [, bucket] of buckets) {
      expect(bucket).not.toContain(post4);
    }
  });

  it("excludes post with no classification entry from all buckets", () => {
    const buckets = groupByBucket(classifications, posts);
    for (const [, bucket] of buckets) {
      expect(bucket).not.toContain(post5);
    }
  });

  it("kerosene, petrochem, bitumen buckets are empty", () => {
    const buckets = groupByBucket(classifications, posts);
    expect(buckets.get("kerosene")).toEqual([]);
    expect(buckets.get("petrochem")).toEqual([]);
    expect(buckets.get("bitumen")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// describe("chunkArray")
// ---------------------------------------------------------------------------

describe("chunkArray", () => {
  it("returns empty array when input is empty", () => {
    expect(chunkArray([], 5)).toEqual([]);
  });

  it("returns single chunk when size > length", () => {
    expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("splits exactly when length is divisible by size", () => {
    expect(chunkArray([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("places remainder in last chunk", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("works with size=1 (one element per chunk)", () => {
    expect(chunkArray([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("throws on size=0", () => {
    expect(() => chunkArray([1, 2, 3], 0)).toThrow(/positive finite number/);
  });

  it("throws on negative size", () => {
    expect(() => chunkArray([1, 2, 3], -1)).toThrow(/positive finite number/);
  });

  it("throws on NaN size", () => {
    expect(() => chunkArray([1, 2, 3], NaN)).toThrow(/positive finite number/);
  });
});
