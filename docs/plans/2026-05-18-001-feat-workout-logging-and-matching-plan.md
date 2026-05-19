---
date: 2026-05-18
title: "feat: Workout logging, completion, and Strava auto-matching"
status: active
deepened: 2026-05-18
origin: docs/brainstorms/2026-05-18-workout-logging-and-matching-requirements.md
---

# feat: Workout logging, completion, and Strava auto-matching

## Problem Frame

Athletes need four distinct workflows handled, two of which have no web UI and one of which has no backend logic:

- **Type 1 (manual ad-hoc)**: No UI to log a gym session or any workout done without Strava. API route exists (`POST /api/activities/manual`), UI is missing.
- **Type 3 (planned + manual completion)**: No UI to mark a calendar workout done. API route exists (`POST /api/workouts/[id]/status`), UI is missing.
- **Type 4 (planned + Strava auto-match)**: No webhook handler and no matching logic in the backfill. Data flows in via Strava but planned workouts never automatically show as completed.
- **Data integrity gap**: `getRecentWorkouts`, `getWorkoutsInRange`, `getAthleteWorkouts`, and `getCoachRoster`'s activities subquery all lack a `superseded_by_id IS NULL` filter, causing manual entries to re-appear after Strava supersedes them.

(see origin: docs/brainstorms/2026-05-18-workout-logging-and-matching-requirements.md)

## Requirements Trace

| Req | Unit | Description |
|-----|------|-------------|
| R1–R4 | 5 | Log workout UI (Type 1) |
| R5–R8 | 6 | Mark as done UI (Type 3) |
| R9 | 4 | Strava webhook handler |
| R10–R13 | 2, 3, 4 | Auto-matching logic |
| R14–R16 | 2 | Type 3 + Strava supersession |
| (fix gap) | 1 | Canonical read helpers |

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Strava webhook POST
  └─ validate Zod schema + subscription_id
  └─ handle object_type='athlete' → mark strava_tokens revoked, exit
  └─ next/after() [maxDuration=60] → fetchFullActivity → insertOrUpdateStravaCompletedWorkout
                                                        └─ matchStravaToPlanned()
                                                             └─ guard: same completedWorkoutId? → early exit
                                                             └─ guard: existing match source='strava'? → skip/no-op
                                                             └─ existing match source='manual'? → supersede_manual_match RPC (atomic)
                                                             └─ no existing match? → insert workout_matches + update status

  DELETE event:
  └─ soft-delete completed_workouts row
  └─ soft-delete linked workout_matches row
  └─ if no live match remains → revert planned_workouts.status = 'planned'

Backfill (existing processActivityPage)
  └─ insertOrUpdateStravaCompletedWorkout  ← returns ID now
  └─ matchStravaToPlanned()               ← wired in after each activity (non-fatal catch)

UI: Log Workout (Type 1)
  └─ LogWorkoutDialog (client component)
  └─ POST /api/activities/manual
  └─ router.refresh()

UI: Mark as Done (Type 3)
  └─ PlannedChipClient + MarkAsDoneButton (client components)
  └─ POST /api/workouts/[id]/status { status: "completed" }
  └─ router.refresh()
