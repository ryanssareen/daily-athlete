---
title: "feat: Plan history, detail view, and archive/delete"
status: active
date: 2026-08-15
---

# feat: Plan history, detail view, and archive/delete

## Summary

Athletes currently have no way to see past training plans or retire a plan they don't want. The `plans` table already carries `status` (`active`/`archived`) and `deleted_at` for exactly this purpose, and RLS already permits a self-owned `UPDATE`, but no API route or UI ever exercises them — `apps/web/app/api/plans/route.ts` only exports `POST` (kick off AI generation), and `apps/web/app/(athlete)/plan/page.tsx` only checks for an active plan.

This plan adds: a plan list (history) endpoint and page, a plan detail endpoint and page, and two new actions — archive (retire, stays visible in history) and delete (soft-remove, drops out of the list). It does **not** add field-level plan editing — plans remain create-only generation artifacts by design; only their lifecycle state changes.

---

## Problem Frame

- Users cannot see plans other than the current active one — no history, no way to review what changed between plans.
- Users cannot get rid of a plan they don't want (e.g. a bad AI generation, or a plan for an event that's been cancelled) without deleting their whole account.
- The schema and RLS were built to support this (`status`, `deleted_at`, `plans_self_update` policy) but the capability was never wired into the API or UI — a genuine, closeable gap rather than a deliberate omission.

---

## Requirements

- **R1.** An athlete can list their own plans (active + archived, excluding soft-deleted), most recent first.
- **R2.** An athlete can view a single plan's detail (metadata: status, event type, event date, source, created date) without it needing to be the active plan.
- **R3.** An athlete can archive an active or archived plan they own; archiving is idempotent and does not affect other plans.
- **R4.** An athlete can soft-delete (remove from history) a plan they own; deletion is idempotent.
- **R5.** Resurrection (`archived` → `active` via this surface, or un-deleting) is not possible through these routes — status transitions only move forward.
- **R6.** All new routes enforce ownership; a request for another athlete's plan returns a not-found response rather than leaking existence (matches the `not_found_or_forbidden` convention already used by the MCP tool surface in `apps/web/src/mcp/tools.ts`).
- **R7.** Plan-level field editing (title, dates, generation params) remains out of scope — this plan only changes lifecycle state (`status`, `deleted_at`).
- **R8.** Deleting or archiving the athlete's current active plan is allowed and simply leaves them with no active plan (same state as before ever generating one) — no special blocking logic required, since `plans_one_active_per_athlete` is a partial index that already treats archived/deleted rows as non-blocking (see `docs/solutions/partial-unique-with-soft-delete.md`).
- **R9.** Archiving or deleting a plan also retires its not-yet-done (`status = 'planned'`) `planned_workouts` rows, so the calendar and adaptive engine don't keep surfacing a dead plan's schedule. Completed/skipped workouts and superseded `'moved'` rows are history and stay untouched.

---

## Key Technical Decisions

**KTD1 — Admin client + explicit ownership filter, not RLS-scoped client.**
`apps/web/app/(athlete)/plan/page.tsx` happens to use an RLS-scoped `createClient()` for its Server Component read, but the majority of this app's API routes (`weekly-review`, `coach/links/[id]/archive`) use `createAdminClient()` with an explicit `.eq("athlete_id", user.id)` filter, because API routes must serve both cookie (web) and Bearer (mobile) auth via `resolveAuth`. New routes follow the majority convention for consistency and to avoid a second auth-to-RLS-context translation path. The admin client bypasses RLS entirely on this path — RLS is not a backstop here — so correctness rests solely on every query in `db/plans.ts` (reads and writes alike) carrying the explicit `athlete_id` filter, verified by U1's ownership test scenarios.

**KTD6 — Archive and delete both retire the plan's not-yet-done `planned_workouts`.**
Migration `0024`'s `create_ai_plan` RPC already establishes this precedent: when it archives the previous active plan, it soft-deletes that plan's `status = 'planned'` `planned_workouts` rows in the same statement, because "Calendar reads, the adaptive context, and the detectors all scope by athlete_id + deleted_at (never plan status), so leaving these live would double-book the calendar with a dead plan." `archivePlan` and `softDeletePlan` (U1) both follow this precedent — archiving already implies workout cleanup today, and delete must too, since delete can be called directly on an active plan without an archive step first.

