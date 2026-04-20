# Domain Pitfalls: Oil & Gas Intelligence Monitor

**Domain:** B2B Competitive Intelligence Digest (Telegram-based)
**Researched:** 2026-04-20
**Source:** SPEC §13 risk catalog + market research on news aggregators, alert systems, digest platforms

---

## Critical Pitfalls

Mistakes that cause rewrites, missed deadlines, or customer loss.

### Pitfall 1: Semantic Dedupe Threshold Set Wrong

**What goes wrong:**
- Threshold too high (0.95): Only identical articles dedupe. "Gazprom reports 10M barrels" and "Gazprom: 10M barrels" treated as different → two digest entries.
- Threshold too low (0.80): Unrelated articles merge → wrong cluster, wrong summary.

**Why it happens:**
- Cosine similarity is sensitive to embedding model + threshold. No golden standard.

**Consequences:**
- User sees "same news" twice → loses trust.
- Defeats purpose of dedupe.

**Prevention:**
1. Start with SPEC default (0.90).
2. Log cosine similarity distribution (histogram).
3. Post-MVP: analyze histogram with customer. Tune if needed.
4. Config-driven: `DEDUPE_COSINE_THRESHOLD` in env.
5. Weekly audit: spot-check 5 dedupe pairs. Verify cosine scores are correct.

**Detection:**
- Customer: "I saw same news twice."
- Monitoring: dedupe similarity distribution shifts.

---

### Pitfall 2: Summarizer Hallucination (keyQuote Doesn't Exist in Source)

**What goes wrong:**
- Summarizer returns: `keyQuote = "Gazprom exports 15M barrels to EU."`
- Verification: `rawText.includes(keyQuote)` → **false**.
- Digest sent with fabricated quote → customer sees quote that isn't real → trust destroyed.

**Why it happens:**
- LLMs rewrite facts for conciseness.
- Claude Sonnet excellent at extraction but prompt not strict enough.

**Consequences:**
- SPEC §12 criterion 4 fails: "100% verbatim keyQuote."
- Pilot rejected.
- Customer loses trust in *all* quotes.

**Prevention:**
1. Post-summarize validation: `if (!rawText.includes(keyQuote)) { retry }`
2. Second retry with STRICTER prompt: "keyQuote MUST be EXACT substring."
3. If still fail: skip item. Log.
4. Monitor retry rate: alert if >5%.

**Detection:**
- SPEC §12 test: manually check 20 items. 100% must pass `includes()` check.
- Monitoring: log retry cases.

---

### Pitfall 3: Classify Accuracy Degradation Over Time

**What goes wrong:**
- MVP launches with ≥85% accuracy on 50-item golden set.
- 2 weeks later: new terminology emerges (OPEC+ policy, regulation).
- Model never saw it → accuracy drops to 78%.
- Digest quality degrades → customer complains.

**Why it happens:**
- Oil & gas language evolves. Claude prompts are static.
- No retraining loop in MVP.

**Consequences:**
- Digest quality degradation over weeks/months.
- Customer loses competitive advantage.

**Prevention:**
1. Monthly accuracy audit: sample 20 new items, manually label, calc F1.
2. Maintain golden dataset: grow from 50 → 100 → 200 over time.
3. Prompt versioning: iterate classify prompt if accuracy drops.
4. A/B test prompts on sample batches.
5. Customer feedback loop: collect marked-wrong classifications.

**Detection:**
- Monthly accuracy report.
- User complaint: "Missing news about X direction."

---

### Pitfall 4: Dedupe Miss — Same Story, Multiple Times in Digest

**What goes wrong:**
- Story: "Gazprom and Shell joint venture."
- Posted to 3 channels: RIA, Oil Daily, Energy Russia.
- Cosine similarity: 0.91 (should dedupe).
- Embedding variation or race condition: items not detected as duplicates.
- Result: 3 entries in digest for 1 story.

**Why it happens:**
- Embedding model stochasticity or text preprocessing edge cases.
- Async ingest: items ingested at different times, dedupe window state varies.

**Consequences:**
- Digest looks noisy. Same news repeated.
- User thinks system is low-quality.

**Prevention:**
1. Log all dedupe decisions: source hash, embedding (first 10 dims), similarity scores, decision, cluster_id.
2. Post-digest audit: spot-check 5 items. Query: are there others with sim >0.85 in same window? Log missed dupes.
3. Temporal padding: extend dedupe window from 24h → 26h.
4. Embedding stability: normalize input (lowercase, whitespace) before embed. Cache to avoid recomputation.
5. Reprocessing: if dedupe miss found post-send, re-run dedupe w/ lower threshold.