```

## Implementation Units

---

### Unit 1 — Fix canonical read helpers

- [ ] **Goal**: Add `superseded_by_id IS NULL` filter to all canonical read paths. Prerequisite for correctness when the Type 3+4 supersession path writes data.

**Files**:
- `apps/web/src/db/workouts.ts` — `getRecentWorkouts`, `getWorkoutsInRange`
- `apps/web/src/db/roster.ts` — `getAthleteWorkouts`, activities subquery in `getCoachRoster`

**Approach**: Each query already calls `.is("deleted_at", null)`. Add `.is("superseded_by_id", null)` on the same query chain. This is safe to deploy before any supersession data exists — `superseded_by_id` is currently NULL on all rows.

`getThisWeekStats` delegates entirely to `getWorkoutsInRange`, so it is fixed transitively. Verify this explicitly in tests.

The `getCoachRoster` activities subquery feeds both `lastActivityAt` (first row after `ORDER BY started_at DESC`) and `weekCount` (7-day rolling count). Both must exclude superseded rows. The fix is one additional `.is("superseded_by_id", null)` on that subquery.

**Patterns to follow**: `getWorkoutById` in `apps/web/src/db/workouts.ts` already has both filters — the reference implementation.

**Test file**: `apps/web/src/db/__tests__/completed-workouts.test.ts`

**Test scenarios**:
- A row with `superseded_by_id` set is absent from `getRecentWorkouts` results
- A row with `superseded_by_id` set is absent from `getWorkoutsInRange` results
- A row with `superseded_by_id` set is absent from `getAthleteWorkouts` results
- A non-superseded row is still returned by all three helpers
- `getCoachRoster` week count does not inflate when a superseded manual row exists within the 7-day window
- `getCoachRoster` last-activity timestamp reflects the canonical (non-superseded) row's `started_at`, not the superseded one
- `getThisWeekStats` week count does not include superseded rows (transitively via `getWorkoutsInRange`)

**Verification**: Grep confirms every query on `completed_workouts` across `db/workouts.ts`, `db/roster.ts` has both `.is("deleted_at", null)` and `.is("superseded_by_id", null)` — except the supersession logic in Unit 2 which intentionally reads the old manual row to get its ID.

---

### Unit 2 — Strava auto-match module + supersession

- [ ] **Goal**: Build the shared `matchStravaToPlanned()` function, update `insertOrUpdateStravaCompletedWorkout` to return the row ID, and add the `supersede_manual_match` Postgres RPC for atomic supersession.

**Files**:
- `apps/web/src/strava/auto-match.ts` — new file
- `apps/web/src/db/completed-workouts.ts` — change `insertOrUpdateStravaCompletedWorkout` return type to `Promise<string>` (the completed_workout ID)
- `apps/web/src/strava/build-summary-stats.ts` — new shared utility (extracted from `backfill-helpers.ts`; also fixes the existing drift in `sync-workout/route.ts`)
- `supabase/migrations/0013_supersede_manual_match_rpc.sql` — new migration for the supersession RPC

**Approach — `insertOrUpdateStravaCompletedWorkout` return value**:
On INSERT path, chain `.select("id").single()` and return the id. On UPDATE fallback (23505 path), query by `(athlete_id, strava_activity_id)` to get the id. The UPDATE already has both filter columns so this is one extra SELECT.

**Approach — `buildSummaryStats` extraction**:
Extract the private `buildSummaryStats` from `apps/web/src/strava/backfill-helpers.ts` to `apps/web/src/strava/build-summary-stats.ts`. Update `backfill-helpers.ts` and `sync-workout/route.ts` to import from the shared file. This prevents a third copy from drifting in the webhook handler. (`sync-workout/route.ts` had already dropped `average_cadence` — the shared version must include it.)

**Approach — `supersede_manual_match` RPC** (new migration, `0013`):
The supersession path requires three DB writes: (a) soft-delete old `workout_matches` row, (b) set `superseded_by_id` on the manual `completed_workouts` row, (c) insert new `workout_matches` row. If the process dies between (b) and (c), the manual row is permanently hidden (its `superseded_by_id` is set) with no canonical replacement — this state has no self-correcting path. Wrapping in a `plpgsql` function with `SECURITY DEFINER` (matching the `complete_planned_workout` RPC pattern in migration 0011) makes it atomic. Parameters: `p_planned_workout_id UUID`, `p_old_match_id UUID`, `p_manual_completed_workout_id UUID`, `p_strava_completed_workout_id UUID`, `p_athlete_id UUID`. Grant `EXECUTE` to `service_role`.

**Approach — `matchStravaToPlanned(admin, params)` full algorithm**:

*Directional signature — exact naming at implementer's discretion:*
```
matchStravaToPlanned(admin, {
  athleteId: string,
  completedWorkoutId: string,   // Strava completed_workout row id
  sport: string,                // normalized sport string
  startedAt: string,            // ISO datetime — see timezone note below
  durationS: number | null
}) → Promise<{ matched: boolean; plannedWorkoutId?: string }>
```

Steps:
1. Extract `dateStr` from `startedAt` — see **Timezone note** below.
2. Query `planned_workouts` for `athlete_id + sport + scheduled_date = dateStr + status IN ('planned', 'completed') + deleted_at IS NULL`.
3. **Duration guard (R10)**: For each candidate, read `structure.duration_s`. Treat the guard as a no-op if the value is absent, null, not a finite number, or `<= 0` (to avoid division by zero). If a valid positive target is present, discard the candidate if `Math.abs(durationS - target) / target > 0.5`. If `durationS` is null, guard is a no-op for all candidates.
4. **Tie-break (R13)**: Sort remaining candidates by `Math.abs(durationS - structure.duration_s)` ascending (nulls last), then by `scheduled_date` ascending. Take the first.
5. If no candidate: return `{ matched: false }`.
6. **Check for existing match**: Query `workout_matches` for `planned_workout_id = candidate.id AND deleted_at IS NULL`. Fetch the matched row including `completed_workout_id`.
7. **Idempotency guard (before any mutation)**: If an existing match is found and `existingMatch.completed_workout_id === completedWorkoutId`, this is a duplicate delivery of already-completed work. Return `{ matched: true, plannedWorkoutId: candidate.id }` immediately — no writes.
8. **Source check (before supersession path)**: Fetch `source` of the existing match's `completed_workout_id` from `completed_workouts`. If `source = 'strava'` (an earlier auto-match already exists, or a different Strava activity was already matched), skip this candidate: either try the next candidate if one remains, or return `{ matched: false }`. Do not supersede a Strava row with another Strava row.
9. **Direct match path** (no existing match OR all existing matches filtered above):
   - `// service-role: explicit user filter required`
   - INSERT `workout_matches` with `method='auto_same_day_sport'`, `confidence=0.9`, `completed_workout_id=completedWorkoutId`
   - On 23505 (race with concurrent call): treat as idempotent success — return `{ matched: true, plannedWorkoutId: candidate.id }` without re-raising
   - UPDATE `planned_workouts.status='completed'` where `id = candidate.id`
