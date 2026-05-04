---
phase: quick-260504-eae
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/summarize.ts
  - src/pipeline.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "Digest header shows total channels from yaml, channels with posts, and channels without posts"
    - "When channels have errors (skipped), header shows error count separately"
    - "DeepSeek prompt enforces per-category limit of 3 items + up to 5 mentions instead of global 15"
  artifacts:
    - path: "src/summarize.ts"
      provides: "Updated renderHtml with channelStats param, updated SYSTEM_PROMPT rule 9"
    - path: "src/pipeline.ts"
      provides: "Passes channelStats to summarize()"
  key_links:
    - from: "src/pipeline.ts"
      to: "src/summarize.ts"
      via: "channelStats passed to summarize()"
      pattern: "summarize\\(freshPosts.*channelStats"
---

<objective>
Two focused fixes to improve digest quality:
1. Enrich the digest header with full channel statistics (total/active/empty/errors)
2. Replace global 15-post limit in DeepSeek prompt with per-category limits (3 per category + 5 mentions)

Purpose: Better transparency for the reader + fairer distribution across categories
Output: Updated src/summarize.ts and src/pipeline.ts
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/summarize.ts
@src/pipeline.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add channelStats to renderHtml and update header format</name>
  <files>src/summarize.ts</files>
  <action>
1. Add a ChannelStats interface: `{ total: number; skipped: number }` (export it).
2. Change `renderHtml` signature to: `renderHtml(digest: DigestJson, posts: Post[], channelStats?: ChannelStats)`.
3. In renderHtml, compute:
   - `k` = unique channels in posts (existing logic)
   - `empty` = channelStats.total - channelStats.skipped - k (channels that succeeded but had zero posts)
4. Build the subtitle line:
   - If no channelStats passed (backward compat): keep existing format `${n} постов из ${k} каналов за 24ч`
   - If skipped === 0: `${n} постов * ${k} из ${channelStats.total} каналов (${empty} без постов за сутки)`
   - If skipped > 0: `${n} постов * ${k} из ${channelStats.total} каналов (${empty} без постов, ${skipped} ошибок)`
   Use the centered dot character (Unicode middle dot U+00B7) for the bullet separator, not asterisk.
5. Change `summarize()` signature to accept optional second param `channelStats?: ChannelStats`.
6. Pass channelStats through to renderHtml call at line 264.
  </action>
  <verify>npx tsx --eval "import { renderHtml } from './src/summarize.js'; console.log('OK')" 2>&1 | grep -q OK && echo PASS || echo FAIL</verify>
  <done>renderHtml accepts channelStats, header shows full statistics when provided, backward-compatible when omitted</done>
</task>

<task type="auto">
  <name>Task 2: Pass channelStats from pipeline to summarize</name>
  <files>src/pipeline.ts</files>
  <action>
1. At the call site (line ~127): change `await summarize(freshPosts)` to `await summarize(freshPosts, { total: channels.length, skipped: channelsSkipped })`.
2. Import ChannelStats type if needed (or rely on inline object matching the interface).
  </action>
  <verify>npx tsx --eval "import { runPipeline } from './src/pipeline.js'; console.log('OK')" 2>&1 | grep -q OK && echo PASS || echo FAIL</verify>
  <done>pipeline.ts passes channel statistics to summarize, TypeScript compiles without errors</done>
</task>

<task type="auto">
  <name>Task 3: Update SYSTEM_PROMPT rule 9 to per-category limits</name>
  <files>src/summarize.ts</files>
  <action>
Replace rule 9 in SYSTEM_PROMPT (line 38) from:
  "9) Отбирай не более 15 самых содержательных постов в сумме по всем массивам."
To:
  "9) Отбирай не более 3 самых содержательных постов на каждую из 5 категорий и не более 5 в массив mentions. Итого не более 20 записей."
  </action>
  <verify>grep -q "не более 3 самых содержательных" src/summarize.ts && grep -q "не более 5 в массив mentions" src/summarize.ts && echo PASS || echo FAIL</verify>
  <done>SYSTEM_PROMPT rule 9 enforces per-category limit (3 each) + mentions limit (5), total cap 20</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` — no TypeScript errors
2. `grep "не более 3" src/summarize.ts` — new prompt rule present
3. `grep "channelStats" src/pipeline.ts` — stats passed to summarize
</verification>

<success_criteria>
- TypeScript compiles cleanly
- renderHtml produces enriched header when channelStats provided
- SYSTEM_PROMPT uses per-category limits instead of global 15
- No breaking changes to existing function signatures (backward compatible via optional params)
</success_criteria>

<output>
After completion, create `.planning/quick/260504-eae-fix-1-fix-2-deepseek-15-3-5-mentions/260504-eae-SUMMARY.md`
</output>
