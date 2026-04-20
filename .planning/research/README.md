# Research Deliverables — Oil & Gas Intelligence Monitor

**Research Phase:** Complete (2026-04-20)  
**Confidence Level:** HIGH  
**Scope:** Technology stack verification, feature landscape, architecture patterns, domain pitfalls

---

## Files in This Directory

### **SUMMARY.md** — START HERE
Executive summary of all findings. Contains:
- Stack confirmation (Node 22 LTS, GramJS + grammy, PostgreSQL 16 + pgvector, Claude Sonnet 4.6, etc.)
- Feature landscape (table stakes vs differentiators vs anti-features)
- Architecture overview (linear pipeline, GramJS → BullMQ → Postgres → Cron → grammy)
- Critical pitfalls (Bot API limit, dedupe threshold, timezone handling, etc.)
- Roadmap implications (Phase 1 MVP is 1–2 weeks, sequential 12-step plan)
- Confidence assessment by domain

**Read this to:** Understand what stack to use, what pitfalls to avoid, what order to build phases

---

### **STACK.md** — Technology & Component Verification
Detailed analysis of each technology component. Contains:
- Current version numbers (verified April 2026)
- Rationale for each choice (why Node 22, not 20; why Sonnet, not Haiku; etc.)
- Alternatives considered & why not chosen
- Critical gotchas & version-specific breakages
- Installation & quick setup scripts
- Confidence level & sources for each recommendation

**Read this to:** Validate component versions, understand tradeoffs, spot potential breaking changes

---

### **FEATURES.md** — Feature Landscape & Acceptance Criteria
Breakdown of what to build (MVP) vs what to defer (Phase 2+). Contains:
- Table stakes features (daily delivery, dedup, classification, extractive summary, company tagging, etc.)
- Differentiators (zero hallucination, RU-specialized, corroboration scoring)
- Anti-features (what NOT to build: Bot API reading, MarkdownV2, hardcoded names, on-prem LLM, dashboard)
- Feature dependencies (ingest → embed → classify → dedupe → summarize → digest)
- MVP recommendation (what's in, what's deferred)
- Acceptance criteria from SPEC §12 (accuracy ≥85%/≥90%, verbatim keyQuote 100%, latency < 60s, uptime 48h)

**Read this to:** Understand what "done" looks like, what's in MVP vs Phase 2+, acceptance criteria for QA

---

### **ARCHITECTURE.md** — System Design & Patterns
Detailed architecture breakdown. Contains:
- High-level data flow (Telegram channels → GramJS → BullMQ → pipeline → Postgres → Cron → grammy → private channel)
- Component boundaries & responsibilities (ingest, normalize, embed, classify, dedupe, summarize, persist, compose, delivery)
- LLM provider abstraction (allows Claude → GigaChat swap post-MVP)
- Embedding provider & cache strategy (Redis, 7-day TTL, hash-based keys)
- Dedupe logic (pgvector cosine_similarity > 0.90, cluster_id grouping)
- Digest composition rules (24h window, max importance per cluster, filter by importance ≥ 2 + company/event mention, 7 items per direction)
- Error handling & retry patterns (zod validation + 1 retry for LLM, exponential backoff for queue)
- Deployment target (single VPS, docker-compose or systemd, no Kubernetes)

**Read this to:** Understand how components fit together, what interfaces to build, error handling strategy

---

### **PITFALLS.md** — Known Risks & Prevention Strategies
Catalog of implementation mistakes & how to prevent them. Contains:
- **Critical pitfalls** (rewrite-inducing bugs):
  - Bot API cannot read public channels → use GramJS only
  - LLM JSON validation fails → zod + retry
  - Dedupe threshold wrong → 0.90 default, env var, pre-launch testing
  - Extractive validation fails → keyQuote must be verbatim, retry if fail
  - Timezone DST issues → use Croner, not node-cron
  - Company names hardcoded → config/env only
- **Moderate pitfalls** (bugs, inefficiency):
  - Embedding cache hit rate low → normalize must be idempotent
  - PostgreSQL connection exhaustion → pool sizing & monitoring
  - LLM cost overruns → validate Classify model choice early
- **Minor pitfalls** (UX friction):
  - Digest exceeds 4096 chars → chunk with footer
  - Logging secrets → redact in prod