10. **Supersession path** (existing match found, `source='manual'`, R14–R16):
    - `// service-role: explicit user filter required`
    - Call `supersede_manual_match` RPC with `p_planned_workout_id`, `p_old_match_id`, `p_manual_completed_workout_id` (old match's completed_workout_id), `p_strava_completed_workout_id` (completedWorkoutId), `p_athlete_id`
    - The RPC atomically: soft-deletes old match, sets `superseded_by_id` on the manual row, inserts new `workout_matches` with `method='merged_from_manual'` and `confidence=1.0`
    - `planned_workouts.status` stays `'completed'` — no change (R16)
11. Return `{ matched: true, plannedWorkoutId: candidate.id }`

**Timezone note**: `startedAt` comes from Strava's `start_date` field (UTC). `scheduled_date` is a `DATE` column populated by the AI coach. Verify during implementation whether `StravaActivitySchema` includes `start_date_local` (the athlete's local-time equivalent). If present, use `start_date_local.split("T")[0]` instead of `start_date.split("T")[0]` to avoid silent mismatches for athletes in negative-UTC timezones who exercise after ~8 PM local time. If `start_date_local` is absent from the schema, document the UTC limitation in a code comment and add a note to the Deferred section. Deferred to implementation-time discovery.

**Security note**: All admin queries must carry `// service-role: explicit user filter required`. The function takes `athleteId` as a trusted parameter from a session-validated caller. Never echo raw Strava errors to the DB.

**Patterns to follow**:
- INSERT-catch-23505-UPDATE pattern: `apps/web/src/db/completed-workouts.ts`
- Soft-delete pattern: existing `deleted_at` updates throughout the codebase
- `workout_matches` schema: `supabase/migrations/0008_completed_workouts_and_matches.sql`
- Partial unique index: `workout_matches (planned_workout_id) WHERE deleted_at IS NULL` — enforces soft-delete + insert for supersession
- Partial unique index: `workout_matches (completed_workout_id) WHERE deleted_at IS NULL` — means the 23505 on INSERT can come from either constraint; treat both as idempotent success
- `complete_planned_workout` RPC: `supabase/migrations/0011_complete_planned_workout_rpc.sql` — template for the new `supersede_manual_match` RPC structure

**Test file**: `apps/web/src/strava/__tests__/auto-match.test.ts` (new)

**Test scenarios**:
- Happy path: same sport + date → inserts `workout_match` with `method='auto_same_day_sport'`, `confidence=0.9`, returns `matched=true`
- Wrong sport → returns `matched=false`, no insert
- Wrong date → returns `matched=false`
- Athlete has no planned workouts at all → returns `{ matched: false }`, no DB writes
- Duration guard: `structure.duration_s = 3600`, Strava duration 1800 (exactly 50% diff) → accepted (boundary). Duration 1799 → rejected (> 50%)
- Duration guard: `structure.duration_s` absent → degrades to sport+date, no rejection
- Duration guard: `structure.duration_s = 0` → treated as absent, no rejection (no division by zero)
- Duration guard: `durationS` null → guard is no-op for all candidates
- Multiple candidates same day → picks closest duration; ties pick earliest `scheduled_date`
- **Idempotency**: `matchStravaToPlanned` called twice with same `completedWorkoutId` → second call detects `existingMatch.completed_workout_id === completedWorkoutId` and returns `{ matched: true }` immediately, no new DB writes
- **Strava-on-Strava no-op**: existing match points to a `source='strava'` row (prior auto-match) → matcher skips that candidate, does not enter supersession, returns `{ matched: false }`
- **Triathlete same-day two swims**: two planned swims on same day, two Strava swims arrive sequentially → both planned workouts end up matched, no supersession fires on the second match
- **Supersession**: planned workout already manually completed (`method='manual_user_link'`, `source='manual'`) → `supersede_manual_match` RPC called; old match soft-deleted, `superseded_by_id` set, new match inserted with `method='merged_from_manual'`
- **Supersession atomicity**: RPC called; simulate failure after step (a) (soft-delete) → `planned_workouts.status` stays `'completed'` but no orphaned state (RPC transaction rolled back)
- `planned_workouts.status` stays `'completed'` after supersession (R16)
- 23505 race on `workout_matches` INSERT in direct match path → treated as idempotent success, no error thrown, no crash
- **Backfill supersedes `manual_user_link` when duration guard inactive**: planned run manually completed (`confidence=1.0`), backfill imports a same-day same-sport Strava run, `structure.duration_s` absent → supersession fires (Strava wins — confirm this is the intended behavior per product decision)
- `insertOrUpdateStravaCompletedWorkout` INSERT path returns row ID
- `insertOrUpdateStravaCompletedWorkout` UPDATE path (23505) returns row ID

