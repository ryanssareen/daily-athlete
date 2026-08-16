---
title: Never-Captured Columns (public.users.timezone)
date: 2026-08-16
status: active
---

# Never-Captured Columns

How `public.users.timezone` sat at its migration default for every user
since launch, why nothing caught it, and the general pattern to watch for
in any other `NOT NULL DEFAULT` column that's supposed to hold a
per-user real-world value.

## The bug

Reported as two symptoms that turned out to be one root cause:

1. The athlete dashboard greeting ("Good morning/afternoon/evening") was
   wrong for every athlete outside UTC.
2. A specific athlete's Strava-synced 4-hour, 91 km ride displayed at a
   clock time that didn't match when they actually rode.

Confirmed directly against production rather than guessed:

```sql
select timezone from public.users where id = '71601da8-...';
-- → "UTC"
```

Not null, not corrupted — just the column's own `DEFAULT`, forever, because
no code path in the app had ever written to it.

## Root cause: a column that looks populated but was never captured

```sql
-- supabase/migrations/0001_users_and_entitlements.sql
timezone TEXT NOT NULL DEFAULT 'UTC',
```

`NOT NULL DEFAULT 'UTC'` guarantees the column is never `NULL` — which is
exactly what makes this class of bug invisible. A `null`-check on the read
side (`data?.timezone ?? "UTC"` in `apps/web/src/auth/roles.ts`) will never
fire, because the stored value is never `null`. The column looks
successfully populated at every layer that reads it. The only way to catch
it is to ask a different question: **not** "is this column ever null?" but
"does any code path ever write a real value into it?" Grepping the entire
app (`app/`, `src/`) for a write to `users.timezone` turned up nothing —
onboarding captures plenty of other profile fields, but timezone was never
one of them.

This is a general pattern, not specific to timezone. Any `NOT NULL DEFAULT`
column intended to hold a real per-user value — a locale, a currency, a
notification preference seeded with a "sensible" default — has the same
failure mode if the capture step was never built: it silently reads as
"successfully set" everywhere downstream, forever, and no `null`-check will
ever surface it.

## The fix

Self-healing capture, not a one-time signup step — this corrects existing
users on their next session, not just new signups:

- `apps/web/app/api/profile/timezone/route.ts` — `PATCH` endpoint. Validates
  the reported string is a real IANA timezone (`Intl.DateTimeFormat` throws
  on garbage) before writing.
- `apps/web/src/components/timezone-sync.tsx` — client component. Compares
  `Intl.DateTimeFormat().resolvedOptions().timeZone` (the browser's real
  timezone) against the value the server rendered; PATCHes only on a
  mismatch, so it's a no-op once corrected.
- Mounted in **both** `apps/web/app/(athlete)/layout.tsx` and
  `apps/web/app/(coach)/layout.tsx` — the root cause (the column, the
  missing write) is identical for both roles; fixing only the athlete side
  would have left every coach-only account on the same bug.
- `apps/web/app/(athlete)/athlete/page.tsx`'s `getGreeting(timezone)` reads
  the local hour via `Intl`/`toLocaleString`, not `new Date().getUTCHours()`,
  with a `try/catch` fallback so a still-invalid stored value degrades to a
  wrong greeting instead of crashing the whole dashboard render.

### Why the admin client, not RLS, for a self-service write

`apps/web/app/api/profile/timezone/route.ts` uses `createAdminClient()` with
an explicit `.eq("id", user.id)` filter rather than the RLS-scoped client,
even though `users_self_update`'s RLS policy already permits a user to
self-write their own `timezone` (migration `0010`'s comment confirms this
column, unlike `role_flags`, is intentionally RLS-updatable). The reason is
this route's auth surface, not the RLS policy: `@/auth/server`'s client is
bound to the **cookie** session only. `resolveAuth()` validates a Bearer
token (mobile) for its return value but never attaches it to that client's
Postgrest requests. A mobile caller hitting an RLS-scoped write here would
authenticate fine, then silently update zero rows (`auth.uid()` reads as
`NULL` under RLS, `NULL = id` is `false`) — a worse failure than the thing
being fixed. Admin client + explicit filter is correct specifically because
the route must serve both auth surfaces; see KTD1 in
`docs/plans/2026-08-15-001-feat-plan-history-archive-delete-plan.md` for the
same reasoning applied to a different dual-surface route.

## Prevention

- When adding a new `NOT NULL DEFAULT` column meant to hold a real per-user
  value, grep the app for an actual write path to it before considering the
  feature done — a default that satisfies the schema is not the same as a
  value that was captured.
- Prefer self-healing capture (compare browser/client-detected reality
  against the stored value on session load, correct on mismatch) over a
  one-time signup-only write. A signup-only capture only fixes new users;
  existing rows stay wrong forever unless something re-visits them.
- If a shared piece of session state (like `session.timezone`) is read from
  more than one route group's layout (athlete, coach, admin, ...), any fix
  that touches how that state gets populated needs to be mounted everywhere
  it's read, not just the layout where the bug was first reported.

## Test coverage

- `apps/web/app/(athlete)/athlete/__tests__/page.test.tsx` — `getGreeting`:
  distinct results for the same instant across timezones, both greeting
  boundaries crossed via local (not UTC) time, and the invalid-timezone
  fallback path.
- `apps/web/app/api/profile/timezone/__tests__/route.test.ts` — auth,
  self-only scoping, IANA validation, DB-error path.
