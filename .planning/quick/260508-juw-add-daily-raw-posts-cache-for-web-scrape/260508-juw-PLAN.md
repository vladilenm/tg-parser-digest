---
phase: quick-260508-juw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/web-posts-cache.ts
  - src/__tests__/web-posts-cache.test.ts
  - src/web-scraper.ts
autonomous: true
requirements:
  - "QUICK-260508-juw"
must_haves:
  truths:
    - "On run N, web-scraper merges this run's freshly scraped posts with the same-day posts already on disk before calling summarize()"
    - "Posts deduped by composite key sha256(url + \"\\n\" + text) — identical url+text counted once, edited text on same url counted as new"
    - "After merge, the union is atomically written back to data/web-posts-${MSK-date}.json (.tmp + rename)"
    - "If data/web-posts-${MSK-date}.json is missing → cache loads as empty without warning; if corrupt → log.warn + start fresh, never crash"
    - "TG-pipeline (src/pipeline.ts) and existing data/hash-cache.json delivered-keyQuote dedup are unchanged — both behaviors fully preserved"
    - "summarize() signature is not changed; the merged Post[] is passed exactly where the old `posts` variable used to be"
  artifacts:
    - path: "src/web-posts-cache.ts"
      provides: "loadDailyWebPostsCache, mergeWebPostsByCompositeHash, saveDailyWebPostsCache, compositeHash"
      min_lines: 60
    - path: "src/__tests__/web-posts-cache.test.ts"
      provides: "Unit tests for load/merge/save round-trip, corrupt/missing file, composite-hash dedup"
      min_lines: 80
    - path: "src/web-scraper.ts"
      provides: "Merge hook between writeRawWeb() and summarize()"
      contains: "loadDailyWebPostsCache"
  key_links:
    - from: "src/web-scraper.ts (runWebPipeline)"
      to: "src/web-posts-cache.ts"
      via: "import { loadDailyWebPostsCache, mergeWebPostsByCompositeHash, saveDailyWebPostsCache } from \"./web-posts-cache.js\""
      pattern: "from \"\\./web-posts-cache\\.js\""
    - from: "src/web-posts-cache.ts (compositeHash)"
      to: "src/dedup.ts (hashText)"
      via: "import { hashText } from \"./dedup.js\""
      pattern: "import.*hashText.*dedup"
    - from: "src/web-scraper.ts"
      to: "merged Post[] passed to summarize()"
      via: "summarize(mergedPosts, { dedupCache, applyDateFilter: true })"
      pattern: "summarize\\(merged"
---

<objective>
Add a daily-rotating raw-posts cache for the web pipeline so information visible
in run N (e.g. neftegaz.ru fetched ok) is preserved into run N+1 the same MSK day
even if the source fails on the later run. The cache lives at
`data/web-posts-${MSK-date}.json`, deduplicates by composite hash of `url+text`,
and merges before `summarize()` so the LLM always sees the union of everything
this day's runs have ever seen.

Purpose: stop info loss across same-day web-pipeline runs (17–19 of 33 sources
succeed, the failing set varies). The existing `hash-cache.json` deduplicates
**delivered keyQuotes** — it does nothing for posts that were never scraped
in a run. This new layer is a pre-summarize merge of raw posts.

Output: `src/web-posts-cache.ts` (new module), unit tests, and a 5-line
hook in `src/web-scraper.ts` between `writeRawWeb` and `summarize`.

Strict scope: web-pipeline only. TG-pipeline (pipeline.ts) and summarize.ts
are NOT modified. Pass2 per-domain refactor is explicitly deferred.
</objective>

<context>
@.planning/STATE.md
@./CLAUDE.md
@src/web-scraper.ts
@src/dedup.ts
@src/types.ts
@src/logger.ts
@src/__tests__/web-scraper.test.ts

<interfaces>
<!-- Contracts the executor needs. Do NOT explore the codebase to rediscover these. -->

From src/types.ts (Post is the cache record shape):
```ts
export interface Post {
  channelUsername: string; // без "@", как в channels.json
  messageId: number;       // 0 для web-постов (нет cross-run dedup в TG-смысле)
  postedAt: string;        // ISO 8601
  text: string;
  url: string;
}
```

From src/dedup.ts (REUSE — DO NOT reimplement):
```ts
export function normalize(text: string): string;       // lowercase, strip emoji/punct, ≤200ch
export function hashText(text: string): string;        // sha256 hex of normalize(text)
```
Note: `hashText` already normalizes its input. For the **composite** key we
need stable hashing of `url + "\n" + text` WITHOUT the aggressive normalization
(URLs would have punctuation stripped). Use `createHash("sha256")` directly on
the raw concatenation — see Task 1 implementation.

