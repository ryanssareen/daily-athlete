// DB integration tests for planned_workouts.version (migration 0021).
// The version token is the AI adaptive engine's per-op staleness baseline. It
// must bump on a plannable-column change but NOT on a status-only change (the
// benign Strava completed->planned revert must not invalidate a pending op).
//
// Prerequisites: `supabase start` must be running locally (CI provides it).

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

async function createPlannedWorkout(athleteId: string) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("planned_workouts")
    .insert({ athlete_id: athleteId, scheduled_date: "2026-06-01", sport: "run", structure: {} })
    .select("id, version")
    .single();
  if (error) throw new Error(`createPlannedWorkout failed: ${error.message}`);
  return data as { id: string; version: number };
}

async function readVersion(id: string) {
  const admin = serviceClient();
  const { data } = await admin.from("planned_workouts").select("version").eq("id", id).single();
  return data?.version as number;
}

describe("planned_workouts.version trigger", () => {
  it("defaults to 1 on insert", async () => {
    const athlete = await createTestUser();
    const wk = await createPlannedWorkout(athlete.id);
    expect(wk.version).toBe(1);
  });

  it("bumps when a plannable column (scheduled_date) changes", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const wk = await createPlannedWorkout(athlete.id);

    await admin.from("planned_workouts").update({ scheduled_date: "2026-06-02" }).eq("id", wk.id);
    expect(await readVersion(wk.id)).toBe(2);

    await admin.from("planned_workouts").update({ planned_load: 55 }).eq("id", wk.id);
    expect(await readVersion(wk.id)).toBe(3);
  });

  it("does NOT bump on a status-only change (Strava revert / skip)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const wk = await createPlannedWorkout(athlete.id);

    await admin.from("planned_workouts").update({ status: "completed" }).eq("id", wk.id);
    expect(await readVersion(wk.id)).toBe(1);

    // Strava activity deleted -> revert to planned. Still no version bump (ABA-safe).
    await admin.from("planned_workouts").update({ status: "planned" }).eq("id", wk.id);
    expect(await readVersion(wk.id)).toBe(1);
  });

  it("bumps on soft-delete (deleted_at change)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const wk = await createPlannedWorkout(athlete.id);

    await admin
      .from("planned_workouts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", wk.id);
    expect(await readVersion(wk.id)).toBe(2);
  });
});
