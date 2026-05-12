---
title: "feat: Athlete Profile Schema (Schema Plan Unit 4)"
type: feat
status: active
date: 2026-05-12
origin: docs/brainstorms/2026-05-02-database-schema-requirements.md
parent: docs/plans/2026-05-02-002-feat-database-schema-plan.md
---

# Athlete Profile Schema — Implementation Plan

## Overview

Land the `athlete_profiles` table that holds per-athlete derived baselines (per-sport pace/HR/power, dominant sport, weekly-volume EWMA, confidence flags) and manual fields (age, weight, weekly hours available, target event), with per-field manual-edit timestamps so derivation never overwrites the athlete's own input. This is Unit 4 of the parent schema plan ([docs/plans/2026-05-02-002-feat-database-schema-plan.md](2026-05-02-002-feat-database-schema-plan.md)) and is a prerequisite for Phase B work on plans, planned/completed workouts, and weekly reviews — every athlete-data unit downstream reads baselines or manual fields.

Scope is one migration (`supabase/migrations/0004_athlete_profiles.sql`), one Zod/TS module (`packages/shared/src/athlete-profile.ts`), and the test coverage that proves the invariants. RLS in this unit is athlete-self only; coach-side read access lands in Unit 8 of the parent plan as a consolidated RLS pass.

## Problem Frame

See origin: [docs/brainstorms/2026-05-02-database-schema-requirements.md](../brainstorms/2026-05-02-database-schema-requirements.md), requirements R4–R6.

The athlete profile is two intermixed surfaces with different sources of truth:

- **Baselines** are derived by the app from completed workouts. They re-compute whenever new completion data lands. They are authoritative for things the athlete has not manually entered.
- **Manual fields** are the athlete's own input (age, weight, weekly hours, target event). They must persist across recomputes — derivation never overwrites an athlete-entered value. Each field carries its own timestamp so a future derivation pass can decide whether a stale manual value should be re-asked rather than blindly overridden.

R6 adds an idempotency requirement: recompute is triggered by completed-workout inserts, debounced per athlete. This plan only owns the storage surface (the timestamp columns and JSONB shapes the derivation logic relies on); the debounce mechanism itself is application-layer work scheduled under product plan Unit 2.3.

## Requirements Trace

- **R4** — `athlete_profiles` is 1:1 with `users` and holds both derived baselines (per-sport pace/HR/power, weekly volume EWMA, dominant sport, confidence flag) and manual fields (age, weight, hours available, target event metadata). Satisfied by the table schema in Unit A.
- **R5** — Manual fields persist across recomputes; each manually-edited field is independently timestamped. Satisfied by the `manual_field_edited_at JSONB` parallel column in Unit A and the Zod contract in Unit B. The "derivation never overwrites manual" invariant is enforced in app code (product plan Unit 2.3) — this plan only guarantees the timestamp surface exists.
- **R6** — Recompute is idempotent. Satisfied here by `derived_at TIMESTAMPTZ` and `derivation_version SMALLINT` so the app's debounce key is `(user_id, derivation_version, latest_completed_at)` — the trigger/debounce logic itself is out of scope (product plan Unit 2.3).

## Scope Boundaries

- The derivation function itself is **not** in this plan. We only land the storage surface it will read and write. Derivation logic lands in product plan Unit 2.3.
- The trigger (or queue subscription) that fires recompute on `completed_workouts` insert is **not** in this plan — `completed_workouts` does not exist yet (parent plan Unit 6). Wiring the trigger lands when that table does.
- Coach-side RLS on `athlete_profiles` is **not** in this plan. The parent plan consolidates all coach-side RLS into Unit 8 to avoid touching every athlete-data table twice. This unit ships only the athlete-self policies; Unit 8 will `ALTER POLICY` / add a coach policy without altering schema.
- No new extensions, materialized views, generated columns, or computed indexes.
- No realtime publication membership — profile rows change rarely enough that on-demand fetch is sufficient, and the data is mildly sensitive (age/weight) so opting out by default is the right posture.

