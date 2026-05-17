# Deployment Checklist: Migration 0010 (coach_athlete_links + role_flags security fix)

**PR:** #73 — feat(flutter): Flutter mobile app + coach/activity API routes  
**Migration:** `supabase/migrations/0010_coach_athlete_links.sql`  
**Risk Level:** HIGH — involves RLS policy drop/recreate on `users` table, new partial unique index, and new FK relationships  
**Estimated Deploy Time:** < 2 minutes  

---

## 1. PRE-DEPLOY CHECKS (BLOCKING)

Run these read-only queries **before** beginning the migration. Save the output for post-deploy comparison.

### 1.1 Verify current users table state and users_self_update policy

```sql
-- Check that users_self_update policy exists and has the expected structure
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'users' AND policyname = 'users_self_update';
```

**Expected:** One row with:
- `qual`: `(auth.uid() = id)`
- `with_check`: `(auth.uid() = id)` (current; will change after migration)

**Action if different:** STOP — investigate policy state before proceeding.

### 1.2 Count users by role_flags

```sql
SELECT role_flags, COUNT(*) as count
FROM public.users
WHERE deleted_at IS NULL
GROUP BY role_flags
ORDER BY count DESC;
```

**Expected:** Approximately:
- `['athlete']`: majority of users
- `['coach']`: smaller subset (if any)
- `['athlete', 'coach']`: edge case only

**Save these values.** Post-deploy, verify counts are unchanged.

### 1.3 Verify no existing coach_athlete_links table

```sql
SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'coach_athlete_links'
) as table_exists;
```

**Expected:** `false`

**Action if `true`:** STOP — table already exists. Investigate before deploying a migration that creates it.

### 1.4 Verify FK constraints on users table

```sql
SELECT constraint_name, table_name, column_name
FROM information_schema.key_column_usage
WHERE table_schema = 'public' AND table_name = 'users';
```

**Expected:** `id` is the PK with FK to `auth.users(id)`. No other unexpected constraints.

### 1.5 Test RLS policies on existing tables

```sql
-- Verify existing RLS-gated tables are active
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
HAVING COUNT(*) > 0
ORDER BY tablename;
```

**Expected:** Tables with RLS enabled:
- `users` (3 policies: users_self_select, users_self_update, [entitlements_self_select, entitlements_*])
- `athlete_profiles` (at least 1 policy)
- `plans` (at least 1 policy)
- `planned_workouts` (at least 1 policy)
- `completed_workouts` (at least 1 policy)
- `strava_tokens` (at least 1 policy)

**Action if any table missing:** Investigate and fix before deploying this migration.

### 1.6 Validate CHECK constraints on status columns

```sql
-- Verify that other tables use the same CHECK constraint pattern
SELECT constraint_name, table_name, constraint_definition
FROM information_schema.check_constraints
WHERE constraint_schema = 'public'
AND constraint_definition LIKE '%IN%'
ORDER BY table_name;
```

**Expected:** Existing tables with `status IN (...)` constraints use the correct syntax. If migration 0010 uses a different pattern, it could indicate a schema drift.

---

## 2. MIGRATION DEPLOYMENT STEPS

**Lock estimate:** < 1 min (only drops and recreates one policy on `users`)

### 2.1 Deploy the migration

```bash
# In the monorepo root
supabase migration up

# OR if running locally
supabase db reset  # For dev/test only; NEVER on production
```

**Expected output:**
- `0010_coach_athlete_links.sql` applies without error
- No warnings from `supabase db lint`

**Estimated duration:** < 10 seconds

### 2.2 Verify migration completed without errors

After migration completes, immediately run:

```sql
-- Check that coach_athlete_links table exists
SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'coach_athlete_links'
) as table_exists;
```

**Expected:** `true`

**Action if `false`:** Rollback immediately (see Section 5).

---

## 3. POST-DEPLOY VERIFICATION (WITHIN 5 MINUTES)

Run these queries in order to verify the migration succeeded and data integrity is preserved.

