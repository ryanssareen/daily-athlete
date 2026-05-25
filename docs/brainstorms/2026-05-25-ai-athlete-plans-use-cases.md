---
date: 2026-05-25
topic: ai-athlete-plans-use-cases
---

# AI Athlete Plans — Use-Case Expansion

## Context

The product already has a designed AI-plan core: event-targeted periodization
(R5–R8, plan Unit 3.2), weekly athlete-confirmed adaptive review (R9–R11, Unit
3.4), free per-workout insights (R22–R23), and paid report narratives /
race-readiness (R25). See:

- `docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md`
- `docs/plans/2026-05-02-001-feat-ai-endurance-training-app-plan.md`

This document does **not** re-litigate that core. It expands the *use-case
surface* for AI-based plans — the scenarios the current design doesn't yet cover
— so future planning has a fuller map. Scope is the existing endurance/tri wedge:
swim, bike, run, triathlon, plus strength/mobility. Use cases are grounded in the
data the app already collects (`athlete_profiles`, `plans`, `planned_workouts`,
`completed_workouts`, `workout_matches`, `weekly_reviews`).

This is a brainstorm — a catalog, not a prioritized roadmap. Each use case is
tagged **baseline** (already designed), **extension** (a variation on a designed
flow), or **new** (not yet covered).

## Baseline (already designed)

To anchor the catalog, these are the use cases the existing docs already cover.
Everything else below is net-new or an extension of them:

- **A1** Event-targeted periodization — R5–R8, Unit 3.2
- **B1** Weekly adaptive review — R9–R11, Unit 3.4
- **C1** Post-workout insight — R22–R23, Unit 5.1
- **D1** AI draft → coach edit — R18–R21, Units 4.1–4.3
- **F1** Race-readiness score + narrative — R25, Unit 5.2

## Use-Case Catalog

### A. Plan creation / goal framing

**A1. Event-targeted periodization** — *baseline* (R5–R8).
Single A-race; full periodization from today to event date.

**A2. Goal-based training, no race date** — *new*.
- *Trigger:* athlete has no event but a goal — "get faster at 10K", "build an
  aerobic base", "stay fit / lose weight while training".
- *AI does:* builds rolling, block-based training with no fixed peak; re-ups the
  next block as the current one completes.
- *Inputs:* profile baselines, weekly hours/days, stated goal.
- *Relation:* new — the current pipeline assumes an `event_date` to taper toward.
- *Risk/open Q:* no date means no natural taper or end-state — needs a
  rolling-horizon model and a different "are we done?" definition.

**A3. Multi-race season (A/B/C races)** — *new (extends A1)*.
- *Trigger:* athlete has several events across a season.
- *AI does:* assigns race priorities, peaks for A-races, treats B/C races as
  tune-ups / training days, inserts recovery + re-base between peaks.
- *Inputs:* multiple `{event_type, event_date, priority}`, profile, hours.
- *Risk/open Q:* closely spaced races create peak/recovery conflicts; the data
  model currently assumes one active plan with one target.

