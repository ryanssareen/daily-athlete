---
title: Partial Unique Indexes with Soft-Delete
date: 2026-05-13
status: active
---

# Partial Unique Indexes with Soft-Delete

How to enforce "at most one X per Y" when rows are soft-deleted rather than hard-deleted.

## The Pattern

```sql
CREATE UNIQUE INDEX <name> ON <table> (<col>)
    WHERE <status-predicate> AND deleted_at IS NULL;
```

The `WHERE` clause makes the uniqueness constraint **partial**: only rows matching the predicate participate in the uniqueness check. Rows that are archived, revoked, or soft-deleted fall outside the predicate and are invisible to the index — they cannot cause a uniqueness violation for new rows.

## Why Partial + Soft-Delete-Aware

A naïve `UNIQUE (<col>)` constraint would prevent a second row from ever sharing the same `col` value, even after the first row is logically deleted. That breaks the common lifecycle:

1. Mark existing row as archived/revoked (`UPDATE status='archived'` or `UPDATE deleted_at=now()`).
2. Insert a new row with the same key column.

With a partial unique index whose predicate excludes archived/deleted rows, step 2 succeeds because the archived row no longer participates in the uniqueness check.

## Concrete Example

From `supabase/migrations/0007_plans_and_planned_workouts.sql` — the canonical first use of this pattern in this repo:

```sql
-- One active plan per athlete (status='active' AND deleted_at IS NULL).
-- The partial WHERE makes archived and soft-deleted rows non-blocking,
-- so the natural archive-then-create transition works without a
-- multi-statement dance.
CREATE UNIQUE INDEX plans_one_active_per_athlete
    ON public.plans (athlete_id)
    WHERE status = 'active' AND deleted_at IS NULL;
```

This enforces: at most one `plans` row per `athlete_id` where `status = 'active'` and `deleted_at IS NULL`. Archived plans (`status = 'archived'`) and soft-deleted plans (`deleted_at IS NOT NULL`) are non-blocking.

## Caveats

### Concurrent inserts still race without a transaction

Postgres checks uniqueness at **commit time**, not at statement time. If two concurrent transactions both INSERT a new active row for the same athlete, neither sees the other's row during its own INSERT — both pass the predicate. The second to commit gets a `23505` unique violation.

Application code that performs the archive-then-create transition (archive the old active row, insert the new one) **must** wrap both statements in a single transaction. See the comment in `0007_plans_and_planned_workouts.sql` above `CREATE UNIQUE INDEX plans_one_active_per_athlete`.

### CHECK constraints validate values, not transitions

A `CHECK (status IN ('active', 'archived'))` constraint prevents invalid enum values, but it does not prevent `archived → active` status transitions. Resurrecting an archived plan (flipping `status` back to `'active'`) is SQL-legal; whether it is product-legal is an app-layer concern. If resurrection should be forbidden, enforce it in the Route Handler or with a trigger.

### Soft-delete + RLS interaction: reads must still filter

The partial index keeps the uniqueness constraint correct, but **read paths must still filter `deleted_at IS NULL` explicitly** — the index does not enforce that filter on SELECT queries. Forgetting the filter in a JOIN or subquery exposes logically-deleted rows as "ghost" results. For example:

```sql
-- Correct: excludes soft-deleted plans
SELECT pw.* FROM planned_workouts pw
JOIN plans p ON p.id = pw.plan_id
WHERE p.athlete_id = $1
  AND p.deleted_at IS NULL      -- <-- required
  AND pw.deleted_at IS NULL;

-- Wrong: surfaces planned_workouts whose plan is soft-deleted
SELECT pw.* FROM planned_workouts pw
JOIN plans p ON p.id = pw.plan_id
WHERE p.athlete_id = $1
  AND pw.deleted_at IS NULL;
```

## Future Reuse Sites

The parent schema plan ([docs/plans/2026-05-02-002-feat-database-schema-plan.md](../plans/2026-05-02-002-feat-database-schema-plan.md)) calls out two additional uses of this pattern:

- **Parent Unit 6 — `completed_workouts`:** idempotent Strava ingest.
  ```sql
  CREATE UNIQUE INDEX completed_workouts_strava_dedup
      ON public.completed_workouts (athlete_id, strava_activity_id)
      WHERE strava_activity_id IS NOT NULL;
  ```
  (Predicate is `IS NOT NULL` rather than a status check — same structural idea: exclude the rows that should not participate in uniqueness.)

- **Parent Unit 8 — `coach_athlete_links`:** at most one active coach per athlete.
  ```sql
  CREATE UNIQUE INDEX coach_athlete_links_one_active_per_athlete
      ON public.coach_athlete_links (athlete_user_id)
      WHERE status = 'active' AND deleted_at IS NULL;
  ```

## Reference

Canonical migration: `supabase/migrations/0007_plans_and_planned_workouts.sql` — `plans_one_active_per_athlete`.

Postgres documentation: https://www.postgresql.org/docs/17/indexes-partial.html
