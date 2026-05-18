// DB integration tests for matchStravaToPlanned (src/strava/auto-match.ts)
// and the updated insertOrUpdateStravaCompletedWorkout return value.
//
// Requires a running local Supabase stack (`supabase start`).
// Run: pnpm vitest run src/strava/__tests__/auto-match.test.ts

import { describe, expect, it } from "vitest";

import { insertOrUpdateStravaCompletedWorkout } from "@/db/completed-workouts";
import { matchStravaToPlanned } from "@/strava/auto-match";

import { createTestUser, serviceClient } from "../../db/__tests__/setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertPlannedWorkout(
  athleteId: string,
  opts: {
    sport?: string;
    scheduled_date?: string;
    status?: string;
    structure?: Record<string, unknown>;
  } = {}
): Promise<string> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("planned_workouts")
    .insert({
      athlete_id: athleteId,
      sport: opts.sport ?? "run",
      scheduled_date: opts.scheduled_date ?? "2026-05-15",
      status: opts.status ?? "planned",
      structure: opts.structure ?? {},
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertPlannedWorkout failed: ${error?.message}`);
  return data.id as string;
}

async function insertStravaCompletedWorkout(
  athleteId: string,
  opts: {
    strava_activity_id?: number;
    sport?: string;
    started_at?: string;
    duration_s?: number | null;
  } = {}
): Promise<string> {
  return insertOrUpdateStravaCompletedWorkout(serviceClient(), {
    athlete_id: athleteId,
    source: "strava",
    strava_activity_id: opts.strava_activity_id ?? Math.floor(Math.random() * 1e9) + 1,
    started_at: opts.started_at ?? "2026-05-15T07:00:00Z",
    sport: opts.sport ?? "run",
    distance_m: null,
    duration_s: opts.duration_s ?? null,
    summary_stats: {},
  });
}

async function insertManualCompletedWorkout(
  athleteId: string,
  opts: { sport?: string; started_at?: string; duration_s?: number | null } = {}
): Promise<string> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("completed_workouts")
    .insert({
      athlete_id: athleteId,
      source: "manual",
      strava_activity_id: null,
      started_at: opts.started_at ?? "2026-05-15T07:00:00Z",
      sport: opts.sport ?? "run",
      duration_s: opts.duration_s ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertManualCompletedWorkout failed: ${error?.message}`);
  return data.id as string;
}

async function linkManualCompletion(
  plannedId: string,
  completedId: string
): Promise<string> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("workout_matches")
    .insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      method: "manual_user_link",
      confidence: 1.0,
      matched_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`linkManualCompletion failed: ${error?.message}`);
  // Update planned workout status to completed
  await admin
    .from("planned_workouts")
    .update({ status: "completed" })
    .eq("id", plannedId);
  return data.id as string;
}

