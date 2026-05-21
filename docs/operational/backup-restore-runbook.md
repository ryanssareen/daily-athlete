# Backup restore runbook

Guarded, manual restore procedure for Daily Athlete. **There is no in-place
"restore" button** — restore is destructive and blast-radius-heavy, so it is a
deliberate operator runbook. Which path applies depends on the Supabase tier.

> Keep the **Path B** steps in sync with the export format produced by
> `apps/web/src/admin/backup-export.ts` and validated by its export→restore
> round-trip test. If the artifact format changes, update this file in the same PR.

## Decide the path

- **Path A — Point-in-time recovery (PITR).** Only if the PITR add-on is enabled
  (see the admin Backups page → "Point-in-time recovery: On"). PITR restores the
  whole project **in place** to a chosen timestamp. Best for "undo the last N
  minutes/hours" incidents.
- **Path B — Logical restore from an on-demand export.** Always available. Use
  when PITR is off (e.g. Free tier), when restoring into a **fresh/scratch**
  project, or when you need a partial/inspectable restore. Uses the encrypted
  export artifacts this dashboard produces.

## Pre-restore checklist (both paths)

1. **Stop writes / put the app in maintenance** if the incident is ongoing, so a
   restore isn't immediately overwritten.
2. **Take a safety snapshot first.** Before Path A, trigger a fresh on-demand
   export (Backups → Run export) so you can roll *forward* again if the restore
   target is wrong. Before Path B into an existing DB, snapshot that DB too.
3. **Confirm the target.** Write down exactly which project/database you are
   restoring into. Restoring into prod by mistake is the main failure mode.
4. **Confirm scope + timestamp** (Path A) or **which export artifact** (Path B).
5. **Note the known loss:** `strava_tokens` is **excluded** from logical exports.
   After a Path B restore, athletes' Strava connections must be **re-linked**
   (the app surfaces a reconnect CTA); historical Strava activity already in
   `completed_workouts` / `strava_raw_payloads` is preserved.

## Path A — PITR (add-on enabled)

1. Supabase Dashboard → Database → Backups → **Point in Time**, or the
   Management API `POST /v1/projects/{ref}/database/backups/restore-pitr`.
2. Choose the recovery timestamp (within the retention window shown on the admin
   Backups page).
3. Confirm. The project restores **in place**; expect downtime during the
   operation.
4. Run the post-restore verification below.

## Path B — Logical restore from an export

1. **Download** the chosen export from the admin Backups page → Download. The
   download streams the **decrypted, gzipped NDJSON** (`backup-<id>.ndjson.gz`);
   no separate decryption step is needed.
2. `gunzip backup-<id>.ndjson.gz` → `backup-<id>.ndjson`. Each line is
   `{"t":"<table>","r":{<row>}}`.
3. Restore **parents before children** (the export is a best-effort multi-read,
   not a single snapshot, so honour FK order and skip/repoint any orphaned
   child rows):
   1. `users`
   2. `entitlements`, `athlete_profiles`, `coach_athlete_links`
   3. `plans`
   4. `planned_workouts`
   5. `completed_workouts`
   6. `workout_matches`
   7. `strava_raw_payloads`
4. Load each table's rows (e.g. a small script that groups lines by `t` and
   `INSERT … ON CONFLICT DO NOTHING` via a **session-mode (5432) or direct**
   connection — never the transaction pooler on 6543).
5. Do **not** restore `strava_tokens` (absent by design) — see the known-loss
   note above.

## Post-restore verification

- Row counts per table match the export's recorded `table_counts` (admin
  Backups page / `admin_backups.table_counts`), allowing for any intentionally
  skipped orphans.
- A sample user can sign in; their dashboard, calendar, and recent activities
  render.
- Re-link one Strava account end-to-end to confirm the reconnect path.
- Trigger a fresh export and confirm it succeeds against the restored DB.

## After restore

- Re-enable writes / exit maintenance.
- Record the incident: what was restored, the timestamp/artifact used, and any
  rows intentionally dropped.