- **Phase-specific warnings** (per implementation step)

**Read this to:** Know what can break & how to prevent it, risk mitigation checklist during implementation

---

## Quick Reference

### For the Roadmap
- **Roadmap structure:** Follow SPEC §9 steps 1→12 sequentially
- **Critical validation points:**
  - Step 5 (ingest): Test GramJS reads messages < 5s
  - Step 7.3 (classify): Validate accuracy on 10–20 test samples (target ≥85% direction, ≥90% company)
  - Step 11 (cron): Verify digest fires ±1 min of 20:00 MSK
- **Phase gates:** After MVP (ingest < 60s, classify validated, dedupe tested, summarize 100% verbatim, digest on time, 48h uptime), move to Phase 2 (scale to 50 channels)

### For Implementation (Step-by-Step)
1. **Step 1–2:** Project init + config (use template from STACK.md)
2. **Step 3:** DB schema (Drizzle + pgvector from ARCHITECTURE.md)
3. **Step 4:** GramJS session (StringSession one-time gen)
4. **Step 5:** Ingest (GramJS listener, BullMQ [ingest] queue) — **VALIDATE LATENCY < 60s**
5. **Step 6:** LLM providers (abstract interfaces, no concrete impl yet)
6. **Step 7:** Pipeline (normalize → embed → classify → dedupe → summarize) — **VALIDATE CLASSIFY ACCURACY**
7. **Step 8–9:** Queue workers + digest composition
8. **Step 11:** Cron (Croner with Europe/Moscow timezone) — **VALIDATE TIMING ±1 MIN**
9. **Step 12:** Integration test + cleanup

### For QA / Acceptance Criteria
- Ingest latency < 60s (measure Step 5)
- Classify accuracy ≥ 85% direction, ≥ 90% company (measure Step 7.3 on 50 samples)
- Dedupe false-positive rate < 5% (measure on 100-item sample with 3+ sources)
- Summarize verbatim keyQuote 100% (measure on 20 random items from digest)
- Digest delivery ±1 minute 20:00 MSK (monitor daily in production)
- Uptime 48 hours without restarts or manual intervention

### For Future Phases
- **Phase 2:** Expand to 50 channels + official sources (RSS, HTML scraping) — new ingest adapters
- **Phase 3:** On-prem LLM (GigaChat/Qwen) via LLMProvider interface (no code rewrite needed)
- **Phase 3:** Dashboard (Next.js + Metabase) for historical trends & ROI analysis
- **Phase 4:** RAG for article generation (if customer requests; conflicts with extractive requirement)

---

## Verification & Confidence

All research verified against:
- **Official documentation** (platform.claude.com, orm.drizzle.team, grammy.dev, docs.bullmq.io, etc.)
- **April 2026 releases** (Node 22 LTS, Claude Sonnet 4.6, Drizzle 0.36+, BullMQ 5.71+, etc.)
- **Production usage patterns** (Telegram API, LLM reliability, queue management)
- **Industry best practices** (competitive intelligence, semantic dedup, extractive summarization)

**Confidence by area:**
- Stack: **HIGH** (all versions current, verified)
- Architecture: **HIGH** (standard patterns, no novel unknowns)
- Pitfalls: **HIGH** (well-documented, preventable)
- Features: **MEDIUM** (market-validated, but customer accuracy requirements need validation)
- Roadmap: **MEDIUM-HIGH** (structure is sound, but timeline depends on team velocity & LLM accuracy validation)

---

## How This Research Feeds the Roadmap

1. **SUMMARY.md** defines the 3-phase roadmap (MVP 1–2 weeks, Phase 2 2–3 weeks, Phase 3+ optional)
2. **STACK.md** gives exact component versions & installation commands
3. **FEATURES.md** defines acceptance criteria (what makes MVP "done")
4. **ARCHITECTURE.md** defines component boundaries & interfaces (what to code)
5. **PITFALLS.md** defines risks to avoid (test checklist, monitoring, prevention)

Together, these documents answer: **"What stack? What features? What order? What can break?"**

---

**Research completed:** 2026-04-20  
**Ready for:** `/gsd-complete-milestone` → roadmap creation  
**Questions?** Check SUMMARY.md for executive overview
