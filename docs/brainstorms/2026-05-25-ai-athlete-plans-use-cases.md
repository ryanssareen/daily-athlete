---
date: 2026-05-25
topic: ai-athlete-plans-use-cases
refined: 2026-05-25
reconciled: 2026-06-08
status: v1 scope decided; build status reconciled against PR #86 (2026-06-08)
---

# AI Athlete Plans — Use-Case Expansion & v1 Scope

## Context

The product has a *designed* AI-plan core — event-targeted periodization (R5–R8,
plan Unit 3.2), weekly athlete-confirmed adaptive review (R9–R11, Unit 3.4), free
per-workout insights (R22–R23), and paid report narratives / race-readiness
(R25). **Build status has moved since this was first written: the adaptive
re-plan engine (category B) has shipped (PR #86); the plan-*generation* wedge
(category A) and the real LLM client have not.** The **Build Status** section
below is the source of truth for what is and isn't built; the `[shipped]` /
`[v1]` / `[vNext]` tags on each catalog entry are reconciled to it. See:

- `docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md`
- `docs/brainstorms/2026-05-02-database-schema-requirements.md`
- `docs/plans/2026-05-02-001-feat-ai-endurance-training-app-plan.md`

This document started as a use-case catalog and was **refined on 2026-05-25 into a
v1 scope decision** (see next section). The catalog (further down) is retained as
the full map; each entry now carries a scope tag. Scope is the existing
endurance/tri wedge: swim, bike, run, triathlon, plus strength/mobility, grounded
in data the app already collects.

Scope tags used throughout:

- **[shipped]** — already built and merged (PR #86); see Build Status.
- **[v1]** — specified for the first AI release (may be shipped or still to
  build; Build Status disambiguates).
- **[v1-guardrail]** — not a chooseable flow; generator behavior the v1 plan
  generator must respect because these inputs arrive whether or not we build a flow.
- **[vNext]** — deferred; *additive* given the v1 architecture (no rewrite).
- **[vNext-schema]** — deferred; needs schema work before it's possible.

---

## Build Status (reconciled 2026-06-08)

This section reconciles the scope decision below against what has actually
shipped. **It is the source of truth; where a catalog tag and this section
disagree, this section wins.**

### Shipped — the adaptive re-plan engine (category B), PR #86

The unified re-plan engine from
`docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md` (status:
completed) is merged:

- **Schema:** `weekly_reviews`, `workout_edits`, and `planned_workouts.version`
  (migrations `0019`–`0023`, including the apply + propose RPCs). The earlier
  "no `weekly_reviews` / `workout_edits` table" note is obsolete.
- **Deterministic load + guardrail layer** (`apps/web/src/training-load/`) —
  CTL/ATL/TSB proxy + invariant validator, run at generation *and* apply.
- **Engine + diff-proposer boundary + precedence + single-open proposal**
  (`apps/web/src/ai/adaptive/`), the transactional apply RPC, and the
  agent-native decision API (`/api/weekly-review/*`).
- **Live triggers:** B1 weekly review (cron), B2 missed-block (daily detector),
  B3 schedule-shock, B4 event-change, B7 single-workout swap, and R11 manual
  replan — all funnel into one `adaptive/run.requested` event.
- **Athlete/coach proposal UX** on web and mobile; entitlement gate; expiry sweeper.

**Two gates keep it inert end-to-end today** ("shipped" ≠ "working for a user"):

1. **No real LLM.** The engine runs against a `FixtureProposer`
   (`apps/web/src/ai/adaptive/llm.ts`); the real Langfuse-traced client is a TODO
   tied to the generation pipeline. No LLM SDK is installed in `apps/web`.
2. **Nothing generates the plan it adapts.** The engine only *re-plans an existing
   plan*; category-A generation does not exist, so there is no plan to act on.

### Not built

- **Category A generation (the wedge)** — A1/A6 block-structured generator: no
  code, no API route. This is the gating next slice.
- **Real LLM client** (Langfuse-traced) — placeholder `FixtureProposer` only.
- **B5 / B6** (fatigue deload / progression bump) — genuinely deferred; the
  `fatigue_deload` / `progression_bump` `trigger_kind` values are reserved in the
  schema vocabulary but no detector is wired.
- **Category C insights** — no `insights` table, no code (C1/C2/C4 all unbuilt).
- **D / E / F** surfaces — unbuilt.

### Reconciliation note: block-replan vs. the shipped EditOp engine

The "block-structured race plan / block = unit of replan" decision below is a
**generation-side aspiration the shipped adaptive engine does not implement.** The
merged engine adapts a plan by emitting per-workout **EditOps**
(`move | modify | skip | insert | delete`) over the flat `planned_workouts` bag,
validated by deterministic invariants — there is no block/phase concept in it.
When generation lands, decide explicitly: either generation emits phase-tagged
blocks that the existing workout-level EditOp engine continues to adapt (cheapest;
no engine rewrite), or block-level replan is genuinely wanted (revisit the shipped
engine). Tracked in Open Questions.

---

## v1 AI Release Scope (Decided 2026-05-25)

> **Reconciliation (2026-06-08):** this section is the *generation-side product
> release* decision and remains the forward plan. The *adaptive* engine it
> references (B-series) has since been built more broadly than the "B1 + B7" line
> below — see **Build Status**. Tags are corrected to `[shipped]` where PR #86
> delivered them.

### Foundational decision: a block-structured race plan

The v1 generator models a **block-structured race plan**, not a flat list and not
(yet) a full rolling engine. A1 emits phase-tagged blocks (base → build → peak →
taper) sized to fit from today to `event_date`. **The block is the unit of both
generation and replanning.**

Why this framing (the reasoning that drove it):

- **The schema is already neutral**, so this is cheap now. `plans.event_date` and
  `plans.event_type` are nullable (`0007_plans_and_planned_workouts.sql`), and
  `planned_workouts` is a flat bag of dated workouts with a JSONB `structure` and
  a `planned_load`. There is no block/phase concept in the schema today — so
  "block-structured" is mostly disciplined generator output plus one lightweight
  persisted phase tag, **not** a new table.
- **Adaptation is v1, not future.** The weekly review (B1, R9–R11) ships in the
  paid wedge. On a flat list, "adapt the next 1–3 weeks" is fuzzy (where do you
  cut?). With blocks, every adaptation trigger becomes the *same* operation:
  "re-run the block generator on the affected block(s) with new constraints."
- **It pays off twice.** Paid for once (block-aware generation), it buys plan-type
  generality (A2 no-date = drop the taper + add a re-up trigger; A7 off-season = a
  maintenance block-type) *and* adaptation generality (the whole B-series).
- **It avoids over-building.** The full rolling engine (dateless re-up machinery,
  "no end-state" model) is deferred until the race wedge is proven.

This resolves the catalog's "Plan model generality" and "Trigger taxonomy" open
questions: it's **one adaptive engine with multiple entry points**, with the block
as the shared unit.

### In scope for v1

| Area | In v1 | Notes |
|---|---|---|
| **Engine** | Block-structured race plan | Block = unit of generation + replan |
| **A. Create** | A1 event-targeted periodization | The core wedge |
| | A6 time-crunched (first-class mode) | Optimizes adaptation-per-hour; flags infeasible goals. Hours is already an R5 input |
| | A4 injury + A5 beginner (**guardrails**) | Generator must produce safe plans for these inputs (see below) |
| **B. Adapt** | B1 weekly review (scheduled) · **shipped (PR #86)** | The baseline adaptive loop |
| | B7 single-workout swap (manual) · **shipped** | Everyday agency, no detector / no false-alarm risk |
| | B2 missed-block · B3 schedule-shock · B4 event-change · R11 manual · **shipped** | Engine + detectors merged in PR #86, ahead of the original B1+B7-only v1 line; inert pending the real LLM + a generated plan |
| **C. Per-workout** | C1 post-workout insight (**free**) | Free habit hook — completed-data-grounded, no plan needed |
| | C4 "why this workout?" (**paid**) | Plan-dependent — explains AI-*planned* sessions; no value to a planless free user |
| **Trial** | One free generated plan | Conversion lever — lets a free user taste the wedge before paying (resolves R27 trial structure) |
| **D. Coach** | D1 AI draft → coach edit | Coach stays an *editor* (not buyer) |
| **E. Assistant** | Structured quick-actions (no chat) | "Move my long run", "easier week" → B7/B1 confirm-flow |
| **F. Analysis** | F1 race-readiness score + narrative (paid) | Event-approaching readiness |

**A4/A5 guardrails the v1 generator must respect** (these athlete types arrive
regardless — R5 takes free-text injury history, hours is an input, and a
sparse-profile confidence flag is *planned* inside `athlete_profiles.baselines`
(Unit 2.3 derivation worker) but **not yet produced** — so the generator needs a
fallback when it's absent):

- Low starting volume + technique focus for near-novices (A5).
- Conservative progressive ramp + deload checkpoints + "stop if pain" framing for
  injury history (A4); no diagnostic or medical claims.
- Polarized / adaptation-per-hour bias + explicit feasibility flag for low hours (A6).
- Refuse unrealistic asks (e.g., Ironman in 6 weeks for a beginner) — already an
  eval scenario in Unit 3.2.

### Deferred to vNext

| Item | Why deferred | Type |
|---|---|---|
| A2 goal-based, no date | Needs the rolling re-up trigger + an "are we done?" model | [vNext] additive |
| A3 multi-race season | Needs an events *list*; the single `event_type`/`event_date` pair can't hold A/B/C races | [vNext-schema] |
| A7 off-season / A8 limiter block | Block-types / generation biases; additive once block-structured | [vNext] additive |
| B5/B6 reactive triggers (fatigue deload / progression bump) | Proactive load-decision triggers; unreliable on Strava-only data without HRV; highest false-alarm/trust risk | [vNext] additive (**B2/B3/B4 already shipped** — see Build Status) |
| C2 pre-workout briefing | Plan-dependent (paid, not a free hook); extra surface | [vNext] additive |
| C3 readiness nudge | Strava-only (no HRV/sleep) → a wrong "you're recovered" is the injury-trust-killer | [vNext] (revisit w/ v2 health data) |
| D2/D3/D4 coach AI | Coach isn't the buyer; keep v1 coach minimal. (Eval harness for D4 still built for R8 — just not coach-facing) | [vNext] additive |
| E1/E2 free-text chat & Q&A | A whole new UI + grounding/guardrail burden; quick-actions cover most E1 value | [vNext] additive |
| F2 plan-vs-actual retrospective | Strong vNext candidate — block-structure makes "end-of-block retrospective" natural, and it feeds the next block's generation (compounding) | [vNext] additive |
| F3 race-week / race-day strategy | Distinct generation surface, adjacent to F1 | [vNext] additive |

### Free vs. paid & the trial path (decided 2026-05-25)

The free per-workout insight is the *habit* hook; it is **not** the conversion
mechanism. Conversion needs the free user to taste plan *generation* (the wedge),
which the free layer never exposes — so a trial is the actual lever, not more
insights. Two stages, two surfaces:

- **Free habit hook** (completed-data-grounded, works without a plan): C1
  post-workout insight, free trend observations (R22 / R25-free), basic reports
  (R24). Builds the open-the-app habit; does not expose the wedge.
- **Paid** (the AI-plan entitlement): A1 generation + A6 mode, B1 + B7 adaptation,
  the E quick-actions, F1 race-readiness, **and the plan-dependent insights C4 (and
  C2 when built)** — these explain/brief AI-*planned* sessions, so they deliver no
  value to a planless free user and belong to the paid experience.
- **Trial / conversion lever:** a free user can generate **one** AI plan to taste
  the wedge (the cold-purchase fix). Adaptation/regeneration (B1/B7), paid reports
  (F1), and the plan-dependent insights (C2/C4) stay paid; the free plan naturally
  expires into the paywall. Chosen over a time-boxed full trial or a hard paywall.
  This resolves the R27 trial-structure open question; pricing $ specifics remain
  deferred.

---

## Use-Case Catalog (full map, scope-tagged)

### A. Plan creation / goal framing

**A1. Event-targeted periodization** — *baseline* · **[v1]**.
Single A-race; full periodization from today to event date, emitted as
phase-tagged blocks (base → build → peak → taper).

**A2. Goal-based training, no race date** — *new* · **[vNext]**.
- *Trigger:* athlete has no event but a goal — "get faster at 10K", "build an
  aerobic base", "stay fit / lose weight while training".
- *AI does:* rolling, block-based training with no fixed peak; re-ups the next
  block as the current one completes.
- *Relation:* additive on the block engine — drop the terminal taper, add a re-up
  trigger. Schema already allows a dateless plan (nullable `event_date`).
- *Open Q:* the re-up trigger and a different "are we done?" definition.

**A3. Multi-race season (A/B/C races)** — *new (extends A1)* · **[vNext-schema]**.
- *Trigger:* several events across a season.
- *AI does:* assigns race priorities, peaks for A-races, treats B/C as tune-ups,
  inserts recovery + re-base between peaks.
- *Blocker:* needs an events *list*; the single `event_type`/`event_date` pair and
  the one-active-plan index can't represent A/B/C races today.

**A4. Return-from-layoff / injury ramp** — *new* · **[v1-guardrail]**.
- v1 has no dedicated comeback flow, but the generator must ramp conservatively,
  insert deload checkpoints, frame "stop if pain", and avoid anything diagnostic.

**A5. Beginner / couch-to-event on-ramp** — *new* · **[v1-guardrail]**.
- v1 has no dedicated on-ramp flow, but the generator must plan cautiously for
  sparse-profile athletes: low starting volume, walk/run intervals, technique
  focus, confidence-building milestones. (The confidence flag is designed in
  `athlete_profiles.baselines` per Unit 2.3 but **not yet produced**; the
  generator needs a fallback when baselines are sparse.)

**A6. Time-crunched / low-availability plan** — *extension* · **[v1]** (first-class mode).
- *AI does:* optimizes adaptation-per-hour (polarized / higher-intensity bias,
  trims junk volume) and flags goals unrealistic for the hours given.
- *Relation:* weekly hours is already an R5 input; the squeeze-optimization +
  feasibility flagging is the distinct behavior, promoted to an explicit v1 mode.

**A7. Off-season / maintenance / transition block** — *new* · **[vNext]**.
- Maintenance volume, address limiters, unstructured cross-training, deliberate
  mental break. A block-type; additive once block-structured.

**A8. Limiter-focused block** — *new* · **[vNext]**.
- Bias volume/intensity to a weakness sport while holding the others. A generation
  parameter on the block engine; per-sport baselines already exist (Unit 2.3).

### B. Adaptation & re-planning

*One engine, multiple entry points; the block is the unit of replan.*

**B1. Weekly adaptive review** — *baseline* · **[shipped — PR #86]**.
Scheduled (Sunday cron), proposes 1–3 weeks of adjustments, athlete confirms.
Shipped as per-workout EditOps, not block-level regeneration (see Build Status).

**B7. Single-workout swap / substitution** — *new (fine-grained)* · **[shipped — PR #86]**.
- *Trigger:* "pool's closed", "treadmill only", "knee's a bit sore".
- *AI does:* swaps one session for an equivalent-stimulus alternative. No detector
  needed (athlete-initiated, on-demand trigger).

**B2. Missed-block recovery** — *new (off-cycle)* · **[shipped — PR #86]**.
Daily missed-block detector + reflow instead of cramming lost work; detected from
`planned_workouts.status` + missing `completed_workouts`. (Was tagged vNext
pre-reconciliation; the detector shipped in PR #86.)

**B3. Schedule-shock reshape** — *extension of R11* · **[shipped — PR #86]**.
On-demand re-plan when availability changes permanently.

**B4. Event change — moved / canceled / added** — *new trigger* · **[shipped — PR #86]**.
On-demand re-plan to new date(s); cancellation proposes a new target or a
maintenance block (links A7).

**B5. Overreaching / fatigue-driven deload** — *extension (proactive)* · **[vNext]**.
Proactive recovery week from a CTL/ATL/TSB-style proxy. **Unreliable without HRV in
v1** — high false-alarm risk; revisit with v2 health data. One of the only two
B-series triggers still unbuilt (B1–B4/B7/R11 shipped in PR #86); `fatigue_deload`
`trigger_kind` is reserved but no detector is wired.

**B6. Over-performance progression bump** — *extension* · **[vNext]**.
Modest volume/intensity increase when actuals consistently beat targets. Unbuilt
alongside B5; `progression_bump` `trigger_kind` reserved, no detector wired.

### C. Daily / per-workout intelligence

**C1. Post-workout insight** — *baseline (free)* · **[v1]**.
The free habit hook — grounded in *completed* data, so it works without a plan.

**C4. "Why this workout?" on demand** — *extension* · **[v1, paid]**.
Plan-dependent (a free user has no AI plan to explain), so it belongs to the paid
plan experience, not the free hook. Surfaces/explains the rationale stored at
generation time (Unit 3.3). Nearly free *only if* A1 is specified to persist
per-workout rationale into `planned_workouts.rationale` (the column exists but
nothing writes it yet); define what C4 shows when rationale is NULL.

**C2. Pre-workout briefing** — *new* · **[vNext, paid]**.
Proactive morning-of session brief (what/why/how/zones/fueling). Plan-dependent →
paid when built, not a free hook.

**C3. Readiness-aware daily nudge** — *new (data-limited)* · **[vNext]**.
Inferred from training history only (no HRV/sleep in v1). Deferred — the trust risk
of a wrong "you're recovered" outweighs the value until v2 health-data ingest.

### D. Coach-in-the-loop augmentation

**D1. AI draft → coach edit** — *baseline (the wedge)* · **[v1]**.
Coach remains an *editor* in v1.

**D2. Coach-directed bulk adjustment** — *new* · **[vNext]**.
NL block regeneration as a coach-approved proposal.

**D3. AI-drafted coach comment / week summary** — *new* · **[vNext]**.
Drafts a summary/comment the coach edits and sends.

**D4. Plan-quality sanity check (linter)** — *new* · **[vNext]**.
The eval rubric (Unit 3.1) run interactively. Note: the deterministic eval harness
is still built in v1 for R8 quality gating — D4 only defers *exposing it
coach-facing*, so it's a near-free reuse later.

### E. Conversational / assistant interface

**E0. Structured quick-actions** — *new* · **[v1]**.
**v1 takes structured quick-actions, not chat.** Quick-action buttons/templates
("move my long run to Sunday", "make next week easier", "swap to bike") map to the
B7/B1 confirm-flow. This removes the free-text *parsing* risk — but not the
grounding/safety burden: each quick-action still triggers a real regeneration that
must be correct and grounded, bounded by the same propose-then-confirm step (R10).
The exact quick-action set is a planning decision (enumerate as a fixed list).

**E1. Natural-language plan tweaks** — *new* · **[vNext]** (free-text form).

**E2. Plan Q&A / coaching chat** — *new* · **[vNext]**.
Grounded Q&A over the athlete's own plan + data; must refuse/hedge outside its data,
no medical advice.

### F. Analysis & readiness (plan-adjacent)

**F1. Race-readiness score + narrative** — *baseline (paid)* · **[v1]**.

**F2. Plan-vs-actual retrospective** — *new* · **[vNext]**.
End-of-block retrospective on adherence + what to change next cycle; feeds the next
block's generation. Strong vNext candidate — block-structure makes this natural and
it compounds into better subsequent plans.

**F3. Race-week / race-day strategy** — *new* · **[vNext]**.
Race-day pacing, fueling, gear strategy. Distinct from taper *training* (R6).

## Cross-Cutting Considerations

- **Trust — athlete-confirmed, no silent replans.** Every adaptation entry point
  (the shipped B1/B2/B3/B4/B7/R11, plus deferred B5/B6 and E items) must propose,
  not apply (R10 across the whole surface) — and the shipped engine enforces this
  via the `weekly_reviews` propose→confirm→apply lifecycle. The E quick-actions
  route through the same confirm step.
- **Guardrails (v1, non-negotiable).** Refuse unrealistic asks, injury-safety
  conservatism (A4), beginner caution (A5), no medical claims anywhere (risk
  register / App Store posture).
- **v1 data limits.** Strava-only, no HRV/sleep. This is what bounds C3 and B5 to
  vNext — readiness/fatigue can only be inferred from training history in v1.
- **Eval harness is load-bearing.** The deterministic quality gate (R8, Unit 3.1)
  is built in v1 regardless; D4 (coach linter) is a deferred reuse of it, not new
  machinery.

## Explicitly Out of Scope (v1, carried forward)

No non-endurance sports, no nutrition planner beyond race-week guidance, no
non-Strava ingest (which bounds C3), no social features, no fine-tuned model. Every
use case above stays inside these bounds.

## Resolved This Session (2026-05-25)

- **Plan model generality** → block-structured race plan; block = unit of gen +
  replan. A2 enabled by nullable `event_date` (needs re-up trigger later); A3 needs
  an events list (deferred schema).
- **Trigger taxonomy** → one adaptive engine, multiple entry points. *(Build note,
  2026-06-08: PR #86 shipped more entry points than this line scoped — B1/B2/B3/B4/B7
  + R11 are all live triggers; only B5/B6 remain deferred. See Build Status.)*
- **Assistant surface** → v1 = structured quick-actions, no chat. E1/E2 → vNext.
- **Coach AI scope** → v1 coach stays an editor (D1 only). D2–D4 → vNext.
- **Athlete-type modes** → A6 first-class v1 mode; A4/A5 as v1 guardrails;
  A7/A8 → vNext.
- **Free layer & trial** → free habit hook is C1 + free trends/reports (R22/R24/
  R25-free); C4 (and C2) reclassified as *paid* plan-dependent features since a
  planless free user has nothing for them to explain; conversion lever is **one
  free generated plan** (resolves the R27 trial-structure open question). C3 stays
  vNext.

## Open Questions (remaining)

- **Block-replan vs. the shipped EditOp engine** — the merged adaptive engine (PR
  #86) emits per-workout EditOps over a flat `planned_workouts` bag with no block
  concept. When generation lands, does it emit phase-tagged blocks that this
  workout-level engine keeps adapting (no engine rewrite), or is block-level replan
  genuinely wanted (revisit the engine)? (See Build Status; resolve when generation
  is planned.)
- **Block/phase tag home** — does the persisted block tag live as a denormalized
  `phase` column on `planned_workouts`, inside the `structure` JSONB, or as a
  per-week concept? (Planning detail, Unit 3.2.)
- **Re-up trigger (A2)** — what signals "regenerate the next block", and what is
  the "are we done?" definition for a dateless goal? (Resolve when A2 is picked up.)
- **Events list (A3)** — events JSONB array on `plans` vs. a first-class `events`
  table. (Resolve when A3 is picked up.)
- **F2/F3 timing** — F2 is the strongest vNext candidate (compounds into better
  plans); confirm whether it leads the post-v1 slice.
- **Pricing $ specifics** — deferred (R27). Trial *structure* is now decided (one
  free generated plan); the price point and any free-trend-insight scope remain open.