**Verification**: `workout_matches` partial unique indexes never violated. Only one active (non-soft-deleted) match per `planned_workout_id` at any time. Only one active match per `completed_workout_id` at any time.

---

### Unit 3 — Backfill integration

- [ ] **Goal**: Wire `matchStravaToPlanned` into `processActivityPage` so the backfill auto-matches Strava activities against planned workouts.

**Files**:
- `apps/web/src/strava/backfill-helpers.ts` — `processActivityPage`
- `apps/web/src/strava/build-summary-stats.ts` — consumed here (from Unit 2 extraction)

**Approach**: After `insertOrUpdateStravaCompletedWorkout` returns the completed_workout ID, call `matchStravaToPlanned`. Wrap in non-fatal catch: log `{ athlete_id, strava_activity_id }` on error (never log raw activity payload). The backfill loop continues regardless.

`processActivityPage` still returns `number` (count). No raw activity data leaves the function.

**Patterns to follow**: Error isolation pattern in `apps/web/src/strava/run-backfill.ts`

**Test file**: `apps/web/src/strava/__tests__/backfill-helpers.test.ts`

**Test scenarios**:
- `processActivityPage` calls `matchStravaToPlanned` once per activity with correct params
- Matcher error does not propagate — backfill continues, returns correct count
- Return value is still the count of processed activities (never raw activity data)

**Verification**: `processActivityPage` returns `number`, no raw activity data in return value.

---

### Unit 4 — Strava webhook handler

- [ ] **Goal**: Receive real-time activity create/delete events from Strava. GET answers the hub challenge. POST defers all work to `next/after()`, handles deauth events, and extends the delete path to revert planned workout state.

**Files**:
- `apps/web/app/api/integrations/strava/webhook/route.ts` — new file
- `apps/web/src/config.ts` — add `STRAVA_WEBHOOK_SUBSCRIPTION_ID` to `RawEnv`, `AppConfig`, and `requireProd` validation block

**Environment variables** (add to Vercel + `.env.local`):
- `STRAVA_WEBHOOK_VERIFY_TOKEN` — arbitrary string set when registering the subscription
- `STRAVA_WEBHOOK_SUBSCRIPTION_ID` — numeric ID returned by Strava after registration; must be a positive finite integer

**Config prerequisite**: `STRAVA_WEBHOOK_SUBSCRIPTION_ID` must be added to `apps/web/src/config.ts` following the same `requireProd` pattern used for other Strava secrets. `Number(undefined)` returns `NaN`; `NaN === NaN` is always false in JavaScript, so a missing env var silently discards all events with no observable error. `buildFromRaw` should validate this as a positive finite integer before the server starts.

**Export required**: `export const maxDuration = 60` — every other `next/after()` route in the codebase (`connect/route.ts`, `backfill/retry/route.ts`) declares this. Without it, Vercel's 10s default function timeout kills the `after()` callback silently, returning 200 to Strava (preventing retry) but dropping the work.

**GET handler (hub verification, R9)**:
- Read `hub.mode`, `hub.challenge`, `hub.verify_token` from search params
- Validate `hub.mode === "subscribe"` and `hub.verify_token === config.stravaWebhookVerifyToken`
- Respond `{ "hub.challenge": challengeValue }` with HTTP 200
- Respond 403 on mismatch

**POST handler (event delivery, R9)**:

Validate the full body with Zod before any DB writes or subscription checks:
```
{
  object_type: string,
  object_id: z.number().int().positive(),  // validated before URL construction
  aspect_type: string,
  owner_id: z.number().int().positive(),
  subscription_id: z.number().int(),
  event_time: z.number(),
  updates: z.record(z.unknown()),
}
```

Steps:
1. Zod-validate the body. On failure, return 200 silently (do not leak validation errors to unknown callers).
2. Validate `subscription_id === config.stravaWebhookSubscriptionId`. On mismatch, return 200 silently.
3. **Handle `object_type === 'athlete'`**: This is a Strava deauthorization event. Look up the user by `owner_id` in `strava_tokens`. If found, mark the token as invalid (e.g., set a `revoked_at` column, or soft-delete the row — implementer to check existing revocation convention in `strava_tokens`). Return 200. Do not proceed to activity processing. (This prevents forged deauth events with a known `owner_id` from triggering service-role token lookups on demand.)
4. Skip `aspect_type === 'update'` events — return 200.
5. Return 200 immediately. All remaining work is in `after()`.
6. **Inside `after()` — wrap entirely in try/catch using `classifyError()` from `apps/web/src/strava/errors.ts` for any structured log fields. Never log `err.message` directly.** Log only `{ athlete_strava_id, strava_activity_id, aspect_type, error_code }`.
7. Look up user: `admin.from("strava_tokens").select("user_id").eq("athlete_strava_id", owner_id).maybeSingle()`. `// service-role: explicit user filter required`.
8. If no user found: log at `warn` level with `{ owner_id }` (no token data), return — no further action. (This is the expected case when an athlete has disconnected Strava before the event arrives; the `completed_workouts` row, if any, will remain live — accepted gap per product scope.)

