import "server-only";

// Batched summaries for the Reports list (review fix #13).
//
// THE PROBLEM THIS REPLACES. The list previously called assemblePeriodReview
// once per listed period. That function is built for ONE period rendered in
// full, so it issues ~8 athlete-scoped queries: the period's completed
// workouts, the prescribed set, the prior period, a prior-history probe, the
// plan, the profile, and up to two workout_matches lookups. Fourteen listed
// periods therefore cost ~114 round trips on every uncached page load, and one
// period's "previous" read redid a query another row in the same list had just
// run as its own "current".
//
// THE SHAPE THAT FIXES IT. A list row needs far less than a rendered review:
// sessions, duration, load, and whether prose exists. So this module fetches
// each underlying table ONCE over the union of every listed period's range and
// slices it in memory — three queries total, independent of how many periods
// are listed.
//
// WHAT IS DELIBERATELY DROPPED, and why it is safe:
//   - the prior period and the history probe: a summary shows no
//     period-over-period comparison, so `previous: null` costs nothing. The
//     DETAIL view still assembles fully and still shows comparisons.
//   - the plan and profile: they feed narration and the fingerprint, neither of
//     which a list row carries.
// If a list row ever needs a comparison, batch the prior periods into the same
// union range rather than reintroducing the per-period call.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodFacts, PeriodKind, PeriodReviewSummary } from "@da2/shared";

import { pickBestMatch } from "@/ai/reports/context";

import { aggregatePeriod, type AggregateCompletedWorkout } from "./aggregate";
import { periodBounds, periodRangeUtc } from "./calendar";

export interface ListedPeriod {
  kind: PeriodKind;
  key: string;
}

interface RawCompletedRow {
  id: string;
  sport: string;
  started_at: string;
  distance_m: number | null;
  duration_s: number | null;
  summary_stats: Record<string, unknown> | null;
}

interface RawPlannedRow {
  id: string;
  sport: string;
  scheduled_date: string;
  planned_load: number | null;
  structure: Record<string, unknown> | null;
}

interface RawMatchRow {
  id: string;
  completed_workout_id: string;
  planned_workout_id: string;
  confidence: number;
  method: string;
  matched_at: string;
}

/** The widest UTC instant range and local date range covering every listed
 * period, so one query per table can serve them all. */
function unionRange(periods: ListedPeriod[], timezone: string) {
  let startUtc = Number.POSITIVE_INFINITY;
  let endUtc = Number.NEGATIVE_INFINITY;
  let startDay = "9999-12-31";
  let endDay = "0000-01-01";

  for (const p of periods) {
    const range = periodRangeUtc(p.kind, p.key, timezone);
    startUtc = Math.min(startUtc, range.startUtc.getTime());
    endUtc = Math.max(endUtc, range.endUtc.getTime());

    const bounds = periodBounds(p.kind, p.key);
    if (bounds.start < startDay) startDay = bounds.start;
    if (bounds.end > endDay) endDay = bounds.end;
  }

  return {
    startUtc: new Date(startUtc),
    endUtc: new Date(endUtc),
    startDay,
    endDay,
  };
}

export interface ListPeriodSummariesArgs {
  supabase: SupabaseClient;
  /** MUST be an authenticated caller id, never client-supplied. */
  athleteId: string;
  timezone: string;
  periods: ListedPeriod[];
  /** `${kind}:${periodKey}` for every period that already has stored prose. */
  narrated: ReadonlySet<string>;
}

/**
 * Summaries for every listed period, in the order given.
 *
 * Three queries total regardless of how many periods are listed. Throws on a
 * failed read of completed or planned workouts, for the same reason
 * gatherPeriodContext does: degrading either would put a fabricated number
 * (an empty week, or "0 prescribed") in front of the athlete rather than a
 * missing one.
 */
