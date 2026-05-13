-- Auto-stamp `athlete_profiles.manual_field_edited_at` whenever
-- `manual_fields` changes. Moves the R5 lockstep invariant from "app
-- discipline" into the database. See:
--   docs/plans/2026-05-12-002-feat-schema-foundation-backfill-plan.md (Unit 3)
--   docs/brainstorms/2026-05-02-database-schema-requirements.md (R5)
--
-- Behaviour:
-- - On INSERT: every top-level key of manual_fields gets a fresh stamp.
-- - On UPDATE where manual_fields is unchanged (`IS NOT DISTINCT FROM`):
--   the trigger is a no-op. Derivation-only writes (baselines, derived_at,
--   weekly_volume_ewma) do not touch manual_field_edited_at.
-- - On UPDATE where manual_fields differs:
--     - keys whose value differs (added or changed) get fresh stamps;
--     - keys removed from manual_fields are also stripped from
--       manual_field_edited_at;
--     - keys whose value is unchanged retain their existing stamp.
-- - The trigger is AUTHORITATIVE: callers should NOT write
--   manual_field_edited_at directly. Any value they pass is overwritten
--   by the trigger.
--
-- Timestamp source: `now()` (transaction start). Two updates in the same
-- transaction therefore share a timestamp -- a feature, not a bug, for
-- audit purposes.
--
-- target_event is treated as a single top-level key. Inner sub-shape
-- changes are detected as a change to the target_event blob as a whole.

CREATE OR REPLACE FUNCTION public.athlete_profiles_stamp_manual_edits()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    k TEXT;
    -- Coalesce defensively: the column is NOT NULL DEFAULT '{}', but the
    -- BEFORE trigger fires before the NOT NULL constraint, so a caller
    -- could pass an explicit NULL.
    edited_at JSONB := COALESCE(NEW.manual_field_edited_at, '{}'::jsonb);
    new_fields JSONB := COALESCE(NEW.manual_fields, '{}'::jsonb);
BEGIN
    IF (TG_OP = 'INSERT') THEN
        FOR k IN SELECT jsonb_object_keys(new_fields) LOOP
            edited_at := edited_at || jsonb_build_object(k, now());
        END LOOP;
        NEW.manual_field_edited_at := edited_at;
        RETURN NEW;
    END IF;

    -- UPDATE path.
    -- IS NOT DISTINCT FROM: equal (treating NULLs as equal). If the blob
    -- is byte-identical between OLD and NEW, leave edited_at untouched.
    IF new_fields IS NOT DISTINCT FROM COALESCE(OLD.manual_fields, '{}'::jsonb) THEN
        -- Manual fields unchanged -- pass NEW through with whatever
        -- value the caller passed for edited_at (might be the old value
        -- from a SELECT-then-UPDATE; we don't second-guess).
        RETURN NEW;
    END IF;

    -- Manual fields changed: re-stamp added/changed keys, drop removed keys.
    -- Start from the OLD edited_at -- callers should never write this
    -- column directly, but if they did, we don't honour their value when
    -- manual_fields is also changing.
    edited_at := COALESCE(OLD.manual_field_edited_at, '{}'::jsonb);

    -- Added or changed: keys present in NEW whose value differs from OLD's
    -- value at that key (including OLD not having the key at all).
    FOR k IN SELECT jsonb_object_keys(new_fields) LOOP
        IF new_fields -> k IS DISTINCT FROM (OLD.manual_fields -> k) THEN
            edited_at := edited_at || jsonb_build_object(k, now());
        END IF;
    END LOOP;

    -- Removed: keys present in OLD but not in NEW.
    FOR k IN SELECT jsonb_object_keys(COALESCE(OLD.manual_fields, '{}'::jsonb)) LOOP
        IF NOT (new_fields ? k) THEN
            edited_at := edited_at - k;
        END IF;
    END LOOP;

    NEW.manual_field_edited_at := edited_at;
    RETURN NEW;
END $$;

CREATE TRIGGER athlete_profiles_stamp_manual_edits_trigger
    BEFORE INSERT OR UPDATE ON public.athlete_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.athlete_profiles_stamp_manual_edits();