**For `aspect_type === 'create'`**:
- Create a `StravaClient` for the user and fetch `/activities/{object_id}` (note: `object_id` is validated as positive integer by Zod at step 1 — safe to use in URL construction)
- Parse with `StravaActivitySchema`; handle `StravaReauthRequired` (log, exit), `StravaRateLimited` (log, exit — backfill will cover eventual consistency)
- Build `CompletedWorkoutRow` using `normalizeSport` and `buildSummaryStats` (both from shared files)
- Call `insertOrUpdateStravaCompletedWorkout` → get ID
- Call `matchStravaToPlanned` (non-fatal catch + log)

**For `aspect_type === 'delete'`**:
Three-step sequence (must all be attempted; non-fatal error on any step is logged):
1. Fetch and soft-delete the `completed_workouts` row: `UPDATE ... SET deleted_at=now() WHERE athlete_id=userId AND strava_activity_id=objectId AND deleted_at IS NULL` — use `.select("id")` on the update call to retrieve the row UUID.
2. If a row was found in step 1: soft-delete the linked `workout_matches` row(s): `UPDATE workout_matches SET deleted_at=now() WHERE completed_workout_id=<row_id> AND deleted_at IS NULL`. Also retrieve `planned_workout_id` from the match(es).
3. For each affected `planned_workout_id`: check if any live `workout_matches` row still exists (`deleted_at IS NULL`). If none remain, revert `planned_workouts.status='planned'` where `id=plannedWorkoutId AND status='completed'`.
- All three steps must carry `// service-role: explicit user filter required`
- Migration comment in `0008_completed_workouts_and_matches.sql` lines 25–26 explicitly assigns this orchestration responsibility to app code.

**Rate limiting**: Relying on Vercel's built-in DDoS protection as the sole external control. Strava subscription IDs are sequential integers in the low-millions (guessable), but the subscription check + `next/after()` model means the synchronous path is near-zero-cost after the Zod validation. No additional rate limiting added in this plan; document this as a conscious decision.

**Security summary**:
- Zod body validation before any processing
- `subscription_id` check before queuing work
- `object_type='athlete'` deauth handled explicitly — no activity hydration on deauth
- `object_id` validated as positive integer before URL construction
- All `after()` errors caught with `classifyError()`; no `err.message` logged
- No HMAC verification needed (Strava does not sign delivery POSTs — confirmed 2026)

**Patterns to follow**:
- `next/after()` + `maxDuration`: `apps/web/app/api/integrations/strava/backfill/retry/route.ts`
- `StravaClient` error handling + `classifyError()`: `apps/web/src/strava/run-backfill.ts`
- Config `requireProd` pattern: `apps/web/src/config.ts`

**Test file**: `apps/web/app/api/integrations/strava/webhook/__tests__/route.test.ts` (new)

**Test scenarios**:
- GET with correct `hub.verify_token` returns `{ "hub.challenge": "..." }` with status 200
- GET with wrong `hub.verify_token` returns 403
- POST with wrong `subscription_id` returns 200 (silent discard)
- POST body fails Zod validation → returns 200 silently
- POST with `object_type='athlete'` → marks strava_tokens revoked, returns 200, no activity processing
- POST with `aspect_type='update'` → returns 200, no processing
- POST with `aspect_type='create'`, correct subscription_id → returns 200 immediately; `after()` triggers upsert + match
- POST with unknown `owner_id` (not in `strava_tokens`) → no-op, warn log, no error thrown
- POST with `aspect_type='delete'` for a previously-matched Strava activity → `completed_workouts` soft-deleted, `workout_matches` soft-deleted, `planned_workouts.status` reverted to 'planned'
- POST with `aspect_type='delete'` for an unmatched Strava activity (no `workout_matches` row) → `completed_workouts` soft-deleted, `planned_workouts` unchanged
- Uncaught error inside `after()` → only `error_code` logged (from `classifyError()`), not raw `err.message`
- `STRAVA_WEBHOOK_SUBSCRIPTION_ID` absent from env → config validator catches at boot, not silently at runtime

**Verification**: Route returns 200 in < 100ms for all event types. `after()` callback completes within the `maxDuration=60` window. Delete events correctly revert planned workout calendar state.

---

### Unit 5 — Log workout UI (Type 1)

- [ ] **Goal**: "Log workout" button accessible from the athlete dashboard and calendar. Opens a modal form. On submit, calls existing `POST /api/activities/manual` and refreshes.