async function getMatchForPlan(plannedId: string) {
  const admin = serviceClient();
  const { data } = await admin
    .from("workout_matches")
    .select("id, planned_workout_id, completed_workout_id, method, confidence, deleted_at")
    .eq("planned_workout_id", plannedId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

async function getPlannedStatus(plannedId: string): Promise<string | null> {
  const admin = serviceClient();
  const { data } = await admin
    .from("planned_workouts")
    .select("status")
    .eq("id", plannedId)
    .single();
  return (data as { status: string } | null)?.status ?? null;
}

// ---------------------------------------------------------------------------
// insertOrUpdateStravaCompletedWorkout return value
// ---------------------------------------------------------------------------

describe("insertOrUpdateStravaCompletedWorkout return value", () => {
  it("INSERT path returns the new row UUID", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const id = await insertOrUpdateStravaCompletedWorkout(admin, {
      athlete_id: user.id,
      source: "strava",
      strava_activity_id: 5001,
      started_at: "2026-05-15T07:00:00Z",
      sport: "run",
      distance_m: null,
      duration_s: 1800,
      summary_stats: {},
    });

    expect(typeof id).toBe("string");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("UPDATE path (23505) returns the existing row UUID", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const row = {
      athlete_id: user.id,
      source: "strava" as const,
      strava_activity_id: 5002,
      started_at: "2026-05-15T07:00:00Z",
      sport: "run",
      distance_m: null,
      duration_s: 1800,
      summary_stats: {},
    };

    const firstId = await insertOrUpdateStravaCompletedWorkout(admin, row);
    const secondId = await insertOrUpdateStravaCompletedWorkout(admin, {
      ...row,
      duration_s: 1900,
    });

    // Same row — same UUID
    expect(secondId).toBe(firstId);
  });
});

// ---------------------------------------------------------------------------
// matchStravaToPlanned
// ---------------------------------------------------------------------------

describe("matchStravaToPlanned", () => {
  it("happy path: same sport + date inserts match with auto_same_day_sport, confidence 0.9", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id);
    const cwId = await insertStravaCompletedWorkout(user.id);

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    expect(result.matched).toBe(true);
    expect(result.plannedWorkoutId).toBe(plannedId);

    const match = await getMatchForPlan(plannedId);
    expect(match).not.toBeNull();
    expect(match!.method).toBe("auto_same_day_sport");
    expect(match!.confidence).toBe(0.9);
    expect(match!.completed_workout_id).toBe(cwId);

    const status = await getPlannedStatus(plannedId);
    expect(status).toBe("completed");
  });

  it("wrong sport → returns matched=false, no match inserted", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id, { sport: "bike" });
    const cwId = await insertStravaCompletedWorkout(user.id, { sport: "run" });

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    expect(result.matched).toBe(false);
    const match = await getMatchForPlan(plannedId);
    expect(match).toBeNull();
  });

  it("wrong date → returns matched=false", async () => {
    const user = await createTestUser();
    await insertPlannedWorkout(user.id, { scheduled_date: "2026-05-14" });
    const cwId = await insertStravaCompletedWorkout(user.id);

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z", // different date
      durationS: null,
    });

    expect(result.matched).toBe(false);
  });

  it("no planned workouts at all → { matched: false }", async () => {
    const user = await createTestUser();
    const cwId = await insertStravaCompletedWorkout(user.id);

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    expect(result.matched).toBe(false);
  });

  it("duration guard: 50% difference is accepted (boundary)", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id, {
      structure: { duration_s: 3600 },
    });
    // 1800 / 3600 = 0.5 — exactly at boundary, should be accepted
    const cwId = await insertStravaCompletedWorkout(user.id, { duration_s: 1800 });

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: 1800,
    });

    expect(result.matched).toBe(true);
    expect(result.plannedWorkoutId).toBe(plannedId);
  });

  it("duration guard: >50% difference is rejected", async () => {
    const user = await createTestUser();
    await insertPlannedWorkout(user.id, { structure: { duration_s: 3600 } });
    // 1799 → diff = 1801, ratio ≈ 0.5003 > 0.5 → rejected
    const cwId = await insertStravaCompletedWorkout(user.id, { duration_s: 1799 });

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: 1799,
    });

    expect(result.matched).toBe(false);
  });

  it("duration guard: structure.duration_s absent → degrades to sport+date", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id, { structure: {} });
    const cwId = await insertStravaCompletedWorkout(user.id, { duration_s: 1800 });

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: 1800,
    });

    expect(result.matched).toBe(true);
    expect(result.plannedWorkoutId).toBe(plannedId);
  });

  it("duration guard: structure.duration_s = 0 treated as absent (no division by zero)", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id, {
      structure: { duration_s: 0 },
    });
    const cwId = await insertStravaCompletedWorkout(user.id, { duration_s: 1800 });

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: 1800,
    });

    expect(result.matched).toBe(true);
    expect(result.plannedWorkoutId).toBe(plannedId);
  });

  it("durationS null → guard is no-op, matches by sport+date", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id, {
      structure: { duration_s: 3600 },
    });
    const cwId = await insertStravaCompletedWorkout(user.id);

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    expect(result.matched).toBe(true);
    expect(result.plannedWorkoutId).toBe(plannedId);
  });

  it("multiple candidates same day → picks closest duration", async () => {
    const user = await createTestUser();
    const shortPlanId = await insertPlannedWorkout(user.id, {
      structure: { duration_s: 1800 }, // 30 min
    });
    const longPlanId = await insertPlannedWorkout(user.id, {
      structure: { duration_s: 3600 }, // 60 min
    });

    // Strava activity is 40 min — closer to the 60-min plan
    const cwId = await insertStravaCompletedWorkout(user.id, { duration_s: 2400 });

    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: 2400,
    });

    expect(result.matched).toBe(true);
    expect(result.plannedWorkoutId).toBe(longPlanId);

    // Short plan should be unmatched
    const shortMatch = await getMatchForPlan(shortPlanId);
    expect(shortMatch).toBeNull();
  });

  it("idempotency: called twice with same completedWorkoutId returns immediately on second call", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id);
    const cwId = await insertStravaCompletedWorkout(user.id);

    const params = {
      athleteId: user.id,
      completedWorkoutId: cwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    };

    const first = await matchStravaToPlanned(serviceClient(), params);
    const second = await matchStravaToPlanned(serviceClient(), params);

    expect(first.matched).toBe(true);
    expect(second.matched).toBe(true);
    expect(second.plannedWorkoutId).toBe(plannedId);

    // Still exactly one active match
    const admin = serviceClient();
    const { data: allMatches } = await admin
      .from("workout_matches")
      .select("id")
      .eq("planned_workout_id", plannedId)
      .is("deleted_at", null);
    expect(allMatches).toHaveLength(1);
  });

  it("Strava-on-Strava no-op: existing Strava match → skip, return matched=false", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id);

    // First Strava activity already matched
    const firstCwId = await insertStravaCompletedWorkout(user.id, { strava_activity_id: 7001 });
    await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: firstCwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    // Second Strava activity for same day/sport — should NOT supersede
    const secondCwId = await insertStravaCompletedWorkout(user.id, { strava_activity_id: 7002 });
    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: secondCwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    expect(result.matched).toBe(false);

    // Original match intact
    const match = await getMatchForPlan(plannedId);
    expect(match!.completed_workout_id).toBe(firstCwId);
  });

  it("triathlete same-day two swims: both planned workouts end up matched", async () => {
    const user = await createTestUser();
    const swim1Id = await insertPlannedWorkout(user.id, { sport: "swim" });
    const swim2Id = await insertPlannedWorkout(user.id, { sport: "swim" });

    const strava1Id = await insertStravaCompletedWorkout(user.id, {
      strava_activity_id: 8001,
      sport: "swim",
    });
    const strava2Id = await insertStravaCompletedWorkout(user.id, {
      strava_activity_id: 8002,
      sport: "swim",
    });

    await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: strava1Id,
      sport: "swim",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: strava2Id,
      sport: "swim",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    const match1 = await getMatchForPlan(swim1Id);
    const match2 = await getMatchForPlan(swim2Id);

    // Both planned workouts should be matched
    expect(match1).not.toBeNull();
    expect(match2).not.toBeNull();

    // Each matched to a different Strava activity (no supersession)
    const matchedCwIds = new Set([
      match1!.completed_workout_id,
      match2!.completed_workout_id,
    ]);
    expect(matchedCwIds.size).toBe(2);
    expect(matchedCwIds).toContain(strava1Id);
    expect(matchedCwIds).toContain(strava2Id);
  });

  it("supersession: manual completion is superseded by Strava, match method becomes merged_from_manual", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id);

    // Manual completion already linked
    const manualCwId = await insertManualCompletedWorkout(user.id);
    await linkManualCompletion(plannedId, manualCwId);

    // Strava activity arrives
    const stravaCwId = await insertStravaCompletedWorkout(user.id);
    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: stravaCwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    expect(result.matched).toBe(true);
    expect(result.plannedWorkoutId).toBe(plannedId);

    // Active match points at Strava row with merged_from_manual method
    const match = await getMatchForPlan(plannedId);
    expect(match!.completed_workout_id).toBe(stravaCwId);
    expect(match!.method).toBe("merged_from_manual");
    expect(match!.confidence).toBe(1.0);

    // Manual match is soft-deleted
    const admin = serviceClient();
    const { data: allMatches } = await admin
      .from("workout_matches")
      .select("id, deleted_at")
      .eq("planned_workout_id", plannedId);
    expect(allMatches).toHaveLength(2);
    const deletedMatch = allMatches!.find((m) => m.deleted_at !== null);
    expect(deletedMatch).toBeDefined();

    // Manual completed_workout has superseded_by_id set
    const { data: manualCW } = await admin
      .from("completed_workouts")
      .select("superseded_by_id")
      .eq("id", manualCwId)
      .single();
    expect(manualCW?.superseded_by_id).toBe(stravaCwId);
  });

  it("planned_workouts.status stays completed after supersession (R16)", async () => {
    const user = await createTestUser();
    const plannedId = await insertPlannedWorkout(user.id);
    const manualCwId = await insertManualCompletedWorkout(user.id);
    await linkManualCompletion(plannedId, manualCwId);

    const stravaCwId = await insertStravaCompletedWorkout(user.id);
    await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: stravaCwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null,
    });

    const status = await getPlannedStatus(plannedId);
    expect(status).toBe("completed");
  });

  it("backfill supersedes manual_user_link when duration guard inactive (Strava wins)", async () => {
    const user = await createTestUser();
    // Planned workout with no structure.duration_s — guard is inactive
    const plannedId = await insertPlannedWorkout(user.id, { structure: {} });
    const manualCwId = await insertManualCompletedWorkout(user.id);
    await linkManualCompletion(plannedId, manualCwId);

    const stravaCwId = await insertStravaCompletedWorkout(user.id);
    const result = await matchStravaToPlanned(serviceClient(), {
      athleteId: user.id,
      completedWorkoutId: stravaCwId,
      sport: "run",
      startedAt: "2026-05-15T07:00:00Z",
      durationS: null, // guard inactive
    });

    expect(result.matched).toBe(true);

    // Strava won — match now points at Strava row
    const match = await getMatchForPlan(plannedId);
    expect(match!.completed_workout_id).toBe(stravaCwId);
    expect(match!.method).toBe("merged_from_manual");
  });
});
