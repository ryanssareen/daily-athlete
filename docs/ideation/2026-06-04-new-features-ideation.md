---
date: 2026-06-04
topic: new-features
focus: new features (new user-facing capabilities for athletes and coaches)
---

# Ideation: New Features

## Codebase Context

DA2 / "daily-athlete" — endurance & triathlon training app. TS monorepo: `apps/web` (Next.js, coach + athlete UI **and** all backend via route handlers/webhooks/cron/Inngest), `daily-athlete/` (Flutter iOS athlete app — the shipped mobile app), `packages/shared` (TS + Zod), `supabase/migrations` (RLS-primary). Product wedge: **"AI triathlon periodization WITH coach review."**

**Already built:** Supabase auth; coach↔athlete linking + roster + per-athlete coach view; Strava (OAuth, webhook ingest, historical backfill + watchdog, enrichment, token crypto); workouts (planned vs completed, auto+manual matching, detail page, calendar, comments); the AI **adaptive-edit** engine (deterministic training-load/guardrail layer + LLM diff-proposer, propose-not-apply, via Inngest); weekly review (propose/accept/reject, versioned planned workouts, append-only edits); admin console.

**Critical reframe (from code-grounded critique — shapes all sequencing):**
- The literal wedge — AI plan **generation** (R5–R8) — is **not built yet**. Only the adaptive *edit* engine exists, and `apps/web/src/ai/adaptive/llm.ts` runs a `FixtureProposer` (`TODO: wire real Langfuse client`). **Every "AI does X" idea is inert until the real LLM lands.**
- **TSS is computed lazily on detail-view**, so the deterministic engine pays a conservative-bias tax and no fitness-trend series exists. TSS-at-ingest is a prerequisite for trend/readiness/recalibration features.
- **No push-notification infrastructure** exists — every proactive/timely nudge degrades to pull-only (in-app, on open) until that foundation is built.
- **Laps & zone-time are already ingested into `summary_stats` but UNSURFACED** — the cheapest latent value on the board (no new Strava calls, ToS-safe).
- GPS + all 1Hz streams are **permanently** Strava-ToS-excluded (no maps, no stream charts).
- Schema assumes **one active plan → one `event_date`**; multi-race/no-date plans need migration.
- Trust contract: **propose-don't-apply**; coach-routing already wired; engine deliberately defers proactive B5/B6 load nudges as "highest trust risk."
- Entitlement SKUs today are only `ai_plans` / `trend_reports` / `coach_invite` — several "paid" ideas have no SKU to attach to yet.

**v1 non-goals (crossing = v2 expansion):** no social feed/leaderboards/clubs; no Garmin/Apple Health ingest; no nutrition planner beyond race-week; no live guidance; no athlete web app; no coach native app.

**Method:** 6 parallel ideation agents (distinct frames) → ~50 raw candidates → merged/deduped to 27 + cross-cutting synthesis → 2 adversarial critics (feasibility + product/strategy, both code-grounded) → orchestrator scoring. 7 survivors.

## Ranked Ideas

