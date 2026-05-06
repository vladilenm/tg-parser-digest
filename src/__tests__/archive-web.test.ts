// src/__tests__/archive-web.test.ts — Vitest для writeRawWeb/writeOutputWeb (Phase 3 D-20, D-21).
// Покрывает: empty array, posts payload mapping, output bytes-for-bytes, re-run overwrite,
// path suffix `-web` (не путать с TG-архивом YYYY-MM-DD.json).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeRawWeb, writeOutputWeb } from "../archive.js";
import type { Post } from "../types.js";

function todayMskString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

describe("archive-web (Phase 3 D-20, D-21)", () => {
  let workDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    workDir = mkdtempSync(join(tmpdir(), "archive-web-"));
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("writeRawWeb([]) создаёт data/raw/YYYY-MM-DD-web.json с пустым массивом", () => {
    writeRawWeb([], "abc12345");
    const date = todayMskString();
    const path = join(workDir, "data", "raw", `${date}-web.json`);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([]);
  });

  it("writeRawWeb пишет посты в TG-совместимом payload-формате (username/messageId/text/date/url)", () => {
    const posts: Post[] = [
      {
        channelUsername: "neftegaz",
        messageId: 0,
        postedAt: "2026-05-06T17:15:00.000Z",
        text: "hello",
        url: "https://neftegaz.ru/news/",
      },
    ];
    writeRawWeb(posts, "abc12345");
    const date = todayMskString();
    const parsed = JSON.parse(
      readFileSync(join(workDir, "data", "raw", `${date}-web.json`), "utf8")
    );
    expect(parsed).toEqual([
      {
        username: "neftegaz",
        messageId: 0,
        text: "hello",
        date: "2026-05-06T17:15:00.000Z",
        url: "https://neftegaz.ru/news/",
      },
    ]);
  });

  it("writeOutputWeb пишет HTML byte-for-byte в data/output/YYYY-MM-DD-web.md", () => {
    writeOutputWeb("<b>hello</b>", "abc12345");
    const date = todayMskString();
    const path = join(workDir, "data", "output", `${date}-web.md`);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("<b>hello</b>");
  });

  it("re-run за тот же день перезаписывает файл (D-11 carried)", () => {
    writeOutputWeb("<b>first</b>", "run-1");
    writeOutputWeb("<b>second</b>", "run-2");
    const date = todayMskString();
    const path = join(workDir, "data", "output", `${date}-web.md`);
    expect(readFileSync(path, "utf8")).toBe("<b>second</b>");
  });

  it("path содержит -web суффикс (не пересекается с TG-архивом YYYY-MM-DD.json)", () => {
    writeRawWeb([], "abc12345");
    const date = todayMskString();
    expect(existsSync(join(workDir, "data", "raw", `${date}-web.json`))).toBe(true);
    expect(existsSync(join(workDir, "data", "raw", `${date}.json`))).toBe(false);
  });
});