### 3.1 Verify coach_athlete_links table structure

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'coach_athlete_links'
ORDER BY ordinal_position;
```

**Expected 7 columns:**
- `id UUID NOT NULL` (PK)
- `coach_user_id UUID NOT NULL` (FK → users)
- `athlete_user_id UUID NOT NULL` (FK → users)
- `status TEXT NOT NULL` (DEFAULT 'active')
- `invited_at TIMESTAMPTZ NOT NULL` (DEFAULT now())
- `accepted_at TIMESTAMPTZ` (nullable)
- `deleted_at TIMESTAMPTZ` (nullable)

**Action if any column missing or wrong type:** Rollback immediately.

### 3.2 Verify partial unique index on coach_athlete_links

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'coach_athlete_links'
AND indexname = 'coach_athlete_links_one_active_coach_per_athlete';
```

**Expected:** Index definition contains:
```
WHERE status = 'active' AND deleted_at IS NULL
```

**Why this matters:** This index is the load-bearing safety mechanism preventing two active coaches per athlete.

**Action if index missing or malformed:** Rollback immediately.

### 3.3 Verify covering indexes for coach_athlete_links

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'coach_athlete_links'
ORDER BY indexname;
```

**Expected 3 indexes:**
1. `coach_athlete_links_one_active_coach_per_athlete` (partial unique)
2. `coach_athlete_links_coach_lookup` (composite: `(coach_user_id, athlete_user_id)`, partial)
3. `coach_athlete_links_athlete_lookup` (composite: `athlete_user_id`, partial)

### 3.4 Verify RLS is enabled on coach_athlete_links

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'coach_athlete_links';
```

**Expected:** `rowsecurity = true`

**Action if `false`:** Rollback immediately.

### 3.5 Verify new RLS policies on coach_athlete_links

```sql
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'coach_athlete_links'
ORDER BY policyname;
```

**Expected 5 policies:**
1. `coach_athlete_links_athlete_select` (SELECT, USING on athlete_user_id)
2. `coach_athlete_links_coach_insert` (INSERT, WITH CHECK on coach_user_id)
3. `coach_athlete_links_coach_select` (SELECT, USING on coach_user_id)
4. `coach_athlete_links_update` (UPDATE, USING + WITH CHECK on both sides)

**Action if any policy missing:** Rollback immediately.

### 3.6 Verify role_flags security fix on users table

```sql
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'users' AND policyname = 'users_self_update';
```

**Expected:** Single row with:
- `qual`: `(auth.uid() = id)`
- `with_check`: **MUST contain** `role_flags = (SELECT role_flags FROM public.users WHERE id = auth.uid())`

**Why this matters:** This WITH CHECK prevents self-promotion to 'coach' via `update({ role_flags: ['coach'] })`.

**Action if WITH CHECK missing or incorrect:** Rollback immediately.

### 3.7 Verify delete_user_cascade function exists

```sql
SELECT pg_get_functiondef('public.delete_user_cascade(UUID)'::regprocedure);
```

**Expected:** Function body contains:
- `UPDATE public.coach_athlete_links SET deleted_at = now(), status = 'archived' WHERE coach_user_id = user_id AND deleted_at IS NULL;`
- Same UPDATE for `athlete_user_id` side

**Why this matters:** This function is the single source of truth for account deletion. Every new table must update it.

### 3.8 Verify users table row count unchanged

```sql
SELECT COUNT(*) as total_users FROM public.users;
SELECT COUNT(*) as active_users FROM public.users WHERE deleted_at IS NULL;
```

**Compare with pre-deploy values from 1.2.** Both should be identical.

**Action if counts changed:** Investigate immediately. If migration inserted test rows, rollback.

### 3.9 Verify users_self_update policy is still callable

This requires a connected authenticated client. If you have Supabase local dev running:

```sql
-- In Supabase local dev, sign in as a test user, then run:
UPDATE public.users
SET display_name = 'Test Update'
WHERE id = auth.uid();
```

**Expected:** UPDATE succeeds (no permission error).

**Then try to update role_flags:**

```sql
UPDATE public.users
SET role_flags = ARRAY['coach']::TEXT[]
WHERE id = auth.uid();
```

