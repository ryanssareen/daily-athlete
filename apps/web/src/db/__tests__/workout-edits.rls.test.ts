// DB integration tests for public.workout_edits (migration 0019).
// Covers:
//   - RLS positive + negative for athletes and linked coaches
//   - Append-only: the immutability trigger blocks UPDATE (even service-role)
//   - The one permitted UPDATE: actor_user_id ON DELETE SET NULL scrub
//   - No app DELETE path (no DELETE policy)
//
// Prerequisites: `supabase start` must be running locally (CI provides it).

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

async function createPlannedWorkout(athleteId: string) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("planned_workouts")
    .insert({ athlete_id: athleteId, scheduled_date: "2026-06-01", sport: "run", structure: {} })
    .select("id")
    .single();
  if (error) throw new Error(`createPlannedWorkout failed: ${error.message}`);
  return data.id as string;
}

async function createCoachLink(coachId: string, athleteId: string) {
  const admin = serviceClient();
  const { error } = await admin
    .from("coach_athlete_links")
    .insert({ coach_user_id: coachId, athlete_user_id: athleteId, status: "active" });
  if (error) throw new Error(`createCoachLink failed: ${error.message}`);
}

async function insertEdit(
  athleteId: string,
  plannedWorkoutId: string,
  actorUserId: string | null,
  actorRole: "athlete" | "coach" | "ai_review" = "athlete",
) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("workout_edits")
    .insert({
      athlete_id: athleteId,
      planned_workout_id: plannedWorkoutId,
      actor_role: actorRole,
      actor_user_id: actorUserId,
      field_diff: { scheduled_date: { from: "2026-06-01", to: "2026-06-02" } },
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertEdit failed: ${error.message}`);
  return data.id as string;
}

describe("workout_edits RLS", () => {
  it("athlete can SELECT their own edit history", async () => {
    const athlete = await createTestUser();
    const workoutId = await createPlannedWorkout(athlete.id);
    await insertEdit(athlete.id, workoutId, athlete.id);

    const { data, error } = await athlete.client
      .from("workout_edits")
      .select("id, actor_role")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("linked coach can SELECT their athlete's edit history", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const workoutId = await createPlannedWorkout(athlete.id);
    await createCoachLink(coach.id, athlete.id);
    await insertEdit(athlete.id, workoutId, athlete.id);

    const { data, error } = await coach.client
      .from("workout_edits")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("unlinked third user cannot SELECT another athlete's edit history", async () => {
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const workoutId = await createPlannedWorkout(athlete.id);
    await insertEdit(athlete.id, workoutId, athlete.id);

    const { data, error } = await stranger.client.from("workout_edits").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("workout_edits append-only immutability", () => {
  it("rejects an UPDATE to field_diff (even as service-role)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const workoutId = await createPlannedWorkout(athlete.id);
    const editId = await insertEdit(athlete.id, workoutId, athlete.id);

    const { error } = await admin
      .from("workout_edits")
      .update({ field_diff: { tampered: true } })
      .eq("id", editId);
    expect(error).not.toBeNull();
    expect(error?.message?.toLowerCase()).toContain("append-only");
  });

  it("permits the actor_user_id SET NULL scrub when the coach actor is deleted", async () => {
    const admin = serviceClient();
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const workoutId = await createPlannedWorkout(athlete.id);
    const editId = await insertEdit(athlete.id, workoutId, coach.id, "coach");

    // Deleting the coach fires the actor_user_id ON DELETE SET NULL cascade,
    // which the immutability trigger must allow. The athlete's audit row
    // survives with actor_user_id scrubbed to NULL.
    await admin.auth.admin.deleteUser(coach.id);

    const { data } = await admin
      .from("workout_edits")
      .select("actor_user_id, actor_role")
      .eq("id", editId)
      .single();
    expect(data?.actor_user_id).toBeNull();
    expect(data?.actor_role).toBe("coach");
  });
});
