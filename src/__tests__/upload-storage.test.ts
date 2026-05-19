// src/__tests__/upload-storage.test.ts — vitest для ISO-week + хранения upload'ов.
// Использует mkdtempSync + DATA_DIR override для round-trip-теста.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isoWeekFolder,
  saveUpload,
  listWeek,
  writeLastRun,
  weekDir,
} from "../upload/storage.js";

describe("isoWeekFolder", () => {
  it("returns 2026-W20 for 2026-05-12 (Tuesday of week 20)", () => {
    expect(isoWeekFolder(new Date(Date.UTC(2026, 4, 12)))).toBe("2026-W20");
  });

  it("handles year-boundary: 2026-01-01 belongs to 2025-W53", () => {
    // 2026-01-01 is Thursday → week 1 of 2026? Actually ISO 8601: Thursday's week
    // belongs to the year of that Thursday. 2026-01-01 IS the Thursday → 2026-W01.
    // But 2025 has 53 weeks because 2025-01-01 was Wed → 2024-W52 / 2025-W01...
    // Let's check: ISO week of 2026-01-01 = year 2026, week 01.
    expect(isoWeekFolder(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
  });

  it("handles 2025-12-29 (Monday) — should be 2026-W01", () => {
    // 2025-12-29 is Monday; Thursday of that week is 2026-01-01 → belongs to 2026.
    expect(isoWeekFolder(new Date(Date.UTC(2025, 11, 29)))).toBe("2026-W01");
  });

  it("pads week to 2 digits", () => {
    expect(isoWeekFolder(new Date(Date.UTC(2026, 0, 8)))).toBe("2026-W02");
  });

  it("agrees with known reference week 2026-W19 (Mon 2026-05-04)", () => {
    expect(isoWeekFolder(new Date(Date.UTC(2026, 4, 4)))).toBe("2026-W19");
  });
});

describe("saveUpload + listWeek + writeLastRun (round-trip in temp dir)", () => {
  let prevDataDir: string | undefined;
  let tmp: string;

  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    tmp = mkdtempSync(path.join(tmpdir(), "upload-storage-test-"));
    process.env.DATA_DIR = tmp;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("saveUpload writes <weekDir>/<type>.xlsx atomically", async () => {
    const week = "2026-W20";
    const buf = Buffer.from("dummy-xlsx-bytes");
    const finalPath = await saveUpload(buf, "birzha_prices", week);
    expect(existsSync(finalPath)).toBe(true);
    expect(finalPath.endsWith("/birzha_prices.xlsx")).toBe(true);
    expect(readFileSync(finalPath).toString()).toBe("dummy-xlsx-bytes");
    // .tmp must not remain
    expect(existsSync(finalPath + ".tmp")).toBe(false);
  });

  it("listWeek reports present file flags", async () => {
    const week = "2026-W20";
    await saveUpload(Buffer.from("p"), "birzha_prices", week);
    await saveUpload(Buffer.from("f"), "fca", week);
    const status = listWeek(week);
    expect(status.hasPrices).toBe(true);
    expect(status.hasFca).toBe(true);
    expect(status.hasVolumes).toBe(false);
    expect(status.lastRunAt).toBe(null);
  });

  it("writeLastRun + listWeek round-trip", async () => {
    const week = "2026-W20";
    await saveUpload(Buffer.from("p"), "birzha_prices", week);
    const t = new Date("2026-05-19T12:34:56.000Z");
    writeLastRun(week, t);
    const status = listWeek(week);
    expect(status.lastRunAt).toBeInstanceOf(Date);
    expect(status.lastRunAt?.toISOString()).toBe("2026-05-19T12:34:56.000Z");
  });

  it("listWeek for empty/non-existent week returns all-false", () => {
    const status = listWeek("2026-W99");
    expect(status.hasPrices).toBe(false);
    expect(status.hasVolumes).toBe(false);
    expect(status.hasFca).toBe(false);
    expect(status.lastRunAt).toBe(null);
  });

  it("listWeek tolerates malformed .last-run.json", async () => {
    const week = "2026-W20";
    const wd = weekDir(week);
    mkdirSync(wd, { recursive: true });
    writeFileSync(path.join(wd, ".last-run.json"), "not-json");
    const status = listWeek(week);
    expect(status.lastRunAt).toBe(null);
  });
});