### Deferred to Separate Tasks

- **Vitest test-runner bootstrap** (parent plan Unit 1 backfill): `apps/web` has no test runner installed today. The test file in Unit C is fully designed but cannot execute until vitest lands. See Dependencies / Prerequisites.
- **Per-table Zod modules for already-shipped tables** (`users`, `entitlements`, `strava_tokens`, `strava_raw_payloads`): also Unit 1 backfill — flagged in the earlier status review, not included here to keep this PR scoped to Unit 4.

## Context & Research

### Relevant Code and Patterns

- [supabase/migrations/0001_users_and_entitlements.sql](../../supabase/migrations/0001_users_and_entitlements.sql) — the canonical pattern for this repo: `CREATE TABLE` → indexes → `touch_updated_at` trigger → `ENABLE ROW LEVEL SECURITY` → self-select / self-update policies. Reuse `public.touch_updated_at()` (already defined there) rather than redefining.
- [supabase/migrations/0002_strava_infra.sql](../../supabase/migrations/0002_strava_infra.sql) — example of a 1:1-with-users table (`strava_tokens` uses `user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE`). `athlete_profiles` follows the same PK shape.
- [supabase/migrations/0003_security_hardening.sql](../../supabase/migrations/0003_security_hardening.sql) — confirms the `SECURITY DEFINER SET search_path = public` posture for any function added in a migration.
- [docs/solutions/migration-conventions.md](../solutions/migration-conventions.md) — naming/numbering rules (next slot is `0004_*.sql`), TIMESTAMPTZ-UTC convention, soft-delete policy (does NOT apply here — profile is 1:1 with users and follows the FK cascade).
- [packages/shared/src/index.ts](../../packages/shared/src/index.ts) — currently an empty barrel; this unit adds `athlete-profile.ts` and wires its export through. Zod 3.23 is already a dependency of `@da2/shared`.
- [AGENTS.md](../../AGENTS.md) — RLS posture ("RLS is the primary authorization defense"), repo-relative-path rule, "Athlete timezone lives on `public.users.timezone`" (the brainstorm R34 said `athlete_profiles`; implementation chose `users` and AGENTS.md is now the source of truth — do NOT add a `timezone` column to `athlete_profiles`).

### Institutional Learnings

- `docs/solutions/migration-conventions.md` already encodes the testing posture: positive + negative RLS tests are required for every user-data table before its defining migration ships. This unit honors that.
- No `athlete_profiles`-specific solution exists yet. After this lands, no new solutions doc is required — the patterns this unit uses are already documented. A solutions entry should only follow if a surprising decision emerges during implementation (e.g., a JSONB constraint pattern worth reusing).

### External References

External research deliberately skipped — local patterns are strong (three prior migrations, established `touch_updated_at` helper, RLS convention) and the topic is not high-risk (no auth/payments/external API exposure in this unit).

## Key Technical Decisions

