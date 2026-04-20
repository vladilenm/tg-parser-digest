# Feature Landscape

**Product:** Oil & Gas Intelligence Monitor
**Domain:** B2B Competitive Intelligence Digest (Telegram-based, Russian oil & gas industry)
**Researched:** 2026-04-20

---

## Executive Summary

Oil & Gas Intelligence Monitor is a specialized B2B competitive-intelligence product solving a critical gap in Russian oil & gas market: **daily, low-noise, verifiable digests of market-moving news focused on target company + competitors**. The competitive-intelligence space shows that **AI-powered real-time monitoring with high-precision classification is now table stakes** (68% of B2B deals involve competitors; teams unprepared lose $2–$10M/year in winnable deals). For this pilot, success is defined by *accuracy* (≥85% direction, ≥90% company tags), *verifiability* (100% verbatim keyQuote), and *zero hallucinations*—not feature breadth.

**Key market insight:** Production intelligence platforms handle 50,000+ articles/day across diverse sources and use semantic deduplication + extractive summarization to prevent noise fatigue. This pilot targets *10–15 high-signal Telegram sources* instead, accepting lower volume in exchange for higher precision and faster deployment.

---

## Table Stakes

Features users expect in a competitive-intelligence digest. Missing any = product feels incomplete or untrustworthy.

| Feature | Why Expected | Complexity | Maps to SPEC | Notes |
|---------|--------------|------------|--------------|-------|
| **Daily digest delivery on schedule** | B2B decision-makers rely on consistent, timely intelligence—missing one day breaks trust. Digest must arrive ±1 min of promised time. | Medium | §1, §9 step 11, §12 criterion 5 | Idempotency required (retry-safe). 48h uptime non-negotiable. |
| **Semantic deduplication** | Same news from 3+ channels creates noise fatigue; users expect "one headline = one digest entry." Cosine similarity thresholding prevents this. | Medium | §2, §5, §9 step 7.4, §12 criterion 3 | SPEC: pgvector, 0.90 threshold. Tuneable in config, logged for audit. |
| **Relevance filtering** | Raw channel feeds are noisy (off-topic retweets, event announcements, off-color jokes). System must only surface news relevant to oil & gas B2B + target/competitors. | High | §9 step 7.3, §12 criterion 2 | Classification task (Claude Haiku). ≥85% direction accuracy, ≥90% company tag accuracy. Requires training data. |
| **Extractive, verifiable summarization** | Users must trust the digest—no creative interpretations, no made-up numbers. Each statement provable back to raw text. keyQuote is 100% verbatim substring (validated post-summarize). | High | §5, §9 step 7.5, §10, §12 criterion 4 | Extractive-only prompting. Retry logic if `rawText.includes(keyQuote)` fails. 100% accuracy on 20 random items = acceptance. |
| **Company + direction tagging** | Digest must answer: "Is this about our company or competitors?" and "Which segment (bunker/oils/kerosene/petrochem/bitumen)?" Without tags, digest is unsortable. | Medium | §5, §9 step 7.3, §12 criterion 2 | Multi-label classification. 4 company classes (target, competitor_a, competitor_b, other); 5 direction classes. |
| **Clickable source attribution** | Each digest entry must link back to original Telegram message for verification and context. URL must be valid and deep-linkable. | Low | §5 (messageUrl), §9 step 5 | `https://t.me/<channel_username>/<message_id>`. Populated during ingest. |
| **Latency ≤60s from publication to processing** | News moves fast; if system lags hours, user may have already seen story elsewhere, reducing perceived value. Ingest → queue → process pipeline must be fast. | Medium | §1, §12 criterion 1 | GramJS listener + BullMQ. Target: 60s from Telegram post to items in DB. |
| **Configurable channel list** | Customers must be able to add/remove monitored channels without code changes. List lives in `config/channels.yaml`. | Low | §6, §7 | YAML-based, reloadable (ideally hot-reload on worker restart). |
| **Configurable target/competitor names** | Product must *never* hardcode company names (security risk, inflexible, violates SPEC §15 rule 2). All names in env/config. | Low | §6, §7, CLAUDE.md requirement | TARGET, competitor_a, competitor_b as env vars + yaml. |
| **Graceful degradation on LLM failures** | If Claude API is down, system should queue and retry, not crash or send corrupted digests. | Medium | §13 risk: "LLM returns invalid JSON" | zod validation + 1 retry. If persistent failure: log, alert, skip item. |
| **Idempotent digest delivery** | Running digest.worker twice in one day should not send two digests. Check `digests` table for today's date; skip if exists. | Low | §1, §9 step 11, §12 criterion 5 | Unique constraint on `digests.digest_date`. |