**Detection:**
- Post-digest: count items per cluster_id. Rare clusters with 5+ items → merge failure.
- User complaint: "Same story 3x."
- Manual review: digest analysis compares text + source.

---

## Moderate Pitfalls

Operational issues that degrade UX but don't kill MVP.

### Pitfall 5: FloodWait Rate Limiting Stalls Ingest

**What goes wrong:**
- System ingests from 15 channels actively.
- Hits Telegram rate limit → FloodWait(3600) (wait 1 hour).
- Ingest stalls. No new messages for 1 hour.
- Digest at 20:00 misses last hour's news.

**Why it happens:**
- GramJS + MTProto has stricter rate limits than bot API.
- High message frequency + peak hours = higher chance of hit.
- Single user-session (MVP constraint).

**Consequences:**
- Latency spike (digest may be 1h late).
- SPEC §12 criterion "≤1 min latency" at risk.

**Prevention:**
1. Exponential backoff (SPEC §13): wait N + 10% jitter, retry.
2. Queue debounce: add 500ms between GramJS ops (SPEC §9).
3. Rate limit monitoring: log every FloodWait, alert if >5 min cumulative/hour.
4. Phase 2: multi-account rotation (avoid this bottleneck).
5. Ingest buffering: stagger channels by priority.

**Detection:**
- Logs: `FloodWait(3600)` messages.
- Queue depth spike.
- Digest late on specific date.

---

### Pitfall 6: Digest Delivery Late (>1 min drift from 20:00 MSK)

**What goes wrong:**
- Cron: 20:00 MSK. Actually sent at 20:04 (+4 min drift).
- Customer: digest promised at 20:00, unreliable if late.
- Or: TZ bug (croner runs in UTC, not MSK) → 8h offset.

**Why it happens:**
- Compose digest takes 10–30s. System load → 2+ minutes.
- TZ misconfiguration.

**Consequences:**
- SPEC §12 criterion "20:00 ± 1 min" at risk.

**Prevention:**
1. TZ-aware cron (SPEC §9 step 11): use `DIGEST_TIMEZONE=Europe/Moscow` env var, pass to Croner.
2. Measure latency: log `digestTriggeredAt` vs `sentAt`. Alert if >2 min.
3. Optimize compose: profile, target <30s.
4. Load testing: run digest during peak ingest. Confirm <1 min latency.

**Detection:**
- Monitoring: `digests.sentAt - scheduledTime`. Alert if >60s drift.
- Manual: set cron to 5-min future, observe actual send time.

---

### Pitfall 7: Empty Digest (0 Items in 24h Window)

**What goes wrong:**
- 24h window: 0 items match filter `importance >= 2`.
- System sends "No relevant news today."
- Customer: confused ("Is system broken? Or really no news?").

**Why it happens:**
- Legitimate: quiet news cycle.
- Or: classify too strict (importance all 1s).

**Consequences:**
- Minor confusion, not system failure.
- If frequent (>2x/week): customer questions value.

**Prevention:**
1. Accept empty digests. Template: "No relevant news today (all channels scanned)."
2. Monitor empty digest %. If >20% → investigate classify accuracy.
3. Optional: lower importance threshold to `>= 1` if >30% empty.
4. Cross-check channels: alert if no new messages from any channel in 12h.

**Detection:**
- Check `itemIds.length == 0` in digests.
- Monitor empty digest rate.

---

### Pitfall 8: Message >4096 Characters

**What goes wrong:**
- Digest renders to 5000 chars.
- Telegram API: "Message too long" (414 error).
- Digest fails to send.

**Why it happens:**
- 7 items × 5 directions = 35 items max. Each ~350 chars (summary + quote + attribution).
- No auto-split in MVP code.

**Consequences:**
- Digest not sent at 20:00.
- SPEC §12 criterion 5 failed.

**Prevention:**
1. Pre-send check: measure `contentMd.length` before send.
2. If >4096: split into parts `(1/N)`, send separately.
3. Test early: manually compose digest w/ 7+ items. Measure. Adjust limit if needed.
4. Unit test: assert digest length <4096.

**Detection:**
- Telegram API error 414.
- Monitoring: log `contentMd.length` before send. Alert if >3500 (warn).

---

## Minor Pitfalls

Quirks that don't break MVP.

### Pitfall 9: Embedding Cache Miss (Redis Down)

**What goes wrong:**
- Redis crashes.
- Cache unavailable.
- Falls back to OpenAI API for every embed.
- Cost spikes 10x, latency increases.

**Why it happens:**
- Redis single point of failure in MVP.

