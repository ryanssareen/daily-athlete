// Tables permitted in the supabase_realtime publication. The single
// source of truth for the CI guard at:
//   apps/web/src/db/__tests__/realtime-publication.test.ts
//
// To add a table to realtime:
//   1. Add `ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>;`
//      to the migration that introduces the change.
//   2. Add the table name to REALTIME_ALLOWLIST below IN THE SAME PR.
//   3. CI verifies publication membership matches this list; drift fails
//      the realtime-publication test with an actionable diff.
//
// Sensitive surfaces (PII, encrypted material, subscription state, raw
// payloads) MUST stay off this list. The per-table rationale belongs in
// the migration's comment, not here -- this file is just the allow-list.
//
// See AGENTS.md "RLS posture" for the broader rule.

// `readonly string[]` rather than `as const satisfies` so consumers get
// a working string-typed array even when the list grows. Narrowing to
// literal table names is a future enhancement; the CI guard's diff-driven
// failure message is the primary contract here.
//
// Members must stay alphabetised so diffs are minimal when entries are
// added or removed.
export const REALTIME_ALLOWLIST: readonly string[] = [
  // Added in migration 0007_plans_and_planned_workouts.sql -- calendar UI
  // subscribes to both tables for live updates.
  "planned_workouts",
  "plans",
];
