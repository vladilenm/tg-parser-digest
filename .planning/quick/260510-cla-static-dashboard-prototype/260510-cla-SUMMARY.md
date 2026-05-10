---
quick_id: 260510-cla
description: Прототип статического дашборда для дайджестов
date: 2026-05-10
status: completed
---

# Quick Task 260510-cla — Summary

## Goal
Build a self-contained, zero-runtime-deps static HTML dashboard that visualizes accumulated digest data (`data/raw/*.json` + `data/output/*.md`) without changing the existing pipeline.

## Outcome
`npm run dashboard` produces `${DATA_DIR}/dashboard/index.html` — a single ~3 MB self-contained file with inlined data, Chart.js via CDN, and vanilla JS interactivity. Verified end-to-end on 1398 posts and 124 events across 6 categories.

## Commits
| # | Hash | Type | Title |
|---|------|------|-------|
| 1 | `305ac91` | feat | build-dashboard data loaders + MD digest parser |
| 2 | `bb614cb` | feat | full HTML template + 4 widgets + vanilla JS |
| 3 | `449e4af` | chore | wire `npm run dashboard` + ignore /data/dashboard/ |

## Files touched
- `scripts/build-dashboard.ts` (new, 581 lines)
- `package.json` (+1 line — `dashboard` script)
- `.gitignore` (+3 lines — `/data/dashboard/`)

## Widgets shipped
1. Header: title, date-range presets (7d / 30d / all), summary tile (channels / websites / generatedAt)
2. Line chart — posts per day, two series (tg vs web)
3. Bar chart — top-15 sources by post count
4. Donut — distribution by category (parsed from MD digests)
5. Events feed — brief description + quoted excerpt + source link, with category/company filters and substring search

## Key technical choices
- **Zero new deps.** `tsx` was already a devDep; Chart.js loads from `cdn.jsdelivr.net` at runtime.
- **Inline JSON payload** in `<script type="application/json" id="data">` (not a separate file) — opens via `file://` with no server.
- **`</` → `<\/` escape** on JSON payload to defuse `</script>` collisions; verified 14 occurrences fire on real data.
- **`textContent` for post text** — no `innerHTML` anywhere user-supplied text reaches the DOM.
- **File-based date as source of truth** (MSK), not the ISO `date` field inside posts — avoids TZ confusion.
- **Uses `src/paths.ts`** (`DATA_DIR/raw`, `DATA_DIR/output`) — respects the persistent-volume layout from quick-260509-k9l.
- **Pipeline source files (`src/`) untouched.** Pure dev tool.

## Auto-fixes during execution
1. **[Bug]** Section regex `\s#(...)` made `#` optional (`\s*?(...)`). Web digests omit `#` before category names; strict regex would silently drop ~28% of events. Verified: 0 unparsed lines.
2. Added "Сводка" sidebar tile to fill the empty 4th grid cell on wide screens (channels / websites / generated-at).
3. Added date + source tags on each event item, sorted newest-first — 124 events across 12 days from 2 sources is hard to scan without them.

## Verification on real data (parent repo)
- 1398 posts indexed
- 124 events parsed across 6 categories: Битум 59, Бункер 5, Керосин 7, Компании 9, Масла 21, Нефтехимия 23
- 2 source types: tg 89, web 35
- All required HTML markers present: `id="data"`, `cdn.jsdelivr.net/npm/chart.js`, `chart-timeline`, `chart-sources`, `chart-categories`, `events-list`
- TypeScript `--noEmit` clean

## How to run
```bash
npm run dashboard
open data/dashboard/index.html
```

## Out of scope (intentionally)
- Live HTTP serving (open `file://` directly, or `npx serve data/dashboard`)
- Authentication
- Mutations to the existing pipeline
- Persisted dashboard state / saved filters
