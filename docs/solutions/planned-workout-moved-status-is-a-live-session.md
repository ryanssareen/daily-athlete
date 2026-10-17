---
title: A planned workout with status 'moved' is the live session at its new date, not a leftover pointer
date: 2026-10-17
status: active
---

# A planned workout with status `moved` is the live session at its new date

## Problem

Comments in the codebase describe `moved` rows as "superseded pointers" kept as history. A plan built on that reading excluded `moved` rows from the Plan tab's outline, compliance and forecast, which would have made every rescheduled session disappear. Document review caught it before any code shipped.

## What the code actually does

- The athlete status route updates the same row in place: `status` becomes `moved` and `scheduled_date` becomes the new date. No replacement row is created (`apps/web/app/api/workouts/[id]/status/route.ts`, `_markMoved`).
- The MCP move tool also updates `scheduled_date` on the same row (`workouts_planned_move` in `apps/web/src/mcp/tools.ts`), but leaves `status` untouched. So a moved session can be `planned` (moved through MCP) or `moved` (moved through the status route), and both are live.
- The header comment of the status route says `skipped`/`moved` "updates planned_workouts.status only", which is also stale: the move path writes the date too.
- The comment in `supabase/migrations/0027_plans_archive_delete_rpc.sql` calling `moved` rows "superseded pointers, also history" is the misleading source.

## Rule

Treat `planned` and `moved` as the same thing for scheduling, display, compliance and load: a session that still needs doing at its stored `scheduled_date`. Only `skipped` is excluded from the denominator, and `completed` is done. `apps/web/src/plan/plan-view.ts` counts `planned`, `moved` and `completed`.

## Known consequence, not yet fixed

The archive RPC in `0027_plans_archive_delete_rpc.sql` soft-deletes only rows with `status = 'planned'`. Because `moved` rows are live sessions, archiving or deleting a plan leaves its `moved` workouts un-deleted. Whether they then surface on the calendar was not verified. Check this before relying on archive to clear a plan's schedule.

## Prevention

- Before excluding or special-casing a status, find the code that writes it and confirm what happens to the row. A comment describing intent is not evidence.
- When writing a test for week compliance or load, include a `moved` row dated inside the week and assert it counts there (covered for the Plan tab in `apps/web/src/plan/__tests__/plan-results.test.ts`).
- If `moved` is ever meant to be a pointer, it needs a replacement row and an explicit link; today there is neither.

## Earlier context (session history)

- The 2026-10-14 Plan tab rebuild had already treated `moved` as a visible session status next to Done and Skipped: the mobile detail screen listed each workout with its Done/Skipped/Moved label, and the web `summarizePlan` in `apps/web/src/plan/plan-summary.ts` counts every returned row as a session regardless of status. Nothing in that work contradicted the live-session reading; the wrong assumption first appeared in the 2026-10-16 plan, from the migration comment.
- That same rebuild was prompted by the complaint that the Plan tab "shows nothing", which is documented in `docs/solutions/screens-show-content-not-row-metadata.md`. The story, outline and forecast work this learning came out of is the follow-up to it.
- Searched the last 14 days of this repo's sessions for `moved`, `planned_workouts` and `PlanOverview`. The other matches (August planned-workout detail rendering, unrelated "moved" in the sense of relocated code) added nothing about the status.

## Related

- Plan: `docs/plans/2026-10-16-001-feat-plan-tab-story-results-forecast-plan.md` (KTD4 states the corrected rule).
- Shipped in PR #119 (merged).
- `docs/solutions/partial-unique-with-soft-delete.md` for the soft-delete conventions the archive RPC relies on.