**Consequences:**
- Cost: $0.02 → $0.20/day.
- Latency: OpenAI ~500ms vs Redis <1ms.
- MVP still works, degrades.

**Prevention:**
1. Graceful fallback: if Redis unavailable, call OpenAI (log warning).
2. Monitor Redis connectivity. Alert if down >10s.
3. Cache warmth: log % from cache. If <80% → investigate.
4. Phase 2: Redis persistence, replication.

**Detection:**
- OpenAI calls when cache should hit.
- Redis availability check.

---

### Pitfall 10: Process Worker Crash → Job Stuck in DLQ

**What goes wrong:**
- Worker crashes (LLM timeout, unhandled exception).
- BullMQ retries 3x, all fail.
- Job moved to Dead Letter Queue.
- Item never processed, missing from digest.

**Why it happens:**
- Edge case: LLM timeout, network glitch, malformed text.

**Consequences:**
- Missing 1 item from digest. Minor: low risk.

**Prevention:**
1. Log DLQ items. Alert if >10 in DLQ over 7 days.
2. Manual retry script (phase 2).
3. Error context: log full error + item data for post-mortem.
4. Timeout tuning: set reasonable LLM timeouts (30s). Skip item if timeout.

**Detection:**
- BullMQ DLQ depth monitoring.
- Digest completeness: expected ≥50, actual <50 → investigate.

---

### Pitfall 11: MarkdownV2 Escaping Errors

**What goes wrong:**
- Digest uses MarkdownV2 (bold, links).
- Source has special char `_`, `*`, `[`, `]`.
- Escaping missed → Telegram API rejects message.
- Digest fails to send.

**Why it happens:**
- MarkdownV2 requires escaping 10+ characters. Easy to miss.

**Consequences:**
- Digest fails to send (SPEC §12 criterion 5).
- Brief to fix (switch to HTML).

**Prevention:**
1. **Use HTML, not MarkdownV2** (SPEC §15 rule 7).
2. HTML: only 3 chars need escaping (`&`, `<`, `>`).
3. Test w/ special-char source text.

**Detection:**
- Digest template tests include special chars.
- Telegram API error.

---

## Phase-Specific Warnings

| Phase | Topic | Pitfall | Mitigation |
|-------|-------|---------|-----------|
| **1 (MVP)** | Classify accuracy | Golden set too small or unrepresentative. <85% on real batch. | Spend time on golden set. Edge cases, terminology variety. Expand to 100+ items monthly post-MVP. |
| **1 (MVP)** | keyQuote validation | Hallucinated quotes slip through. | Implement strict validation + retry. Manual verify 20 items before acceptance. |
| **1 (MVP)** | Dedupe threshold | No post-ingest analysis. Threshold never validated. | Post-first 24h, analyze similarity histogram. Show customer. Adjust if needed. |
| **1 (MVP)** | 48h uptime test | Test under normal load, not peak. | Stress test: peak load (all channels posting). Run cron during heavy ingest. Confirm no race. |
| **2 (Expansion)** | 50-channel ingest | Scaling complexity, cost, latency. | Phase 1: establish baseline (ingest time, dedupe latency, LLM cost). Phase 2: project 50 × baseline. If >3x cost or >10% latency, optimize. |
| **2 (Expansion)** | RSS/HTML parsing | Encoding issues, formatting variability. | Start w/ 1 RSS source. Validate parsing on 100 items before expanding. |
| **3 (Dashboard)** | Metabase query perf | Historical query (100K items) slow. | Phase 1: item insert rate baseline. Phase 2: archive old, optimize queries. Phase 3: profiling before dashboard. |
| **Prod** | GigaChat/YandexGPT | LLMProvider interface ready, but API different. | Implement GigaChat provider before prod. Run parallel test (Claude + GigaChat) on 50 items. Compare accuracy, cost, latency. |

---

## Sources

- [SPEC.md §13 Known Risks](../../SPEC.md#13-известные-риски-учёт-в-mvp)
- [SPEC.md §15 Claude Code Hints](../../SPEC.md#15-подсказки-для-claude-code)
- [Architecture strategies for designing a monitoring system – Microsoft Azure](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/observability)
- [System Design: News Aggregator (Dedup, Clustering) – CrackingWalnuts](https://crackingwalnuts.com/post/news-aggregator-system-design)
- [How to Fix Telegram FloodWait Error – MemberTel](https://membertel.com/blog/how-to-fix-telegram-floodwait-error-fast/)
- [Scaling Up IV: Flood Limits – grammY](https://grammy.dev/advanced/flood)
- [8 Common Mistakes To Avoid With Your B2B Newsletter](https://www.thesciencemarketer.com/b2b-newsletter-common-mistakes/)
