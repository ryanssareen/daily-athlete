-- Backfill: move date-only manual workouts off UTC midnight to local noon.
--
-- Until 2026-10-12 both web manual-log forms sent a picked day as
-- `${date}T00:00:00+00:00` (see
-- docs/solutions/date-only-input-stored-as-utc-midnight.md). Dates render in
-- the athlete's timezone, so those rows show a fabricated time east of UTC
-- (5:30 AM in IST) and the PREVIOUS day west of UTC. New entries use local
-- noon for past days (apps/web/src/lib/format.ts manualStartedAt); this moves
-- the legacy rows onto the same convention.
--
-- Which rows: source = 'manual' AND started_at is exactly 00:00:00 UTC. The
-- UTC date of that value IS the day the athlete picked. Mobile manual entries
-- carry a real time (now, or the picker's local midnight converted to UTC),
-- which equals 00:00:00 UTC only for an athlete whose zone is UTC -- and for
-- them the rewrite is 12:00 UTC on the same day, so the day is unchanged.
-- MCP/API callers that sent a bare date as T00:00:00Z are the same bug and
-- are moved the same way.
--
-- New value: 12:00 on that date in the owner's users.timezone, clamped to no
-- later than the athlete-local day the row was created. The quick-log dialog
-- defaulted its date to the UTC day, so an athlete west of UTC logging in the
-- evening stored TOMORROW's date; it happened to render on the right local
-- day, and without the clamp this would push it a day forward. A completed
-- workout is never logged ahead of time, so the clamp only touches those
-- rows. Cached workout reports and period reviews whose inputs include a
-- moved row read as stale afterwards (their input fingerprint changes).
--
-- An invalid zone (users.timezone is athlete-supplied text) falls back to UTC
-- rather than failing the whole migration, matching the app's read-side
-- fallback.
--
-- Soft-deleted and superseded rows are included: they are the same data and
-- may be restored or inspected later. No trigger fires on started_at (the only
-- completed_workouts trigger is on deleted_at, migration 0028), and existing
-- workout_matches are left as they are.
--
-- Reversal is not derivable from the result: clamped rows changed date, and
-- web entries made after the fix also sit at local noon. Snapshot
-- (id, started_at) of the selected rows before applying if a rollback must be
-- possible.

UPDATE public.completed_workouts AS cw
SET started_at =
    ((LEAST(
        (cw.started_at AT TIME ZONE 'UTC')::date,
        (cw.created_at AT TIME ZONE z.zone)::date
     ) + TIME '12:00') AT TIME ZONE z.zone)
FROM (
    SELECT
        u.id,
        CASE
            WHEN EXISTS (SELECT 1 FROM pg_timezone_names t WHERE t.name = u.timezone)
                THEN u.timezone
            ELSE 'UTC'
        END AS zone
    FROM public.users AS u
) AS z
WHERE cw.athlete_id = z.id
  AND cw.source = 'manual'
  AND (cw.started_at AT TIME ZONE 'UTC')::time = TIME '00:00:00';