**KTD2 — Archive and delete are separate actions on separate endpoints.**
Archive (`PATCH /api/plans/[id]/archive`) retires a plan but keeps it visible in history; delete (`DELETE /api/plans/[id]`) soft-removes it from the list entirely via `deleted_at`. Collapsing these into one "remove" action would lose the distinction the schema already draws between `status='archived'` (still browsable) and `deleted_at` (hidden). This mirrors the existing `coach/links/[id]/archive` route shape in this codebase.

**KTD3 — Both actions are idempotent, not error-on-repeat.**
Calling archive on an already-archived plan, or delete on an already-deleted plan, returns success (200/204) rather than a conflict — matching typical REST DELETE idempotency and avoiding UI special-casing for double-clicks or stale tabs. The only hard error is ownership mismatch (404) or acting on a plan that no longer exists.

**KTD4 — New `/plans` route for history, not folded into `/plan`.**
`/plan` stays the single-purpose "your current plan / weekly review" page. `/plans` (new) is the history browser (list + detail), following the same list/detail routing shape used elsewhere in the app rather than overloading one page with two concerns.

**KTD5 — New `db/plans.ts` data-access module.**
Unlike `weekly-reviews` and `workouts`, there is currently no `db/plans.ts` — plan queries are inline in `apps/web/app/api/plans/route.ts`. This plan introduces one (`listPlans`, `getPlan`, `archivePlan`, `softDeletePlan`) so the new list/detail/archive/delete routes share one query surface instead of four copies of the same filters.

---

## Scope Boundaries

**In scope:** list route + page, detail route + page, archive action, delete action, confirm-before-destroy UI, linking from `/plan` to `/plans`.

**Out of scope / non-goals:** editing a plan's fields (event date, event type, etc.) — plans remain generation artifacts; resurrecting an archived or deleted plan; bulk archive/delete; the MCP connector's `plans_list`/`plans_get` tools, which are intentionally read-only per `docs/brainstorms/2026-06-27-mcp-athlete-stats-connector-requirements.md` and are not touched by this plan.

### Deferred to Follow-Up Work

- Surfacing a diff or summary of what changed between two plans (would need `plan_versions` or similar — does not exist today).
- Coach-initiated archive/delete of an athlete's plan (this plan is athlete-self-service only).

---

## Implementation Units

### U1. Plan data-access module

**Goal:** Centralize plan list/get/archive/delete queries behind one module so routes stay thin and the ownership + soft-delete + resurrection-guard logic lives in one place.

**Requirements:** R1, R2, R3, R4, R5, R6, R8, R9

**Dependencies:** none

**Files:**
- `supabase/migrations/0027_plans_archive_delete_rpc.sql` (new — `archive_plan`/`soft_delete_plan` `SECURITY DEFINER` functions, per Risks & Dependencies)
- `apps/web/src/db/plans.ts` (new)
- `apps/web/src/db/__tests__/plans-lifecycle.test.ts` (new, DB-backed per existing `db/__tests__` convention — named distinctly from the existing `plans.test.ts`, which already covers the raw `plans` table schema/RLS/CHECK constraints; this file covers the `listPlans`/`getPlan`/`archivePlan`/`softDeletePlan` module and the new RPCs)

**Approach:** Export `listPlans(admin, athleteId)`, `getPlan(admin, athleteId, planId)`, `archivePlan(admin, athleteId, planId)`, `softDeletePlan(admin, athleteId, planId)`. All four take the admin Supabase client plus the resolved athlete id (never trust a client-supplied id for the `athleteId` filter). `listPlans`/`getPlan` are plain `.eq("athlete_id", athleteId)`-filtered queries (KTD1: there is no RLS backstop on this path) filtering `deleted_at IS NULL`. `archivePlan`/`softDeletePlan` each call one of the two new RPC functions (`archive_plan`, `soft_delete_plan` — see Files) via `admin.rpc(...)`, mirroring `db/create-ai-plan.ts`'s `persistGeneratedPlan`; the RPC owns the plan-row transition plus the `planned_workouts` cascade (KTD6/R9) as one atomic unit. Both TS wrappers return a discriminated result (`{ ok: true, plan }` | `{ ok: false, reason: "not_found" }`) mapping the RPC's typed JSONB outcome so routes don't re-derive the logic.

