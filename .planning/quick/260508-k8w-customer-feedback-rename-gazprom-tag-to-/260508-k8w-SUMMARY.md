---
phase: quick-260508-k8w
plan: 01
subsystem: summarize
tags: [classify-prompt, sources, hashtags, customer-feedback]
dependency-graph:
  requires:
    - .planning/quick/260508-b55-classify-system-prompt-gazprom-gazpromne/260508-b55-SUMMARY.md
  provides:
    - "rolf-oil and lubrigard web sources for Oils category"
    - "rolf_oil and lubrigard TG channels"
    - "Full keyword lists in CLASSIFY_SYSTEM_PROMPT for rosneft/gazpromneft/lukoil"
    - "антифриз keyword in oil category"
    - "Hashtag navigation in digest section headers (#Бункер/#Масла/#Керосин/#Нефтехимия/#Битум/#Компании)"
  affects:
    - "Pass 1 classification recall (more refineries/subsidiaries matched)"
    - "Telegram digest navigation UX (clickable hashtags)"
tech-stack:
  added: []
  patterns:
    - "SECTION_HEADERS as const array — Telegram parses #Word inside <b>...</b>"
    - "CLASSIFY_SYSTEM_PROMPT structured as array of strings, joined with \\n"
key-files:
  created: []
  modified:
    - websites.json
    - channels.json
    - src/summarize.ts
    - README.md
decisions:
  - "Use #Компании (single-token) for 6th block — Telegram doesn't parse multi-word hashtags; #Упоминания_компаний rejected for visual noise"
  - "Preserve Газпром-без-нефть exclusion clause inside new rule 3b (parent-company filter)"
metrics:
  duration: "~2 minutes (autonomous quick task)"
  completed: 2026-05-08T11:42:30Z
requirements:
  - QUICK-260508-k8w
---

# Phase quick-260508-k8w Plan 01: Customer Feedback — Sources, Keyword Recall, Hashtag Navigation Summary

Five customer feedback items applied in one quick task: added rolf-oil + lubrigard sources for Oils category (web + TG), expanded company keyword lists for rosneft/gazpromneft/lukoil with full refinery/subsidiary names, added «антифриз» to the oil category, and converted digest section headers to clickable Telegram hashtags (#Бункер / #Масла / #Керосин / #Нефтехимия / #Битум / #Компании).

## Tasks Completed (3/3)

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Rolf and Lubrigard to source lists | `d017e20` | websites.json, channels.json |
| 2 | Expand CLASSIFY_SYSTEM_PROMPT with full company keyword lists | `937c253` | src/summarize.ts |
| 3 | Add hashtag navigation to digest section headers | `56a6aac` | src/summarize.ts, README.md |

## Customer Feedback Items Addressed (5/5)

1. **New Oils sources (Rolf, Lubrigard)** — 2 entries in `websites.json`, 2 entries in `channels.json`. Validated as JSON.
2. **Expanded company keyword lists** — Rule 3a (rosneft) now includes 19+ forms (Роснефть, РН-, РНПК, Башнефть, Уфанефтехим, Новойл, ЯНОС, Славнефть, НЗМП, all NPZ subsidiaries). Rule 3b (gazpromneft) added Московский НПЗ, МНПЗ, Омский НПЗ, NIS. Rule 3c (lukoil) is NEW — ЛУКОЙЛ, ЛЛК, Нижегородский НПЗ/НОРСИ, Волгоградский НПЗ, Пермский НПЗ/ПНОС, Ухтинский НПЗ, Бургас, Петротел, Литаско/Litasco.
3. **«антифриз» in oil category** — appended to oil description on line 38.
4. **Hashtag-prefixed section headers** — all 6 SECTION_HEADERS now carry `#Word` prefixes; render path unchanged.
5. **README.md alignment** — line 77 bold label updated from `**Упоминания компаний**` to `**#Компании**`. Lines 3 and 210 (descriptive prose) untouched per plan.

## Verification

```
=== npm test ===
Test Files  56 passed (56)
Tests       1188 passed (1188)
Duration    1.40s

=== JSON valid ===
websites.json: OK
channels.json: OK

=== TypeScript ===
npx tsc --noEmit -p . — no errors

=== Literals present ===
'rosneft'/'lukoil'/'gazpromneft' in src/summarize.ts: 4 occurrences (3 rules + JSON example)
rolf-oil/lubrigard in websites.json: 2 occurrences
rolf_oil/lubrigard in channels.json: 2 occurrences
#Бункер/#Масла/#Керосин/#Нефтехимия/#Битум/#Компании in src/summarize.ts: 6 occurrences

=== No remaining [Газпром] ===
grep -rE "Газпром\]" src/ README.md → empty (clean)
```

Baseline (pre-task) test count: 56 files / 1188 tests passing. Post-task: identical. Zero new failures.

## Discretion Captured

- **6th block tag = `#Компании`** (single-token). Telegram does NOT support multi-word hashtags — `#Упоминания компаний` would only tag «Упоминания» and orphan the rest. The alternative `#Упоминания_компаний` is visually noisy and underscore-ridden. `#Компании` is semantically clean, navigation-friendly, and aligns with the customer-facing tag style. The prose «Упоминания компаний» is dropped from the rendered header but remains in the architectural code comment at line 248 (descriptive only).
- **`Газпром` keyword in rules 3a/3b** — preserved verbatim. It is the deliberate keyword list element for the parent-company exclusion clause; not removed despite the «no [Газпром] tag» customer requirement (which targets the user-facing inline label, not the LLM keyword list).

## Deviations from Plan

None — plan executed exactly as written. No bugs surfaced, no critical functionality was missing, no blockers encountered.

## Self-Check: PASSED

- websites.json contains `rolf-oil` and `lubrigard`: FOUND
- channels.json contains `rolf_oil` and `lubrigard`: FOUND
- src/summarize.ts contains rules `3a)` `3b)` `3c)`: FOUND (3 rule labels)
- src/summarize.ts contains «антифриз»: FOUND
- src/summarize.ts contains `#Компании`, `#Бункер`, `#Масла`, `#Керосин`, `#Нефтехимия`, `#Битум`: FOUND (6/6)
- README.md line 77 contains `🏢 **#Компании**`: FOUND
- Commit `d017e20`: FOUND in `git log`
- Commit `937c253`: FOUND in `git log`
- Commit `56a6aac`: FOUND in `git log`
- npm test exits 0 (1188/1188 passing): VERIFIED
- npx tsc --noEmit passes (no TypeScript errors): VERIFIED