**A4. Return-from-layoff / injury ramp** — *new*.
- *Trigger:* athlete returning after time off, illness, or injury (R5 already
  takes free-text injury history, but there's no dedicated comeback flow).
- *AI does:* conservative progressive reintroduction, deload checkpoints,
  "stop if pain" guardrails, slow volume ramp.
- *Risk/open Q:* injury safety + no medical claims (per existing risk register);
  must err conservative and avoid anything diagnostic.

**A5. Beginner / couch-to-event on-ramp** — *new*.
- *Trigger:* first-timer or near-novice.
- *AI does:* gentle on-ramp (walk/run intervals), technique focus, very low
  starting volume, confidence-building milestones.
- *Risk/open Q:* sparse-profile athletes (the `confidence flag` from Unit 2.3) —
  AI must plan cautiously with little baseline data.

**A6. Time-crunched / low-availability plan** — *extension*.
- *Trigger:* athlete has very limited hours.
- *AI does:* optimizes adaptation-per-hour (polarized / higher-intensity bias,
  trims junk volume) and flags goals that are unrealistic for the hours given.
- *Relation:* weekly hours is already an input (R5); the squeeze-optimization and
  goal-feasibility flagging is the distinct behavior.

**A7. Off-season / maintenance / transition block** — *new*.
- *Trigger:* between events; athlete wants to hold fitness, not peak.
- *AI does:* maintenance volume, addresses limiters, unstructured cross-training,
  a deliberate mental break.

**A8. Limiter-focused block within a multisport athlete** — *new*.
- *Trigger:* "my swim is my weakness" — athlete wants to target one sport.
- *AI does:* biases volume/intensity to the limiter sport while maintaining the
  others at a holding load.
- *Inputs:* per-sport baselines already derived in the profile (Unit 2.3).

### B. Adaptation & re-planning

**B1. Weekly adaptive review** — *baseline* (R9–R11).

**B2. Missed-block recovery (travel / illness / life)** — *new (off-cycle)*.
- *Trigger:* a multi-day gap of missed workouts (detected from
  `planned_workouts.status` + missing `completed_workouts`).
- *AI does:* reflows the remaining plan instead of cramming the lost work,
  protecting the taper and event date.
- *Relation:* the weekly review (B1) is scheduled; this is an off-cycle reflow
  triggered by a gap.

**B3. Schedule-shock reshape** — *extension of R11*.
- *Trigger:* availability changes permanently (new job, baby, season change);
  athlete edits weekly hours/days on the profile.
- *AI does:* re-periodizes the remaining plan to the new constraints.

**B4. Event change — moved / canceled / added** — *new trigger*.
- *Trigger:* the race date shifts, the race is canceled (re-target the next one),
  or a new race is added mid-plan.
- *AI does:* re-periodizes to the new date(s); for cancellation, proposes a new
  target or a maintenance block (links to A7).
- *Relation:* R11 is a generic replan; this is a specific trigger with explicit
  date-math and taper repositioning.

**B5. Overreaching / fatigue-driven deload** — *extension (proactive)*.
- *Trigger:* load trend (a CTL/ATL/TSB-style proxy computed from
  `completed_workouts`, per Unit 5.2) signals accumulating fatigue.
- *AI does:* proactively proposes an unscheduled recovery week.
- *Risk/open Q:* avoid false alarms; still athlete-confirmed.

**B6. Over-performance progression bump** — *extension*.
- *Trigger:* athlete consistently beating targets (actuals > planned).
- *AI does:* proposes a modest volume/intensity increase (the inverse of B5).

**B7. Single-workout swap / substitution** — *new (fine-grained)*.
- *Trigger:* "pool's closed", "treadmill only", "knee's a bit sore".
- *AI does:* swaps one session for an equivalent-stimulus alternative without
  disturbing the week's overall structure.
- *Relation:* finer-grained than the weekly review — a single-workout edit, not a
  block re-plan.

### C. Daily / per-workout intelligence

**C1. Post-workout insight** — *baseline* (free, R22–R23).

**C2. Pre-workout briefing** — *new*.
- *Trigger:* morning-of (or evening-before) a planned session.
- *AI does:* states what today's session is, why it matters in the block, how to
  execute it, target zones, and a brief fueling note.
- *Relation:* mirrors the rationale already captured at generation (Unit 3.3),
  delivered proactively as a daily touchpoint.

**C3. Readiness-aware daily nudge** — *new (data-limited)*.
- *Trigger:* recent load + completion pattern (e.g., three hard days in a row).
- *AI does:* nudges "consider keeping today easy" / "you're well-recovered".
- *Risk/open Q:* v1 is Strava-only — **no HRV / sleep / HealthKit** — so
  readiness is inferred only from training history, not physiological signals.
  Set expectations accordingly; revisit when v2 adds health-data ingest.

**C4. "Why this workout?" on demand** — *extension*.
- *Trigger:* athlete taps a workout and asks why it's prescribed.
- *AI does:* surfaces/explains the rationale stored at generation time (Unit 3.3).

### D. Coach-in-the-loop augmentation

**D1. AI draft → coach edit** — *baseline* (the wedge, R18–R21).

**D2. Coach-directed bulk adjustment** — *new*.
- *Trigger:* coach instructs in natural language ("make the next 3 weeks
  bike-heavy", "this athlete races short course — add threshold work").
- *AI does:* regenerates the affected block as a proposal for coach approval.

**D3. AI-drafted coach comment / week summary** — *new*.
- *Trigger:* coach reviewing an athlete's week.
- *AI does:* drafts a summary or a comment the coach edits and sends, cutting
  coach busywork (reinforces the "AI does the busywork" coach-buy-in story).

**D4. Plan-quality sanity check for coach** — *new*.
- *Trigger:* coach has edited a plan.
- *AI does:* reviews the edited plan and flags risks (back-to-back hard days,
  long-run jump >10%, missing taper) — effectively the eval rubric from Unit 3.1
  run interactively as a linter.
- *Relation:* reuses deterministic assertions already built for the eval harness.

### E. Conversational / assistant interface

**E1. Natural-language plan tweaks** — *new (interface over B1/B7)*.
- *Trigger:* "move my long run to Sunday and add more swimming".
- *AI does:* translates the request into concrete plan edits the athlete confirms
  (no silent application).

**E2. Plan Q&A / coaching chat** — *new*.
- *Trigger:* "what's a brick?", "why is this week easier?", "am I on track for
  sub-4?".
- *AI does:* answers grounded in the athlete's own plan + completed-workout data.
- *Risk/open Q:* must stay grounded — refuse or hedge on questions it can't
  answer from the athlete's data; no medical advice.

### F. Analysis & readiness (plan-adjacent)

**F1. Race-readiness score + narrative** — *baseline* (paid, R25).

**F2. Plan-vs-actual retrospective** — *new*.
- *Trigger:* end of a block or completed plan.
- *AI does:* retrospective on adherence, what worked, and what to change next
  cycle — feeding the athlete's next plan request.

**F3. Race-week / race-day strategy** — *new*.
- *Trigger:* event approaching.
- *AI does:* race-day pacing, fueling, and gear strategy tailored to the event +
  athlete.
- *Relation:* taper *training* is already in the plan (R6); race-day *strategy*
  is a distinct AI output, adjacent to readiness (F1).

## Cross-Cutting Considerations

- **Trust — athlete-confirmed, no silent replans.** Every adaptation use case
  (B2–B7, E1) must propose, not apply. Carry the existing R10 principle across
  the whole surface.
- **Inputs vs. v1 data limits.** Most use cases run on data we already have. The
  notable constraint is readiness (C3): v1 is Strava-only with no HRV/sleep, so
  readiness is inferred from training history, not physiology.
- **Guardrails.** Refuse unrealistic asks (e.g., Ironman in 6 weeks for a
  beginner — already an eval scenario in Unit 3.2), injury-safety conservatism
  (A4), and no medical claims anywhere (existing risk register / App Store
  posture).
- **Free vs. paid leaning** (directional, not a monetization plan): insights and
  briefings (C1–C4) lean free as the acquisition hook; plan generation and
  adaptation (A2–A8, B2–B7), the assistant (E1–E2), and deep analysis (F2–F3)
  lean paid alongside the existing AI-plan entitlement.

## Explicitly Out of Scope (v1, carried forward)

No non-endurance sports, no nutrition planner beyond race-week guidance, no
non-Strava ingest (which bounds C3), no social features, no fine-tuned model.
Every use case above stays inside these bounds.

## Open Questions (resolve before any of these becomes a plan)

- **Plan model generality:** does the `plans` / `planned_workouts` schema support
  no-date rolling plans (A2) and multi-race seasons (A3), or do those need schema
  work? (The current design assumes one active plan toward one event.)
- **Trigger taxonomy:** B2–B6 are different *triggers* into the same re-plan
  machinery — is that one adaptive engine with multiple entry points, or distinct
  flows?
- **Assistant surface:** is E1/E2 a v1 ambition or a v2 layer? It implies a chat
  UI not in the current plan.
- **Coach AI scope:** D2–D4 expand the coach from editor to AI operator — does
  that change the coach value prop and the v1 coach scope?
- **Prioritization:** which of these is the next slice after the event-periodization
  core ships? (Deliberately left open — this doc is the catalog, not the roadmap.)