---

## Differentiators

Features that set product apart from generic news aggregators. Not expected, but valued by oil & gas B2B customers.

| Feature | Value Proposition | Complexity | MVP Feasibility | Notes |
|---------|-------------------|------------|-----------------|-------|
| **100% extractive summarization (no hallucinations)** | Most AI news summarizers add inferences or rewrite facts. This system **only quotes verbatim**—oil & gas is compliance-sensitive; customers trust what they can verify. | High | YES (core SPEC requirement) | Competitive moat vs. generic AI summaries. Post-summarize check: `rawText.includes(keyQuote)`. Retry on fail. Becomes marketing point: "AI without bullshit." |
| **Russian-language specialized classification** | English news aggregators exist; few handle Russian oil & gas terminology precisely (бункеровка, мазут судовой, IFO, VLSFO). Custom prompts for domain. | Medium | YES | SPEC §10 includes Russian-specific classify + summarize prompts. Claude Haiku handles RU well. Differentiates vs. Feedly/Google News. |
| **Competitor benchmarking view** | Digest groups by direction, but could add cross-company summary: "Today, Competitor A mentioned 2x as much as TARGET in bunker segment." Trend visibility. | Medium | NO (MVP) — deferred to phase 2 | Useful post-MVP. Requires aggregation over time. Out of scope. |
| **Inbound link frequency (trending signals)** | Track how often each company is mentioned across all monitored channels over 7-day window. Spike = potential market event. | Medium | NO (MVP) — deferred to phase 2 | Adds dashboard/alerting layer. Out of scope for text-digest MVP. |
| **Cross-channel corroboration score** | If same story appears in 5 channels, mark as "High confidence." If 1 channel only, flag as "Unverified report." Helps distinguish rumor from fact. | Low | YES — light implementation | Add field to items: `sourceCount: int` (how many channels). Include in digest template. Low-effort, high-value. |
| **Manual re-send & editing interface** | Oncall engineer should be able to manually trigger digest for past date or edit/resend if typo found. (Admin panel.) | Medium | NO (MVP) — manual script | SPEC §11: `scripts/send-test-digest.ts` (CLI only). Full UI deferred. |
| **Admin command: tune dedupe threshold live** | Toggle `DEDUPE_COSINE_THRESHOLD` in config, reload workers, see impact on same 24h batch without re-ingesting. | Low | YES (partial) | SPEC §6 says threshold in config. Live reload harder. MVP: restart workers (downtime acceptable for pilot). |
| **Quality dashboard: classify accuracy** | Page showing 50-item sample with human-labeled ground truth vs. model predictions. Precision/recall/F1 breakdown by direction & company. | Medium | YES (as CSV report, not UI) | SPEC §12 criterion 2 requires ≥85% direction / ≥90% company on 50 samples. Report-generation script, not live dashboard. |
| **Multi-language support (later: Ukraine, Kazakhstan, Asia)** | Future expansion. Not MVP. | High | NO | Out of SPEC §14. Deferred to stage 2+. |

---

## Anti-Features

Features to **deliberately NOT build in MVP**. Including rationale to avoid scope creep.

