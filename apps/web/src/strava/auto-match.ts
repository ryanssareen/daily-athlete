import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface MatchParams {
  athleteId: string;
  completedWorkoutId: string;
  sport: string;
  // ISO datetime from Strava start_date (UTC). start_date_local is not
  // present in StravaActivitySchema, so UTC date extraction is used here.
  // Athletes in negative-UTC timezones exercising after ~8 PM local time
  // may see their workout attributed to the next calendar day's planned
  // workout. Known limitation — deferred until start_date_local is added.
  startedAt: string;
  durationS: number | null;
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

  const dateStr = startedAt.split("T")[0];

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
