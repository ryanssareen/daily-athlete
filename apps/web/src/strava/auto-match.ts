import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { calendarDayInTimezone } from "@/lib/format";

export interface MatchParams {
  athleteId: string;
  completedWorkoutId: string;
  sport: string;
  /**
   * ISO datetime of the activity start, in UTC (Strava's `start_date`).
   *
   * The calendar day is resolved from this in the ATHLETE'S timezone, not in
   * UTC — see the note on `dateStr` below.
   */
  startedAt: string;
  durationS: number | null;
  /**
   * Optional override for the athlete's IANA timezone. Callers already holding
   * it can pass it to save a lookup; otherwise it is read from
   * `users.timezone`.
   */
  timezone?: string | null;
}

export interface MatchResult {
  matched: boolean;
  plannedWorkoutId?: string;
}

interface PlannedCandidate {
  id: string;
  sport: string;
  scheduled_date: string;
  structure: Record<string, unknown>;
  status: string;
}

interface ExistingMatch {
  id: string;
  completed_workout_id: string;
}

function getTargetDuration(structure: Record<string, unknown>): number | null {
  const v = structure.duration_s;
  if (v == null || typeof v !== "number" || !isFinite(v) || v <= 0) return null;
  return v;
}

/**
 * The athlete's IANA timezone, for resolving which calendar day an activity
 * belongs to. Best-effort: any failure degrades to UTC (the previous
 * behaviour) rather than aborting the match, because a mis-dated match is
 * recoverable and a thrown ingest is not.
 *
 * `users.timezone` is NOT NULL DEFAULT 'UTC' (migration 0001), so this is
 * normally a single cheap read that always resolves.
 */
async function resolveAthleteTimezone(
  admin: SupabaseClient,
  athleteId: string
): Promise<string> {
  // service-role: explicit user filter required
  const { data, error } = await admin
    .from("users")
    .select("timezone")
    .eq("id", athleteId)
    .maybeSingle();

  if (error || !data?.timezone) return "UTC";
  return data.timezone as string;
}

/**
 * Try to match a Strava completed_workout against a planned_workout for the
 * same athlete, sport, and calendar date (R10–R13).
 *
 * On a match, inserts a workout_matches row and updates planned_workouts.status
 * to 'completed'. If a manual completion already exists, calls the
 * supersede_manual_match RPC to atomically supersede it (R14–R16).
 *
 * Safe to call concurrently for the same activity: an idempotency guard
 * returns immediately when the match already exists, and a 23505 on
 * workout_matches INSERT is treated as success.
 *
 * // service-role: explicit user filter required
 */
