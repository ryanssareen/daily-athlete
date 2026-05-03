-- Security hardening:
--   1. Propagate auth.users email updates into public.users (was INSERT-only).
--   2. Add `key_version` to strava_tokens so the encryption key can be rotated
--      without orphaning existing rows.
--
-- The application stops using pgp_sym_encrypt entirely starting in this version;
-- access_token_enc / refresh_token_enc are now produced by Python's
-- cryptography library (Fernet) so the symmetric key never traverses SQL or
-- the Postgres logs. Existing rows in dev/test get re-encrypted on next use;
-- prod has no rows yet.

-- 1. Email + soft-delete propagation from auth.users → public.users.

CREATE OR REPLACE FUNCTION public.handle_auth_user_email_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.users
       SET email = NEW.email
     WHERE id = NEW.id
       AND email IS DISTINCT FROM NEW.email;
    RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.handle_auth_user_email_update();

-- 2. key_version on strava_tokens.

ALTER TABLE public.strava_tokens
    ADD COLUMN key_version SMALLINT NOT NULL DEFAULT 1;

-- 3. The supabase_realtime publication exclusions for sensitive tables are
--    documented in the migrations that create them; no publication change here.
