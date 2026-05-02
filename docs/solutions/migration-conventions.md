---
title: Migration Conventions
date: 2026-05-02
status: active
---

# Migration Conventions

How database schema changes are authored, ordered, and verified in DA2.

## Where migrations live

`supabase/migrations/NNNN_<description>.sql` — plain SQL files applied by the Supabase
CLI in alphanumeric order.

Why plain SQL (not Alembic):
- RLS policies, triggers, and Realtime publication tweaks live in raw SQL anyway.
- Supabase CLI knows about the `auth` schema, the `supabase_realtime` publication, and
  Edge Functions — Alembic does not.
- Plain SQL is easier to review than auto-generated Alembic ops.

## Naming + numbering

- Four-digit zero-padded sequence prefix: `0001_*.sql`, `0002_*.sql`, ...
- Imperative description of the change in snake_case: `0001_users_and_entitlements.sql`,
  `0007_workout_edits.sql`.
- One logical change per file. No monolithic migrations.

If two PRs both add `0007_*.sql`, the second to merge re-numbers to `0008_*.sql` —
catch this in code review, not after merge.

## What every migration must include

- `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` etc.
- Any new constraints (CHECK, UNIQUE, FK).
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY ...` for any user-data
  table.
- Realtime publication membership when applicable:
  `ALTER PUBLICATION supabase_realtime ADD TABLE <table>;`

## What never goes in a migration

- Application data seeds (use a separate seed script).
- Secrets, API keys, encryption keys (always env vars).
- `DROP DATABASE`, `DROP SCHEMA public CASCADE` outside of test bootstrap.
- Time-bound logic that depends on `now()` for behavior (use app-layer scheduled jobs).

## Soft-delete convention

Any table whose rows can be user-deleted in normal flow gets a `deleted_at TIMESTAMPTZ`
column with a default of NULL. All read paths filter `WHERE deleted_at IS NULL`. Hard
delete is reserved for the account-deletion cascade (Schema plan Unit 10).

## Timestamps

Every column representing a moment is `TIMESTAMPTZ`. All values stored UTC. Athlete
timezone lives on `public.users.timezone` and is applied at the read/render boundary.

## Drift check

`apps/api/scripts/check_schema_drift.py` reflects the test database after applying all
migrations, then compares to the SQLAlchemy `Base.metadata`. Drift flags:

- Tables in ORM but not in DB (FAIL — write a migration).
- Columns in ORM but not in DB (FAIL — write a migration).
- Tables/columns in DB but not in ORM (WARN — could be deliberate, e.g. Supabase-owned
  tables).

CI runs this on every PR; merge is blocked on FAIL.

## Account deletion safety

Schema plan Unit 10 introduces `delete_user_cascade(user_id)`. Any migration adding a
new user-scoped table must update that function in the **same PR**. CI catches
omissions by verifying every table containing a `user_id` or `athlete_id` column is
referenced in the function body.

## Testing

`apps/api/tests/conftest.py` applies `tests/sql/test_bootstrap.sql` (auth-schema stub
for plain Postgres) followed by every `supabase/migrations/*.sql` file before each
test session. RLS is exercised via `auth.uid()` reading from `request.jwt.claim.sub`
which the `as_user` fixture sets.