export async function matchStravaToPlanned(
  admin: SupabaseClient,
  params: MatchParams
): Promise<MatchResult> {
  const { athleteId, completedWorkoutId, sport, startedAt, durationS } = params;

  // THE CALENDAR DAY MUST BE THE ATHLETE'S, NOT UTC.
  //
  // `planned_workouts.scheduled_date` is a bare DATE — it means "the day the
  // athlete was meant to do this", in their own local calendar. Deriving the
  // completed workout's day with `startedAt.split("T")[0]` compared that
  // against a UTC day instead, and the two disagree for anyone training near
  // either end of their local day: at UTC+5:30 every session started before
  // 05:30 local was filed under the PREVIOUS day; at negative offsets a
  // late-evening session lands on the NEXT one. Either way the candidate query
  // returns nothing and the workout stays unmatched forever — silently, since
  // "no planned workout that day" is indistinguishable from "athlete had
  // nothing scheduled".
  //
  // Not theoretical: measured on production, 10 of one athlete's 102 workouts
  // fell on a different UTC day than their real IST training day, including a
  // ride that had a planned bike waiting on exactly the day it was ridden.
  const timezone = params.timezone ?? (await resolveAthleteTimezone(admin, athleteId));
  const dateStr = calendarDayInTimezone(startedAt, timezone);

  // Steps 1–4: find candidates matching athlete + sport + date
  // service-role: explicit user filter required
  const { data: rawCandidates, error: queryErr } = await admin
    .from("planned_workouts")
    .select("id, sport, scheduled_date, structure, status")
    .eq("athlete_id", athleteId)
    .eq("sport", sport)
    .eq("scheduled_date", dateStr)
    .in("status", ["planned", "completed"])
    .is("deleted_at", null);

  if (queryErr) {
    throw new Error(`matchStravaToPlanned query failed: ${queryErr.message}`);
  }
  if (!rawCandidates || rawCandidates.length === 0) return { matched: false };

  // Duration guard (R10): discard candidates where the Strava duration
  // differs by more than 50% from structure.duration_s. Guard is a no-op
  // when durationS is null or when the candidate has no valid duration target.
  const candidates = (rawCandidates as PlannedCandidate[]).filter((c) => {
    const target = getTargetDuration(c.structure);
    if (durationS === null || target === null) return true;
    return Math.abs(durationS - target) / target <= 0.5;
  });

  if (candidates.length === 0) return { matched: false };

  // Tie-break (R13): closest duration diff first, then earliest scheduled_date
  candidates.sort((a, b) => {
    if (durationS !== null) {
      const targetA = getTargetDuration(a.structure);
      const targetB = getTargetDuration(b.structure);
      if (targetA !== null && targetB !== null) {
        const diff = Math.abs(durationS - targetA) - Math.abs(durationS - targetB);
        if (diff !== 0) return diff;
      } else if (targetA !== null) {
        return -1;
      } else if (targetB !== null) {
        return 1;
      }
    }
    return a.scheduled_date.localeCompare(b.scheduled_date);
  });

  const now = new Date().toISOString();

  for (const candidate of candidates) {
    // Step 6: check for existing active match
    // service-role: explicit user filter required
    const { data: existingMatch, error: matchQueryErr } = await admin
      .from("workout_matches")
      .select("id, completed_workout_id")
      .eq("planned_workout_id", candidate.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (matchQueryErr) {
      throw new Error(`matchStravaToPlanned match query failed: ${matchQueryErr.message}`);
    }

    // Step 7: idempotency guard — this completedWorkoutId is already the match
    if ((existingMatch as ExistingMatch | null)?.completed_workout_id === completedWorkoutId) {
      return { matched: true, plannedWorkoutId: candidate.id };
    }

    if (!existingMatch) {
      // Step 9: direct match path
      // service-role: explicit user filter required
      const { error: insertMatchErr } = await admin
        .from("workout_matches")
        .insert({
          planned_workout_id: candidate.id,
          completed_workout_id: completedWorkoutId,
          method: "auto_same_day_sport",
          confidence: 0.9,
          matched_at: now,
        });

      if (insertMatchErr) {
        if ((insertMatchErr as { code?: string }).code === "23505") {
          // Race with a concurrent call — treat as idempotent success
          return { matched: true, plannedWorkoutId: candidate.id };
        }
        throw new Error(`workout_matches insert failed: ${insertMatchErr.message}`);
      }

      // service-role: explicit user filter required
      await admin
        .from("planned_workouts")
        .update({ status: "completed", edited_at: now })
        .eq("id", candidate.id);

      return { matched: true, plannedWorkoutId: candidate.id };
    }

    // Existing match — check its source before deciding whether to supersede
    // service-role: explicit user filter required
    const { data: existingCW, error: cwQueryErr } = await admin
      .from("completed_workouts")
      .select("source")
      .eq("id", (existingMatch as ExistingMatch).completed_workout_id)
      .maybeSingle();

    if (cwQueryErr) {
      throw new Error(`matchStravaToPlanned CW source query failed: ${cwQueryErr.message}`);
    }

    // Step 8: source check — never supersede a Strava match with another Strava match
    if (existingCW?.source === "strava") {
      continue; // try next candidate
    }

    // Step 10: supersession path — existing match is source='manual'; Strava wins (R14–R16)
    // service-role: explicit user filter required
    const { error: rpcErr } = await admin.rpc("supersede_manual_match", {
      p_planned_workout_id: candidate.id,
      p_old_match_id: (existingMatch as ExistingMatch).id,
      p_manual_completed_workout_id: (existingMatch as ExistingMatch).completed_workout_id,
      p_strava_completed_workout_id: completedWorkoutId,
      p_athlete_id: athleteId,
    });

    if (rpcErr) {
      throw new Error(`supersede_manual_match RPC failed: ${rpcErr.message}`);
    }

    return { matched: true, plannedWorkoutId: candidate.id };
  }

  return { matched: false };
}
