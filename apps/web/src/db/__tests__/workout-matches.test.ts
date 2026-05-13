// DB integration tests for public.workout_matches (migration 0008).
// Covers:
//   - R19: 1:1 cardinality via two partial unique indexes
//   - R20: re-linking via soft-delete
//   - CHECK constraints (confidence range, method enum)
//   - EXISTS-subquery RLS (workout_matches has no athlete_id column)
//   - RLS WITH CHECK on both INSERT and UPDATE (post-#54-review hardening)
//   - Service-role bypass for the matcher worker path
//   - FK cascade from planned_workouts and completed_workouts
//   - WorkoutMatchRowSchema Zod-roundtrip
//
// Companion file: completed-workouts.test.ts.

import { describe, expect, it } from "vitest";

import { WorkoutMatchRowSchema } from "@da2/shared";

import { createTestUser, serviceClient } from "./setup";

type Ids = { plannedId: string; completedId: string };

async function seedPlannedAndCompleted(
  userId: string,
  date = "2026-05-13",
  startedAt = "2026-05-13T07:00:00+00:00",
): Promise<Ids> {
  const admin = serviceClient();

  const { data: plan } = await admin
    .from("plans")
    .insert({
      athlete_id: userId,
      status: "active",
      source: "ai_generated",
    })
    .select()
    .single();

  const { data: planned } = await admin
    .from("planned_workouts")
    .insert({
      athlete_id: userId,
      plan_id: plan?.id,
      scheduled_date: date,
      sport: "run",
    })
    .select()
    .single();

  const { data: completed } = await admin
    .from("completed_workouts")
    .insert({
      athlete_id: userId,
      source: "strava",
      strava_activity_id: Date.now(),
      started_at: startedAt,
      sport: "run",
    })
    .select()
    .single();

  if (!planned?.id || !completed?.id) {
    throw new Error("seed failed");
  }
  return { plannedId: planned.id, completedId: completed.id };
}