export async function listPeriodSummaries(
  args: ListPeriodSummariesArgs,
): Promise<PeriodReviewSummary[]> {
  const { supabase, athleteId, timezone, periods, narrated } = args;
  if (periods.length === 0) return [];

  const range = unionRange(periods, timezone);

  // 1 + 2. The two athlete-scoped table reads, over the union range.
  // service-role: explicit user filter required
  const [completedRes, plannedRes] = await Promise.all([
    supabase
      .from("completed_workouts")
      .select("id, sport, started_at, distance_m, duration_s, summary_stats")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .gte("started_at", range.startUtc.toISOString())
      .lt("started_at", range.endUtc.toISOString())
      .order("id", { ascending: true }),
    // service-role: explicit user filter required
    supabase
      .from("planned_workouts")
      .select("id, sport, scheduled_date, planned_load, structure")
      .eq("athlete_id", athleteId)
      .is("deleted_at", null)
      .gte("scheduled_date", range.startDay)
      .lte("scheduled_date", range.endDay)
      .order("id", { ascending: true }),
  ]);

  if (completedRes.error) {
    throw new Error(`listPeriodSummaries: completed_workouts read failed: ${completedRes.error.message}`);
  }
  if (plannedRes.error) {
    throw new Error(`listPeriodSummaries: planned_workouts read failed: ${plannedRes.error.message}`);
  }

  const completedRows = (completedRes.data ?? []) as RawCompletedRow[];
  const plannedRows = (plannedRes.data ?? []) as RawPlannedRow[];

  // 3. Matches for the whole window at once. Degrades to unplanned on error,
  // which understates compliance rather than inventing it — the same posture
  // gatherPeriodContext takes.
  const matches = new Map<string, string>();
  if (completedRows.length > 0) {
    const { data, error } = await supabase
      .from("workout_matches")
      .select("id, completed_workout_id, planned_workout_id, confidence, method, matched_at")
      .in(
        "completed_workout_id",
        completedRows.map((r) => r.id),
      )
      .is("deleted_at", null);

    if (!error && data) {
      const grouped = new Map<string, RawMatchRow[]>();
      for (const row of data as RawMatchRow[]) {
        const bucket = grouped.get(row.completed_workout_id);
        if (bucket) bucket.push(row);
        else grouped.set(row.completed_workout_id, [row]);
      }
      for (const [completedId, rows] of grouped) {
        const best = pickBestMatch(rows as unknown as Parameters<typeof pickBestMatch>[0]);
        if (best) matches.set(completedId, best.planned_workout_id);
      }
    }
  }

  const completed: AggregateCompletedWorkout[] = completedRows.map((r) => ({
    id: r.id,
    sport: r.sport,
    started_at: r.started_at,
    duration_s: r.duration_s,
    distance_m: r.distance_m,
    summary_stats: r.summary_stats ?? {},
    matched_planned_workout_id: matches.get(r.id) ?? null,
  }));

  // Slice per period in memory. `startedAtMs` is precomputed once rather than
  // re-parsed inside every period's filter.
  const withTime = completed.map((w) => ({ w, at: new Date(w.started_at).getTime() }));

  return periods.map(({ kind, key }): PeriodReviewSummary => {
    const bounds = periodBounds(kind, key);
    const { startUtc, endUtc } = periodRangeUtc(kind, key, timezone);
    const from = startUtc.getTime();
    const to = endUtc.getTime();

    const periodCompleted = withTime.filter((x) => x.at >= from && x.at < to).map((x) => x.w);
    const periodPlanned = plannedRows
      .filter((p) => p.scheduled_date >= bounds.start && p.scheduled_date <= bounds.end)
      .map((p) => ({
        id: p.id,
        sport: p.sport,
        scheduled_date: p.scheduled_date,
        planned_load: p.planned_load,
        structure: p.structure,
      }));

    const facts: PeriodFacts = aggregatePeriod({
      kind,
      periodKey: key,
      bounds,
      timezone,
      completed: periodCompleted,
      planned: periodPlanned,
      // A summary shows no comparison, so there is nothing to compare against
      // and nothing to fetch. See the module header.
      previous: null,
    });

    return {
      kind,
      periodKey: key,
      bounds: facts.bounds,
      sessions: facts.totals.sessions,
      durationS: facts.totals.durationS,
      load: facts.totals.load,
      hasNarration: narrated.has(`${kind}:${key}`),
    };
  });
}