From src/logger.ts (use this, never console.log):
```ts
export const log: { info(msg, ...ctx); warn(msg, ...ctx); error(msg, ...ctx) };
```

From src/archive.ts (mirror this MSK-date helper exactly — it must produce
the same string as the one in summarize.ts and logger.ts):
```ts
function todayMsk(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
}
```

From src/dedup.ts (mirror this atomic-write pattern exactly):
```ts
function atomicWriteJson(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}
```

Hook point in src/web-scraper.ts (verified by reading lines 408–499):
- After Promise.allSettled assembles `posts: Post[]` (line 408–429)
- After `writeRawWeb(posts, runId)` at line 436 (preserves "raw saved" invariant)
- BEFORE the `if (websitesSucceeded === 0 && websites.length > 0)` placeholder branch (line 442)
- The merged set must be used by BOTH the websitesSucceeded check (we may have 0 succeeded THIS run but cache has yesterday-untouched posts — see Task 2 for exact wording) AND by `summarize()` at line 477.
</interfaces>

<file-schema>
File: `data/web-posts-${MSK-date}.json` — daily-rotating, atomic-written.

```json
{
  "version": 1,
  "msk_date": "2026-05-08",
  "posts": [
    {
      "url": "https://neftegaz.ru/news/...",
      "text": "...full extracted text...",
      "channelUsername": "neftegaz.ru",
      "ts": "2026-05-08T17:15:23.456Z",
      "hash": "sha256-hex-of-url-newline-text"
    }
  ]
}
```