**Expected:** UPDATE fails with error like:
```
ERROR 42501 (insufficient privilege)
```

**Why this matters:** Confirms the WITH CHECK is blocking role_flags changes.

### 3.10 Verify no orphaned FKs

```sql
-- Check for any coach_athlete_links rows with missing user references
SELECT cal.id
FROM public.coach_athlete_links cal
LEFT JOIN public.users coach ON coach.id = cal.coach_user_id
LEFT JOIN public.users athlete ON athlete.id = cal.athlete_user_id
WHERE coach.id IS NULL OR athlete.id IS NULL;
```

**Expected:** 0 rows (empty result)

**Action if any rows:** Investigate FK violation — should not happen on a clean migration.

### 3.11 Verify coach SELECT policies on other tables

```sql
SELECT policyname, tablename, qual
FROM pg_policies
WHERE policyname LIKE '%coach_select'
ORDER BY tablename;
```

**Expected policies added:**
1. `plans_coach_select` on `plans` table
2. `planned_workouts_coach_select` on `planned_workouts` table
3. `completed_workouts_coach_select` on `completed_workouts` table
4. `workout_matches_coach_select` on `workout_matches` table

**All should use EXISTS subquery pattern:**
```sql
EXISTS (
    SELECT 1 FROM public.coach_athlete_links cal
    WHERE cal.coach_user_id = auth.uid()
      AND cal.athlete_user_id = <table>.athlete_id
      AND cal.status = 'active'
      AND cal.deleted_at IS NULL
)
```

**Action if any policy missing:** Rollback immediately.

### 3.12 Verify existing athlete-self policies are unchanged

```sql
-- These should NOT have changed
SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'plans' AND policyname = 'plans_self_select'
UNION ALL
SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'planned_workouts' AND policyname = 'planned_workouts_self_select'
UNION ALL
SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'completed_workouts' AND policyname = 'completed_workouts_self_select';
```

**Expected:** Existing policies still present and unchanged.

**Why this matters:** Coach policies are additive; athlete policies must not be modified.

---

## 4. ROLLBACK PROCEDURE

**Trigger rollback immediately if any of the following occur:**

- coach_athlete_links table does not exist post-deploy (3.1)
- Partial unique index is missing or malformed (3.2)
- RLS is not enabled (3.4)
- Any RLS policy is missing (3.5, 3.11, 3.12)
- users_self_update WITH CHECK is incorrect (3.6)
- delete_user_cascade function is missing or broken (3.7)
- User count changed unexpectedly (3.8)
- Orphaned FKs detected (3.10)
- Authenticated user cannot update display_name (3.9 first test fails)

### 4.1 Rollback migration

```bash
# In the monorepo root
supabase migration down

# For local testing
supabase db reset
```

**Expected:** Migration 0010 is removed and all tables/policies revert to pre-migration state.

### 4.2 Verify rollback completed

```sql
-- Verify coach_athlete_links is gone
SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'coach_athlete_links'
) as table_exists;
```

**Expected:** `false`

```sql
-- Verify users_self_update policy is restored to original WITH CHECK
SELECT with_check
FROM pg_policies
WHERE tablename = 'users' AND policyname = 'users_self_update';
```

**Expected:** `(auth.uid() = id)` (original form, without role_flags check)

### 4.3 Verify users table is unchanged

```sql
SELECT COUNT(*) FROM public.users;
SELECT COUNT(*) FROM public.users WHERE deleted_at IS NULL;
```

**Expected:** Counts match pre-deploy baseline (same as pre-rollback).

### 4.4 Re-run pre-deploy checks

Run all queries from Section 1 again to confirm the database is back to the exact pre-migration state.

---

## 5. POST-DEPLOY MONITORING (FIRST 24 HOURS)

### 5.1 Real-time alert conditions

