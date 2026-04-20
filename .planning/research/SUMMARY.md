# Research Summary: Oil & Gas Intelligence Monitor

**Project:** Oil & Gas Intelligence Monitor — Daily Telegram news digest (MVP pilot)  
**Domain:** Competitive intelligence for B2B oil & gas (Russian market, 5 business segments)  
**Researched:** 2026-04-20  
**Overall Confidence:** **HIGH** (verified against official docs April 2026, production-proven stack)

---

## Executive Summary

The Oil & Gas Intelligence Monitor is a **Telegram-ingest + LLM-summarization pipeline** solving a gap in Russian oil & gas market: daily, low-noise, verifiable competitive-intelligence digests. The MVP targets **10–15 public Telegram channels**, classifies news by 5 directions (bunker, oils, kerosene, petrochem, bitumen) and 4 company classes (target + 3 competitors), deduplicates via semantic similarity (pgvector), and delivers a daily digest at 20:00 MSK.

### Key Findings

**Stack is production-ready (April 2026):**
- Node 22 LTS (Node 20 EOL April 30, 2026; 22 is mandatory for new projects)
- TypeScript 5.9 (stable; 6.0 available but changes config defaults)
- GramJS (2.16+) for reading public channels via MTProto (only way to read; Bot API cannot)
- grammy (1.28+) for Telegram bot delivery (HTML parse mode is simpler than MarkdownV2)
- PostgreSQL 16 + pgvector (0.5+) with HNSW indexing for vector similarity dedupe
- Drizzle ORM (0.36+) with native pgvector support (better than Prisma for this use case)
- BullMQ (5.71+) + Redis for reliable job queue with retry/backoff
- Claude Sonnet 4.6 for classify + summarize (Haiku 4.5 for cost-sensitive classify; verify on 10 test samples first)
- OpenAI text-embedding-3-small (1536 dims, strong on RU text per MIRACL benchmark)
- Croner (8.0+) for timezone-aware cron (handles DST, unlike node-cron)
- Zod v3.24 (stable, no breaking changes; v4 has breaking changes not worth MVP friction)
- Pino (10.3+) for structured logging (ESM/CJS agnostic)

