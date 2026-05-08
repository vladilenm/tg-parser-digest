// src/__tests__/web-posts-cache.test.ts — Vitest для quick-260508-juw.
// Покрывает: compositeHash determinism, load missing/corrupt/wrong-shape/valid,
// merge dedup + same-url-different-text + ts preservation, save round-trip + atomic + mkdir.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock logger before importing the module under test, so log.warn / log.info
// can be asserted. Keep the same surface shape as ../logger.ts.
vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { log } from "../logger.js";
import {
  compositeHash,
  loadDailyWebPostsCache,
  mergeWebPostsByCompositeHash,
  saveDailyWebPostsCache,
  todayMsk,
  type CachedWebPost,
} from "../web-posts-cache.js";
import type { Post } from "../types.js";

const MSK_DATE = "2026-05-08";
const cachePath = (mskDate: string) => `./data/web-posts-${mskDate}.json`;

let workDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "web-posts-cache-"));
  process.chdir(workDir);
  vi.mocked(log.info).mockClear();
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.error).mockClear();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
});

// =============================================================================
// Test 1 — compositeHash determinism + 64-hex-char output
// =============================================================================
describe("compositeHash", () => {
  it("is deterministic for same (url, text)", () => {
    expect(compositeHash("https://x.com/", "hello world")).toBe(
      compositeHash("https://x.com/", "hello world")
    );
  });

  it("differs when text changes", () => {
    expect(compositeHash("https://x.com/", "t1")).not.toBe(
      compositeHash("https://x.com/", "t2")
    );
  });

  it("differs when url changes", () => {
    expect(compositeHash("https://x.com/a", "t")).not.toBe(
      compositeHash("https://x.com/b", "t")
    );
  });

  it("returns 64-char hex sha256 string", () => {
    const h = compositeHash("https://x.com/", "hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// =============================================================================
// Test 2 — load missing file: returns [], no log.warn
// =============================================================================
describe("loadDailyWebPostsCache (missing/corrupt/valid)", () => {
  it("returns [] for missing file with no log.warn", () => {
    const result = loadDailyWebPostsCache(MSK_DATE);
    expect(result).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  // Test 3 — corrupt JSON triggers log.warn + returns []
  it("returns [] and logs warn on corrupt JSON", () => {
    mkdirSync("./data", { recursive: true });
    writeFileSync(cachePath(MSK_DATE), "{ this is not json", "utf8");
    const result = loadDailyWebPostsCache(MSK_DATE);
    expect(result).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  // Test 4 — wrong-shape (posts not array) returns [] + log.warn
  it("returns [] and logs warn on wrong-shape file (posts not array)", () => {
    mkdirSync("./data", { recursive: true });
    writeFileSync(
      cachePath(MSK_DATE),
      JSON.stringify({ version: 2, posts: "not-an-array" }),
      "utf8"
    );
    const result = loadDailyWebPostsCache(MSK_DATE);
    expect(result).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  // Test 5 — valid 2-post file round-trips
  it("returns posts from a valid file with all fields preserved", () => {
    const posts: CachedWebPost[] = [
      {
        url: "https://a.com/1",
        text: "alpha",
        channelUsername: "a.com",
        ts: "2026-05-08T10:00:00.000Z",
        hash: compositeHash("https://a.com/1", "alpha"),
      },
      {
        url: "https://b.com/2",
        text: "beta",
        channelUsername: "b.com",
        ts: "2026-05-08T11:00:00.000Z",
        hash: compositeHash("https://b.com/2", "beta"),
      },
    ];
    mkdirSync("./data", { recursive: true });
    writeFileSync(
      cachePath(MSK_DATE),
      JSON.stringify({ version: 1, msk_date: MSK_DATE, posts }, null, 2),
      "utf8"
    );

    const result = loadDailyWebPostsCache(MSK_DATE);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(posts[0]);
    expect(result[1]).toEqual(posts[1]);
  });
});

// =============================================================================
// Test 6/7/8 — merge semantics
// =============================================================================
describe("mergeWebPostsByCompositeHash", () => {
  const makePost = (url: string, text: string, channelUsername = "x.com"): Post => ({
    channelUsername,
    messageId: 0,
    postedAt: "2026-05-08T17:00:00.000Z",
    text,
    url,
  });

  // Test 6 — dedup on same url+text
  it("dedups when fresh contains a post identical (url+text) to existing", () => {
    const existing: CachedWebPost[] = [
      {
        url: "https://a.com/1",
        text: "alpha",
        channelUsername: "a.com",
        ts: "2026-05-08T10:00:00.000Z",
        hash: compositeHash("https://a.com/1", "alpha"),
      },
    ];
    const fresh: Post[] = [
      makePost("https://a.com/1", "alpha", "a.com"), // same url+text → dedup
      makePost("https://b.com/2", "beta", "b.com"), // new
    ];
    const merged = mergeWebPostsByCompositeHash(existing, fresh);
    expect(merged).toHaveLength(2);
    const urls = merged.map((m) => m.url).sort();
    expect(urls).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  // Test 7 — same url, edited text → both kept
  it("keeps both when same url has different text (edited post)", () => {
    const existing: CachedWebPost[] = [
      {
        url: "https://x.com/a",
        text: "version one",
        channelUsername: "x.com",
        ts: "2026-05-08T10:00:00.000Z",
        hash: compositeHash("https://x.com/a", "version one"),
      },
    ];
    const fresh: Post[] = [makePost("https://x.com/a", "version two", "x.com")];
    const merged = mergeWebPostsByCompositeHash(existing, fresh);
    expect(merged).toHaveLength(2);
    const texts = merged.map((m) => m.text).sort();
    expect(texts).toEqual(["version one", "version two"]);
  });

  // Test 8 — collision preserves existing.ts (not fresh's now-time)
  it("preserves existing entry's ts on collision (drop fresh duplicate)", () => {
    const oldTs = "2026-05-08T05:30:00.000Z";
    const existing: CachedWebPost[] = [
      {
        url: "https://a.com/1",
        text: "alpha",
        channelUsername: "a.com",
        ts: oldTs,
        hash: compositeHash("https://a.com/1", "alpha"),
      },
    ];
    const fresh: Post[] = [makePost("https://a.com/1", "alpha", "a.com")];
    const merged = mergeWebPostsByCompositeHash(existing, fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ts).toBe(oldTs); // first-seen ts preserved
  });

  it("is pure: does not perform I/O or logging", () => {
    mergeWebPostsByCompositeHash([], []);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Test 9 / 10 / 11 — save round-trip, atomic write, mkdir
// =============================================================================
describe("saveDailyWebPostsCache (round-trip / atomic / mkdir)", () => {
  it("round-trips: save then load returns identical posts (Test 9)", () => {
    const posts: CachedWebPost[] = [
      {
        url: "https://a.com/1",
        text: "alpha",
        channelUsername: "a.com",
        ts: "2026-05-08T10:00:00.000Z",
        hash: compositeHash("https://a.com/1", "alpha"),
      },
    ];
    saveDailyWebPostsCache(MSK_DATE, posts);
    const loaded = loadDailyWebPostsCache(MSK_DATE);
    expect(loaded).toEqual(posts);

    const raw = JSON.parse(readFileSync(cachePath(MSK_DATE), "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.msk_date).toBe(MSK_DATE);
    expect(raw.posts).toHaveLength(1);
  });

  it("leaves no .tmp file behind (atomic rename — Test 10)", () => {
    const posts: CachedWebPost[] = [
      {
        url: "https://a.com/1",
        text: "alpha",
        channelUsername: "a.com",
        ts: "2026-05-08T10:00:00.000Z",
        hash: compositeHash("https://a.com/1", "alpha"),
      },
    ];
    saveDailyWebPostsCache(MSK_DATE, posts);
    const files = readdirSync("./data");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("creates ./data/ if missing (Test 11)", () => {
    expect(existsSync("./data")).toBe(false);
    saveDailyWebPostsCache(MSK_DATE, []);
    expect(existsSync("./data")).toBe(true);
    expect(existsSync(cachePath(MSK_DATE))).toBe(true);
  });
});

// =============================================================================
// todayMsk — sanity check (not a strict requirement, just a smoke test)
// =============================================================================
describe("todayMsk", () => {
  it("returns YYYY-MM-DD format", () => {
    const d = todayMsk();
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
