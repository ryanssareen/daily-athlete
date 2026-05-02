---
date: 2026-05-02
topic: ai-endurance-training-app
---

# AI Endurance Training App — Requirements

## Context

Build a multi-sport endurance training app (swim, bike, run, triathlon, plus strength/mobility) anchored on an AI plan generator that produces full triathlon periodization. The product is athlete-first with coaches as a feature inside the athlete's experience. Athletes pay; coaches are unlocked secondarily. Web for coaches, native mobile (iOS/Android) for athletes, with Strava as the primary completion-sync surface.

This document captures the product decisions reached during brainstorming so that `/ce:plan` can produce an implementation plan without re-litigating product scope.

## Problem Frame

Endurance athletes training for events (5K → Ironman) currently choose between:
- **Static plan apps** (TrainingPeaks templates, free PDFs) — cheap but not personalized.
- **AI plan apps** (Runna, Humango) — strong but mostly single-sport (run-heavy), and coach-less.
- **Coach platforms** (TrainingPeaks, Final Surge) — powerful but require hiring a coach and have no AI.

There is no product that is **(a) AI-generated true triathlon periodization, (b) adaptive to actual training load, and (c) lets a coach optionally review/edit the AI plan in the same surface**. The hybrid (AI does the volume, coach adds the judgment) is the wedge.

## High-Level Product Shape

```
            ┌──────────────────────────────────────────┐
            │             AI Planning Core             │
            │  (periodization + weekly adaptation +    │
            │      per-workout insight generation)     │
            └──────────────────────────────────────────┘
                       ▲                 ▲
            athlete    │                 │   coach
            profile    │                 │   edits/comments
                       │                 │
   ┌───────────────────┴────┐   ┌────────┴────────────────┐
   │  Athlete (native iOS/  │   │  Coach (web)            │
   │  Android)              │   │                         │
   │  - Calendar            │   │  - Roster view          │
   │  - Workout detail      │   │  - Plan edit + comment  │
   │  - Mark complete       │   │  - Athlete progress     │
   │  - Daily insight       │   │                         │
   │  - Reports             │   │                         │
   └────────┬───────────────┘   └─────────────────────────┘
            │
            │ Strava OAuth + webhook
            ▼
   ┌────────────────────────┐
   │  Strava                │
   │  - 200-workout import  │
   │  - Activity webhook    │
   └────────────────────────┘
```

## Requirements

**Athlete onboarding & profile**
- R1. Athlete signs up on native mobile (iOS, Android) and connects Strava via OAuth.
- R2. On first Strava connection, the system imports the athlete's last 200 activities and derives an initial athlete profile (training volume, pace/power baselines per sport, weekly load pattern, dominant sport).
- R3. Athlete profile is continuously updated as new workouts (Strava-synced or manually completed) land in the system.
- R4. Athlete can edit profile fields manually (age, weight, target event date, target event type, weekly availability).

**AI plan generation (paid)**
- R5. Paid athlete can request an AI-generated plan by providing: target event type (5K/10K/half/marathon, Sprint/Olympic/70.3/IM tri, custom), event date, current fitness inputs (auto-prefilled from profile), weekly hours available, prior injuries (free text).
- R6. The AI generates a full periodized plan from "today" to event date, including swim, bike, run sessions (multi-sport for tri events) with brick workouts, race-week taper, and optional strength/mobility days.
- R7. The plan is rendered on the athlete's calendar with per-workout details (target intensity, duration, structure, rationale).
- R8. The AI's quality bar must be measurable — we ship with an internal eval harness that compares AI plans against reference coach plans before launch (see Risks).

**Adaptivity (paid)**
- R9. Once per training week, the AI runs a "weekly review" that proposes plan adjustments for the following 1–3 weeks based on completed/missed/over-performed workouts and load trends.
- R10. The athlete must explicitly accept, reject, or modify proposed adjustments before they apply (no silent replans).
- R11. The athlete can manually trigger an off-cycle replan ("life happened, redo the next 2 weeks").

**Workout completion**
- R12. When an athlete completes an activity in Strava, a webhook updates the matching planned workout to "completed" with actuals (distance, time, HR, power if available).
- R13. Athlete can manually mark a workout completed (with optional actuals) when not Strava-tracked.
- R14. Athlete can mark a workout skipped or rescheduled, which informs the next weekly review.
- R15. The system attempts to deduplicate Strava webhooks and manual completion (one workout, one completion record).

**Calendar**
- R16. Athlete sees a multi-week calendar view with planned and completed workouts, color-coded by sport.
- R17. Athlete can drag/move a planned workout to a different day (within reason — moves are flagged to the next weekly review).

**Coach in v1**
- R18. An athlete can invite one coach by email to their plan.
- R19. The coach uses a web app to view the athlete's plan, edit individual workouts, and leave comments on workouts and weeks.
- R20. Coach edits show up live on the athlete's calendar with attribution ("Edited by Coach Y").
- R21. A single coach can be connected to multiple athletes from the same web account (roster view).

**Daily insights (free)**
- R22. After each completed workout (Strava or manual), the system generates a short AI insight (e.g., "your Z2 pace is trending up 3% over 4 weeks; recovery looks adequate").
- R23. Daily insights are shown on the athlete's mobile home screen and per-workout view, free for all users.

**Reports**
- R24. Free reports: weekly, monthly, annual rollup of volume, time, distance per sport, plus PRs detected from completed workouts.
- R25. Paid reports: trend analysis (fitness/fatigue/form proxy, pace/power progression, cross-sport balance), AI-written narrative summary, race readiness score as event approaches.

