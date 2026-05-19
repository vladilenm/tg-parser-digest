// src/__tests__/web-scraper.test.ts — Vitest для web-scraper (Phase 3 WEB-01..WEB-04).
// Покрывает: extractText cascade/cleanup/cap (D-01/D-02/D-04), siteToPost 200-char/hostname (D-03/D-05/D-22),
// loadWebsites Zod-throws (T-03-01), fetchSite mock (D-15..D-18), composeWebDigest split-contract (D-12).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  extractText,
  siteToPost,
  loadWebsites,
  fetchSite,
  composeWebDigest,
  buildFailedSitesBlock,
} from "../web-scraper.js";
import { paths } from "../paths.js";

// =============================================================================
// extractText — D-01 (cascade), D-02 (cleanup), D-04 (cap)
// =============================================================================
describe("extractText (D-01, D-02, D-04)", () => {
  it("cascade: <article> takes precedence over <body>", () => {
    const html = `<html><body><article>article text here</article><div>body div text</div></body></html>`;
    const text = extractText(html);
    expect(text).toContain("article text here");
    expect(text).not.toContain("body div text");
  });

  it("cascade: falls back to <body> when no article/main/role=main", () => {
    const html = `<html><body>plain body content</body></html>`;
    expect(extractText(html)).toContain("plain body content");
  });

  it("cascade: [role=\"main\"] has highest priority", () => {
    const html = `<html><body><div role="main">main content</div><article>article text</article></body></html>`;
    const text = extractText(html);
    expect(text).toContain("main content");
    expect(text).not.toContain("article text");
  });

  it("cleanup: <script> removed before text extraction (security T-03-02)", () => {
    const html = `<html><body><script>alert("xss")</script>real content</body></html>`;
    const text = extractText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("xss");
    expect(text).toContain("real content");
  });

  it("cleanup: <nav>, <header>, <footer>, <aside> removed", () => {
    const html = `<html><body><nav>menu link</nav><header>logo</header>main story<footer>copyright</footer><aside>ads</aside></body></html>`;
    const text = extractText(html);
    expect(text).not.toContain("menu link");
    expect(text).not.toContain("logo");
    expect(text).not.toContain("copyright");
    expect(text).not.toContain("ads");
    expect(text).toContain("main story");
  });

  it("cap: text > 8000 chars sliced to 8000 (D-04)", () => {
    const longText = "x".repeat(10_000);
    const html = `<html><body><article>${longText}</article></body></html>`;
    const text = extractText(html);
    expect(text.length).toBe(8000);
  });

  it("normalize: whitespace collapsed to single spaces", () => {
    const html = `<html><body><article>line1\n\n\n   line2\t\tline3</article></body></html>`;
    const text = extractText(html);
    expect(text).toBe("line1 line2 line3");
  });

  it("empty: returns empty string for empty body", () => {
    expect(extractText("<html><body></body></html>")).toBe("");
  });
});

// =============================================================================
// siteToPost — D-03 (one site = one Post), D-05 (200-char validation), D-22 (hostname fallback)
// =============================================================================
describe("siteToPost (D-03, D-05, D-22)", () => {
  it("returns null for text < 200 chars (D-05)", () => {
    expect(siteToPost({ url: "https://x.com/" }, "x".repeat(199))).toBeNull();
  });

  it("returns Post for text >= 200 chars (D-05 boundary)", () => {
    const post = siteToPost({ url: "https://x.com/" }, "x".repeat(200));
    expect(post).not.toBeNull();
    expect(post!.text.length).toBe(200);
  });

  it("uses site.name as channelUsername if provided (D-22)", () => {
    const post = siteToPost(
      { url: "https://x.com/", name: "custom-name" },
      "x".repeat(300)
    );
    expect(post!.channelUsername).toBe("custom-name");
  });

  it("derives channelUsername from hostname without www (D-22)", () => {
    const post = siteToPost(
      { url: "https://www.example.com/news/" },
      "x".repeat(300)
    );
    expect(post!.channelUsername).toBe("example.com");
  });

  it("derives channelUsername from hostname for non-www URL", () => {
    const post = siteToPost({ url: "https://oilcapital.ru/" }, "x".repeat(300));
    expect(post!.channelUsername).toBe("oilcapital.ru");
  });

  it("returns Post with messageId=0 (D-03 — no cross-run dedup for web)", () => {
    const post = siteToPost({ url: "https://x.com/" }, "x".repeat(300));
    expect(post!.messageId).toBe(0);
  });

  it("Post.url matches site.url (verifyExtractiveness contract)", () => {
    const url = "https://neftegaz.ru/news/123";
    const post = siteToPost({ url }, "x".repeat(300));
    expect(post!.url).toBe(url);
  });
});