- `hash` is the composite-dedup key, NOT for content addressing externally.
- `ts` is when the post first entered the cache (debugging — answers "when did this post first appear today?").
- File rotates naturally by MSK date — no GC in v1 (mentioned as follow-up).
</file-schema>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create web-posts-cache.ts module + unit tests</name>
  <files>src/web-posts-cache.ts, src/__tests__/web-posts-cache.test.ts</files>
  <behavior>
    Test 1 — compositeHash determinism: compositeHash("u","t") === compositeHash("u","t"); compositeHash("u","t") !== compositeHash("u","t2"); compositeHash("u","t") !== compositeHash("u2","t"). Hash is sha256 hex of `url + "\n" + text` — 64 hex chars.

    Test 2 — load missing file: loadDailyWebPostsCache("2026-05-08") on a fresh tmpdir returns []. No log.warn (missing-file is normal first-run-of-day).

    Test 3 — load corrupt file: write invalid JSON to data/web-posts-2026-05-08.json → loadDailyWebPostsCache returns [] AND log.warn fires once. Process must NOT throw.

    Test 4 — load wrong-shape file: write `{"version":2,"posts":"not-an-array"}` → returns [] + log.warn. Same recovery as corrupt.

    Test 5 — load valid file: write a valid 2-post file → loadDailyWebPostsCache returns those 2 Post objects with all fields preserved.

    Test 6 — merge dedup: existing=[postA], fresh=[postA-same-url-same-text, postB] → merge returns [postA, postB] (length 2, A not duplicated). Equality is on compositeHash.

    Test 7 — merge same url, different text: existing=[postA url=X text=Y1], fresh=[postA' url=X text=Y2] → merge returns BOTH (length 2). Composite key includes text.

    Test 8 — merge preserves existing on collision: when fresh contains a post with the same compositeHash as an existing one, the existing entry (with its older `ts`) is kept — fresh duplicate is dropped. Verifies "ts answers when post FIRST appeared".

    Test 9 — save round-trip: saveDailyWebPostsCache("2026-05-08", posts) → file exists at correct path → loadDailyWebPostsCache("2026-05-08") returns identical posts. File content includes version=1, msk_date matches, posts array length matches.

    Test 10 — atomic write: after saveDailyWebPostsCache succeeds, no `.tmp` file remains in the data dir. (Mirrors dedup.ts pattern; tmp must be renamed not left behind.)

    Test 11 — save creates data/ dir if missing: tmpdir without `data/` subdir → save creates it.

    Use vitest, follow the style of src/__tests__/web-scraper.test.ts (describe blocks per concern, mkdtempSync + process.chdir for filesystem isolation, restore cwd in afterEach). Mock `log` via `vi.mock("../logger.js", ...)` to assert log.warn was called for corrupt-file tests.
  </behavior>
  <action>
    Create `src/web-posts-cache.ts` with the following exported API. NO new runtime deps — only Node built-ins (`node:crypto`, `node:fs`, `node:path`).

    Public API:
    ```ts
    export interface CachedWebPost {
      url: string;
      text: string;
      channelUsername: string;
      ts: string;       // ISO 8601 — when post first entered cache
      hash: string;     // compositeHash(url, text) — denormalized for fast equality
    }

    export function compositeHash(url: string, text: string): string;
    export function loadDailyWebPostsCache(mskDate: string): CachedWebPost[];
    export function mergeWebPostsByCompositeHash(
      existing: CachedWebPost[],
      freshPosts: import("./types.js").Post[]
    ): CachedWebPost[];
    export function saveDailyWebPostsCache(mskDate: string, posts: CachedWebPost[]): void;

    // Helper for the call site — derives MSK date the same way archive.ts does.
    export function todayMsk(): string;
    ```

    Implementation rules:
    1. `compositeHash(url, text)` = `createHash("sha256").update(url + "\n" + text, "utf8").digest("hex")`. Do NOT route through dedup.ts `hashText` — that one normalizes (strips punct, lowercases, ≤200 chars), which would make different URLs collide and make text>200 chars indistinguishable. The composite hash here is a content-addressed equality check, not a "near-duplicate" check.
    2. Path is `./data/web-posts-${mskDate}.json` — exact format from the file-schema block above.
    3. `loadDailyWebPostsCache`:
       - If file missing → return `[]` silently (no log).
       - If JSON.parse throws OR top-level `posts` is not an array OR `version !== 1` → `log.warn("[web-posts-cache] ...")` and return `[]`.
       - Per-entry validation: must have string `url`, `text`, `channelUsername`, `ts`, `hash`. Skip malformed entries with a single aggregated `log.warn` (don't spam).
    4. `mergeWebPostsByCompositeHash`:
       - Build a `Map<string, CachedWebPost>` from `existing` keyed by `hash`.
       - For each fresh `Post`, compute `h = compositeHash(p.url, p.text)`. If `map.has(h)` → skip (preserves original `ts`). Else insert `{url, text, channelUsername: p.channelUsername, ts: new Date().toISOString(), hash: h}`.
       - Return `Array.from(map.values())`.
       - Pure function: no I/O, no logging.
    5. `saveDailyWebPostsCache`: atomic-write `{version: 1, msk_date: mskDate, posts}` via `.tmp` + `renameSync` (mirror `atomicWriteJson` from dedup.ts; ensure `data/` exists via `mkdirSync(..., {recursive:true})`). Log `log.info("[web-posts-cache] saved {N} posts to {path}")` after rename.
    6. `todayMsk()` is identical to the helper in archive.ts/logger.ts — copy it (8 lines, not worth a shared module yet; same precedent as formatDateRu in web-scraper.ts).

    Then create `src/__tests__/web-posts-cache.test.ts` covering all 11 behaviors. Mirror the pattern in `src/__tests__/web-scraper.test.ts`:
    - Use `mkdtempSync(join(tmpdir(), "web-posts-cache-"))` per-test scratch dir.
    - `process.chdir(tmpDir)` in beforeEach, restore in afterEach (the module reads `./data/...` relative paths).
    - For corrupt-file tests, mock `../logger.js` and assert `log.warn` was called.
    - rmSync(tmpDir, { recursive: true, force: true }) in afterEach.

    Self-check before finishing:
    - [ ] No `console.log/warn/error` anywhere — only `log.*`.
    - [ ] No new dependencies in package.json.
    - [ ] `compositeHash` does NOT call `hashText` — it uses raw sha256.
    - [ ] All exports listed above are present.
    - [ ] Test file imports from `"../web-posts-cache.js"` (note the .js — ESM with bundler resolution).
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo && npx vitest run src/__tests__/web-posts-cache.test.ts</automated>
  </verify>
  <done>All 11 unit tests pass. `src/web-posts-cache.ts` exists with the exported API. No new entries in package.json dependencies. `npx tsc --noEmit` (if you choose to run it) reports no errors in the new module.</done>
</task>

<task type="auto">
  <name>Task 2: Wire merge hook into web-scraper.ts between writeRawWeb and summarize</name>
  <files>src/web-scraper.ts</files>
  <action>
    Modify `runWebPipeline()` in `src/web-scraper.ts` to merge this-run's freshly scraped posts with the same-day on-disk cache BEFORE the existing `summarize()` flow. The existing `loadHashCache` / `commitHashCache` (delivered-keyQuote dedup) flow MUST stay byte-identical — do not touch lines 475–498 except for changing the variable passed to `summarize()`.

    Step 1 — add import at the top of the file (alongside the existing `loadHashCache, commitHashCache` import on line 15):
    ```ts
    import {
      loadDailyWebPostsCache,
      mergeWebPostsByCompositeHash,
      saveDailyWebPostsCache,
      todayMsk,
    } from "./web-posts-cache.js";
    ```

    Step 2 — insert the merge block IMMEDIATELY AFTER `writeRawWeb(posts, runId);` (currently line 436) and BEFORE the comment `// D-13 (technical fail): all sites pruned...` on line 442.

    Insert exactly this block (adjust whitespace to match surrounding 2-space indent):
    ```ts
    // quick-260508-juw: same-day raw-posts cache. Each run scrapes only ~17–19 of 33 sources
    // successfully; the failing set varies between runs, so info visible at 17:00 disappears at
    // 18:00 if we don't carry it forward. We merge this run's posts with everything seen earlier
    // today (same MSK date), feed the union to summarize(), and persist the union back.
    // The hash-cache.json (delivered keyQuotes) below is UNCHANGED — that layer continues to
    // filter already-shipped items so the digest grows incrementally over the day.
    const mskDate = todayMsk();
    const cachedPosts = loadDailyWebPostsCache(mskDate);
    const mergedCachedPosts = mergeWebPostsByCompositeHash(cachedPosts, posts);
    const mergedPosts: Post[] = mergedCachedPosts.map((c) => ({
      channelUsername: c.channelUsername,
      messageId: 0,
      postedAt: c.ts,
      text: c.text,
      url: c.url,
    }));
    log.info(
      `[web-scraper] runId=${runId} web-posts-cache: cached=${cachedPosts.length} fresh=${posts.length} merged=${mergedPosts.length}`
    );
    // Persist union BEFORE summarize so a crash mid-LLM doesn't lose the merge.
    saveDailyWebPostsCache(mskDate, mergedCachedPosts);
    ```

    Step 3 — at the existing `summarize()` call site (currently line 477), replace `posts` with `mergedPosts`:
    ```ts
    // BEFORE:
    const { html, postsDropped, itemsCount, freshKeyQuoteHashes } = await summarize(posts, { ... });
    // AFTER:
    const { html, postsDropped, itemsCount, freshKeyQuoteHashes } = await summarize(mergedPosts, { ... });
    ```

    Step 4 — IMPORTANT: also update the `if (websitesSucceeded === 0 && websites.length > 0)` placeholder gate. The current guard sends a placeholder when zero sites succeeded **this run** — but if the cache has posts from earlier today, we should NOT send a placeholder; we should run summarize over the cached set. Change the condition to:
    ```ts
    // Updated: only send placeholder when BOTH this run had no successes AND nothing is in same-day cache.
    if (websitesSucceeded === 0 && websites.length > 0 && mergedPosts.length === 0) {
      // ... existing placeholder branch unchanged ...
    } else if (mergedPosts.length > 0) {
      // ... existing summarize branch unchanged, but now triggers even when websitesSucceeded=0 if cache has posts ...
    } else {
      // websites.length === 0 — schema gate (.min(1)) этого не допускает.
      log.info(`[web-scraper] runId=${runId} no websites configured — skipping`);
    }
    ```

    Note for executor: the existing branch condition was `else if (websitesSucceeded > 0)`. Change it to `else if (mergedPosts.length > 0)`. The summary header still shows `(websitesSucceeded, websites.length)` for the **current run** — that's correct UX (the user sees how many sources worked THIS run, not historical). Only the gate logic changes.

    Do NOT modify:
    - src/pipeline.ts (TG-pipeline)
    - src/summarize.ts
    - src/dedup.ts
    - The `loadHashCache` / `commitHashCache` flow (lines 475 and 497 in current file)
    - The `writeRawWeb(posts, runId)` call — `posts` here is intentionally THIS RUN's freshly scraped, raw archive of what we actually fetched. The merged set goes to summarize, not to writeRawWeb.

    Self-check before finishing:
    - [ ] grep "import.*web-posts-cache" src/web-scraper.ts → 1 match
    - [ ] grep "summarize(merged" src/web-scraper.ts → 1 match (the call site)
    - [ ] grep "summarize(posts" src/web-scraper.ts → 0 matches
    - [ ] grep -c "loadHashCache\|commitHashCache" src/web-scraper.ts → 2 (unchanged)
    - [ ] No edits in src/pipeline.ts, src/summarize.ts, src/dedup.ts
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo && npx vitest run src/__tests__/web-scraper.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>Existing web-scraper tests still pass (no regression). TypeScript compiles clean. The merge block is in place between writeRawWeb and the placeholder branch. summarize() receives `mergedPosts`. TG-pipeline file unchanged (`git diff src/pipeline.ts` empty).</done>
</task>

<task type="auto">
  <name>Task 3: Smoke test full pipeline + verify cache file lifecycle</name>
  <files>(no source changes — verification only)</files>
  <action>
    Run the web-pipeline end-to-end against the real `websites.json` and verify the cache file behaves as designed across two consecutive runs the same MSK day.

    Step 1 — clean slate. Identify today's MSK date:
    ```bash
    MSK_DATE=$(node -e 'console.log(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()))')
    echo "MSK date: $MSK_DATE"
    rm -f "data/web-posts-${MSK_DATE}.json" "data/web-posts-${MSK_DATE}.json.tmp"
    ```

    Step 2 — first run via the existing one-shot script:
    ```bash
    npm run start:once:web 2>&1 | tee /tmp/run1.log
    ```
    Verify in /tmp/run1.log: a line `[web-scraper] runId=... web-posts-cache: cached=0 fresh=N1 merged=N1` where N1 is the number of successfully scraped posts this run.

    Verify file exists:
    ```bash
    ls -la "data/web-posts-${MSK_DATE}.json"
    ls -la "data/web-posts-${MSK_DATE}.json.tmp" 2>/dev/null && echo "FAIL: tmp file leaked" || echo "OK: no tmp leak"
    ```
    File should exist; .tmp should NOT exist (atomic rename worked).

    Step 3 — inspect schema:
    ```bash
    node -e '
      const fs = require("fs");
      const d = JSON.parse(fs.readFileSync("data/web-posts-'"${MSK_DATE}"'.json","utf8"));
      console.log("version:", d.version, "msk_date:", d.msk_date, "posts:", d.posts.length);
      console.log("sample:", JSON.stringify(d.posts[0], null, 2));
      const allHaveFields = d.posts.every(p => p.url && p.text && p.channelUsername && p.ts && p.hash && p.hash.length === 64);
      console.log("all posts have required fields + 64-char hash:", allHaveFields);
    '
    ```
    Expect: version=1, msk_date matches today, posts is an array of N1 entries, all entries have url/text/channelUsername/ts/hash, hash is 64 hex chars.

    Step 4 — second run a few seconds later (same MSK day):
    ```bash
    npm run start:once:web 2>&1 | tee /tmp/run2.log
    ```
    Verify in /tmp/run2.log: a line `[web-scraper] runId=... web-posts-cache: cached=N1 fresh=N2 merged=Nm` where:
    - cached = N1 (file from run 1 loaded successfully)
    - merged ≥ N1 (we never lose what was already there)
    - merged = N1 + (new posts not seen in run 1). For most runs Nm ≈ N1 because the same sources tend to succeed; what matters is that a source which succeeded in run 1 but failed in run 2 is still represented in `merged`.

    Step 5 — cross-run union check (the actual core-value verification):
    ```bash
    node -e '
      const fs = require("fs");
      const d = JSON.parse(fs.readFileSync("data/web-posts-'"${MSK_DATE}"'.json","utf8"));
      const byChan = {};
      for (const p of d.posts) byChan[p.channelUsername] = (byChan[p.channelUsername]||0)+1;
      console.log("posts per channel after 2 runs:", JSON.stringify(byChan, null, 2));
      console.log("total:", d.posts.length, "unique hashes:", new Set(d.posts.map(p=>p.hash)).size);
    '
    ```
    Expect: total === unique hashes (no dup hashes after merge). Channel breakdown shows ≥ as many sources as the union of both runs.

    Step 6 — corrupt-file recovery sanity:
    ```bash
    cp "data/web-posts-${MSK_DATE}.json" "data/web-posts-${MSK_DATE}.json.bak"
    echo "{ this is not json" > "data/web-posts-${MSK_DATE}.json"
    npm run start:once:web 2>&1 | tee /tmp/run3.log
    grep -E "web-posts-cache.*(parse|invalid|corrupt|warn)" /tmp/run3.log || echo "EXPECTED log.warn from cache load — check run3.log"
    grep "web-posts-cache: cached=0 fresh=" /tmp/run3.log && echo "OK: corrupt file → empty cache, run continued"
    # Restore for sanity (the run3 already overwrote it with run 3's union, but if you want the run-2 state back):
    # mv "data/web-posts-${MSK_DATE}.json.bak" "data/web-posts-${MSK_DATE}.json"
    rm -f "data/web-posts-${MSK_DATE}.json.bak"
    ```
    Expect: log.warn fired AND the run completed without crashing AND the new file was rewritten (run 3 treated cache as empty, then merged its fresh posts and saved).

    Step 7 — confirm TG-pipeline untouched and no regression in delivered-keyQuote dedup:
    ```bash
    git diff --stat src/pipeline.ts src/summarize.ts src/dedup.ts
    ```
    Expect: empty (no changes to those files).

    ```bash
    npx vitest run
    ```
    Expect: all suites green.

    If any step fails, the most likely root causes are:
    - Path mismatch (using `data/web-posts-${date}.json` vs `./data/...`) — both resolve to the same place from cwd, but be consistent.
    - MSK-date drift if the run crosses MSK midnight — acceptable (file rotates), just means the second run wrote a new file.
    - Forgetting to import `Post` type in the wire-up — TS will catch this at the `npx tsc --noEmit` step from Task 2.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo && npx vitest run && git diff --stat src/pipeline.ts src/summarize.ts src/dedup.ts | grep -q "0 insertions\|^$" && echo "TG-pipeline untouched"</automated>
  </verify>
  <done>Two consecutive same-day runs produce a `data/web-posts-${MSK_DATE}.json` whose post count is the UNION (not intersection) of what each run individually scraped. Corrupt-file injection produces a single log.warn and the run continues. All vitest suites pass. `git diff src/pipeline.ts src/summarize.ts src/dedup.ts` is empty.</done>
</task>

</tasks>

<verification>
After all 3 tasks:
- New file exists: `src/web-posts-cache.ts` (with `compositeHash`, `loadDailyWebPostsCache`, `mergeWebPostsByCompositeHash`, `saveDailyWebPostsCache`, `todayMsk` exports).
- New file exists: `src/__tests__/web-posts-cache.test.ts` (≥11 tests, all green).
- `src/web-scraper.ts` modified with: import from `./web-posts-cache.js`, merge block between `writeRawWeb` and `summarize`, gate condition updated to `mergedPosts.length > 0`.
- `summarize()` is called with `mergedPosts`, NOT `posts`.
- `loadHashCache`/`commitHashCache` flow byte-identical (still gates delivered-keyQuote dedup).
- `data/web-posts-${MSK-date}.json` produced on run, schema matches spec, atomic-write leaves no `.tmp` files.
- TG-pipeline files (`src/pipeline.ts`, `src/summarize.ts`, `src/dedup.ts`) UNCHANGED — `git diff` empty for these.
- No new entries in `package.json` dependencies.
- `npx vitest run` and `npx tsc --noEmit` both clean.
</verification>

<success_criteria>
1. Source `data/web-posts-${MSK-date}.json` exists after a web-pipeline run, with the documented schema (version=1, msk_date, posts[] with url/text/channelUsername/ts/hash).
2. Across two same-day runs where source A succeeded only in run 1 and source B succeeded only in run 2: the file after run 2 contains posts from BOTH A and B (i.e., information from run 1 is not lost in run 2).
3. Corrupt JSON in the cache file triggers `log.warn` and the run continues with an empty starting cache (no crash).
4. The composite hash key correctly distinguishes (a) same url + same text → one entry, (b) same url + edited text → two entries, (c) different url + same text → two entries.
5. The existing `data/hash-cache.json` (delivered-keyQuote dedup) flow is unchanged — verifiable by inspecting that file is still updated after delivery and `commitHashCache` is still called only after successful `sendToChannel`.
6. TG-pipeline (`pipeline.ts`) git diff is empty.
7. `summarize()` signature is unchanged — only the variable passed in changes.
8. All vitest suites green; `tsc --noEmit` clean.
</success_criteria>

<output>
After completion, a SUMMARY.md is not required for quick tasks (these are atomic). The work itself is the artifact: the new module, the test file, and the wire-up in web-scraper.ts.

Follow-up (NOT in this plan, mention in commit message):
- GC of stale `data/web-posts-*.json` files (older than N days). User OK with accumulation in v1.
- Optionally generalize `todayMsk()` into a shared helper (currently duplicated in archive.ts, logger.ts, summarize.ts, and now web-posts-cache.ts) — defer until a 5th call site emerges.
</output>
