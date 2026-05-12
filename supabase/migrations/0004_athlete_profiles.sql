-- Per-athlete derived baselines + manual fields with per-field edit timestamps.
--
-- Implements R4 (one profile per athlete), R5 (manual fields persist across
-- recomputes; per-field timestamps drive merge logic), R6 (recompute is
-- idempotent — the schema only stores `derived_at` so the job can dedup).
--
-- The "derivation never overwrites manual edits" invariant is enforced in
-- application code (compare manual_field_edited_at[field] to derived_at).
-- This migration only ensures the timestamp surface exists.
--
-- DO NOT ADD `athlete_profiles` TO supabase_realtime publication: profile is
-- not a per-second-broadcast surface; reads are on-demand. Manual fields also
-- include weight, which we keep off the realtime stream by default.

CREATE TABLE public.athlete_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    baselines JSONB NOT NULL DEFAULT '{}'::jsonb,
    manual_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    manual_field_edited_at JSONB NOT NULL DEFAULT '{}'::jsonb,
    weekly_volume_ewma JSONB NOT NULL DEFAULT '{}'::jsonb,
    derived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT athlete_profiles_baselines_is_object
        CHECK (jsonb_typeof(baselines) = 'object'),
    CONSTRAINT athlete_profiles_manual_fields_is_object
        CHECK (jsonb_typeof(manual_fields) = 'object'),
    CONSTRAINT athlete_profiles_manual_field_edited_at_is_object
        CHECK (jsonb_typeof(manual_field_edited_at) = 'object'),
    CONSTRAINT athlete_profiles_weekly_volume_ewma_is_object
        CHECK (jsonb_typeof(weekly_volume_ewma) = 'object')
);

CREATE TRIGGER athlete_profiles_touch_updated_at
    BEFORE UPDATE ON public.athlete_profiles
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.athlete_profiles ENABLE ROW LEVEL SECURITY;

-- Athlete owns their own profile. Coach-side read access is layered on in
-- Unit 8 (coach_athlete_links + active-link RLS); intentionally absent here.
CREATE POLICY athlete_profiles_self_select ON public.athlete_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY athlete_profiles_self_insert ON public.athlete_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY athlete_profiles_self_update ON public.athlete_profiles
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- No DELETE policy: profile lifecycle is tied to the user row via FK cascade.