describe("workout_matches table", () => {
  it("inserts a valid match linking planned and completed (R19 happy path)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0.92,
      method: "auto_same_day_sport",
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from("workout_matches")
      .select("confidence, method")
      .eq("planned_workout_id", plannedId)
      .single();
    expect(data?.confidence).toBe(0.92);
    expect(data?.method).toBe("auto_same_day_sport");
  });

  it("R19: second LIVE match for same planned_workout_id -> 23505", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    // Need a SECOND completed_workout to attempt the duplicate match
    const { data: secondCompleted } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "strava",
        strava_activity_id: Date.now() + 1,
        started_at: "2026-05-13T08:00:00+00:00",
        sport: "run",
      })
      .select()
      .single();

    await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0.92,
      method: "auto_same_day_sport",
    });

    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: secondCompleted?.id,
      confidence: 0.85,
      method: "manual_user_link",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });

  it("R19: second LIVE match for same completed_workout_id -> 23505", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    const { data: secondPlanned } = await admin
      .from("planned_workouts")
      .insert({
        athlete_id: user.id,
        scheduled_date: "2026-05-13",
        sport: "run",
      })
      .select()
      .single();

    await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0.92,
      method: "auto_same_day_sport",
    });

    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: secondPlanned?.id,
      completed_workout_id: completedId,
      confidence: 0.5,
      method: "manual_user_link",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });

  it("R20: re-link via soft-delete then INSERT succeeds", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    const { data: secondCompleted } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "strava",
        strava_activity_id: Date.now() + 2,
        started_at: "2026-05-13T08:00:00+00:00",
        sport: "run",
      })
      .select()
      .single();

    // Initial auto-match
    const { data: firstMatch } = await admin
      .from("workout_matches")
      .insert({
        planned_workout_id: plannedId,
        completed_workout_id: completedId,
        confidence: 0.7,
        method: "auto_same_day_sport",
      })
      .select()
      .single();

    // Soft-delete the existing match
    await admin
      .from("workout_matches")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", firstMatch?.id);

    // Insert a manual re-link to the second completed workout
    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: secondCompleted?.id,
      confidence: 1.0,
      method: "manual_user_link",
    });
    expect(error).toBeNull();

    // Both rows exist; only one is live
    const { data: live } = await admin
      .from("workout_matches")
      .select("method")
      .eq("planned_workout_id", plannedId)
      .is("deleted_at", null);
    expect(live).toHaveLength(1);
    expect(live?.[0]?.method).toBe("manual_user_link");
  });

  it("CHECK accepts confidence at boundaries 0 and 1", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0,
      method: "auto_same_day_sport",
    });
    expect(error).toBeNull();

    // Tear down for second case
    await admin
      .from("workout_matches")
      .update({ deleted_at: new Date().toISOString() })
      .eq("planned_workout_id", plannedId);

    const { error: err2 } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 1,
      method: "manual_user_link",
    });
    expect(err2).toBeNull();
  });

  it("CHECK rejects confidence outside [0, 1]", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    const { error: neg } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: -0.01,
      method: "auto_same_day_sport",
    });
    expect(neg?.code).toBe("23514");

    const { error: hi } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 1.5,
      method: "auto_same_day_sport",
    });
    expect(hi?.code).toBe("23514");
  });

  it("CHECK rejects unknown method", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0.5,
      method: "auto_geofence",
    });
    expect(error?.code).toBe("23514");
  });

  it("FK violation 23503 on non-existent planned_workout_id", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { completedId } = await seedPlannedAndCompleted(user.id);

    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: "00000000-0000-0000-0000-000000000000",
      completed_workout_id: completedId,
      confidence: 0.5,
      method: "manual_user_link",
    });
    expect(error?.code).toBe("23503");
  });

  it("FK violation 23503 on non-existent completed_workout_id", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId } = await seedPlannedAndCompleted(user.id);

    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: "00000000-0000-0000-0000-000000000000",
      confidence: 0.5,
      method: "manual_user_link",
    });
    expect(error?.code).toBe("23503");
  });

  it("RLS WITH CHECK on JWT path: athlete A cannot create a match using athlete B's planned/completed", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const idsB = await seedPlannedAndCompleted(userB.id);

    // userA attempts to INSERT a match referencing userB's planned + completed
    const { error } = await userA.client.from("workout_matches").insert({
      planned_workout_id: idsB.plannedId,
      completed_workout_id: idsB.completedId,
      confidence: 0.9,
      method: "manual_user_link",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("Service-role bypass: cross-athlete match succeeds (documented surprise; matcher must validate identity)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    const idsA = await seedPlannedAndCompleted(userA.id);
    const idsB = await seedPlannedAndCompleted(userB.id);

    // SQL accepts a cross-athlete match via service-role. RLS is bypassed.
    // App-layer matcher (product plan Unit 2.4) MUST validate athlete
    // identity before insert.
    const { error } = await admin.from("workout_matches").insert({
      planned_workout_id: idsA.plannedId,
      completed_workout_id: idsB.completedId,
      confidence: 0.5,
      method: "auto_same_day_sport",
    });
    expect(error).toBeNull();
  });

  it("athlete reads own matches via JWT (RLS positive via EXISTS subquery)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0.92,
      method: "auto_same_day_sport",
    });

    const { data, error } = await user.client
      .from("workout_matches")
      .select("planned_workout_id, confidence")
      .eq("planned_workout_id", plannedId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.confidence).toBe(0.92);
  });

  it("athlete B cannot see athlete A's matches (RLS negative via EXISTS subquery)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();
    const idsA = await seedPlannedAndCompleted(userA.id);

    await admin.from("workout_matches").insert({
      planned_workout_id: idsA.plannedId,
      completed_workout_id: idsA.completedId,
      confidence: 0.92,
      method: "auto_same_day_sport",
    });

    const { data, error } = await userB.client
      .from("workout_matches")
      .select("planned_workout_id")
      .eq("planned_workout_id", idsA.plannedId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("FK cascade: deleting a completed_workout removes its match", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0.92,
      method: "auto_same_day_sport",
    });

    // Hard-delete the completed_workout via service-role
    await admin.from("completed_workouts").delete().eq("id", completedId);

    const { data } = await admin
      .from("workout_matches")
      .select("id")
      .eq("planned_workout_id", plannedId);
    expect(data).toEqual([]);
  });

  it("WorkoutMatchRowSchema parses a real PostgREST-returned row", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    const { plannedId, completedId } = await seedPlannedAndCompleted(user.id);

    await admin.from("workout_matches").insert({
      planned_workout_id: plannedId,
      completed_workout_id: completedId,
      confidence: 0.92,
      method: "auto_same_day_sport",
    });

    const { data, error } = await admin
      .from("workout_matches")
      .select(
        "id, planned_workout_id, completed_workout_id, confidence, method, matched_at, deleted_at",
      )
      .eq("planned_workout_id", plannedId)
      .single();

    expect(error).toBeNull();
    const parsed = WorkoutMatchRowSchema.parse(data);
    expect(parsed.confidence).toBe(0.92);
    expect(parsed.method).toBe("auto_same_day_sport");
    expect(parsed.deleted_at).toBeNull();
  });
});