**Files**:
- `apps/web/app/(athlete)/athlete/LogWorkoutDialog.tsx` — new client component (`"use client"`)
- `apps/web/app/(athlete)/athlete/page.tsx` — import and render `<LogWorkoutButton />`
- `apps/web/app/(athlete)/athlete/calendar/page.tsx` — import and render `<LogWorkoutButton />` in the header area

**Approach**: `LogWorkoutDialog` wraps both the trigger button and the `<dialog>` element. State: `open`, form fields (sport, date, durationMin), submitting, errorMsg. On success: `setOpen(false); router.refresh()`.

Form fields (R2):
- **Sport**: `<select>` with options: run / swim / bike / strength / mobility / other
- **Date**: `<input type="date">` defaulting to today (UTC `YYYY-MM-DD`)
- **Duration**: `<input type="number">` in minutes, required, min=1
- Distance excluded per scope boundary

Use native `<dialog>` element with a backdrop overlay div. Inline styles matching `SyncButton.tsx` / `InviteSection.tsx` patterns. Close on Escape key and backdrop click.

**Patterns to follow**: `apps/web/app/(athlete)/athlete/workouts/[id]/SyncButton.tsx` — client component structure, inline styles, `router.refresh()` pattern

**Test file**: Browser / integration test (unit test value is low for a simple form modal)

**Test scenarios** (browser):
- "Log workout" button visible on dashboard and calendar header
- Clicking opens modal with sport select, date input, duration input
- Form does not submit when sport/date/duration missing (required validation)
- Happy path: correct `{ sport, started_at, duration_s }` body sent to `POST /api/activities/manual`
- On 200: modal closes, page refreshes showing new workout in the list and calendar
- On API error: error message shown inline, modal stays open
- Escape key closes modal

**Verification**: New workout appears on activities list and calendar immediately after submit without a full navigation (R4, via `router.refresh()`).

---

### Unit 6 — Mark as done UI (Type 3)

- [ ] **Goal**: "Mark as done" action on planned calendar chips and on a new planned workout detail page. Calls existing `POST /api/workouts/[id]/status`.

**Files**:
- `apps/web/app/(athlete)/athlete/calendar/PlannedChipClient.tsx` — new client component
- `apps/web/app/(athlete)/athlete/calendar/page.tsx` — replace static `PlannedChip` with `PlannedChipClient`; pass `id` and `status` as props
- `apps/web/app/(athlete)/athlete/planned/[id]/page.tsx` — new server component (planned workout detail page)
- `apps/web/app/(athlete)/athlete/planned/[id]/MarkAsDoneButton.tsx` — new client component

**Approach — PlannedChipClient**:
Extract current `PlannedChip` render logic into the client component. When `status === "planned"`, render a small "Mark as done" tap target. On tap: POST to `/api/workouts/${id}/status` with `{ status: "completed" }`, then `router.refresh()`. Show loading state (disabled button) during request; surface inline error on failure. When `status !== "planned"`: static chip appearance only.

Calendar page change: replace `<PlannedChip key={p.id} p={p} />` with `<PlannedChipClient key={p.id} id={p.id} status={p.status} sport={p.sport} />`. Calendar page remains a server component; only the chip is `"use client"`. Add `Link` wrapper inside `PlannedChipClient` to `/athlete/planned/${p.id}` so chips are navigable.

**Approach — planned workout detail page** (`/athlete/planned/[id]`):
Server component; `await params` pattern matching `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx`. Query `planned_workouts` by ID + `athlete_id` + `deleted_at IS NULL`. Display: sport, scheduled date, status badge, `structure.description` string if present (otherwise show a placeholder). Render `<MarkAsDoneButton id={id} />` only when `status === "planned"`.

**MarkAsDoneButton**: Mirrors `SyncButton.tsx` structure. POST body: `{ status: "completed" }`. On success: `router.refresh()`. On error: inline red banner (same style as SyncButton error state).

**Patterns to follow**:
- Client component + `router.refresh()`: `apps/web/app/(athlete)/athlete/workouts/[id]/SyncButton.tsx`
- Server component detail page: `apps/web/app/(athlete)/athlete/workouts/[id]/page.tsx`
- Inline styles: match calendar chip styles in `apps/web/app/(athlete)/athlete/calendar/page.tsx`

**Test file**: Browser test (UI components)

**Test scenarios** (browser):
- Calendar chip with `status=planned` shows "Mark as done" tap target
- Calendar chip with `status=completed` shows static "done ✓" chip, no action
- Tapping "Mark as done" on chip → chip updates to completed style immediately after `router.refresh()` (R8)
- Calendar chip links to `/athlete/planned/[id]`
- Navigating to `/athlete/planned/[id]` shows sport, scheduled date, status badge
- "Mark as done" button visible when `status=planned`, absent when `status=completed`
- Button POST sends `{ status: "completed" }` to correct route; on success page refreshes
- Error from API shows inline red banner

**Verification**: Calendar card and detail page both reflect completed state after a single tap without full page navigation (R8, via `router.refresh()`).