| Anti-Feature | Why Avoid | What to Do Instead | Reference |
|--------------|-----------|-------------------|-----------|
| **All 50 industry Telegram channels** | Ingest latency, dedupe complexity, and LLM cost scale linearly with channel count. MVP pilots with 10–15; stage 2 expands. | Start with 10–15 priority channels from customer. Add more after acceptance. | SPEC §14, §3 |
| **Official RSS/website scraping (Rosneft, Lukoil, Gazprom)** | Adds HTML parsing, CMS-specific extraction, copyright/robots.txt compliance. Telegram-only is faster to market. | Telegram aggregates official announcements anyway; monitor via channels. Stage 2: add RSS. | SPEC §14 |
| **Real-time streaming dashboard** | Requires WebSocket, React frontend, Redis pub/sub. MVP is CLI + digest email (text-only). | Digest email *is* the dashboard. Metabase/Next.js dashboard → stage 3. | SPEC §14, §16 |
| **RAG-powered Q&A assistant** | "Ask anything about recent news"—requires vector DB, embedding store, orchestration. Adds latency to ingest pipeline. | Digest *summarizes*; users read it. Assistant → stage 4 (separate service). | SPEC §14 |
| **Sentiment analysis on text** | Tempting add-on (is market sentiment bullish?). But oil & gas news is factual/transactional, not opinion-driven. Adds cost, low ROI. | Skip. Focus on facts. Sentiment analysis is noise for this customer. | Domain-specific decision |
| **Multi-account Telegram session rotation** | Single user-session can hit rate limits under high ingest. Rotating accounts circumvents limits. But adds complexity: session mgmt, account access, legal risk. | Start with one account. If hit FloodWait → add backoff logic (SPEC §13). Stage 2: account rotation. | SPEC §14, §15 rule 8 |
| **Message forwarding / rewriting** | System could reformat digest as "news article" and post to company's own public Telegram channel. Tempting, adds exposure. | No. MVP: digest to *private* channel only. Customers control distribution. | Out of scope / privacy |
| **Bitsab (shipping cost index) integration** | Specific to bunker segment; requires API key, adds data dependency. | Nice-to-have post-MVP. Skip for pilot. | SPEC §14 |
| **MarkdownV2 parse mode** | Telegram supports MarkdownV2 (bold, links, code blocks). Requires extensive escaping (`_`, `*`, etc.). Easy to break. | Use `parse_mode: "HTML"` instead (simpler, more robust). SPEC §15 rule 7. | SPEC §7, §15 rule 7 |
| **Bot API for reading public channels** | Tempting to use one bot for both reading and sending. Bot API **cannot read public channels**—only user-session (MTProto) can. | Use GramJS (user-session) for read, grammy (bot API) for send. Don't mix. | SPEC §2, §15 rule 8 |
| **LLM streaming (partial completions)** | Could stream classify/summarize responses incrementally. Adds complexity to pipeline. | Use blocking `.complete()` calls. Fast enough for digest schedule. | Implementation simplicity |
| **Custom fine-tuned classifier** | Building domain-specific model on 500 annotated samples would improve accuracy slightly. But 4 weeks of labeling. | Use Claude + few-shot prompting. Accuracy target ≥85% achievable. | Timeline constraint |
| **Webhook / Slack alerts on digest send failure** | "Alert me if 20:00 digest fails." Requires Slack SDK, webhook plumbing. | Oncall engineer monitors logs/DB. Cron logs failures. Early-stage pilot doesn't need Slack integration. | Complexity vs. value |
| **Historical trending / archive search** | "Show me all bunker news about TARGET from last 30 days." Useful, but adds query layer + indexed search. | Digest is point-in-time summary. Historical archive → dashboard/stage 3. | Out of MVP scope |

---

## Feature Dependencies

```
Core ingest → normalize → embed → classify
                                      │
                                      ├─→ (if !isRelevant) → STOP
                                      ├─→ (if directions.length == 0) → STOP
                                      └─→ dedupe (needs embedding)
                                           │
                                           └─→ summarize (if not dup)
                                                │
                                                └─→ persist (items table)

Daily cron (20:00) → compose digest (selects from items 24h window)
                        │
                        ├─→ filter: importance ≥ 2 + (mentions company | isEvent)
                        ├─→ dedupe: 1 item per cluster_id, max importance wins
                        ├─→ group by direction
                        └─→ send via grammy bot → private channel
                             │
                             └─→ idempotency check: skip if `digests` table has today's entry
```

