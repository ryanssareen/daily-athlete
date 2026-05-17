-- Replace handle_new_auth_user so the trigger respects an
-- `intended_role` field on auth.users.raw_user_meta_data when the row is
-- inserted. This lets the email/password coach sign-up create a public.users
-- row with role_flags = ['coach'] in a single atomic step, instead of the
-- old behaviour where every signup landed with the default ['athlete'] role
-- and then needed an out-of-band promotion.
--
-- Why this matters: the (athlete)/layout.tsx gate redirects any user whose
-- role_flags include 'athlete' but who has no athlete_profiles.onboarded_at
-- stamp into /athlete/onboarding. Coaches do not need that flow, so without
-- this trigger fix a brand-new coach signup gets pushed through athlete
-- onboarding before they ever see /roster.
--
-- Security posture:
-- - `raw_user_meta_data` is client-supplied (the `data` field on
--   supabase.auth.signUp). A malicious user CAN pass `intended_role: 'coach'`
--   from any sign-up surface and self-grant the coach role. This is
--   acceptable in v1 because the coach role only unlocks coach-side
--   surfaces, and coach-side reads of athlete data still require a
--   `coach_athlete_links` row (per migration 0010 RLS). Self-granted
--   coaches see an empty roster.
-- - The closed CHECK constraint on role_flags (migration 0001) ensures
--   we never store an unrecognised role even if the metadata is junk.
-- - Google OAuth coach sign-up does NOT populate `intended_role` (Google's
--   profile data overwrites raw_user_meta_data), so a complementary
--   cookie-based path in /auth/callback handles that case.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    intended_role TEXT := NULLIF(NEW.raw_user_meta_data ->> 'intended_role', '');
    initial_roles TEXT[];
BEGIN
    initial_roles := CASE
        WHEN intended_role = 'coach' THEN ARRAY['coach']::TEXT[]
        ELSE ARRAY['athlete']::TEXT[]
    END;

    INSERT INTO public.users (id, email, role_flags)
    VALUES (NEW.id, NEW.email, initial_roles)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END $$;
