-- Athlete profile (1:1 with public.users): derived baselines and manual fields
-- with per-field manual-edit timestamps so derivation never overwrites athlete
-- input. See docs/plans/2026-05-12-001-feat-athlete-profile-schema-plan.md.
--
-- Scope notes:
-- - Coach-side RLS is deferred to schema plan Unit 8 (consolidated coach RLS
--   pass). Only athlete-self policies live here.
-- - DO NOT ADD `athlete_profiles` TO supabase_realtime publication: profile
--   rows change rarely and `manual_fields` contains mildly sensitive data
--   (age, weight). Realtime is opt-in per-table; this exclusion is
--   deliberate. A CI guard asserting publication membership against a repo
--   allow-list is tracked in the Unit 4 follow-up issue.
-- - DO NOT add `athlete_profiles` to the future `delete_user_cascade`
--   function (schema plan Unit 10): the FK ON DELETE CASCADE on `user_id`
--   handles teardown when the parent `public.users` row goes away (which
--   itself cascades from `auth.users`). The integration test in the
--   deferred Unit C will pin this contract before Unit 10 ships.
-- - `manual_fields` <-> `manual_field_edited_at` are intended to be written
--   in lockstep at the app layer (per R5). The schema does not enforce
--   this in 0004; the choice between status-quo discipline, an
--   auto-stamping trigger, and a key-set CHECK is tracked in the Unit 4
--   follow-up issue and must land before product plan Unit 2.3 starts.
-- - Timezone lives on `public.users.timezone`, NOT here, per AGENTS.md.
--   Do not add a timezone column to this table.

CREATE TABLE public.athlete_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    -- Per R4: derived baselines. Inner per-sport shape stays loose in v1
    -- (tightened in product plan Unit 2.3 when the derivation worker lands).
    baselines JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Per R4: per-athlete weekly-volume EWMA. `total_min` (when present)
    -- is a derived sum of the per-sport rolls, maintained by derivation.
    weekly_volume_ewma JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Per R4 + R5: athlete-owned input (age, weight_kg, weekly_hours_avail,
    -- target_event). Persisted across recomputes; derivation MUST NOT write
    -- to this column.
    manual_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Per R5: parallel timestamp map keyed by top-level keys of
    -- `manual_fields`. Values are ISO-8601 UTC timestamps. Written in
    -- lockstep with `manual_fields` by the app layer.
    manual_field_edited_at JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Per R6: last successful derivation pass. NULL on initial insert
    -- (athlete signed up, no completed workouts yet -- sparse-data case
    -- from R5). The derivation worker's debounce key is
    -- (user_id, latest_completed_at).
    derived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reuse the helper defined in 0001_users_and_entitlements.sql.
CREATE TRIGGER athlete_profiles_touch_updated_at
    BEFORE UPDATE ON public.athlete_profiles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.athlete_profiles ENABLE ROW LEVEL SECURITY;

-- Athlete-self only. Coach-side SELECT policy lands in schema plan Unit 8.
CREATE POLICY athlete_profiles_self_select ON public.athlete_profiles
    FOR SELECT USING (auth.uid() = user_id);

-- App-layer first-touch endpoints MUST use
-- `INSERT ... ON CONFLICT (user_id) DO NOTHING` to be safe under concurrent
-- requests from the same athlete (mobile + web open simultaneously).
CREATE POLICY athlete_profiles_self_insert ON public.athlete_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY athlete_profiles_self_update ON public.athlete_profiles
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No DELETE policy: row deletion happens via FK cascade from public.users.
-- See the "Scope notes" comment at the top for why this is intentional.