---

## System-Wide Impact

- **Concurrent delivery (backfill + webhook)**: Both `processActivityPage` and the webhook `after()` handler can call `matchStravaToPlanned` for the same Strava activity near-simultaneously. The idempotency guard (Unit 2, step 7) and 23505 handling on the `workout_matches` INSERT make this safe. The `insertOrUpdateStravaCompletedWorkout` INSERT-catch-23505-UPDATE pattern was already idempotent; the matcher is now equally hardened.

- **Delete event correctness depends on Unit 4 delete path**: If a Strava activity is deleted after being auto-matched, `matchStravaToPlanned` will later find a `planned_workout` with `status='completed'` and an existing match pointing at a soft-deleted `completed_workouts` row. Unit 4's extended delete path (soft-delete match + revert status) is a correctness prerequisite for the re-match scenario. Without it, a re-imported or re-matched activity can enter an inconsistent supersession loop.

- **`superseded_by_id` writes affect three read surfaces**: `getRecentWorkouts`, `getWorkoutsInRange` (and transitively `getThisWeekStats`), `getAthleteWorkouts`, and `getCoachRoster` all must filter `superseded_by_id IS NULL`. Unit 1 fixes all four. Verify no new read paths on `completed_workouts` are added during implementation without this filter.

- **Strava deauth events (`object_type='athlete'`)**: Without an explicit deauth branch, these events reach the activity hydration path and trigger a service-role `strava_tokens` lookup. Anyone who knows the subscription ID and a Strava athlete ID (public integer on any profile URL) can trigger on-demand token lookups. Unit 4 handles this explicitly.

- **`STRAVA_WEBHOOK_SUBSCRIPTION_ID` must be in `config.ts`**: Without the `requireProd` validator, `Number(undefined) = NaN` makes the subscription check a permanent silent no-op — indistinguishable from a healthy deployment.

- **`planned_workouts.status` lifecycle**: Unit 4's delete handler is the only place where `status` reverts from `'completed'` to `'planned'`. This is intentional and scoped — no other path reverts status. The RPC `complete_planned_workout` only ever sets forward (to `'completed'`); the webhook delete path is the only reverse.

- **`build-summary-stats.ts` now canonical**: After Unit 2's extraction, `backfill-helpers.ts` and `sync-workout/route.ts` both import from the shared file. Any future code that needs to build Strava summary stats must import from there — not copy the function.

- **No Flutter / mobile impact**: `completed_workouts`, `planned_workouts`, and `workout_matches` are read via Supabase Realtime on Flutter. The `superseded_by_id IS NULL` filter is applied server-side in the Dart client (see `AGENTS.md` constraint on realtime allowlist). Confirm Flutter realtime queries are not affected — they currently select `completed_workouts` without this filter per the standing note in the requirements doc (deferred to Flutter plan).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `matchStravaToPlanned` called twice for same activity (backfill + webhook overlap) | Idempotency guard in step 7 exits early if `existingMatch.completed_workout_id === completedWorkoutId`. 23505 on `workout_matches` INSERT treated as success. |
| Supersession breaks on re-delivery if source check absent | Source check in step 8 skips Strava-sourced existing matches entirely; supersession only fires on `source='manual'`. |
| Partial supersession write leaves manual row permanently hidden | `supersede_manual_match` RPC wraps all three steps in a DB transaction (migration 0013). |
| UTC date extraction mismatches late-evening workouts for negative-UTC athletes | Verify `start_date_local` availability in schema during Unit 2. Use it if present; document limitation if absent. |
| `STRAVA_WEBHOOK_SUBSCRIPTION_ID` missing from env → silent event loss | Added to `config.ts` `requireProd` validator — fails at boot rather than silently at runtime. |
| Strava does not sign webhook payloads (no HMAC) | Subscription ID check + Zod body validation + `object_type='athlete'` explicit deauth handling. Rely on Vercel DDoS protection for flood risk (documented conscious decision). |
| `next/after()` callback truncated by Vercel 10s default timeout | `export const maxDuration = 60` in webhook route (matches backfill/connect pattern). |
| `structure.duration_s` key convention not validated | Plan establishes the convention; implementation must verify against real DB rows before committing. Degrades gracefully (sport+date only) if absent. |
| AI coach generates sport values outside the 6-value vocabulary | `SportSchema` validation must be confirmed at the plan-generation API boundary before the matcher is useful. See Prerequisites below. |
| Backfill supersedes `manual_user_link confidence=1.0` when duration guard inactive | Confirmed "Strava wins" product decision (origin doc). Add explicit test scenario so behavior is documented and intentional, not accidental. |

## Prerequisites