### 1. Execution & Intensity Intelligence  *(quick win — ship first)*
**Description:** Surface the already-ingested-but-unsurfaced lap splits + zone-time as (a) a per-interval **execution scorecard** ("5×1km planned → 5 work laps, 4 in target zone, rep 5 faded ~6%") on the workout detail page, and (b) a rolling **zone-distribution / polarization audit** ("your easy days ran too hard 4 weeks running"). Emit the structured result as context for AI coach comments and plan-vs-actual.
**Rationale:** Cheapest high-value feature on the board — the data is already hydrated in `summary_stats`, fully ToS-safe (no streams/maps), and answers the #1 post-workout question ("did I hit it?"). Independently shippable (no foundation dependency), leans FREE (acquisition), and the structured output feeds every downstream AI surface. Appeared in 5 of 6 ideation frames independently — strongest convergence signal.
**Downsides:** Lap parsing must handle messy/warm-up laps and unstructured sessions gracefully; per-rep "target" needs the planned structure to be present and trustworthy.
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 2. Training-Load Spine — TSS-at-ingest + threshold profile + CTL/ATL/TSB  *(foundation)*
**Description:** Compute & persist TSS in the ingest/enrichment path (replacing lazy per-view calc); add a per-athlete **FTP/threshold/zone profile with effective-date history**; derive the rolling **CTL/ATL/TSB fitness–fatigue–form** curve — the dashboard endurance athletes live in.
**Rationale:** The foundational data layer. Unblocks readiness, race-result recalibration, ramp guardrails, and removes the conservative-bias tax the adaptive engine pays today. The fitness-trend chart is itself a marquee, expected athlete feature; the threshold profile makes all zone/TSS math credible.
**Downsides:** Migration + backfill of historical TSS; correct per-athlete thresholds are themselves a data-entry problem (mitigated by idea #7); CTL/ATL/TSB is a proxy on Strava summary data, not lab-measured — communicate uncertainty.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 3. AI Quality Flywheel — real LLM client + trace/eval harness  *(foundation — sequence first among AI work)*
**Description:** Wire the real LLM client behind the existing fixture seam, plus a trace store (prompt, context, proposal, accept/reject outcome) and a replayable eval suite **seeded from the accept/reject labels the weekly-review already produces for free**. Later: a per-coach decision-pattern miner that tunes proposals toward each coach's style.
**Rationale:** Not really a "feature" — it's the prerequisite that turns the entire AI surface from a fixture into a real product, and it makes "AI quality improves over time" a structural property (every coach review becomes a labeled eval example). Paid unit economics depend on it.
**Downsides:** Real LLM = latency, cost, and eval/guardrail discipline before exposure; honest framing as enabling investment, not a shippable end-user screen.
**Confidence:** 85%
**Complexity:** Medium-High
**Status:** Unexplored

### 4. Roster Triage Board — coach attention queue  *(coach-scaling, quick win)*
**Description:** Replace the flat last-activity roster sort with a ranked **"needs attention"** board: athletes with pending coach-routed proposals, missed-block hits, no-activity streaks, and proposals about to expire — the missing front door for the coach loop at scale.
**Rationale:** The wedge is "AI proposes, coach reviews," but there's no surface telling a coach *which* reviews are waiting or *who* silently fell off. Builds directly on the existing `db/roster.ts` (just redesigned) + the coach-SELECTable `weekly_reviews`. Pure ranking query over shipped data — low burden, high coach-retention value.
**Downsides:** "Attention score" weighting needs tuning to avoid crying wolf; value scales with roster size (thin for 1–2 athletes).
**Confidence:** 80%
**Complexity:** Low-Medium
**Status:** Unexplored

### 5. Coach-Bounded Auto-Apply Envelope  *(coach-scaling — bold)*
**Description:** Let a coach define standing rules for low-stakes adaptive proposals (e.g. "auto-accept easy-run cuts <15%", "auto-shift a missed recovery day", "never touch race week"); the engine applies qualifying diffs automatically, each logged as a reversible, coach-reviewable action. Inverts propose-review-accept into **review-by-exception**.
**Rationale:** The single biggest lever for moving a coach from ~1:8 to ~1:30 athletes. Extends the existing deterministic guardrail (`validateOps`) + recipient routing additively rather than inventing new risk.
**Downsides:** **Relaxes the propose-don't-apply trust contract** — the core differentiator. Must stay strictly bounded, reversible, and coach-authored (consent, not silent override); needs an audit/undo surface. Highest-risk survivor; sequence after the change-ledger/audit trail is solid.
**Confidence:** 60%
**Complexity:** Medium-High
**Status:** Unexplored

### 6. Post-Race Auto-Debrief + Next-Block Offer  *(retention)*
**Description:** When an activity matches the plan's `event_date` (or is tagged a race), auto-generate a splits-based debrief (executed vs race-day strategy, using lap data) and a one-tap **"plan my recovery + what's next"** draft for coach review — closing the void after a goal race.
**Rationale:** The days after an A-race are the canonical endurance-app churn cliff: the goal is gone and the app goes quiet. Acknowledging the result and immediately offering the next chapter is the highest-leverage retention moment, and a natural paid re-conversion point. The debrief (free) ships on lap data now; the next-block draft activates once idea #3 lands.
**Downsides:** Next-block narrative depends on the real LLM (#3); race detection beyond `event_date` (unplanned races, B-races) needs heuristics.
**Confidence:** 70%
**Complexity:** Medium
**Status:** Unexplored

### 7. Backfill-to-Baseline Onboarding  *(activation, quick win)*
**Description:** On first plan setup, auto-derive a starting-fitness baseline (recent weekly TSS distribution, typical session durations, sport mix) from the **already-backfilled** Strava history and pre-fill the plan's starting load — the human just confirms or nudges, instead of self-reporting fitness they estimate badly.
**Rationale:** Onboarding's most painful manual step is self-reporting fitness; the data already sits in backfill (`athlete_profiles.baselines` / `weekly_volume_ewma` exist). This is the activation moment that makes the *first* generated plan credible — a free-acquisition lever directly feeding plan-gen.
**Downsides:** Quality depends on backfill completeness (sparse Strava history → weak baseline); pairs best with idea #2's TSS-at-ingest for accuracy.
**Confidence:** 75%
**Complexity:** Low-Medium
**Status:** Unexplored

## Recommended sequencing

Foundations **#3 (real LLM + eval)** and **#2 (training-load spine)** unblock the rest. Ship the independent quick wins **#1** and **#4** in parallel now (neither needs the foundations). **#7** and the free half of **#6** ride on #2; **#5** and the AI half of #6 ride on #3 (and #5 should wait for a solid change-ledger/audit trail).

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| C3 | Readiness without wearable | Catalogued + low-confidence Strava-only signal; the 10s subjective check-in is the only new bit. Revisit once #2 sharpens the load proxy. |
| C5 | Life-aware context annotations (sick/travel) | Strong but overlaps the existing missed-block detector heavily; folds into the #4/#6 retention tier as a runner-up. |
| C6 | Athlete reschedule handshake | Overlaps the already-designed B7 `workout_swap` trigger; little new beyond the availability template. |
| C9 | Activate deferred B5/B6 as coach-only signals | Engine flags these as the *top* trust risk; premature until #2's load quality + confidence gating exist. Defer, don't kill. |
| C10 | Multi-event season + conflict linter | Heavy core schema migration (relax one-plan-one-event); premature while plan-gen itself isn't shipped. |
| C11 | What-if shadow plan branch | Heavy new plan-lifecycle machinery for speculative coach scenarios; needs plan-gen + real LLM first. |
| C13 | Versioned athlete-context "fingerprint" | Premature until #3; `gatherContext` already covers the real need and the only consumer is the fixture engine. |
| C15 | Race-result-triggered recalibration | Depends entirely on #2's FTP-profile-with-history; absorbed into #2's roadmap. |
| C17 | Coach workout template library | Table-stakes (TrainingPeaks parity) — build for credibility, don't headline as a differentiator. |
| C18 | Brick/compound-session model | Deep schema + matching-cardinality change (1 plan ↔ 1–2 activities); on-wedge for tri but sequence later. |
| C19 | Matching quality upgrades | Hygiene that protects data quality; partly auto-confirm-by-exception is cheap, tail (self-heal/reconciler) pushes the deferred matcher. Runner-up. |
| C20 | Private PR & milestone tracker | Net-new persistence for modest retention; nice-not-now. |
| C21 | Streak-free consistency score | Cheap & on-ethos but low strategic weight; could fold into #2's surface. |
| C22 | Coach-protected-op transparency | Cheapest trust win and grounded — strong runner-up; cut from top-7 only for breadth balance. |
| C23 | Proposal contention manager | Duplicates #4 over the same roster + weekly_reviews data; fold in. |
| C24 | Shareable season card (no login) | Heaviest new attack surface (public unauth page + token + privacy/ToS review) per unit of value. |
| C25 | Squad view within a roster | Crosses the no-social v1 line for thin, non-wedge value; needs athlete-to-athlete RLS that contradicts the isolation model. |
| C26 | Second-opinion read-only reviewer | Crosses one-coach-per-athlete for a rare workflow at real RLS/routing cost. |
| C27 | Coach proxy-logging for app-averse athletes | Breaks the athlete-confirmed completion trust invariant; wrong boundary to cross in v1. |

## Round 2 Additions — new-angle survivors

Refinement pass ("add more / new angles"). Five fresh frames not used in round 1 — **monetization/conversion, mobile-native, trust/explainability, reporting/data-viz, growth/virality** — explicitly steered off the 27 round-1 candidates. ~40 new raw ideas, deduped to 8 survivors. Several are unusually grounded: the trust pass found machinery that is *built and thrown away*.

### 8. Guardrail Veto Log — "what the AI wanted to do but couldn't"  *(trust — quick win)*
**Description:** Persist and surface the dropped ops that `validateEditOps` already computes, with their machine-readable `DropReason` (volume_ramp, ctl_ramp, tsb_floor, taper_window, past_event, coach_protected): "3 changes were held back to keep you safe," each with the threshold it would have breached. Today the engine keeps only `droppedCount` and discards the reasons.
**Rationale:** The single most defensible trust artifact in the system — it proves the deterministic guardrail is real, not theater, by showing the AI being overruled. Computed-then-discarded today, so it's nearly free, and fully LLM-independent. Generalizes round-1 runner-up C22 to all six drop reasons.
**Downsides:** Needs a small column on `weekly_reviews` + a render section; plain-language copy per reason code.
**Confidence:** 85% · **Complexity:** Low-Medium · **Status:** Unexplored

### 9. Plan Change Timeline — surface the wired-but-invisible audit trail  *(trust — quick win)*
**Description:** A per-athlete / per-workout history rendered from the existing append-only `workout_edits` log: every change with actor (you / coach / AI), field-level before→after diff, and a back-link to the proposal that caused it. A "history" tab on the workout detail page.
**Rationale:** `workout_edits` is fully built — append-only, attributed, coach+athlete-RLS, realtime — but has **zero read API and zero UI**; the raw material for "who changed my plan and why" is sitting dark. It's the trust substrate every auto-apply/override feature (incl. round-1 #5) depends on. LLM-independent.
**Downsides:** Field-diff rendering needs friendly labels; mostly a read API + UI over existing data.
**Confidence:** 85% · **Complexity:** Low · **Status:** Unexplored

### 10. 402 Paywall / Upgrade Surface  *(monetization — quick win)*
**Description:** Build the first actual upgrade UI: a reusable web + Flutter component that catches the existing `402 {error:'payment_required', entitlement_key}` response and renders a contextual, SKU-specific upsell, routed to RevenueCat (mobile) or Stripe (web).
**Rationale:** `requireEntitlement` already returns a feature-aware 402 that **nothing renders** — the entire backend gate exists with no conversion surface in front of it. This is the literal free→paid moment and it's currently a dead end. (Depends on the Stripe write-path for web purchases — see runners-up.)
**Downsides:** Stripe entitlement source is CHECK-blocked today (`source IN ('revenuecat')`), so web checkout needs that path first; copy/SKU mapping per entitlement key.
**Confidence:** 85% · **Complexity:** Low-Medium · **Status:** Unexplored

### 11. Today Widget (home / lock-screen)  *(mobile-native — retention)*
**Description:** A WidgetKit home- and lock-screen widget showing today's planned workout (sport, structure summary, target zones) with a tick when a completed workout has matched it; refreshes on the iOS timeline budget + on app foreground — no server push needed.
**Rationale:** Answers the highest-frequency athlete question ("what am I doing today?") at a glance without opening anything — the canonical reason a native app beats coach-side web, and the daily-retention surface the shipped Flutter app uniquely owns. Round 1 covered zero native surface.
**Downsides:** Native (Swift/WidgetKit) build + an App Group token/data bridge; reads best with the offline-cache layer (a mobile runner-up).
**Confidence:** 80% · **Complexity:** Medium · **Status:** Unexplored

### 12. Coach Weekly Roster Digest  *(reporting / coach — retention)*
**Description:** An Inngest-scheduled weekly per-coach brief that rolls each linked athlete into a line or two — adherence %, biggest miss, notable PR/load spike, proposals awaiting the coach — delivered in-app or by email.
**Rationale:** Coaches manage N athletes and must currently visit each profile; a Monday-morning brief is a canonical reason a coach stays. Monetizes `coach_invite` + `trend_reports` together and reuses the existing weekly-review scheduler. Complements round-1 #4 (triage board = live queue; digest = periodic push). No push infra needed (email/in-app).
**Downsides:** Email delivery path; digest content tuning to stay signal-dense.
**Confidence:** 80% · **Complexity:** Medium · **Status:** Unexplored

### 13. Coach Public Profile Page  *(growth)*
**Description:** Replace the raw-UUID invite target (`/join/coach/[coachId]`, which 302s straight to a signup wall) with a server-rendered, indexable vanity page (`/c/[slug]`) showing the coach's name, bio, disciplines, roster size, and a "Train with me" CTA — doubling as the invite landing and an organic SEO surface.
**Rationale:** The only acquisition surface a coach can share today is an opaque UUID that shows zero value before the wall. A real page makes the link shareable (Instagram/forums/signatures), ranks for "[coach] triathlon coaching," and gives the coach ownership — the highest-leverage upgrade to the built-in growth engine.
**Downsides:** New `coach_profiles` columns (slug, bio, credentials) + slug uniqueness; light moderation surface for public bios.
**Confidence:** 80% · **Complexity:** Medium · **Status:** Unexplored

### 14. Invite Attribution & Activation Ledger  *(growth)*
**Description:** Signed per-invite tokens (coach_id + optional campaign + nonce) and a lightweight `invite_events` table recording link-created / opened / signed-up / activated, surfaced to the coach as "you've invited 12, 8 joined, 5 connected Strava."
**Rationale:** You can't optimize a growth loop you can't measure; invites are fire-and-forget UUIDs with no funnel telemetry today. Visible "X of Y joined" counters also create coach-side completion pressure, and attribution is the substrate every later referral mechanic needs. The coach signup already drops a half-built attribution cookie to generalize.
**Downsides:** Append-only events table + token signing; privacy-respecting (no athlete PII beyond the funnel state).
**Confidence:** 80% · **Complexity:** Low-Medium · **Status:** Unexplored

### 15. Plan Adherence Ledger  *(reporting)*
**Description:** A periodic report reconciling every planned workout against its match — completed-as-prescribed / completed-but-modified / swapped / moved / skipped — with per-sport and per-week roll-ups and a single "adherence rate" headline. Portfolio-level (a block/month), distinct from the per-session execution scorecard (#1).
**Rationale:** Adherence is the #1 thing a coach eyeballs and the hardest thing an athlete sees honestly; the data (`planned_workouts.status` + `workout_matches.method/confidence`) is fully collected but never aggregated. The natural anchor feature for the `trend_reports` SKU, zero new ingest.
**Downsides:** Defining "modified vs swapped" cleanly; heavy aggregation runs via Inngest.
**Confidence:** 80% · **Complexity:** Low-Medium · **Status:** Unexplored

### Round 2 — strongest runners-up (not promoted, worth keeping warm)
- **Stripe write-path + dual-source reconciler** — necessary plumbing under #10 for web/coach monetization (relax the `source` CHECK; merge dual-store entitlements).
- **Decision Provenance Card** + **Confidence-Tiered Recommendations** — the rest of the trust/legibility cluster (persist the `gatherContext` snapshot; surface `powerConfidenceRatio`); ship alongside #8/#9.
- **"What happens if I skip this"** — deterministic per-workout impact preview from the load math; LLM-independent, free-tier.
- **Athlete→coach reverse invite (R18)** — flips the acquisition vector; resurrects a specced-but-unbuilt requirement. *Crosses the v1 schema deferral of athlete-initiated/mutual-accept linking — flag.*
- **Pre-signup "see your baseline" Strava preview** — value-before-account conversion hook; moves backfill-baseline (#7) earlier in the funnel. *Privacy/ToS check on pre-account Strava data.*
- **Off-season pause / lapse winback** (monetization, anti-seasonal-churn) · **Consistency calendar heatmap** + **aerobic-decoupling trend** (data-viz) · **Siri quick-log** + **offline-first cache** (mobile).

### Round 2 — folded / cut
- Plan-volatility churn report → folds into **#9** (same `workout_edits` source). Zone-drift report → overlaps **#1**. Tokenized plan share / co-branded artifacts → overlap round-1 C24. Assistant-SKU metered chat, Apple Watch, race-day Live Activity → premature (need real LLM / push / heavier native). Coach-seat billing scaffold → v2-deferred.

## Session Log
- 2026-06-04: Initial ideation — focus "new features"; 6 frames × ~8 → ~50 raw candidates, deduped/synthesized to 27, 2 adversarial critics, 7 survived.
- 2026-06-04: Refinement (add more / new angles) — 5 new frames (monetization, mobile-native, trust/explainability, reporting, growth) → ~40 raw, deduped vs round 1, 8 new survivors added (#8–#15). Total survivor set now 15.