**Critical dependency chain:**
- Embedding must succeed (Redis cache or OpenAI API) before dedupe
- Classify must succeed (JSON valid + ≥1 direction) before summarize
- Summarize must succeed (keyQuote verified) before item is saved
- Digest compose requires ≥1 item in 24h window (can be empty, that's OK)

---

## MVP Feature Prioritization

### Must-Have (Blocking Acceptance)

1. **Daily digest delivery ±1 min MSK** — §12 criterion 5
2. **Semantic dedupe (0.90 cosine)** — §12 criterion 3
3. **Relevance classification (≥85% direction, ≥90% company)** — §12 criterion 2
4. **Extractive summarization (100% verbatim keyQuote)** — §12 criterion 4
5. **Ingest latency ≤60s** — §12 criterion 1
6. **Company + direction tagging**
7. **Source attribution (clickable links)**
8. **Configurable channels / companies**
9. **Graceful LLM error handling** (retry, don't crash)
10. **48h uptime without manual intervention** — §12 criterion 6

### Should-Have (Nice, Feasible)

- Cross-channel corroboration score (sourceCount in digest)
- Quality report (classify accuracy on 50-item sample)
- Config reload on worker restart (dedupe threshold tunable)
- Manual test-digest trigger (send-test-digest.ts script)

### Nice-To-Have (Defer to Phase 2+)

- Competitor benchmarking view
- Real-time dashboard / Next.js UI
- Admin panel (edit/resend digest)
- Historical archive search
- Alert webhooks (Slack, email)
- Multi-account session rotation

---

## Operational Features (Ops Surface)

For **48h hands-off operation**, oncall engineer needs:

| Capability | Why Needed | Implementation |
|-----------|-----------|-----------------|
| **Ingest health** | "Are new messages flowing in?" | Monitor Redis queue depth + `messages` table insert rate. Alert if flat for >30 min. |
| **Process queue health** | "Are items being processed?" | Monitor BullMQ queue `process` depth + item insert rate. Alert if >100 items stuck in queue. |
| **LLM API failures** | "Is Claude/OpenAI responding?" | Catch & log LLM errors (rate limit, auth fail, network). Log to file; oncall checks logs. |
| **Dedupe false negatives** | "Are duplicates leaking into digest?" | Log cosine similarity scores for each dedupe check. Post-digest: compare sent items to manual review sample. |
| **Digest send success** | "Did 20:00 digest get sent?" | Check `digests` table for today's date + `sentAt is not null`. If null, check logs for grammy error. |
| **Database bloat** | "Is `messages` table growing unbounded?" | Monthly cleanup: archive old messages (>30 days) to cold storage or compress. Not critical for pilot. |
| **Redis memory** | "Is Redis evicting keys?" | Monitor Redis memory usage. Embedding cache (TTL 7d) should be <1GB for 10–15 channels. |
| **Manual digest resend** | "Customer needs yesterday's digest resent (typo fix)." | Script `scripts/send-test-digest.ts --date 2025-04-19`. Repurpose for manual send. |
| **Classify accuracy drift** | "Is model accuracy degrading?" | Monthly: sample 20 new items, manually label, compare to model. If <85% → flag for retraining/prompt tuning. |
| **Summarize keyQuote misses** | "Are summaries hallucinating?" | Log all retries in `keyQuote` validation. If >5% retry rate → check prompts / model drift. |

---

## Failure Modes & Mitigations

From SPEC §13 + research on alert systems, digest platforms commonly fail in these ways:

| Failure Mode | Impact | Mitigation (Implemented) | Detection |
|--------------|--------|-------------------------|-----------|
| **Telegram FloodWait** | Ingest stalls for 60–3600s; messages queued in GramJS; perceived latency. | Exponential backoff + wait specified seconds. Retry queue job on FloodWait. | Log FloodWait w/ duration; alert if >5 min wait. |
| **LLM JSON invalid** | classify/summarize returns non-JSON or wrong schema; item rejected. | zod schema validation + 1 retry w/ strict `response_format: json_object`. If 2nd fail: log + skip item. | High error rate in worker logs → oncall investigation. |
| **keyQuote not verbatim** | Summarizer hallucinates; quote doesn't exist in source. Breaks trust. | Post-summarize check: `rawText.includes(keyQuote)`. If fail: 1 retry w/ harder prompt. If still fail: skip item summary. | Log all retry cases; flag model if >5% fail rate. |
| **Dedupe miss (false negative)** | Same story from 2+ channels sent twice in digest. User sees duplicate. | Cosine similarity threshold 0.90 (tunable). Log similarity score for audit. Post-digest: manual spot-check 5 random dedupe pairs. | User complaint or manual review. Re-run dedupe w/ lower threshold. |
| **Digest sent late (> ±1 min)** | Customer schedules decisions around 20:00 digest; late delivery = missed action window. | Use croner (tz-aware) + 1-sec grace. If delayed >2 min: log + alert. | Monitor `digests.sentAt` vs. cron trigger time. |
| **Empty digest (no items in 24h)** | Rarely, but if all messages off-topic → 0 items. Empty digest confuses customer. | OK to send empty digest (document as "No relevant news today"). Include disclaimer in template. | Check `itemIds.length` before send. If 0, optional: skip send (idempotency still works). |
| **Message >4096 chars** | Telegram API rejects oversized message. Digest not sent. | Split into parts `(1/N)`. Test w/ >7 items per direction (should fit). | Measure `contentMd.length` before send. If >4096, auto-split. |
| **Process worker crash** | BullMQ job fails permanently; item stuck in queue. | Retry 3 times (exponential backoff). On 3rd fail: move to DLQ (dead-letter queue). | Monitor DLQ. If >10 items: oncall investigation. |
| **Database connection pool exhausted** | New ingest messages can't be inserted; congestion. | Pool size 10 (§3), wrap writes in transactions. Monitor active connections. | Alert if >8/10 connections busy for >1 min. |
| **Redis down** | Embedding cache unavailable; every summarize re-calls OpenAI. Cost spike + latency. | Cache miss → fetch from OpenAI + retry populate Redis. Degrades gracefully. | Monitor Redis connectivity. Alert if down >10s. |
| **Duplicate message from channel** (upsert conflict) | Same message posted twice (user edited & reposted). | Unique constraint `(tg_channel_id, tg_message_id)` on messages table. Upsert on conflict. | Log upsert conflicts. Rare; not alarming. |

---

## Quality Assurance Features

For **MVP acceptance** (§12), system must prove:

1. **Ingest ≤60s:** Set up test: publish message to monitored channel, measure time to `messages` table insert. Target: <60s median, <90s p99.

2. **Classify ≥85% direction, ≥90% company:** Manually label 50 articles (directions + companies). Run through pipeline. Calculate precision/recall/F1 by class. Target ≥85% / ≥90%. CSV report.

3. **Dedupe: 1 story → 1 item:** Manually post same article to 3+ monitored channels. Check `cluster_id` in digest: all 3 should map to same cluster. Verify only 1 appears in digest.

4. **Summarize 100% verbatim:** Sample 20 random items from recent digest. Manually check: is `keyQuote` an exact substring of `rawText`? Target: 20/20 (100%).

5. **Digest ±1 min MSK:** Monitor `digests.sentAt` vs. cron trigger. Measure latency over 3 sends (consecutive days). Target: 0–60 sec drift.

6. **48h uptime:** Run system for 48 hours with no manual restarts. Monitor for worker crashes, DB errors, queue backlog. Document any interventions.

---

## Sources

- [20+ B2B SaaS Trends That Will Drive The Industry In 2026 – SaaS Capital](https://growth.cx/blog/b2b-saas-trends/)
- [Competitive Intelligence for B2B SaaS: A Practical Playbook](https://www.userintuition.ai/posts/competitive-intelligence-b2b-saas/)
- [The Ultimate Guide to Competitive Intelligence in 2025 – Rivalyze](https://rivalyze.io/blog/ultimate-guide-competitive-intelligence-2025)
- [15 Best AI Competitor Analysis Tools for Sales (2026) – Autobound](https://www.autobound.ai/blog/top-15-competitive-intelligence-tools-2026)
- [Marketing Intelligence Platforms 2026 – Improvado](https://improvado.io/blog/marketing-intelligence-tools)
- [Market Intelligence and Search Platform – AlphaSense](https://www.alpha-sense.com/solutions/market-intelligence-platform/)
- [System Design: News Aggregator (100K Sources, Dedup, Personalized Ranking) – CrackingWalnuts](https://crackingwalnuts.com/post/news-aggregator-system-design)
- [News Aggregator and Efficient Summarization System – Scientific Reports](https://www.researchgate.net/publication/342626761_News_Aggregator_and_Efficient_Summarization_System)
- [Oil and Gas Market Research — AI & Content Workflows – AlphaSense](https://www.alpha-sense.com/solutions/oil-gas-market-research/)
- [Top 10 AI tools driving innovation in oil and gas – Energy Intelligence](https://energy-oil-gas.com/news/top-10-ai-tools-driving-innovation-in-oil-and-gas-operations/)
- [Architecture strategies for designing a monitoring system – Microsoft Azure](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/observability)
- [Monitoring and Alerting Setup: Observability for Production Systems – Open Door Digital](https://opendoordigital.dev/blog/monitoring-alerting-setup)
- [Scaling Up IV: Flood Limits – grammY](https://grammy.dev/advanced/flood)
- [Avoiding flood limits – python-telegram-bot Wiki](https://github.com/python-telegram-bot/python-telegram-bot/wiki/Avoiding-flood-limits)
- [How to Fix Telegram's FloodWait Error – MemberTel](https://membertel.com/blog/how-to-fix-telegram-floodwait-error-fast/)
- [Classification: Accuracy, recall, precision, and related metrics – Google Machine Learning](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall)
- [Evaluating Machine Learning for News Article Classification – Medium](https://medium.com/@anupam.kumar_40930/evaluating-machine-learning-for-news-article-ab9df74b820c)
- [8 Common Mistakes To Avoid With Your B2B Newsletter – The Science Marketer](https://www.thesciencemarketer.com/b2b-newsletter-common-mistakes/)
- [B2B Newsletter Best Practices in 2025 – Callin](https://callin.io/b2b-newsletter-best-practices/)