- **`planned_workouts.sport` validated via `SportSchema` at plan-generation boundary**: If the AI coach can write values outside the 6-value enum (`run`, `swim`, `bike`, `strength`, `mobility`, `other`), the INSERT fails with 23514 and the planned workout is silently dropped — the matcher will never find a candidate for that day. Verify this guard exists in the AI plan generation route before writing matcher tests. If it doesn't exist, add it first.
- `complete_planned_workout` RPC (migration 0011): already deployed. Unit 6 calls the existing route — no changes.
- `workout_matches.method` CHECK includes `'auto_same_day_sport'` and `'merged_from_manual'` (confirmed, migration 0008).
- `next/after()` available in Next.js 15 (confirmed via `backfill/retry/route.ts`).

## Sequencing

Units 1 and 2 are independent and can proceed in parallel. Unit 3 depends on Unit 2. Unit 4 depends on Unit 2 and must include the delete path (which is a correctness prerequisite for the re-match scenario in Unit 2). Units 5 and 6 are fully independent of all backend units.

Recommended order:
1. Unit 1 (data fix — safe to deploy anytime, no behavior change until supersession rows exist)
2. Unit 2 (core logic — includes migration 0013 for the supersession RPC and `build-summary-stats.ts` extraction)
3. Unit 3 + Unit 4 in parallel (both wire Unit 2 into a delivery path)
4. Unit 5 + Unit 6 in parallel (independent UI work)

## Key Decisions

- **`supersede_manual_match` RPC for atomicity**: Three-step supersession without a transaction leaves manual rows permanently hidden on partial failure. Migration 0011 (`complete_planned_workout`) shows the correct pattern; a new RPC follows it. (see origin + data integrity review)
- **Idempotency guard before any mutation**: `matchStravaToPlanned` returns early when `existingMatch.completed_workout_id === completedWorkoutId`. Mirrors the INSERT-catch-23505-UPDATE pattern already used in `insertOrUpdateStravaCompletedWorkout`. (see architecture review)
- **Source check gates supersession**: Only `source='manual'` existing matches trigger supersession. `source='strava'` existing matches → skip candidate (no-op). Prevents Strava-on-Strava supersession and handles re-delivery from backfill correctly. (see data integrity review)
- **`buildSummaryStats` extracted to shared file**: Two copies already existed and had drifted (`average_cadence` missing in one). Plan establishes `apps/web/src/strava/build-summary-stats.ts` as the canonical location. (see architecture review)
- **`next/after()` over Inngest for webhook**: Inngest functions are currently unregistered (empty `functions` array in `src/inngest/functions/index.ts`). `next/after()` matches the backfill pattern. (see origin)
- **Silent auto-match**: No UI feedback when Strava auto-matches. Low false-positive rate from sport+date guard. (see origin)
- **Strava wins for stats (supersession)**: Strava becomes canonical even over `manual_user_link confidence=1.0` entries, including when the duration guard is inactive. This is intentional — see "Backfill supersedes manual" test scenario. (see origin)
- **No HMAC on Strava webhooks**: Strava does not sign delivery POSTs (confirmed 2026 via official docs + community hub). Subscription ID check + Zod validation + Vercel DDoS protection is the security model. (confirmed external research)
- **`STRAVA_WEBHOOK_SUBSCRIPTION_ID` in `config.ts`**: Without `requireProd` validation, a missing env var silently discards all events — undetectable without explicit checking. (see security review)
- **`object_type='athlete'` deauth handled explicitly**: Without this branch, any caller with the subscription ID + a public Strava athlete ID can trigger on-demand service-role token lookups. (see security review)
- **Rate limiting via Vercel DDoS protection**: No application-layer rate limiting added to the webhook endpoint. Documented as a conscious decision; subscription ID check keeps cost-per-request low. (see security review)
- **`structure.duration_s` as duration target key**: No existing code reads `structure` for duration. Validate against real DB data during implementation; degrade gracefully if absent or zero.
- **UTC timezone limitation**: `start_date` (UTC) used for date extraction unless `start_date_local` is available in `StravaActivitySchema`. Verify during implementation.

## Deferred to Implementation

- **`start_date_local` availability in `StravaActivitySchema`**: If present, use it for date extraction instead of `start_date` (UTC) to avoid silent non-matches for athletes in negative-UTC timezones. If absent, document the UTC limitation in a code comment.
- **`structure.duration_s` key validation**: Inspect actual AI-generated `planned_workouts.structure` rows in the DB before implementing the guard. Degrade gracefully if the key is absent or differently named.
- **`strava_tokens` deauth revocation convention**: Check existing revocation pattern in `strava_tokens` (is there a `revoked_at` column? a soft-delete? a status flag?). Use whichever is established. If none exists, soft-delete is the safe default.
- **Strava subscription registration**: One-time ops step — `POST /api/v3/push_subscriptions` via curl after the handler is deployed. Document in Vercel env var setup.

## New Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Vercel + `.env.local` | Validates hub subscription GET |
| `STRAVA_WEBHOOK_SUBSCRIPTION_ID` | Vercel + `.env.local` | Validates POST delivery source; must be added to `config.ts` with `requireProd` |