- **Migration filename: `0004_athlete_profiles.sql`**, not `0003_*` as the parent plan said. `0003` was consumed by the security-hardening migration (Wave-1 review residual). Parent plan numbering shifts +1 from this point onward; this unit captures the corrected number and the parent plan should be updated as units land.
- **Primary key is `user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE`** — 1:1 with users, no separate `id` column. Matches the `strava_tokens` shape.
- **No `deleted_at` column.** Profile rows do not get soft-deleted in normal user flow; account deletion cascades via the FK. Listing `athlete_profiles` in `delete_user_cascade` (parent plan Unit 10) is therefore unnecessary — the FK cascade handles it. Document the omission as an explicit comment in the migration so the Unit-10 audit doesn't flag it as a missing entry.
- **Three separate JSONB columns**, not one combined blob, because they have different write semantics: `baselines` (derivation-owned), `manual_fields` (athlete-owned), `manual_field_edited_at` (parallel timestamps, app-maintained in lockstep with `manual_fields`). Mixing them would make the "derivation must not touch manual" invariant harder to enforce in app code and harder to assert in tests.
- **`weekly_volume_ewma` is its own JSONB column**, not nested under `baselines`. Two reasons: it changes every recompute (where individual baselines can be sticky), and downstream queries (weekly review narrative, plan generation) read it independently. Parent plan sketch already separated it; honoring that.
- **`derived_at TIMESTAMPTZ NULL`** records the last successful derivation. NULL on initial insert (athlete signed up, no completed workouts yet — sparse-data case from R5). The confidence flag inside `baselines` covers "I have baselines but they are weak."
- **`derivation_version SMALLINT NOT NULL DEFAULT 1`** added now (not later) so the eventual derivation function can detect "this row was written by an older derivation version" without a schema change. Cheap forward-compatibility; matches the same idea as `strava_tokens.key_version` from 0003.
- **No CHECK constraint validating JSONB shape inside Postgres.** Zod at the API boundary is the authority. Postgres CHECK on JSONB is fragile (re-runs on every UPDATE, has to be kept in sync with two other sources), and the parent plan already commits to Zod-as-contract.
- **RLS: athlete-self SELECT / UPDATE / INSERT, no DELETE policy.** Insert happens via app code after first sign-in (the `handle_new_auth_user` trigger does not auto-create profiles — first-time access to a profile-aware endpoint upserts the row). DELETE is reserved for the account-deletion cascade.
- **Realtime publication: excluded.** Profile changes are not eventful enough to push, and `manual_fields` contains age/weight. Add a comment in the migration noting the deliberate exclusion (matches the pattern in `0002_strava_infra.sql`).
- **`updated_at TIMESTAMPTZ`** + the existing `touch_updated_at` trigger. Same shape as `users` and `entitlements`.

## Open Questions

### Resolved During Planning

- *Should timezone go on `athlete_profiles`?* — No. Brainstorm R34 said `athlete_profiles`, implementation already shipped it on `public.users`, AGENTS.md is the source of truth. Do not duplicate.
- *Soft-delete?* — No. FK cascade is sufficient.
- *Combined JSONB or separate?* — Separate (see Key Technical Decisions).
- *Realtime?* — No.
- *Migration number?* — `0004`.
- *Coach RLS in this unit?* — No, deferred to parent plan Unit 8.

### Deferred to Implementation

- **Final JSONB shape for `baselines`.** Locked at the top level (`per_sport`, `dominant_sport`, `confidence`) but the exact inner structure per sport (which zones, which units for power vs pace vs HR) converges with the derivation function in product plan Unit 2.3. The Zod schema written in Unit B reserves the top-level shape with permissive inner fields (`z.object({...}).passthrough()` for the per-sport blob) and is tightened once derivation lands.
- **Final JSONB shape for `manual_fields`.** Same approach — fix the four documented top-level keys (`age`, `weight_kg`, `weekly_hours_avail`, `target_event`) and leave the `target_event` sub-shape loose until product plan Unit 2.3 settles event metadata.
- **Whether `manual_field_edited_at` is a flat `{field_name: timestamp}` map or a nested mirror of `manual_fields`.** Default to flat, top-level only, because nested target-event fields aren't independently edited in v1 (the athlete edits the whole event blob). Revisit if the UI grows per-sub-field editing.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Table sketch

```
athlete_profiles
  user_id UUID PK REFERENCES public.users(id) ON DELETE CASCADE
  baselines JSONB NOT NULL DEFAULT '{}'::jsonb
     -- { per_sport: { run|bike|swim|...: {...} }, dominant_sport, confidence: 'low'|'med'|'high' }
  weekly_volume_ewma JSONB NOT NULL DEFAULT '{}'::jsonb
     -- { run_min, bike_min, swim_min, total_min, half_life_days }
  manual_fields JSONB NOT NULL DEFAULT '{}'::jsonb
     -- { age, weight_kg, weekly_hours_avail, target_event: { type, date, distance_m, notes } }
  manual_field_edited_at JSONB NOT NULL DEFAULT '{}'::jsonb
     -- { age: '2026-05-12T...', weight_kg: '...', ... }  (flat map of top-level keys → ISO timestamp)
  derived_at TIMESTAMPTZ NULL
  derivation_version SMALLINT NOT NULL DEFAULT 1
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Read/write surfaces (informational, not implemented in this plan)

```mermaid
flowchart LR
  subgraph App
    A[Athlete profile UI] -->|UPDATE manual_fields + manual_field_edited_at| P[(athlete_profiles)]
    D[Derivation worker] -->|UPDATE baselines, weekly_volume_ewma, derived_at, derivation_version| P
  end
  CW[(completed_workouts)] -.->|insert triggers debounce| D
  R[Read paths: plan-gen, weekly-review, calendar] -->|SELECT| P
