---
title: "feat: AI Plan Generation & LLM Client"
type: feat
status: in-progress
date: 2026-06-08
origin: docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md
---

# AI Plan Generation & LLM Client

## Overview

Build the **generation** half of the AI training core: the first-time plan
generator (and the shared LLM client it runs on) that produces an athlete's
active plan from their profile + event, complementing the already-shipped
**adaptive** re-plan engine (`docs/plans/2026-05-25-001-...`). Generation owns
the **archive-then-create** lifecycle transition: when a new plan is generated,
the prior active plan is archived (`status='archived'`) and a new active plan
is inserted, in a single transaction (migration `0007` mandates atomicity to
preserve the one-active-plan-per-athlete invariant).

> **Resolution note (2026-06-08):** this revision records the resolution of the
> calendar read-path open question that was previously **Deferred to
> Implementation** and called out under **System-Wide Impact**. The question:
> when generation archives the prior plan, its `planned_workouts` rows still
> point at the archived plan, so the active-plan calendar can double-book future
> days. The investigation behind this resolution is read-path-only and
> independent of the generation pipeline itself; it is recorded here so the
> decision is settled *before* generation ships. The remaining generation /
> LLM-client units are tracked in the body of this plan.

## Problem Frame

Migration `0007_plans_and_planned_workouts.sql` defines:

- `plans.status IN ('active','archived')`. Archival sets `status='archived'` +
  `archived_at` and leaves `deleted_at` **NULL** (an archived plan is not a
  soft-deleted plan).
- `planned_workouts.plan_id` is **nullable**: ad-hoc athlete workouts and
  coach-assigned workouts (`apps/web/app/api/coach/workouts/route.ts` inserts
  with no `plan_id`) legitimately have `plan_id IS NULL`.
- `planned_workouts.plan_id` FK is `ON DELETE SET NULL`, which fires only on
  **hard** delete (the account-deletion cascade) — never on plan archival or
  plan soft-delete.

The single athlete calendar read path is `getPlannedInRange()`
(`apps/web/src/db/workouts.ts`), consumed by the calendar
(`apps/web/app/(athlete)/athlete/calendar/page.tsx`) and the dashboard
"next 7 days" (`apps/web/app/(athlete)/athlete/page.tsx`). It filters **only**
`athlete_id`, `deleted_at IS NULL`, and the `scheduled_date` range — it does not
select `plan_id`, does not join `plans`, and **does not filter on plan status**.

Consequence once an archive-then-create generation flow ships: the archived
plan's future `planned` rows (`deleted_at` still NULL) and the new plan's rows
for the same days both satisfy the query, so overlap days are double-booked.

## Open Questions

### Resolved During Planning

- *Archived-plan calendar double-booking — read-path filter vs. generation-side
  transition?* (**was: Deferred to Implementation**) → **Fix it in generation,
  not the read path.** When the archive-then-create transition runs, in the
  **same transaction** it soft-deletes the prior plan's *future, still-planned*
  workouts:

  ```sql
  UPDATE planned_workouts
     SET deleted_at = now()
   WHERE plan_id        = :old_plan_id
     AND status         = 'planned'        -- never touch completed/skipped/moved
     AND scheduled_date >= :changeover_date -- preserve past weeks as history
     AND deleted_at IS NULL;
  ```

  The existing calendar query is **left unchanged** — its `deleted_at IS NULL`
  filter now naturally excludes the superseded rows. A naive
  `plans.status='active'` read-path filter was **rejected** because:
  1. **It drops legitimate rows.** With `plan_id` nullable, a
     `plans!inner(status='active')` join silently excludes every coach-assigned
     and ad-hoc workout. A correct read filter would need
     `plan_id IS NULL OR plan.status='active'` — not a one-line `.eq()` in the
     Supabase builder (it needs `.or()` over an embedded resource, a view, or an
     RPC), so the "one-line filter" framing is false.
  2. **It erases history.** The calendar navigates to past weeks (`?week=`),
     which belong to now-archived plans. An active-only filter blanks every
     planned/skipped chip from prior plans on scroll-back. The double-booking
     exists only on the *future overlap window*; an active-status filter
     over-corrects across all history. (Actual completed workouts survive — they
     come from `completed_workouts` via `getWorkoutsInRange` — but the
     planned-side record would vanish.)
  3. **It deoptimizes the hot path.** The query is served by the partial index
     `planned_workouts_athlete_date (athlete_id, scheduled_date) WHERE deleted_at
     IS NULL`. Adding a `plans` join + status predicate forfeits that for the
     query migration `0007` itself labels the "hot path."

  Soft-delete is also the idiomatic fit: it is this project's stated teardown
  mechanism for both tables, and the `0007` warning that "any read path that
  JOINs plans MUST filter `plans.deleted_at IS NULL`" is itself an argument
  *against* expanding the read path — keep superseded rows out of the live set
  at write time instead.

  Boundary rules baked into the `UPDATE`:
  - `status = 'planned'` only — preserve the athlete's actual record
    (`completed`/`skipped`/`moved` rows are never soft-deleted, even if
    future-dated).
  - `scheduled_date >= :changeover_date` — `:changeover_date` is where the new
    plan's coverage begins (e.g. today or next Monday), so past planned rows
    remain as history and there is neither a gap nor an overlap at the seam.

### Deferred to Implementation

- **`:changeover_date` definition** — today (UTC) vs. next-Monday week boundary;
  must match where the new plan's first `planned_workouts` row lands so the seam
  has no gap/overlap. Fix alongside the generation unit that emits the new rows.
- *(Generation pipeline / LLM-client open questions tracked with their own
  units — out of scope for this resolution.)*

## System-Wide Impact

- **Calendar / dashboard read path (`getPlannedInRange`, `db/workouts.ts`):**
  **No change required.** It stays a single-table, index-backed query filtered
  on `deleted_at IS NULL` + date range. Correctness depends on generation
  soft-deleting the prior plan's superseded future rows inside the
  archive-then-create transaction (see Resolved above). Documented here so a
  future audit does not "fix" the read path by adding a `plans` join.
- **Generation unit (archive-then-create):** must include the
  future-`planned`-rows soft-delete `UPDATE` in the same transaction/RPC as the
  plan archive + new-plan insert. This is the load-bearing change for this
  resolution.
- **Regression test (to add with the generation unit):** after a regeneration,
  assert that overlap days render only the new plan's workouts, that a prior
  (archived) week still renders its history, and that a `plan_id IS NULL`
  coach-assigned / ad-hoc workout on an overlap day survives.