**Monetization**
- R26. Free tier: tracking, calendar, Strava sync, manual workout creation, basic reports (R24), daily insights (R22).
- R27. Paid tier (target ~$15–$20/month, exact pricing TBD): AI plan generation (R5–R8), weekly adaptive review (R9–R11), trend analysis & deep reports (R25), coach invitation (R18–R21).
- R28. Subscription via App Store / Play Store (mobile) and Stripe (web) with a single account identity.

**Platforms**
- R29. v1 athlete experience: native iOS and Android (framework choice deferred to planning — RN / Flutter / two-native is a planning decision).
- R30. v1 coach experience: web only.
- R31. Backend, auth, and AI services are shared across platforms.

## Success Criteria

- **AI quality**: ≥80% of generated plans pass internal eval (coach reviewers rate "would assign to a real athlete with at most minor edits") before public launch.
- **Activation**: ≥60% of new athletes connect Strava during onboarding.
- **Adaptivity**: ≥70% of paid athletes accept (with or without edits) the weekly review proposal in any given week of an active plan.
- **Conversion**: free → paid conversion ≥5% within 30 days for athletes with an active event date set.
- **Coach NPS**: among invited coaches who use the editor ≥3 times, NPS ≥30 in the first 90 days.

## Scope Boundaries (v1 non-goals)

- No marketplace where coaches sell plans publicly. (Future: v2/v3.)
- No coach-paid SaaS pricing. Coach is a free feature inside an athlete subscription. (Future: per-seat coach pricing.)
- No nutrition / fueling planner beyond race-week guidance inside the plan.
- No social feed, leaderboards, or club features.
- No Garmin Connect / Apple Health / Wahoo / TrainingPeaks ingest in v1 — Strava only. (Future v2.)
- No live workout guidance / structured workout export to head units in v1.
- No web app for athletes in v1 (mobile only); no native app for coaches in v1 (web only).
- No fine-tuned model in v1 — prompt engineering + RAG over coaching playbooks only. (Revisit after eval data.)

## Key Decisions

- **Athlete-first, dual-sided.** Athletes are the buyer; coaches are a feature inside the athlete experience. Coach monetization deferred to post-PMF.
- **Wedge is "AI triathlon periodization with coach review."** Single-sport apps (Runna/Humango) and coach platforms (TrainingPeaks/Final Surge) are both incomplete; we sit in the middle.
- **AI is full periodization day 1.** Highest risk, but the wedge is meaningless if we ship a library-based product. Mitigation: eval harness + alpha with real coaches in the loop.
- **Adaptation is weekly + athlete-confirmed.** Avoids the "AI silently changed my plan" trust-killer; lower thrash than per-workout replanning.
- **Free per-workout AI insights are the acquisition hook.** Free users get continuous AI value, which builds habit before the paywall. Paid value is plan generation + trend analysis + coach.
- **Strava is the only completion source in v1.** Manual completion as fallback. Other integrations deferred.

## Dependencies / Assumptions

- Strava API access in good standing, including activity webhook subscription and the right to import the athlete's recent activity history. (**Verify Strava ToS allows the 200-activity backfill before promising it.**)
- Native mobile is built with a cross-platform stack (RN or Flutter) — assumed for v1 timeline. Final choice in planning.
- LLM provider with sufficient context window for periodization prompts and competitive pricing for free-tier per-workout insights at scale.
- App Store / Play Store subscription approval, given the AI-generated training content (no medical claims).
- A small alpha cohort of coaches willing to grade AI plans during eval harness construction.

## Risks (Top)

- **AI plan quality is the wedge and is unproven.** A bad taper, an absurd swim volume jump, or a missed brick can vaporize trust in one workout. Mitigation: eval harness, coach-in-the-loop alpha, conservative defaults, "why this workout?" rationale on every session.
- **Strava webhook reliability and dedup.** Missed/duplicate webhooks affect adaptivity quality. Mitigation: nightly reconciliation pull + idempotent completion records.
- **Cost of free per-workout insights at scale.** If acquisition succeeds, insight generation is the largest variable cost. Mitigation: caching of profile-derived context, smaller model for insights, rate-limiting.
- **Cross-platform mobile + web coach is real scope.** The 3–4 month MVP is aggressive. Mitigation: ruthless cut of v2 features; consider PWA for athlete v1 if native blocks the timeline.

## Outstanding Questions

### Resolve Before Planning
- *(none — all blocking product decisions resolved during brainstorm)*

### Deferred to Planning
- [Affects R29][Technical] Cross-platform stack choice for athlete mobile (RN vs Flutter vs two-native) — affects timeline and coach-web code reuse.
- [Affects R6, R8][Needs research] LLM provider + model choice for plan generation; structured output strategy (JSON schema vs. function calling vs. multi-step generation).
- [Affects R8][Needs research] Eval harness design — reference plans source, grading rubric, automation level.
- [Affects R12, R15][Technical] Strava webhook architecture (subscription model, retry, dedup with manual completion).
- [Affects R2, R3][Technical] Athlete profile storage shape and update cadence (event-driven vs. nightly recompute).
- [Affects R27][Needs research] Final pricing point and trial structure (free per-event AI plan trial vs. 14-day full trial vs. paywalled from day 1).
- [Affects R28][Technical] Subscription unification across iOS / Android / Stripe (single source of truth for entitlements).
- [Affects R22, R25][Needs research] Insight + report content templates and quality bar.
- [Affects R20][Technical] Real-time sync strategy for coach edits on athlete mobile.

## Next Steps

→ `/ce:plan` for structured implementation planning.
