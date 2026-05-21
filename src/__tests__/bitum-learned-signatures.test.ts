import { describe, expect, it, beforeEach, afterEach } from "vitest";
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
  loadLearned,
  appendLearned,
} from "../bitum/learned-signatures.js";

describe("bitum/learned-signatures", () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "bitum-learned-"));
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("loadLearned returns [] when file missing", () => {
    expect(loadLearned()).toEqual([]);
  });

  it("appendLearned creates directory and writes file atomically", async () => {
    await appendLearned({
      type: "fca_sellers",
      a1: "test marker",
      learnedAt: new Date("2026-05-21").toISOString(),
    });
    const file = path.join(tmpDir, "bitum", "signatures-learned.json");
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("fca_sellers");
  });

  it("appendLearned appends to existing file", async () => {
    mkdirSync(path.join(tmpDir, "bitum"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "bitum", "signatures-learned.json"),
      JSON.stringify([
        {
          type: "birzha_prices",
          a1: "old",
          learnedAt: "2026-01-01T00:00:00Z",
        },
      ]),
      "utf8",
    );
    await appendLearned({
      type: "all_prices",
      a1: "new",
      learnedAt: "2026-05-21T00:00:00Z",
    });
    const arr = loadLearned();
    expect(arr).toHaveLength(2);
    expect(arr[1].type).toBe("all_prices");
  });

  it("concurrent appendLearned serialize via mutex — no lost writes", async () => {
    await Promise.all([
      appendLearned({
        type: "birzha_prices",
        a1: "p1",
        learnedAt: "2026-05-21T00:00:01Z",
      }),
      appendLearned({
        type: "birzha_volumes",
        a1: "v1",
        learnedAt: "2026-05-21T00:00:02Z",
      }),
      appendLearned({
        type: "fca_sellers",
        a1: "f1",
        learnedAt: "2026-05-21T00:00:03Z",
      }),
    ]);
    const arr = loadLearned();
    expect(arr).toHaveLength(3);
    const types = arr.map((x) => x.type).sort();
    expect(types).toEqual([
      "birzha_prices",
      "birzha_volumes",
      "fca_sellers",
    ]);
  });

  it("loadLearned returns [] when file is malformed JSON", () => {
    mkdirSync(path.join(tmpDir, "bitum"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "bitum", "signatures-learned.json"),
      "not-json",
      "utf8",
    );
    expect(loadLearned()).toEqual([]);
  });
});
