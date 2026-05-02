---
date: 2026-05-02
topic: database-schema
---

# Database Schema — Athlete Workouts, AI Plans, Coach Linkage

## Problem Frame

The training app has many overlapping data sources for what is effectively the same conceptual object — "a workout":
- **AI-generated planned workouts** (output of the plan generation pipeline).
- **Coach edits** to those planned workouts (with attribution + audit).
- **Manual workouts** an athlete logs themselves (no Strava activity).
- **Strava activities** that arrive via webhook and need to be matched to a planned workout when one exists, or stand alone when none does.
- **Athlete profile** derived from the rolling history of completed workouts plus manual edits.

The schema must let all of these coexist cleanly without:
- Losing data on Strava webhook duplicates / out-of-order delivery.
- Confusing manual completion with Strava completion (or double-counting).
- Breaking when an athlete's plan changes mid-week.
- Making the weekly-review query (compare planned vs completed for the prior 1–2 weeks) slow.
- Making the coach roster query (all athletes I'm linked to, with plan summaries) slow.

This brainstorm captures the entities, relationships, and key invariants. Exact column types, migration sequencing, and indexing strategy are deferred to `/ce:plan`.

This document supplements the broader product requirements at `docs/brainstorms/2026-05-02-ai-endurance-training-app-requirements.md` and the implementation plan at `docs/plans/2026-05-02-001-feat-ai-endurance-training-app-plan.md`. Decisions there about platform stack (Supabase Postgres + RLS), Strava ingest patterns, and the AI plan pipeline are inputs here.

## Entity Relationship Overview

```
┌──────────┐       ┌──────────────────┐       ┌──────────┐
│  users   │ 1───* │ coach_athlete    │ *───1 │  users   │
│          │       │ _links           │       │          │
│ (athlete)│       └──────────────────┘       │ (coach)  │
└────┬─────┘                                   └──────────┘
     │ 1
     │
     │ 1
┌────▼──────────────┐
│ athlete_profiles  │
│  - baselines      │
│  - target_event   │
│  - manual fields  │
└────┬──────────────┘
     │
     │ 1───* (one active plan + ad-hoc workouts)
     │
┌────▼──────┐         ┌──────────────────┐
│  plans    │ 1───*   │ planned_workouts │
│  (active /│         │  - structure JSON│
│  archived)│         │  - target intensity
└───────────┘         │  - plan_id NULL  │
                      │    = ad-hoc      │
                      └────────┬─────────┘
                               │
                               │ 0..1 ───── * 0..1
                               │
                      ┌────────▼─────────┐         ┌──────────────────┐
                      │ workout_matches  │ * ──── 1│completed_workouts│
                      │  (link table)    │         │ - source: strava │
                      │  - confidence    │         │   | manual       │
                      └──────────────────┘         │ - strava_act_id  │
                                                   │   (UNIQUE)       │
                                                   └────────┬─────────┘
                                                            │
                                                            │ 1
                                                            │
                                                   ┌────────▼─────────┐
                                                   │  insights        │
                                                   │  (per-workout AI)│
                                                   └──────────────────┘

Audit / cross-cutting:
   workout_edits (audit log: actor, ts, field diff)
   workout_comments (threaded; on planned_workouts and on weeks)
   weekly_reviews (proposal + decision)
   strava_tokens (per-user OAuth tokens, encrypted)
   strava_raw_payloads (incoming webhook + hydration responses, for replay)
   entitlements (RevenueCat-mirrored)
```

## Requirements

**Identity & roles**
- R1. A `users` row represents one human; the row carries the role(s) they currently hold (athlete, coach, or both). One user can be both an athlete (with their own profile + plan) and a coach (with linked athletes).
- R2. Strava OAuth tokens are stored per user, encrypted at rest, with refresh logic owned by the backend (never exposed to the client).
- R3. Subscription entitlements (`ai_plans`, `trend_reports`, `coach_invite`) are mirrored from RevenueCat to a per-user `entitlements` table; the backend never trusts client claims of paid state.

**Athlete profile**
- R4. Each athlete has exactly one `athlete_profiles` row holding derived baselines (per-sport pace/HR/power, weekly volume EWMA, dominant sport, confidence flag) and manual fields (age, weight, weekly hours available, target event metadata).
- R5. Manual fields persist across recomputes — derivation never overwrites a field the athlete edited. Each manually-edited field is timestamped so derivation can decide whether a new manual edit has superseded a stale automatic value.
- R6. Profile recompute is idempotent and triggered by completed-workout inserts (debounced per athlete).

**Plans & workouts**
- R7. An athlete has at most one **active** plan at a time (`status = active`); switching events archives the previous plan (`status = archived`).
- R8. Ad-hoc workouts are supported: a `planned_workouts` row may have `plan_id = NULL`, representing a workout an athlete or coach scheduled outside any structured plan.
- R9. A planned workout stores its structure as a single semi-structured JSON document (warm-up / main set / cool-down with intervals + targets) plus first-class columns for the fields the calendar and weekly-review queries need to index efficiently (athlete_id, scheduled_date, sport, planned_load, status).
- R10. Plan status transitions are explicit: `active` → `archived` (event passed or athlete switched events), with `created_from_review_id` available for plans regenerated by an off-cycle replan.

**Edits & audit**
- R11. Every edit to a `planned_workouts` row writes one `workout_edits` row capturing: actor (user id + role: athlete / coach / ai_review), timestamp, field-level diff, and the source (manual edit / accepted weekly review proposal / coach edit).
- R12. The current state of a workout always lives on the `planned_workouts` row — the audit log is read-only history, not the source of truth. Reading a workout never requires replaying audit events.
- R13. Workout edit attribution ("Edited by Coach Y, 2 days ago") is computable from the most recent `workout_edits` row for that workout.

**Strava ingest**
- R14. A canonical `completed_workouts` row exists for every completed activity, regardless of source (`source = strava | manual`). One row per real-world effort.
- R15. Strava-sourced rows carry `strava_activity_id` with a UNIQUE constraint per athlete to make webhook upserts idempotent.
- R16. Webhook + hydration payloads from Strava are also persisted in a `strava_raw_payloads` table for replay and debugging, separate from the canonical row. Raw payloads are retention-bounded (e.g., 30 days).
- R17. On Strava `delete` events, completed_workouts is soft-deleted (`deleted_at` set), never hard-deleted. The matched `planned_workout` returns to `planned` status if the deletion is the only completion link.
- R18. Per Strava ToS, raw stream samples (HR/power/pace at 1Hz) are NOT stored long-term in our DB — only summary statistics (avg/max/zones, normalized power, TSS-equivalent) plus a reference URL when needed. (Reflected in `completed_workouts.summary_stats` JSONB; raw streams are not in the schema at all.)

**Planned ↔ completed matching**
- R19. A `workout_matches` link table connects 0..1 `completed_workouts` rows to 0..1 `planned_workouts` rows. Both sides nullable so unmatched completions and uncompleted planned workouts are first-class.
- R20. Each match carries a confidence score and a method (`auto_same_day_sport`, `manual_user_link`, `merged_from_manual`). Coach or athlete can manually re-link if the auto-match is wrong.
- R21. Manual-completion-then-Strava-arrives merges into a single canonical row, with the manual record marked superseded (`superseded_by_completed_workout_id`). The matcher prefers Strava data when available.
- R22. The matcher window (date / sport / duration tolerance) is configurable per athlete or global; defaults documented in the planning artifact.

**Coach linkage**
- R23. A `coach_athlete_links` row connects one coach user to one athlete user, with status (`pending | active | revoked`) and link metadata (invited_at, accepted_at, revoked_at).
- R24. An athlete may have at most one coach with `status = active` at any time (single-coach model in v1, enforced by partial unique index).
- R25. A coach may have many active athletes (no cap in v1).
- R26. Coach access to an athlete's data is enforced by Row-Level Security tied to `coach_athlete_links.status = 'active'` — revocation immediately blocks queries.
- R27. Coach edits to planned workouts use the same path as athlete edits and produce `workout_edits` rows attributed to the coach.

**Weekly review & insights**
- R28. A `weekly_reviews` row captures one weekly-review proposal (target athlete, week_of, proposed_changes JSON, narrative rationale, status: `proposed | accepted | rejected | partially_accepted`).
- R29. Accepting a weekly-review proposal applies its changes to the relevant `planned_workouts` rows AND writes the corresponding `workout_edits` audit rows with `actor_role = ai_review` and a back-reference to the `weekly_review_id`.
- R30. An `insights` row stores one short AI insight per completed workout (FK to `completed_workouts`), generated by the small-model job. Insights are append-only (no edit history).
- R31. A daily per-athlete cap on insight generation (e.g., 5/day) is enforced at the job layer; the schema needs a way to count today's insights for an athlete cheaply (covered by an index on `(athlete_id, generated_at)`).

**Comments**
- R32. `workout_comments` supports threaded comments attached to either a single planned workout or a "week" (week_of date + plan_id). One table with a discriminator field is acceptable; nested replies are flat (parent_comment_id), not deeply hierarchical.
- R33. Comments persist independently of the workout being deleted/superseded; deleting a workout marks comments orphaned but does not destroy them.

**Cross-cutting invariants**
- R34. All time-bearing columns store UTC; the athlete's local timezone lives on `athlete_profiles` and is applied at the read/render boundary (e.g., to compute "today's workout" or "Sunday 6 PM weekly review").
- R35. Soft-delete (`deleted_at`) is used for: `completed_workouts`, `planned_workouts`, `plans`, `coach_athlete_links`. Hard-delete only on athlete account-deletion request (full purge cascade, audited).
- R36. Account deletion (privacy / app-store requirement) cascades deletes across all athlete-owned rows AND revokes any Strava token, AND enqueues a Strava-side activity-data-deletion request per Strava's data deletion API.

## Success Criteria

- **Calendar query** (athlete's planned + completed workouts for a 4-week window) returns in <50ms P95 from indexed Postgres at MVP scale (single-region, Supabase managed).
- **Weekly review query** (compare planned vs completed for prior 1–2 weeks for one athlete) returns in <100ms P95.
- **Coach roster query** (all active-linked athletes for a coach with plan summary) returns in <150ms P95 for coaches with up to 50 athletes.
- **Webhook idempotency**: replaying any Strava webhook 1000 times produces exactly one `completed_workouts` row.
- **Edit audit completeness**: every change to a `planned_workouts` row leaves a corresponding `workout_edits` trace; "show me what changed and who" is answerable from the audit log alone.
- **Privacy**: account deletion request results in zero athlete-owned rows remaining within 30 days, including Strava raw payloads.

## Scope Boundaries

- No raw 1Hz stream samples in the DB (Strava ToS + storage cost). Streams referenced by URL only when needed.
- No multi-coach support in v1 (single active coach per athlete).
- No multi-active-plan support in v1 (one active plan + ad-hoc workouts).
- No full plan versioning / rollback in v1 (audit log only, not immutable snapshots).
- No team / club / shared-plan structures. A plan belongs to exactly one athlete.
- No public sharing of plans or workouts (no public-read flag).
- No event/race object as a first-class entity in v1 — target event is a set of fields on `athlete_profiles` / `plans`. (Promote to its own table only when we add multi-plan support or race results tracking.)
- No nutrition / fueling entities.
- No equipment / gear tracking (bike serials, shoe mileage). Defer.
- No data warehouse / OLAP split — analytical queries (trends, cohorts) run against the same Postgres at MVP scale.

## Key Decisions

- **JSONB for workout structure, columns for query fields.** Workout structure (intervals, targets, rationale) is JSONB on `planned_workouts` and `completed_workouts`. Athlete_id, scheduled_date, sport, status, planned_load are first-class columns to make calendar + weekly-review queries fast. Rationale: structure varies by sport and changes shape with prompt iteration; columns are only what we filter or sort by.
- **`completed_workouts` is the canonical surface; `strava_raw_payloads` is replay-only.** Reads always go to `completed_workouts`. Raw payloads exist for debugging webhook ordering, prompt-engineering eval, and reprocessing if we change normalization logic. Retention-bounded (e.g., 30 days) so we don't accumulate Strava ToS exposure.
- **One plan + ad-hoc workouts via nullable `plan_id` on `planned_workouts`.** Avoids a second table for off-plan sessions. The active-plan invariant is enforced by a partial unique index (`status = 'active'`).
- **Audit log, not versioning.** `workout_edits` rows record actor + timestamp + diff for every edit. Sufficient for "Edited by Coach Y" attribution and forensic debugging without the cost of immutable plan snapshots.
- **Coach linkage uses RLS on `coach_athlete_links.status = 'active'`.** Revocation is enforced at the database layer, not just the app, so a stale token or a missed app-side check cannot leak data.
- **Single-coach-per-athlete enforced by partial unique index.** Allows historical revoked links to coexist with one active link.
- **Soft-delete is the default; hard-delete is reserved for account deletion.** Strava `delete` webhooks should never destroy data; account-deletion requests must.
- **Insights are append-only and rate-capped at the job layer.** No edit history needed; cap enforced by querying today's count via an index.
- **Single source of truth for entitlements.** RevenueCat webhook is the only writer of `entitlements`; daily reconciliation job catches missed webhooks.
- **Encryption at rest for Strava tokens.** Application-layer encryption (libsodium / pgcrypto), not just disk encryption — defense in depth.
- **UTC everywhere; athlete timezone applied at the edges.** Avoids DST bugs in scheduled jobs (weekly review) and calendar queries.

## Dependencies / Assumptions

- Single-region Postgres (Supabase US) at MVP scale; no multi-region replication concerns. EU users accept this posture.
- Supabase Realtime broadcasts row changes via Postgres triggers — schema must remain compatible (no quirky generated columns or polymorphic FKs that confuse the replication slot).
- Strava ToS interpretation: storing summary stats + reference to streams is permitted; storing raw streams indefinitely is not. Verify with a fresh ToS read before launch.
- RevenueCat is the source of truth for entitlements; no in-house subscription logic.
- Account-deletion latency target (≤30 days end-to-end) is acceptable to App Store reviewers and to GDPR (assuming we don't aggressively market to EU until Phase 2 region work).

## Outstanding Questions

### Resolve Before Planning

- *(none — all blocking product/schema decisions resolved during brainstorm)*

### Deferred to Planning

- [Affects R9][Technical] Exact JSONB shape for workout structure (per-sport schema variants vs. one uber-schema). Likely resolved during Unit 3.2 prompt iteration.
- [Affects R20, R22][Technical] Match confidence formula and tolerance defaults (date ±1 day, sport exact, duration ±50%). Validate with real Strava data during Unit 2.4.
- [Affects R8, R9][Technical] Index strategy for `(athlete_id, scheduled_date)` covering common queries (calendar window, weekly review). Decide between a btree composite vs. covering index after measuring on realistic data volume.
- [Affects R16][Needs research] Retention window for `strava_raw_payloads` — 7 / 14 / 30 days. Driven by debugging value vs. ToS exposure.
- [Affects R17, R21][Technical] Exact "merge" semantics when manual + Strava records collide (which fields take which source). Document during Unit 2.4.
- [Affects R28][Technical] How to represent `proposed_changes` on `weekly_reviews` — list of patch objects keyed by workout_id, or full proposed-week snapshot. Implementation detail; surface to user only as a UI question.
- [Affects R34][Technical] Where exactly the timezone boundary lives (worker job arms with athlete tz vs. column `local_date` cached). Likely cached for query simplicity.
- [Affects R36][Needs research] Strava data-deletion API mechanics and SLA — confirm the call exists and is reliable before promising 30-day deletion in the privacy policy.
- [Affects R32][Technical] Comment storage shape — single table with `commentable_type` discriminator vs. two tables (workout_comments + week_comments). Pick the lower-friction one during Unit 4.2.
- [Affects R10][Technical] Whether archived plans retain their `planned_workouts` rows (kept for history / reports) or those are also archived to a snapshot table. Default: retain in place with `plan.status = archived`.

## Next Steps

→ `/ce:plan` for structured implementation planning. The schema lands incrementally across Phase 1 (users, entitlements), Phase 2 (athlete_profiles, completed_workouts, strava_*, planned_workouts, workout_matches), Phase 3 (plans, weekly_reviews, workout_edits), Phase 4 (coach_athlete_links, workout_comments), Phase 5 (insights), per the existing plan's unit breakdown.