```

The derivation worker writes only to derivation-owned columns; the profile UI writes only to athlete-owned columns. The schema does not enforce this split (Postgres has no column-level GRANT distinction between these two app roles when both use the same JWT path); the test in Unit C and a code-review checklist enforce it instead.

## Implementation Units

- [ ] **Unit A: Migration `0004_athlete_profiles.sql`**

**Goal:** Create the `athlete_profiles` table with all columns, indexes, trigger, and athlete-self RLS policies.

**Requirements:** R4, R5, R6 (storage surface only).

**Dependencies:** Migration `0001_users_and_entitlements.sql` (depends on `public.users` and `public.touch_updated_at`). No dependency on `completed_workouts` — derivation wiring is out of scope.

**Files:**
- Create: `supabase/migrations/0004_athlete_profiles.sql`

**Approach:**
- `CREATE TABLE public.athlete_profiles` with the columns listed in High-Level Technical Design.
- Attach a `BEFORE UPDATE` trigger to call the existing `public.touch_updated_at()` function (matches the pattern in 0001).
- `ALTER TABLE public.athlete_profiles ENABLE ROW LEVEL SECURITY`.
- Three policies:
  - `athlete_profiles_self_select` — `FOR SELECT USING (auth.uid() = user_id)`.
  - `athlete_profiles_self_insert` — `FOR INSERT WITH CHECK (auth.uid() = user_id)`.
  - `athlete_profiles_self_update` — `FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)`.
- No DELETE policy (account-deletion cascade handles it via the FK).
- Comment at the top noting:
  - Coach-side RLS is added later in parent plan Unit 8 (consolidated coach RLS pass).
  - Deliberately excluded from `supabase_realtime` (mildly sensitive data + low change rate).
  - `athlete_profiles` is intentionally absent from any future `delete_user_cascade` body because FK cascade handles it; do NOT add it there.

**Patterns to follow:** [supabase/migrations/0001_users_and_entitlements.sql](../../supabase/migrations/0001_users_and_entitlements.sql) (RLS + trigger structure), [supabase/migrations/0002_strava_infra.sql](../../supabase/migrations/0002_strava_infra.sql) (1:1-with-users PK + realtime-exclusion comment).

**Test scenarios:** see Unit C — schema-level invariants are tested there once Unit 1 vitest infra exists. For this unit's standalone verification: applying the migration against a clean Postgres succeeds with no warnings, and `\d public.athlete_profiles` in `psql` shows the expected columns, indexes, trigger, and RLS-enabled flag.

**Verification:**
- `supabase db reset` (or equivalent CI step) applies the migration cleanly.
- `pg_dump --schema-only` of the resulting DB shows the table, the `touch_updated_at` trigger attached, and `rowsecurity = true` for `public.athlete_profiles`.

---

- [ ] **Unit B: Shared Zod / TS module `packages/shared/src/athlete-profile.ts`**

**Goal:** Hand-authored Zod schemas + inferred TS types for the table row and the two JSONB blobs, wired into the shared barrel.

**Requirements:** R4, R5 (typed contract for the manual-fields + edited-at surface so app code maintains them in lockstep).

**Dependencies:** Unit A's migration (so the contract has a real table behind it).

**Files:**
- Create: `packages/shared/src/athlete-profile.ts`
- Modify: `packages/shared/src/index.ts` (re-export `athlete-profile` symbols)

**Approach:**
- Export these schemas:
  - `BaselinesSchema` — top-level `per_sport`, `dominant_sport`, `confidence` with permissive inner shape (`z.record(z.unknown())` for per-sport content; tighten in product plan Unit 2.3 when derivation lands).
  - `WeeklyVolumeEwmaSchema` — `run_min`, `bike_min`, `swim_min`, `total_min`, `half_life_days` all optional numeric.
  - `ManualFieldsSchema` — `age` (int, optional), `weight_kg` (number, optional), `weekly_hours_avail` (number, optional), `target_event` (object: `type`, `date`, `distance_m`, `notes` — all optional, permissive inner shape).
  - `ManualFieldEditedAtSchema` — `z.record(z.string().datetime())` keyed on the top-level manual-field keys.
  - `AthleteProfileRowSchema` — full row shape (matches the table columns), composing the above.
  - Inferred TS types (`AthleteProfileRow`, `Baselines`, `ManualFields`, etc.) via `z.infer`.
- Each schema gets a one-line comment pointing to the originating requirement (R4 / R5) so future readers know why the shape exists.
- Update the barrel to `export * from "./athlete-profile";`.

**Patterns to follow:** None established yet (the barrel is empty). This unit sets the pattern that subsequent table-family modules (`users.ts`, `entitlement.ts`, etc., shipped under the Unit 1 backfill) will follow: one file per logical table, named exports for schema + inferred type, the row schema named `<EntityName>RowSchema`.

**Test scenarios:**
- *Happy path*: `AthleteProfileRowSchema.parse(...)` accepts a fully-populated row matching what migration 0004 would produce.
- *Happy path*: `ManualFieldsSchema.parse({})` accepts an empty manual fields blob (sparse-data athlete).
- *Edge case*: `ManualFieldEditedAtSchema.parse({ age: "2026-05-12T10:00:00Z" })` accepts a valid ISO timestamp; `parse({ age: "not a date" })` rejects.
- *Edge case*: `BaselinesSchema.parse({ confidence: "bogus" })` rejects (`confidence` is the only inner field locked to an enum in v1).

**Execution note:** Tests for this unit are pure schema-validation; they do not need a Postgres connection and can run under vitest as soon as it lands. They are designed alongside this unit but live in Unit C's file so the test file enumeration stays one-place.

**Verification:**
- `pnpm --filter @da2/shared typecheck` passes.
- `pnpm --filter @da2/web typecheck` still passes (shared barrel still re-exports cleanly).

---

- [ ] **Unit C: Test coverage `apps/web/src/db/__tests__/athlete-profile.test.ts`**

**Goal:** Cover the schema's invariants and the Zod contract with vitest, exercising RLS against a real Postgres.

**Requirements:** Verification surface for R4, R5; RLS posture for the new table.

**Dependencies:**
- Unit A and Unit B.
- **Parent plan Unit 1 vitest infrastructure** (`apps/web/src/db/__tests__/setup.ts`, vitest installed in `apps/web`, CI job that spins up Postgres and applies migrations). Today none of this exists. See Dependencies / Prerequisites below.

**Files:**
- Create: `apps/web/src/db/__tests__/athlete-profile.test.ts`

**Approach:**
- Two-actor pattern (already proposed in the parent plan): create two test users via the Supabase test helper, sign in as each, issue queries through the JWT-bound supabase-js client, and assert row visibility.
- Run each test inside a transaction that the harness rolls back at the end (per `docs/solutions/migration-conventions.md`).
- For pure Zod tests (the four test scenarios listed under Unit B above), no DB needed — they can live in the same file under their own `describe` block, or be split to `packages/shared/src/__tests__/athlete-profile.test.ts` if the implementer prefers co-location with the schema. Either is acceptable.

**Patterns to follow:** None yet — this is the first DB test file in the repo. The implementer should keep helpers minimal and let the parent plan Unit 1 backfill extract any reusable test fixture.

**Test scenarios:**
- *Happy path*: `INSERT INTO athlete_profiles (user_id, manual_fields) VALUES ($self, '{"age":34,"weight_kg":72}')` succeeds → `SELECT * FROM athlete_profiles` from the same JWT returns one row with the expected JSONB values intact.
- *Happy path*: Insert profile with `baselines = '{}'`, `derived_at = NULL` (sparse-data athlete from R5) — row inserts cleanly, `confidence` absence is allowed.
- *Edge case (R5 invariant)*: Two-step sequence — (1) athlete UPDATEs `manual_fields` and `manual_field_edited_at` for `age`, (2) derivation-style UPDATE writes new `baselines` + `derived_at` without referencing `manual_fields`. After step 2, the original `manual_fields.age` and `manual_field_edited_at.age` are byte-identical to step 1. (This proves the schema enables the invariant; the app-layer enforcement is a separate test in product plan Unit 2.3.)
- *Edge case*: Inserting two `athlete_profiles` rows for the same `user_id` raises a primary-key violation (the 1:1 invariant).
- *Edge case*: `updated_at` advances on UPDATE (proves the `touch_updated_at` trigger is wired).
- *Integration (RLS positive)*: Signed in as user A, `SELECT * FROM athlete_profiles` returns A's row.
- *Integration (RLS negative)*: Signed in as user A, `SELECT * FROM athlete_profiles WHERE user_id = $userB_id` returns zero rows. UPDATE / INSERT targeting user B's id is rejected by RLS.
- *Integration (cascade)*: Deleting user A from `public.users` (or `auth.users`) removes user A's `athlete_profiles` row via FK cascade. (Bonus check that the Unit 10 cascade-audit assumption holds.)
- *Zod (happy path)*: `AthleteProfileRowSchema.parse` round-trips a fully populated row.
- *Zod (edge)*: `ManualFieldEditedAtSchema` rejects a non-ISO timestamp; `BaselinesSchema` rejects `confidence: "bogus"`.

**Verification:**
- `pnpm --filter @da2/web test athlete-profile` (or the equivalent vitest invocation once the runner lands) runs ≥9 scenarios, all green.
- CI step that applies migrations + runs vitest reports the new file with full pass.

## System-Wide Impact

- **Interaction graph:** No code paths read `athlete_profiles` today. The first readers will be product plan Unit 2.3 (derivation) and Unit 3.x (plan generation). Adding the table is invisible until those wire up.
- **Error propagation:** Schema-constraint violations surface as supabase-js errors with Postgres error codes (`23505` for PK duplication, `42501` for RLS denial). Route handlers that eventually touch this table must translate them to user-facing errors at the API boundary (parent plan System-Wide Impact already covers this).
- **State lifecycle risks:** The "derivation never overwrites manual" invariant lives in app code, not SQL. If the derivation function (product plan Unit 2.3) is implemented carelessly, a bug there can blow away the athlete's edits. The Unit C edge-case test for this asserts the storage surface preserves bytes; the parent-plan Unit 2.3 will need its own app-layer test asserting the derivation function respects the contract.
- **API surface parity:** No API endpoints yet. When `/api/me/profile` lands (product plan Unit 2.3), it must validate both reads and writes against `AthleteProfileRowSchema` / `ManualFieldsSchema` from this unit.
- **Integration coverage:** RLS positive + negative tests (Unit C) are the safety net. The cascade test in Unit C also pre-validates one assumption that Unit 10 (account deletion) depends on — cheap insurance.
- **Unchanged invariants:** `public.users.timezone` remains the timezone source of truth — this unit does NOT add a duplicate column on `athlete_profiles`. `public.touch_updated_at()` is reused, not redefined. The existing migration ordering, RLS conventions, and realtime-opt-in posture are unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Test coverage cannot run until vitest infrastructure lands (parent plan Unit 1 backfill is owed). | Unit A + Unit B can ship as one PR with manual `psql`/`supabase db reset` verification noted in the PR body; Unit C lands in a follow-up PR once vitest is in place. Or bundle the minimum vitest setup into this PR if the implementer wants Unit C to land atomically — see Dependencies / Prerequisites for the explicit choice. |
| JSONB shape drift between Zod schemas (Unit B) and what derivation actually writes (product plan Unit 2.3). | Keep top-level keys locked here (`per_sport`, `dominant_sport`, `confidence`, etc.); leave inner sub-objects permissive until derivation lands; tighten Zod via review when Unit 2.3's PR ships. The eval harness in product plan Unit 3.1 validates downstream usage against `packages/shared` schemas. |
| Forgetting `athlete_profiles` is intentionally absent from `delete_user_cascade` (parent plan Unit 10) and "fixing" it later → double-delete or function complexity. | Migration comment in Unit A states the FK cascade is intentional; the Unit-10 CI audit (parent plan) needs to know to exclude tables with `ON DELETE CASCADE` from `users.id`. If that audit is rigid, relax the audit, not this design. |
| Account-deletion cascade test (Unit C integration scenario) inadvertently constrains FK behaviour in a way that breaks once `delete_user_cascade` exists. | Treat the cascade test as documentation of the current behaviour, not a forever-contract. When Unit 10 lands, update or move the assertion. |
| Coach RLS deferred to Unit 8 → if a coach-facing endpoint is built before Unit 8 ships, it silently sees no rows. | Document the deferral in the migration comment and in the parent plan checklist; coach-facing endpoints in the product plan are sequenced after Unit 8 anyway. |

## Dependencies / Prerequisites

- **Migrations 0001 + 0002 + 0003** — already shipped. No further DB prerequisites.
- **vitest in `apps/web`** — does not exist today. The implementer of this plan has two choices when picking up Unit C:
  1. **Defer Unit C to a follow-up PR** once parent plan Unit 1 backfill installs vitest + the test bootstrap. Unit A + Unit B ship first with manual verification.
  2. **Bundle a minimum vitest setup into this PR**: add `vitest` + `vitest-environment-node` (or similar) to `apps/web/devDependencies`, a `vitest.config.ts`, a `test` script, a basic `apps/web/src/db/__tests__/setup.ts` that opens a JWT-scoped supabase-js client against `supabase start`-managed Postgres, and a CI job. This is non-trivial — at least four additional files plus a CI change — and crosses the Unit 1 boundary. Pick this path only if you also want to discharge part of the Unit 1 backfill at the same time.
- **Today's date `2026-05-12`** — confirm migration timestamping conventions in `docs/solutions/migration-conventions.md` are still current before authoring the migration.

## Documentation / Operational Notes

- Update the parent plan ([docs/plans/2026-05-02-002-feat-database-schema-plan.md](2026-05-02-002-feat-database-schema-plan.md)) Unit 4 entry to:
  - Tick the checkbox once this lands.
  - Note the migration number is `0004_*` (parent plan currently says `0003_athlete_profiles.sql`).
  - Note that subsequent Unit-5+ migrations all shift +1 from the originally planned numbers.
- No new `docs/solutions/*.md` required unless an implementation surprise emerges (parent plan calls for `docs/solutions/strava-webhook-dedup.md` and `docs/solutions/rls-coach-athlete.md` later — those still belong to their own units).
- No README updates required — the README does not currently describe the schema table-by-table.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-02-database-schema-requirements.md](../brainstorms/2026-05-02-database-schema-requirements.md), R4–R6 and R34.
- **Parent plan:** [docs/plans/2026-05-02-002-feat-database-schema-plan.md](2026-05-02-002-feat-database-schema-plan.md), Unit 4.
- **Conventions:** [docs/solutions/migration-conventions.md](../solutions/migration-conventions.md), [AGENTS.md](../../AGENTS.md).
- **Prior migrations to mirror:** [supabase/migrations/0001_users_and_entitlements.sql](../../supabase/migrations/0001_users_and_entitlements.sql), [supabase/migrations/0002_strava_infra.sql](../../supabase/migrations/0002_strava_infra.sql), [supabase/migrations/0003_security_hardening.sql](../../supabase/migrations/0003_security_hardening.sql).
- No related PRs/issues yet — greenfield work.