// =============================================================================
// loadWebsites — D-22, D-23, T-03-01 (Zod validation as SSRF mitigation)
// =============================================================================
describe("loadWebsites (D-22, D-23, T-03-01)", () => {
  let workDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), "loadweb-"));
    process.chdir(workDir);
    // paths.websitesConfig резолвится в `${workDir}/data/config/websites.json`.
    mkdirSync(dirname(paths.websitesConfig), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("throws when websites.json missing", () => {
    expect(() => loadWebsites()).toThrow(/websites\.json not found/);
  });

  it("throws on invalid JSON", () => {
    writeFileSync(paths.websitesConfig, "{not-valid-json", "utf8");
    expect(() => loadWebsites()).toThrow(/failed to parse/);
  });

  it("throws on Zod fail: non-URL string (T-03-01 SSRF mitigation)", () => {
    writeFileSync(
      paths.websitesConfig,
      JSON.stringify({ websites: [{ url: "not-a-url" }] }),
      "utf8"
    );
    expect(() => loadWebsites()).toThrow();
  });

  it("throws on empty websites array (Zod min(1))", () => {
    writeFileSync(paths.websitesConfig, JSON.stringify({ websites: [] }), "utf8");
    expect(() => loadWebsites()).toThrow();
  });

  it("returns parsed array on valid input", () => {
    writeFileSync(
      paths.websitesConfig,
      JSON.stringify({
        websites: [
          { url: "https://x.com/" },
          { url: "https://y.com/", name: "y" },
        ],
      }),
      "utf8"
    );
    const result = loadWebsites();
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe("https://x.com/");
    expect(result[1]!.name).toBe("y");
  });
});

// =============================================================================
// fetchSite — D-15..D-18 (mocked globalThis.fetch)
// =============================================================================
describe("fetchSite (D-15..D-18)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
      fetchSpy = undefined;
    }
  });

  it("returns body on 200 OK", async () => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("<html><body>ok</body></html>", { status: 200 })
      );
    const html = await fetchSite("https://x.com/");
    expect(html).toBe("<html><body>ok</body></html>");
  });

  it("throws on non-2xx (D-18 no retry)", async () => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(fetchSite("https://x.com/")).rejects.toThrow(/HTTP 404/);
  });

  it("aborts on timeout (D-16)", async () => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          const sig = (init as RequestInit | undefined)?.signal;
          if (sig) {
            sig.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }
        });
      });
    // 50ms timeout — мгновенно abort'нется через AbortController
    await expect(fetchSite("https://x.com/", 50)).rejects.toThrow();
  }, 5000);

  it("sends Chrome/120 User-Agent (D-17)", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        capturedHeaders = (init as RequestInit | undefined)
          ?.headers as Record<string, string>;
        return Promise.resolve(new Response("ok", { status: 200 }));
      });
    await fetchSite("https://x.com/");
    expect(capturedHeaders?.["user-agent"]).toMatch(/Chrome\/120/);
  });
});

