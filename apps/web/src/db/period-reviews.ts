import "server-only";

// The single write path for `period_reviews`.
//
// WHY THIS EXISTS AT ALL — the 42P10 trap. `period_reviews_identity_unique`
// (migration 0029) is a PARTIAL unique index (`WHERE deleted_at IS NULL`), and
// supabase-js `.upsert(..., { onConflict })` cannot target a partial index:
// PostgREST emits `ON CONFLICT (cols)` with no predicate, and Postgres refuses
// to infer a partial index from it, raising
//
//   42P10: there is no unique or exclusion constraint matching the
//          ON CONFLICT specification
//
// at RUNTIME — not at build, not in a mocked test. The repo already documents
// this rule at apps/web/src/db/completed-workouts.ts:23 and pins it with a
// real-Postgres test. `workout_reports` (0028) gets away with `.upsert()` only
// because its unique index is PLAIN; copying that call shape onto a partial
// index is precisely the mistake this module exists to make unrepeatable.
//
// Both writers — the on-demand API route and the scheduled delivery worker —
// go through here, so the two can never drift, and there is exactly one place
// to correct if the index predicate ever changes.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodKind } from "@da2/shared";

export interface PersistPeriodReviewRow {
  athlete_id: string;
  kind: PeriodKind;
  period_key: string;
  period_start: string;
  period_end: string;
  narrative: string;
  takeaway: string;
  input_fingerprint: string;
  model: string | null;
  generated_at: string;
}

/**
 * INSERT a period review; on 23505 (the partial unique index rejecting a live
 * duplicate) fall through to UPDATE.
 *
 * Concurrency: two simultaneous generations for the same period both attempt
 * the INSERT, Postgres serializes them, the loser gets 23505 and updates the
 * winner's row. Exactly one live row survives either way — the same guarantee
 * the (unusable) upsert was reaching for.
 *
 * The UPDATE is filtered on `deleted_at IS NULL` to match the index predicate:
 * without it, a regeneration could resurrect prose into a tombstoned row that
 * every read filters out, and the athlete would see generation "succeed" while
 * nothing ever appeared.
 *
 * Throws on any other error — a failed persist must not be mistaken for a
 * successful one by either caller.
 */
export async function persistPeriodReview(
  admin: SupabaseClient,
  row: PersistPeriodReviewRow,
): Promise<void> {
  // service-role: explicit user filter required
  const { error: insertErr } = await admin.from("period_reviews").insert(row);

  if (!insertErr) return;

  if ((insertErr as { code?: string }).code !== "23505") {
    throw new Error(`persistPeriodReview insert failed: ${insertErr.message}`);
  }

  // 23505: a live review already exists for this identity — update it.
  // service-role: explicit user filter required
  const { data: updated, error: updateErr } = await admin
    .from("period_reviews")
    .update({
      period_start: row.period_start,
      period_end: row.period_end,
      narrative: row.narrative,
      takeaway: row.takeaway,
      input_fingerprint: row.input_fingerprint,
      model: row.model,
      generated_at: row.generated_at,
    })
    .eq("athlete_id", row.athlete_id)
    .eq("kind", row.kind)
    .eq("period_key", row.period_key)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (updateErr) {
    throw new Error(`persistPeriodReview update fallback failed: ${updateErr.message}`);
  }
  if (!updated) {
    // The INSERT hit 23505 but the UPDATE matched nothing. That means the
    // conflicting row was soft-deleted between the two statements, so neither
    // statement landed. Surface it rather than reporting a phantom success.
    throw new Error(
      "persistPeriodReview: insert conflicted but no live row matched the update",
    );
  }
}