| Signal | Condition | Action |
|--------|-----------|--------|
| RLS permission errors | Any 42501 error in app logs | Check users_self_update WITH CHECK logic; may be too strict |
| FK violations | Error inserting to coach_athlete_links | Verify both user_ids exist in public.users |
| Unique constraint violation | 23505 error on coach_athlete_links insert | Confirms partial index is working; verify transaction wraps old-coach-archive + new-coach-insert |
| Policy lookup failures | Queries to coach data tables return no rows for coaches | Verify coach_athlete_links rows exist and status='active' + deleted_at IS NULL |
| Realtime lag | coach_athlete_links changes take >5s to propagate | Expected — not on realtime allowlist; poll instead |

### 5.2 Console spot-check (run 1 hour after deploy)

```ruby
# In Rails console or similar authenticated context
# Verify a coach user can see their linked athletes

user = User.find(coach_id)  # A user with 'coach' in role_flags
linked = supabase.from('coach_athlete_links')
  .select('*')
  .eq('coach_user_id', user.id)
  .eq('status', 'active')
  .is_('deleted_at', null)
  .execute()

puts "Coach #{user.id} has #{linked.data.length} linked athletes"
# Expected: > 0 if coach has assigned athletes, 0 if no links yet

# Verify an athlete can see their coach
athlete_id = linked.data[0][:athlete_user_id] rescue nil
if athlete_id
  athlete_coach = supabase.from('coach_athlete_links')
    .select('*')
    .eq('athlete_user_id', athlete_id)
    .eq('status', 'active')
    .is_('deleted_at', null)
    .execute()
  
  puts "Athlete #{athlete_id} has coach: #{athlete_coach.data[0][:coach_user_id]}"
  # Expected: one row with matching coach_user_id
end
```

### 5.3 Dashboard monitoring

Check the following in Supabase dashboard:

1. **Database > Indexes**: Confirm all 3 indexes on coach_athlete_links exist and are not bloated
2. **Database > Query Performance**: No unexpected slow queries on coach_athlete_links
3. **Auth > Users**: User signup/signin unaffected; new users still have `role_flags = ['athlete']`
4. **Database > Policies**: Verify all 5 coach_athlete_links policies are active and 4 coach SELECT policies on other tables are present

### 5.4 Application-level checks (per product team)

- [ ] Flutter coach app can query coach_athlete_links and see roster (or empty state if no links)
- [ ] Flutter athlete app can query coach_athlete_links and see their coach (or empty state)
- [ ] Next.js API routes that check coach identity still work (if any are live)
- [ ] User settings pages (if they exist) allow updating display_name, timezone, etc. but not role_flags
- [ ] No user reports of "permission denied" or "coach data disappeared"

### 5.5 Metrics to track

- [ ] coach_athlete_links row count (should be 0 until coach features go live)
- [ ] Error rate on queries to plans/planned_workouts/completed_workouts (should be unchanged; coach policies are additive)
- [ ] Latency on coach data queries (should be < 50ms for coach_athlete_links lookups due to covering indexes)
- [ ] FK constraint violations on coach_athlete_links inserts (should be 0)
- [ ] Soft-delete `deleted_at` is NULL checks (should pass; no orphaned rows)

### 5.6 Close-out checklist (24 hours after deploy)

- [ ] No alert fires related to migration 0010
- [ ] All console spot-checks pass
- [ ] Dashboard metrics are nominal
- [ ] Product team confirms no user-facing issues
- [ ] Create a post-deploy runbook entry documenting coach_athlete_links schema
- [ ] Archive this checklist in a deploy log for future reference

---

## 6. ROLLBACK SAFETY NOTES

**Can we roll back?**
- **Yes.** Migration 0010 only adds new tables and policies; no existing data is modified or deleted.
- No data was backfilled into coach_athlete_links (it starts empty).
- The users_self_update policy change is additive (tighter WITH CHECK only); rolling back restores the original behavior.
- **Time to rollback:** < 1 minute (drop table, recreate original policy).

**Data preserved if rollback occurs:**
- All existing users, athletes, plans, workouts, etc. remain untouched.
- If any coach_athlete_links rows were inserted before rollback, they will be hard-deleted when the table is dropped. This is acceptable only if rollback happens within hours of deploy, before any real links are established.