**Technical design (SQL, `SECURITY DEFINER`, mirrors `create_ai_plan`'s posture — `REVOKE FROM PUBLIC` / `GRANT EXECUTE TO service_role`):**
```
archive_plan(p_athlete_id, p_plan_id):
  row = SELECT * FROM plans WHERE id = p_plan_id AND athlete_id = p_athlete_id AND deleted_at IS NULL
  if !row: return { outcome: 'not_found' }
  if row.status = 'archived': return { outcome: 'ok', plan: row }   -- idempotent no-op
  UPDATE plans SET status = 'archived', archived_at = now()
    WHERE id = p_plan_id AND athlete_id = p_athlete_id
  UPDATE planned_workouts SET deleted_at = now()
    WHERE plan_id = p_plan_id AND athlete_id = p_athlete_id
      AND status = 'planned' AND deleted_at IS NULL
  return { outcome: 'ok', plan: <updated row> }

soft_delete_plan(p_athlete_id, p_plan_id):
  -- No deleted_at IS NULL filter on this lookup -- an already-deleted row
  -- must still resolve (as a no-op success), not collapse into the same
  -- not_found branch as "never existed" / "not yours".
  row = SELECT * FROM plans WHERE id = p_plan_id AND athlete_id = p_athlete_id
  if !row: return { outcome: 'not_found' }
  if row.deleted_at IS NOT NULL: return { outcome: 'ok', plan: row }   -- idempotent no-op
  UPDATE plans SET deleted_at = now()
    WHERE id = p_plan_id AND athlete_id = p_athlete_id
  UPDATE planned_workouts SET deleted_at = now()
    WHERE plan_id = p_plan_id AND athlete_id = p_athlete_id
      AND status = 'planned' AND deleted_at IS NULL
  return { outcome: 'ok', plan: <updated row> }
```
(Directional — exact PL/pgSQL follows `create_ai_plan`'s structure in `supabase/migrations/0024_ai_generation_and_create_plan_rpc.sql`. Both functions run as a single Postgres function body, which Postgres already executes atomically — no explicit `BEGIN`/`COMMIT` needed inside a function.)

**Patterns to follow:** `apps/web/app/api/weekly-review/route.ts` for column-constant + explicit-filter query shape; `packages/shared/src/plan.ts` `PlanRowSchema`/`PlanStatus` for typing — reuse, don't redefine.

**Test scenarios:**
- `listPlans` returns only the given athlete's plans, excludes soft-deleted, orders newest first.
- `listPlans` returns an empty array (not an error) for an athlete with no plans.
- `getPlan` returns the plan when owned and not deleted.
- `getPlan` returns `not_found` for another athlete's plan (Covers R6).
- `getPlan` returns `not_found` for a soft-deleted plan.
- `archivePlan` transitions an active plan to `archived` and sets `archived_at`.
- `archivePlan` on an already-archived plan is a no-op success, does not touch `archived_at` again (Covers R3).
- `archivePlan` on a soft-deleted plan returns `not_found` — archiving a gone plan is not resurrecting it (Covers R5).
- `softDeletePlan` sets `deleted_at` on an active or archived plan.
- `softDeletePlan` on an already-deleted plan is a no-op success (Covers R4).
- Archiving/deleting the athlete's only active plan succeeds and leaves them with zero active plans (Covers R8) — verify no unique-index violation and no special-case error.
- `archivePlan` on a plan with two `'planned'` workouts and one `'completed'` workout soft-deletes only the two planned rows; the completed row's `deleted_at` is untouched (Covers R9).
- `softDeletePlan` on an active plan (no prior archive step) also soft-deletes its `'planned'` workouts — cleanup isn't conditional on archiving having happened first (Covers R9).
- After `archivePlan` or `softDeletePlan`, a calendar-range read (mirroring `getPlannedInRange`'s `athlete_id` + `deleted_at IS NULL` filter) no longer returns the retired plan's workouts (Covers R9 — integration-level, proves the ghost-workout scenario can't occur, not just that the flag was set).

**Verification:** All scenarios above pass against local Supabase Postgres; `plans_one_active_per_athlete` partial index is never violated by any test case; no test observes a `planned_workouts` row with `deleted_at IS NULL` whose `plan_id` points at an archived or deleted plan.

---

### U2. `GET /api/plans` (list)

**Goal:** Serve the athlete's own plan list for the history view.

**Requirements:** R1, R6

**Dependencies:** U1

**Files:**
- `apps/web/app/api/plans/route.ts` (modify — add `GET` alongside existing `POST`)
- `apps/web/app/api/plans/__tests__/route.test.ts` (modify — add GET coverage)

**Approach:** `resolveAuth` → 401 on failure → `listPlans(admin, user.id)` → `{ plans: [...] }`, `200`, `export const dynamic = "force-dynamic"`. Response items serialized through `PlanRowSchema` (from `packages/shared/src/plan.ts`) so the shape matches what the detail route and any future mobile client expect.

**Patterns to follow:** `apps/web/app/api/weekly-review/route.ts` GET handler for auth + response envelope shape.

**Test scenarios:**
- Authenticated athlete with 3 plans (1 active, 2 archived) gets all 3, newest first.
- Authenticated athlete with 0 plans gets `{ plans: [] }`, `200` (not 404).
- Unauthenticated request gets `401`.
- Soft-deleted plans never appear in the response (Covers R1).
- Response items validate against `PlanRowSchema`.

**Verification:** Route test suite passes; manual check confirms another athlete's plans never leak into the response.

---

### U3. `GET /api/plans/[id]` (detail)

**Goal:** Serve a single plan's detail, owned-or-404, for the plan detail page.

**Requirements:** R2, R6

**Dependencies:** U1

**Files:**
- `apps/web/app/api/plans/[id]/route.ts` (new)
- `apps/web/app/api/plans/[id]/__tests__/route.test.ts` (new)

**Approach:** `resolveAuth` → `getPlan(admin, user.id, params.id)` → `not_found` maps to `404 { error: "not_found" }` (covers both "doesn't exist" and "exists but isn't yours" — R6). Success returns `{ plan }`, `200`.

**Patterns to follow:** `apps/web/app/api/weekly-review/[id]/route.ts` for the `{ params: Promise<{ id: string }> }` Next 15 async-params shape and 404-on-ownership-mismatch handling.

**Test scenarios:**
- Owner requests their own plan → `200` with full plan detail.
- Owner requests a nonexistent plan id → `404`.
- Athlete A requests athlete B's plan id → `404`, not `403` (Covers R6 — no existence leak).
- Owner requests a soft-deleted plan of their own → `404` (deleted means gone, not just hidden from list).
- Unauthenticated request → `401`.

**Verification:** Route test suite passes; cross-athlete access consistently returns `404`, never `403` or `200`.

---

### U4. `PATCH /api/plans/[id]/archive`

**Goal:** Let an athlete archive a plan they own.

**Requirements:** R3, R5, R6, R8, R9

**Dependencies:** U1

**Files:**
- `apps/web/app/api/plans/[id]/archive/route.ts` (new)
- `apps/web/app/api/plans/[id]/archive/__tests__/route.test.ts` (new)

**Approach:** `resolveAuth` → `archivePlan(admin, user.id, params.id)` → `not_found` → `404`; success → `200 { plan }` (echo the updated row so the client can update state without a refetch).

**Patterns to follow:** `apps/web/app/api/coach/links/[id]/archive/route.ts` for the overall control-flow shape (auth → ownership-scoped lookup → update → response) — but **not** its ownership-mismatch branch, which returns `403`. This route's ownership mismatch must fold into the same `404` as not-found, per R6's no-existence-leak requirement; `not_found` and `forbidden` are one response here, not two.

**Test scenarios:**
- Archiving the athlete's active plan → `200`, `status` becomes `archived`, `archived_at` set.
- Archiving an already-archived plan → `200`, idempotent no-op (Covers R3).
- Archiving another athlete's plan → `404` (Covers R6).
- Archiving a soft-deleted plan → `404` — cannot resurrect via archive (Covers R5).
- Archiving the athlete's only active plan succeeds; a subsequent plan generation is not blocked by the partial unique index (Covers R8).
- Archiving a plan with not-yet-done workouts removes them from a subsequent calendar-range read (Covers R9).
- Unauthenticated request → `401`.

**Verification:** Route test suite passes; `plans_one_active_per_athlete` index never raises `23505` across the test suite.

---

### U5. `DELETE /api/plans/[id]`

**Goal:** Let an athlete soft-delete a plan they own, removing it from history.

**Requirements:** R4, R5, R6, R8, R9

**Dependencies:** U1, U3

**Files:**
- `apps/web/app/api/plans/[id]/route.ts` (modify — add `DELETE` alongside `GET` from U3)
- `apps/web/app/api/plans/[id]/__tests__/route.test.ts` (modify — add DELETE coverage)

**Approach:** `resolveAuth` → `softDeletePlan(admin, user.id, params.id)` → `not_found` → `404`; success → `204 No Content` (matches `coach/links/[id]/archive` convention for state-change-only responses). Idempotent: deleting an already-deleted plan also returns `204`, not `404` — from the client's perspective the desired end state ("this plan is gone") already holds.

**Test scenarios:**
- Deleting an owned active or archived plan → `204`, `deleted_at` set.
- Deleting an already-deleted plan → `204` again, no error (Covers R4).
- Deleting another athlete's plan → `404` (Covers R6).
- Deleting the athlete's only active plan succeeds; `GET /api/plans` and `/plan` both reflect "no active plan" afterward (Covers R8).
- Deleting a plan with not-yet-done workouts removes them from a subsequent calendar-range read (Covers R9).
- Unauthenticated request → `401`.

**Verification:** Route test suite passes; deleted plans are unreachable via `GET /api/plans` and `GET /api/plans/[id]` (both already covered by U2/U3 tests, cross-referenced here).

---

### U6. Plan history + detail pages, and archive/delete UI

**Goal:** Give athletes a page to browse past plans and a way to archive/delete one, with a link out from the existing `/plan` page.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U2, U3, U4, U5

**Files:**
- `apps/web/app/(athlete)/plans/page.tsx` (new — list/history page)
- `apps/web/app/(athlete)/plans/[id]/page.tsx` (new — detail page)
- `apps/web/app/(athlete)/plans/__tests__/page.test.tsx` (new)
- `apps/web/app/(athlete)/plans/[id]/__tests__/page.test.tsx` (new)
- `apps/web/src/plan/PlanHistoryList.tsx` (new — client component, list rendering)
- `apps/web/src/plan/PlanActions.tsx` (new — client component, archive/delete buttons with confirm step)
- `apps/web/app/(athlete)/plan/page.tsx` (modify — add a link to `/plans`)
- `apps/web/app/(athlete)/plan/__tests__/page.test.tsx` (modify — cover the new link)

**Approach:** `apps/web/app/(athlete)/plans/page.tsx` is a Server Component that does the initial fetch (mirrors `apps/web/app/(athlete)/plan/page.tsx`'s existing shape) and renders `PlanHistoryList`, a client component showing each plan's status, event type/date, and created date, each linking to `/plans/[id]`. The detail page fetches one plan and renders `PlanActions` — archive/delete buttons using the two-step inline confirm pattern from `apps/web/src/components/coach-disconnect.tsx` (neutral button → confirming state with warning copy + `useTransition` for pending state), not a modal. `PlanActions` renders per plan status: an `'active'` plan shows both Archive and Delete; an `'archived'` plan shows only Delete (Archive is a no-op from here, so the control is hidden rather than shown disabled). Confirm copy warns explicitly when the plan being archived/deleted is the athlete's current active plan ("This is your current plan — archiving it will leave you without an active plan until you generate a new one.") and, when the plan has upcoming scheduled workouts, that those will also be removed from the calendar (Covers R9). If the archive/delete `fetch` call fails, `PlanActions` returns to the confirming state with an inline error message and the action remains retryable — it does not silently drop back to the neutral button. Both actions call the U4/U5 routes via plain `fetch` (no React Query/SWR anywhere in this repo — stay consistent) and route back to `/plans` on success.

**Patterns to follow:** `apps/web/app/(athlete)/plan/page.tsx` for Server Component + client-component handoff; `apps/web/src/components/coach-disconnect.tsx` for the confirm-before-destroy interaction; `apps/web/src/adaptive/ProposalReview.tsx`'s injectable API-interface test seam (mirror as a `PlanApi` interface) for testability without mocking `fetch` directly.

**Test scenarios:**
- List page renders all plans returned by the API, each with a status badge (active/archived).
- List page shows an empty state when the athlete has no plans yet, with a call-to-action back to plan generation.
- Detail page renders plan metadata for an owned plan.
- Detail page shows a not-found state when the API returns 404 (deleted or not owned).
- Clicking "Archive" shows the inline confirm step before calling the archive endpoint; confirming calls it and navigates back to `/plans` with the plan now showing `archived`.
- Clicking "Delete" shows the inline confirm step with delete-specific warning copy; confirming calls the delete endpoint and the plan no longer appears in `/plans`.
- Canceling either confirm step makes no network call and returns to the neutral button state.
- Archiving/deleting the current active plan shows the "you'll be left without an active plan" warning in the confirm copy (Covers R8).
- Archiving/deleting a plan with upcoming scheduled workouts shows the calendar-impact warning in the confirm copy (Covers R9).
- An `'archived'` plan's detail view shows only the Delete action, not Archive.
- A failed archive/delete `fetch` leaves the confirm step visible with an inline error and a retry path, rather than silently reverting to the neutral button or navigating away.
- `/plan` page shows a link to `/plans` regardless of whether the athlete currently has an active plan.

**Verification:** Component tests pass; manual walkthrough in the dev server confirms list → detail → archive → back-to-list and list → detail → delete → back-to-list, both reflecting the new state without a full page reload being required to see correct data (a fresh Server Component fetch on navigation is sufficient — no client-side cache invalidation needed given the no-React-Query convention).

---

## Risks & Dependencies

- **Deleting/archiving the current active plan** leaves the athlete in the pre-generation empty state. This is intentional (R8) but the confirm-step copy must make it explicit, or it will feel like accidental data loss — this is the main UX risk this plan introduces and is addressed directly in U6's test scenarios.
- **`archived_at` vs `deleted_at` both being timestamps on the same row** means a plan can be archived-then-deleted (both timestamps set) — `getPlan`/`listPlans` filtering on `deleted_at IS NULL` already handles this correctly (a deleted plan disappears regardless of its archive state), but it's worth the implementer double-checking U1's tests exercise this combined state, not just each flag independently.
- **The plan-row update and the `planned_workouts` cleanup (KTD6/R9) must land in one transaction**, not two sequential admin-client calls — a crash between them would leave a plan archived/deleted with its workouts still live on the calendar, reintroducing the exact ghost-workout failure R9 exists to prevent. The Supabase REST client has no ad hoc multi-statement transaction primitive, so — unlike `status`/`archived_at`/`deleted_at` themselves, which need no schema change — **this plan does require one small migration**: two `SECURITY DEFINER` RPC functions (`archive_plan`, `soft_delete_plan`), following migration `0024`'s `create_ai_plan` posture (`REVOKE FROM PUBLIC` / `GRANT EXECUTE TO service_role`, explicit `athlete_id` param never trusted from row state alone). `db/plans.ts`'s `archivePlan`/`softDeletePlan` call these via `admin.rpc(...)`, mirroring `db/create-ai-plan.ts`'s `persistGeneratedPlan`.

---

## Sources & Research

- `supabase/migrations/0007_plans_and_planned_workouts.sql` — `plans` schema, RLS policies, `plans_one_active_per_athlete` partial unique index.
- `docs/solutions/partial-unique-with-soft-delete.md` — governs U1's archive/delete semantics and the R8 no-special-case guarantee.
- `supabase/migrations/0024_ai_generation_and_create_plan_rpc.sql` — `create_ai_plan` RPC; precedent for KTD6/R9's plan-archive-cascades-to-planned_workouts behavior and the single-transaction requirement in Risks & Dependencies.
- `apps/web/app/api/weekly-review/route.ts`, `apps/web/app/api/weekly-review/[id]/route.ts` — GET list/detail route conventions.
- `apps/web/app/api/coach/links/[id]/archive/route.ts` — PATCH archive-action route convention (KTD2, U4).
- `apps/web/src/components/coach-disconnect.tsx` — confirm-before-destroy UI pattern (U6).
- `apps/web/src/adaptive/ProposalReview.tsx` — injectable API-interface test seam pattern (U6).
- `packages/shared/src/plan.ts` — existing `PlanRowSchema`/`PlanStatus`, reused rather than duplicated.
- `apps/web/src/mcp/tools.ts` — `not_found_or_forbidden` convention informing R6/KTD1.