// =============================================================================
// composeWebDigest — D-12: фиксирует контракт split-по-`\n\n`.
// Цель теста: ЕСЛИ кто-то в будущем изменит формат summarize.renderHtml header'а
// (например, добавит ещё одну строку перед body, или поменяет separator),
// этот тест должен поломаться ЯВНО, а не молча сломать прод-сообщение.
// =============================================================================
describe("composeWebDigest (D-12 — contract anchor)", () => {
  it("replaces TG-header with web-header on canonical renderHtml output", () => {
    // Mock-input соответствует текущему формату summarize.renderHtml:
    // "<b>Нефтегаз — {date}</b>\n<i>{n} постов из {k} каналов за 24ч</i>\n\n<b>🚢 Бункер</b>..."
    const tgInput =
      `<b>Нефтегаз — 6 мая 2026 г.</b>\n` +
      `<i>10 постов из 5 каналов за 24ч</i>\n\n` +
      `<b>🚢 Бункер</b>\n• item one\n\n<b>🛢 Масла</b>\n<i>— нет упоминаний за сутки</i>`;

    const result = composeWebDigest(tgInput, 3, 5);

    // (1) результат начинается с web-header:
    expect(result.startsWith("<b>🌐 Веб-источники")).toBe(true);
    // (2) субзаголовок D-11 присутствует с правильными числами:
    expect(result).toContain("<i>3 сайтов из 5 обработано</i>");
    // (3) body секций сохраняется (буллеты + section headers):
    expect(result).toContain("<b>🚢 Бункер</b>");
    expect(result).toContain("• item one");
    expect(result).toContain("<b>🛢 Масла</b>");
    // (4) старый TG-заголовок «Нефтегаз —» НЕ присутствует (split сработал):
    expect(result).not.toContain("<b>Нефтегаз —");
    expect(result).not.toContain("постов из");
    expect(result).not.toContain("каналов за 24ч");
  });

  it("falls back to full input when separator not found (defensive)", () => {
    // Если formatu summarize.renderHtml сломается (нет `\n\n`), composeWebDigest
    // не упадёт — просто prepend'ит web-header перед всем входом.
    // Тест документирует defensive fallback (idx >= 0 ? ... : summarizedHtml).
    const broken = `<b>some content without separator</b>`;
    const result = composeWebDigest(broken, 1, 1);
    expect(result.startsWith("<b>🌐 Веб-источники")).toBe(true);
    expect(result).toContain("some content without separator");
  });
});

// =============================================================================
// buildFailedSitesBlock — quick-260519-k6c: блок «⚠️ Не удалось распарсить (N)»
// Контракт: non-empty → блок, empty → "", HTML escape применяется к url и reason.
// =============================================================================
describe("buildFailedSitesBlock (quick-260519-k6c)", () => {
  it("A: non-empty — возвращает блок с заголовком и bullets", () => {
    const failedSites = [
      { url: "https://a.example/", reason: "HTTP 500" },
      {
        url: "https://b.example/news",
        reason: "fetch failed (cause: UND_ERR_CONNECT_TIMEOUT — Connect Timeout Error)",
      },
    ];
    const result = buildFailedSitesBlock(failedSites);
    // Блок начинается с двойного \n\n (для отделения от основного HTML)
    expect(result.startsWith("\n\n")).toBe(true);
    // Заголовок с правильным счётчиком
    expect(result).toContain("<b>⚠️ Не удалось распарсить (2)</b>");
    // Первый bullet
    expect(result).toContain("• <code>https://a.example/</code> — HTTP 500");
    // Второй bullet
    expect(result).toContain("• <code>https://b.example/news</code> — fetch failed");
    // Счётчик совпадает с длиной массива
    expect(result).toContain(`(${failedSites.length})`);
  });

  it("B: empty input — возвращает пустую строку", () => {
    const result = buildFailedSitesBlock([]);
    expect(result).toBe("");
  });

  it("C: HTML escape — url и reason экранируются", () => {
    const failedSites = [
      {
        url: "https://x.example/?a=1&b=2",
        reason: "<script>alert(1)</script>",
      },
    ];
    const result = buildFailedSitesBlock(failedSites);
    // & в url должен быть экранирован
    expect(result).toContain("&amp;");
    expect(result).not.toContain("&b=2");
    // <script> в reason должен быть экранирован
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("D: reason length cap — reason > 120 символов обрезается с суффиксом «…»", () => {
    const longReason = "x".repeat(500);
    const failedSites = [{ url: "https://y.example/", reason: longReason }];
    const result = buildFailedSitesBlock(failedSites);
    // Обрезанная причина должна заканчиваться на «…»
    expect(result).toContain("…");
    // Полный длинный reason НЕ должен присутствовать
    expect(result).not.toContain(longReason);
    // Проверяем что обрезано до 120 символов + «…»
    const expectedTruncated = "x".repeat(120) + "…";
    expect(result).toContain(expectedTruncated);
  });
});