**Post-rollback plan:**
1. Investigate root cause of the failure (see Section 4.1–4.3).
2. Fix the issue in a new migration (e.g., 0011_fix_coach_athlete_links.sql) rather than re-deploying 0010.
3. Reapply the fixed migration.

---

## 7. DEPENDENCY CHECKLIST

Before deploying this migration, confirm:

- [ ] PR #73 is approved and ready to merge
- [ ] No other PRs are being deployed simultaneously (to avoid migration order conflicts)
- [ ] Supabase project is healthy (no ongoing maintenance or alerts)
- [ ] Database backups are recent and restorable
- [ ] Staging environment has been tested with this migration
- [ ] All related API routes (coach roster, athlete coach lookup) are ready but feature-flagged off (no public exposure until Flutter app ships)
- [ ] `delete_user_cascade` function is tested and ready for future table additions
- [ ] Product team is aware of the migration and has no conflicting data operations scheduled

---

## 8. KEY RISK FACTORS & MITIGATIONS

| Risk | Why It Matters | Mitigation |
|------|---|---|
| DROP + recreate `users_self_update` policy is a breaking change | If web app relies on self-updating `role_flags`, it will break | Code review confirms no client-side role_flags updates in web app |
| Partial unique index race condition | Two concurrent coach assignments to same athlete can both pass if not in transaction | API routes must wrap archive + insert in explicit transaction |
| Coach SELECT EXISTS subqueries degrade perf if coach_athlete_links grows large | Each coach data query runs an EXISTS on coach_athlete_links | Covering indexes on (coach_user_id, athlete_user_id) mitigate; monitor query plans |
| Soft-delete semantics on coach_athlete_links could be misunderstood | App code might hard-delete instead of setting deleted_at | Enforce soft-delete in code review; create a helper function if API routes handle it |
| `delete_user_cascade` not called on actual account deletion | Links remain after user is deleted | Account deletion feature is not yet live; function is a stub for future use |

---

## 9. DEPLOYMENT SIGN-OFF

| Role | Name | Date | Sign-off |
|------|------|------|----------|
| Database Admin | [Your Name] | [Date] | [ ] Ran pre-deploy checks |
| Database Admin | [Your Name] | [Date] | [ ] Deployed migration |
| Database Admin | [Your Name] | [Date] | [ ] Ran post-deploy checks |
| Backend Lead | [Your Name] | [Date] | [ ] Verified API readiness |
| Product Lead | [Your Name] | [Date] | [ ] Confirmed no user impact |
| Ops/SRE | [Your Name] | [Date] | [ ] Monitoring in place |

---

## References

- **Migration file:** `/Users/ryan/Documents/da2/supabase/migrations/0010_coach_athlete_links.sql`
- **Plan document:** `/Users/ryan/Documents/da2/docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md` (Unit 2)
- **Conventions:** `/Users/ryan/Documents/da2/docs/solutions/migration-conventions.md`
- **Partial index pattern:** `/Users/ryan/Documents/da2/docs/solutions/partial-unique-with-soft-delete.md`
- **GitHub PR:** #73
- **Related API endpoints:** (Not yet deployed; feature-flagged for Flutter app launch)

---

## Appendix: Quick SQL Query Reference

Copy-paste these for faster verification:

```sql
-- All checks in one pass (safe to run repeatedly)
SELECT 'Table exists' as check_name, 
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='coach_athlete_links') as result
UNION ALL
SELECT 'RLS enabled', rowsecurity FROM pg_tables WHERE tablename='coach_athlete_links'
UNION ALL
SELECT 'Partial unique index', EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename='coach_athlete_links' 
    AND indexname='coach_athlete_links_one_active_coach_per_athlete'
)
UNION ALL
SELECT 'Coach athlete links policies', COUNT(*)::BOOLEAN FROM pg_policies WHERE tablename='coach_athlete_links'
UNION ALL
SELECT 'Role flags check in users_self_update', 
       with_check LIKE '%role_flags%' FROM pg_policies 
       WHERE tablename='users' AND policyname='users_self_update'
UNION ALL
SELECT 'Delete cascade function exists', 
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='delete_user_cascade');
```
