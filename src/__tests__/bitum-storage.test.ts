import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isoWeekFolder,
  weekDir,
  saveUpload,
  listWeekV5,
  findLatestWeekWithUploads,
  writeLastRun,
  resetWeek,
} from "../bitum/storage.js";

describe("bitum/storage", () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "bitum-storage-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("isoWeekFolder produces YYYY-Www format", () => {
    expect(isoWeekFolder(new Date("2026-05-08T00:00:00Z"))).toMatch(
      /^\d{4}-W\d{2}$/,
    );
  });

  it("listWeekV5 returns 0/5 for empty week", () => {
    const status = listWeekV5("2026-W20");
    expect(status.presentCount).toBe(0);
    expect(status.allPresent).toBe(false);
    expect(status.hasBirzhaPrices).toBe(false);
    expect(status.hasBitumPriceNew).toBe(false);
  });

  it("saveUpload + listWeekV5 round-trip for all 5 types", async () => {
    const buf = Buffer.from("test");
    const week = "2026-W20";
    await saveUpload(buf, "birzha_prices", week);
    await saveUpload(buf, "birzha_volumes", week);
    await saveUpload(buf, "fca_sellers", week);
    await saveUpload(buf, "all_prices", week);
    await saveUpload(buf, "bitum_price_new", week);
    const status = listWeekV5(week);
    expect(status.presentCount).toBe(5);
    expect(status.allPresent).toBe(true);
  });

  it("MIGRATE-03: legacy fca.xlsx detected as hasFcaSellers", () => {
    const week = "2026-W20";
    const dir = weekDir(week);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "fca.xlsx"), "legacy");
    const status = listWeekV5(week);
    expect(status.hasFcaSellers).toBe(true);
    expect(status.presentCount).toBe(1);
  });

  it("resetWeek removes xlsx + .last-run.json, returns deleted list", async () => {
    const buf = Buffer.from("test");
    const week = "2026-W20";
    await saveUpload(buf, "birzha_prices", week);
    await saveUpload(buf, "fca_sellers", week);
    writeLastRun(week, new Date());
    const deleted = resetWeek(week);
    expect(deleted).toContain("birzha_prices.xlsx");
    expect(deleted).toContain("fca_sellers.xlsx");
    expect(deleted).toContain(".last-run.json");
    expect(listWeekV5(week).presentCount).toBe(0);
  });

  it("resetWeek is idempotent (empty dir → [])", () => {
    expect(resetWeek("2026-W20")).toEqual([]);
  });

  it("findLatestWeekWithUploads returns lex-max week with xlsx", async () => {
    const buf = Buffer.from("t");
    await saveUpload(buf, "birzha_prices", "2026-W18");
    await saveUpload(buf, "birzha_prices", "2026-W20");
    await saveUpload(buf, "birzha_prices", "2026-W19");
    expect(findLatestWeekWithUploads()).toBe("2026-W20");
  });

  it("findLatestWeekWithUploads returns null on empty uploads", () => {
    expect(findLatestWeekWithUploads()).toBe(null);
  });

  it("writeLastRun sets lastRunAt ISO string", () => {
    const week = "2026-W20";
    const now = new Date("2026-05-21T10:00:00Z");
    writeLastRun(week, now);
    const status = listWeekV5(week);
    expect(status.lastRunAt).toBe("2026-05-21T10:00:00.000Z");
  });

  it("writeLastRun + saveUpload atomic via .tmp+rename (no .tmp leftover)", async () => {
    const buf = Buffer.from("t");
    const week = "2026-W20";
    await saveUpload(buf, "birzha_prices", week);
    writeLastRun(week, new Date());
    const dir = weekDir(week);
    expect(existsSync(path.join(dir, "birzha_prices.xlsx"))).toBe(true);
    expect(existsSync(path.join(dir, "birzha_prices.xlsx.tmp"))).toBe(false);
    expect(existsSync(path.join(dir, ".last-run.json.tmp"))).toBe(false);
  });
});