**Feature landscape is lean & testable:**
- **Table stakes (MVP):** Delivery on schedule, dedup, relevance filter, extractive summary with verbatim quote, routing by segment, company detection, sub-60s latency, cost optimization.
- **Differentiators (valuable, not critical):** Zero hallucination guarantee, RU-specialized classification, cross-channel corroboration score.
- **Anti-features (don't build):** Bot API for reading (impossible), MarkdownV2 (too much escaping), hardcoded names (config risk), on-prem LLM (prod-only), dashboard (Phase 3).

**Architecture is straightforward & battle-tested:**
- **One-way pipeline:** GramJS → BullMQ [ingest] → Sequential pipeline (normalize → embed → classify → dedupe → summarize → persist) → Postgres+pgvector → Cron 20:00 → grammy → Private channel
- **Component boundaries:** Clean separation (Telegram client vs bot, LLMProvider/EmbeddingProvider/Deliverer abstractions for future swaps)
- **Concurrency:** Single VPS, docker-compose dev, systemd/docker prod deployment (no Kubernetes)

**Pitfalls are well-documented & preventable:**
- **Critical:** Bot API cannot read channels (GramJS only; locked in architecture), LLM JSON validation (zod + retry), dedupe threshold tuning (0.90 default, env var), extractive validation (keyQuote must be verbatim), DST handling (croner, not node-cron), company names (never hardcode).
- **Moderate:** Embedding cache idempotency, PostgreSQL pool exhaustion, LLM cost overruns.
- **Minor:** 4096 char limit per Telegram message (chunk + footer), logging secrets (redact in prod).

---

## Key Findings (By Domain)

**Stack:**
- Node 22 LTS (only choice for new projects April 2026)
- GramJS + grammy (Telegram reading + sending; two separate clients)
- PostgreSQL 16 + pgvector (HNSW index) + Drizzle ORM
- BullMQ + Redis (job queue with retry)
- Claude Sonnet 4.6 (classify + summarize) with prompt caching
- OpenAI text-embedding-3-small (Russian-capable embeddings)
- Croner (DST-aware scheduling)

**Architecture:**
- Linear pipeline: ingest → normalize → embed → classify → dedupe → summarize → persist
- GramJS reads via user-session; grammy sends via bot API (never mix)
- Semantic dedupe: pgvector cosine similarity > 0.90 in 24h window
- Cron daily at 20:00 MSK (idempotent, no double-send)

**Critical Pitfalls:**
- Bot API cannot read public channels (rewrite risk if wrong)
- Dedupe threshold (0.90 default, must be config, not hardcode)
- Extractive validation (keyQuote must be verbatim; retry if fail)
- Timezone handling (croner for DST, not node-cron)

---

## Implications for Roadmap

Based on research, **suggested phase structure:**

### Phase 1: MVP (1–2 weeks)
**Scope:** Single VPS, 10–15 channels, 5 directions, Claude LLM, Telegram delivery

**Why this order:**
1. **Config + DB setup** (Step 1–3) — Foundation; unblocks everything
2. **Telegram session + ingest** (Step 4–5) — Core data source; test GramJS early
3. **LLM providers** (Step 6) — Abstract layer; allows Claude → GigaChat swap later
4. **Pipeline (normalize → embed → classify → dedupe → summarize)** (Step 7) — Sequential, testable per-message
5. **Queue + workers** (Step 8) — Reliable job processing with retry
6. **Digest composition + delivery** (Step 9–10) — Group, filter, format, send
7. **Cron scheduling** (Step 11) — Daily trigger with timezone & idempotency
8. **Full integration + cleanup** (Step 12) — Test end-to-end on VPS

**Addresses pitfalls:**
- GramJS reading (not Bot API) locked in architecture
- Dedupe threshold in config (DEDUPE_COSINE_THRESHOLD)
- Company names in .env (TARGET, competitor_a_aliases)
- Croner for timezone-aware scheduling
- Zod validation + retry for LLM outputs
- Extractive validation (keyQuote must be verbatim)

### Phase 2: Scale (2–3 weeks post-MVP)
**Scope:** 50 channels, official sources (RSS/HTML), cross-channel corroboration

**Why after MVP:**
- MVP proves accuracy + reliability (classify ≥85%, dedupe works, zero hallucinations)
- Then expand data sources (less risk of new problems)
- Add dashboard/alerting (optional; MVP is CLI + digest only)

### Phase 3+: Advanced
**Scope:** On-prem LLM (GigaChat/Qwen), RAG, sentiment tagging, ML anomaly detection

**Why later:**
- LLMProvider/EmbeddingProvider abstractions are ready; no code rewrite needed
- But on-prem LLM requires ops infrastructure (GPU, model serving) — prod-only decision
- RAG would hurt extractivity (core MVP requirement) — revisit for future product

---

## Phase-Specific Research Flags

| Phase | Topic | Flag | Reason |
|-------|-------|------|--------|
| MVP | GramJS StringSession auth | ✅ READY | Well-documented, production-proven. Test early (Step 4). |
| MVP | Claude classify accuracy | ⚠️ VALIDATE | SPEC assumes ≥85% direction, ≥90% company on 50 samples. **Test on 10–20 samples during Step 7.3 before commit.** If Haiku accuracy drops, use Sonnet instead. |
| MVP | Dedupe threshold | ⚠️ TUNE | Default 0.90 is guidance, not gospel. Pre-launch, run on historical sample (50+ items). Measure false positives (duplicate not detected) and false negatives (unique item marked dup). Adjust if needed. |
| MVP | Croner DST handling | ✅ READY | Croner is modern & DST-aware. Test during Step 11 by simulating DST transition (or check croner docs for test utilities). |
| MVP | Zod v3 compatibility | ✅ READY | v3 is stable, no breaking changes. v4 has breaking changes (string validators moved to functions); defer migration to Phase 2. |
| Phase 2 | Official sources (RSS/HTML) | ⚠️ RESEARCH | New ingest adapter types. May need separate pipeline (HTML ≠ Telegram format). Out of scope for MVP; revisit post-launch. |
| Phase 2 | Sentiment/tone tagging | ⚠️ LIGHT | Optional enhancement. Add `sentiment` field to classify output. Low risk. |
| Phase 3 | On-prem LLM (GigaChat) | ✅ ARCHITECTURE READY | LLMProvider interface supports swap. But requires ops infrastructure (model serving, GPU). Prod-only decision. |
| Phase 3 | RAG + summarization | ⚠️ RISKY | Would require storing + indexing all articles. Contradicts extractive-only requirement (SPEC §10). Not recommended for this product. |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | **HIGH** | All component versions verified against official docs (April 2026). Node 22 LTS confirmed mandatory (Node 20 EOL April 30, 2026). Claude Sonnet 4.6 models & pricing from platform.claude.com. Drizzle pgvector support confirmed in orm.drizzle.team docs. BullMQ v5 concurrency patterns from official docs. Croner & timezone handling verified via multiple sources. |
| **Telegram Integration** | **HIGH** | GramJS (telegram npm) is only MTProto client for public channel reading. grammy is official bot API wrapper. Hard constraint (Bot API cannot read). No ambiguity. |
| **Database** | **HIGH** | PostgreSQL 16 + pgvector 0.5+ is production-standard. HNSW index recommended for < 1M vectors (MVP is 100–1000 vectors/day). Drizzle ORM native support confirmed. |
| **LLM** | **HIGH** | Claude Sonnet 4.6 is current prod model (official April 2026). Prompt caching costs 90% less on repeats (verified in docs). Text-embedding-3-small is current standard (OpenAI docs). Cost estimates are rough (~$5/day MVP), but order of magnitude is correct. |
| **Architecture** | **MEDIUM-HIGH** | Pattern is standard (queue-based pipeline), but execution details depend on step-by-step validation (GramJS latency, Classify accuracy, Dedupe false-positive rate). Architecture is sound; validation required during implementation. |
| **Pitfalls** | **HIGH** | Critical pitfalls (Bot API limitation, dedupe threshold, timezone handling) are well-understood and documented. Moderate/minor pitfalls are typical of this class of system (cache idempotency, connection pooling, logging). No novel risks. |
| **Features** | **MEDIUM** | Feature list is comprehensive and market-validated (competitive intelligence is well-understood domain). But customer accuracy requirements (≥85% classify, ≥90% company tagging) depend on training data quality and LLM capability. Validation required post-MVP. |

---

## Gaps to Address

1. **Classify accuracy:** SPEC assumes Claude Haiku is sufficient (≥85% direction, ≥90% company). **Validate on 10–20 test samples during Step 7.3.** If Haiku underperforms, switch to Sonnet (costs more, but necessary for quality).

2. **Dedupe threshold tuning:** SPEC defaults to 0.90. **Pre-launch, run on historical sample (50+ items from 3+ channels).** Measure false positives (duplicate not detected) and false negatives (unique item marked dup). Adjust if > 5% error rate.

3. **Embeddings quality with Russian text:** OpenAI text-embedding-3-small is strong on multilingual (MIRACL benchmark), but **verify on 20 Russian oil & gas snippets.** Test cosine_similarity of paraphrases (should be > 0.85 for dedup to work).

4. **LLM cost validation:** Pre-launch budget is ~$5/day. **Monitor actual spend daily after launch.** If > $10/day, investigate: Classify accuracy too low (more retries)? Summarize token count higher than expected? Rate limits causing retries?

5. **Ingest latency (GramJS):** SPEC requires < 60s from channel post to DB. **Measure during Step 5:** Start timer when message posted, check `messages` table timestamp when received. GramJS should be < 5s; pipeline < 60s total.

6. **Cron reliability:** DST handling is tested in theory, but **verify in practice** during March/October. Check logs for cron execution time. Alert if deviates > 1 minute from 20:00 MSK.

7. **Extractive validation (keyQuote):** SPEC requires 100% verbatim on 20 random items (Step 12 criterion 4). **Post-MVP, run monthly validation** (pick 20 random items from digest, verify keyQuote is substring of rawText). If < 100%, investigate Claude summarization behavior.

---

## Roadmap Recommendations

**Phase 1 (MVP) — 1–2 weeks:**
- Follow SPEC §9 steps 1→12 sequentially.
- Validate each step (deploy locally, test, log output).
- Critical checkpoints: GramJS ingest (Step 5), Classify accuracy (Step 7.3), Digest delivery (Step 9–11).
- Acceptance: Ingest < 60s, Classify ≥85%/≥90%, Dedupe < 5% error, Summarize 100% verbatim, Digest ±1 min on time, 48h uptime.

**Phase 2 (Scale) — 2–3 weeks:**
- Expand to 50 channels (if demand exists).
- Add official sources (RSS, HTML scraping).
- Build dashboard (Next.js + Metabase for historical trends).
- Revisit accuracy & cost after production data.

**Phase 3+ (Advanced):**
- On-prem LLM (GigaChat/Qwen) if prod scaling requires cost reduction.
- RAG for article generation (if customer requests "write-ups").
- ML-based anomaly detection (trend acceleration, competitor spikes).

---

## Confidence Assessment Summary

| Dimension | Level | Reason |
|-----------|-------|--------|
| **Tech Stack Selection** | HIGH | All versions current (April 2026), verified against official docs. No deprecated or bleeding-edge components. |
| **Architecture Soundness** | HIGH | Linear pipeline + queue pattern is industry-standard for this use case. Component boundaries are clean (abstractions ready for future swaps). |
| **Risk Awareness** | HIGH | Critical pitfalls documented and preventable. Moderate/minor pitfalls are typical. No novel risks or unknowns. |
| **Cost Optimization** | MEDIUM | Budget estimate (~$5/day) is order-of-magnitude correct, but depends on Classify accuracy. If Classify requires Sonnet (not Haiku), cost doubles. **Validate early.** |
| **Accuracy Validation** | MEDIUM | SPEC requires ≥85% direction, ≥90% company. Achievable with Sonnet, but depends on prompt quality and training data. **Validation is step 2 of MVP, not step 1.** |
| **Production Readiness** | MEDIUM-HIGH | Code structure is straightforward, but needs comprehensive test coverage (integration tests, load test, DST test). Acceptable for MVP pilot; requires hardening for prod-scale. |

---

## Summary Statement

**The Oil & Gas Intelligence Monitor is technically sound and ready to build.** The stack is production-proven (April 2026), with no dead ends or deprecated components. The architecture is straightforward (linear pipeline + queue) and the feature set is lean (focus on accuracy, not breadth). Critical pitfalls (Bot API limitation, dedupe, timezone handling) are well-understood and preventable.

**The main unknowns are customer-specific (Classify accuracy on actual customer data, appropriate dedupe threshold for customer channels, actual LLM costs vs budget).** These are validated during MVP implementation (Steps 5, 7.3, and post-launch monitoring), not research blockers.

**Roadmap recommendation:** Build Phase 1 (MVP) per SPEC §9 steps 1→12. Validate Classify accuracy early (Step 7.3). Monitor costs and latency throughout. Phase 2 (scale to 50 channels, official sources) follows after MVP is proven stable. Phases 3+ (on-prem LLM, RAG, dashboards) are optional based on customer feedback.

---

**Research completed by:** Claude Code (gsd-new-project/phase-6)  
**Next step:** `/gsd-complete-milestone` to create roadmap from this research
