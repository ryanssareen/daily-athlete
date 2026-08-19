// DB integration tests for public.workout_reports (migration 0028).
// Covers:
//   - RLS positive + negative for athletes and linked coaches
//   - No client write path (service-role only): athlete INSERT/UPDATE/DELETE
//     are all rejected
//   - Unique constraint: one report per completed_workout_id
//   - completed_workouts parent delete cascades the report away (hard delete
//     via the FK, and SOFT delete via the 0028 trigger)
//   - verdict_code CHECK rejects a code outside the closed VerdictCode enum
//   - workout_reports is absent from the supabase_realtime publication (KTD6)
//
// Prerequisites: `supabase start` must be running locally (CI provides it).

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

async function createCompletedWorkout(athleteId: string) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("completed_workouts")
    .insert({
      athlete_id: athleteId,
      source: "manual",
      started_at: new Date().toISOString(),
      sport: "run",
      summary_stats: {},
    })
    .select("id")
    .single();
  if (error) throw new Error(`createCompletedWorkout failed: ${error.message}`);
  return data.id as string;
}

async function createCoachLink(
  coachId: string,
  athleteId: string,
  opts: { status?: string; deleted?: boolean } = {},
) {
  const admin = serviceClient();
  const { error } = await admin.from("coach_athlete_links").insert({
    coach_user_id: coachId,
    athlete_user_id: athleteId,
    status: opts.status ?? "active",
    ...(opts.deleted ? { deleted_at: new Date().toISOString() } : {}),
  });
  if (error) throw new Error(`createCoachLink failed: ${error.message}`);
}

async function insertReport(
  athleteId: string,
  completedWorkoutId: string,
  opts?: { narrative?: string | null; verdictCode?: string; fingerprint?: string },
) {
  const admin = serviceClient();
  return admin
    .from("workout_reports")
    .insert({
      athlete_id: athleteId,
      completed_workout_id: completedWorkoutId,
      narrative: opts?.narrative ?? "You executed the session as prescribed.",
      takeaway: "Keep the easy days easy.",
      verdict_code: opts?.verdictCode ?? "executed_as_prescribed",
      input_fingerprint: opts?.fingerprint ?? "fingerprint-v1",
      model: "test-model",
    })
    .select("id, athlete_id, completed_workout_id, narrative, deleted_at")
    .single();
}

describe("workout_reports RLS", () => {
  it("athlete can SELECT their own report", async () => {
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    await insertReport(athlete.id, completedWorkoutId);

    const { data, error } = await athlete.client
      .from("workout_reports")
      .select("id, narrative")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.narrative).toBe("You executed the session as prescribed.");
  });

  it("another athlete cannot SELECT a report that is not theirs (negative RLS)", async () => {
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    await insertReport(athlete.id, completedWorkoutId);

    const { data, error } = await stranger.client.from("workout_reports").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("linked active coach can SELECT their athlete's report", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    await createCoachLink(coach.id, athlete.id);
    await insertReport(athlete.id, completedWorkoutId);

    const { data, error } = await coach.client
      .from("workout_reports")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("coach with no link to the athlete cannot SELECT their report (negative RLS)", async () => {
    const unlinkedCoach = await createTestUser();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    await insertReport(athlete.id, completedWorkoutId);

    const { data, error } = await unlinkedCoach.client
      .from("workout_reports")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // The coach policy checks `status = 'active' AND deleted_at IS NULL`. The
  // no-link case above only proves the EXISTS subquery needs a row at all —
  // these two prove the predicate inside it is doing work, which is what
  // actually matters when a coaching relationship ENDS. A coach who is
  // dismissed must lose read access to past debriefs, not just to new ones.
  it("a coach whose link was ARCHIVED cannot SELECT the athlete's report", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    await createCoachLink(coach.id, athlete.id, { status: "archived" });
    await insertReport(athlete.id, completedWorkoutId);

    const { data, error } = await coach.client
      .from("workout_reports")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a coach whose link was SOFT-DELETED cannot SELECT the athlete's report", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    await createCoachLink(coach.id, athlete.id, { deleted: true });
    await insertReport(athlete.id, completedWorkoutId);

    const { data, error } = await coach.client
      .from("workout_reports")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("athlete cannot INSERT a report (no INSERT policy; service-role only)", async () => {
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);

    const { error } = await athlete.client.from("workout_reports").insert({
      athlete_id: athlete.id,
      completed_workout_id: completedWorkoutId,
      input_fingerprint: "fingerprint-v1",
    });
    expect(error).not.toBeNull();
    expect(
      error?.code === "42501" || error?.message?.toLowerCase().includes("row-level"),
    ).toBe(true);
  });

  it("athlete cannot UPDATE a report (no UPDATE policy; service-role only)", async () => {
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    const { data: report } = await insertReport(athlete.id, completedWorkoutId);

    // With no UPDATE policy, RLS matches zero rows -- the call itself does
    // not error, but the row is left unchanged.
    await athlete.client
      .from("workout_reports")
      .update({ narrative: "tampered" })
      .eq("id", report!.id);

    const admin = serviceClient();
    const { data } = await admin
      .from("workout_reports")
      .select("narrative")
      .eq("id", report!.id)
      .single();
    expect(data?.narrative).toBe("You executed the session as prescribed.");
  });

  it("athlete cannot DELETE a report (no DELETE policy; service-role only)", async () => {
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    const { data: report } = await insertReport(athlete.id, completedWorkoutId);

    await athlete.client.from("workout_reports").delete().eq("id", report!.id);

    const admin = serviceClient();
    const { data } = await admin
      .from("workout_reports")
      .select("id, deleted_at")
      .eq("id", report!.id)
      .single();
    expect(data).not.toBeNull();
    expect(data?.deleted_at).toBeNull();
  });
});

describe("workout_reports uniqueness", () => {
  it("a second report for the same completed_workout_id raises 23505", async () => {
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);

    const first = await insertReport(athlete.id, completedWorkoutId);
    expect(first.error).toBeNull();

    const second = await insertReport(athlete.id, completedWorkoutId);
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });
});

describe("workout_reports cascade", () => {
  it("deleting the parent completed_workouts row cascades the report away", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    const { data: report } = await insertReport(athlete.id, completedWorkoutId);

    const { error: deleteError } = await admin
      .from("completed_workouts")
      .delete()
      .eq("id", completedWorkoutId);
    expect(deleteError).toBeNull();

    const { data, error } = await admin
      .from("workout_reports")
      .select("id")
      .eq("id", report!.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("workout_reports soft-delete cascade (0028 trigger)", () => {
  // The FK CASCADE only fires on a HARD delete. The delete path that exists
  // today (the MCP `workouts_completed_delete` tool) stamps
  // completed_workouts.deleted_at, which no FK can observe — without the
  // trigger the report stays live, debriefing a workout the athlete believes
  // they deleted.
  it("soft-deleting the parent completed workout soft-deletes its report", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    const { data: report } = await insertReport(athlete.id, completedWorkoutId);

    const { error: softDeleteError } = await admin
      .from("completed_workouts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", completedWorkoutId);
    expect(softDeleteError).toBeNull();

    const { data } = await admin
      .from("workout_reports")
      .select("deleted_at")
      .eq("id", report!.id)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });

  it("an ordinary update to the parent workout does NOT touch the report", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    const { data: report } = await insertReport(athlete.id, completedWorkoutId);

    // e.g. a Strava re-sync enriching summary_stats.
    await admin
      .from("completed_workouts")
      .update({ summary_stats: { tss_equivalent: 61 } })
      .eq("id", completedWorkoutId);

    const { data } = await admin
      .from("workout_reports")
      .select("deleted_at")
      .eq("id", report!.id)
      .single();
    expect(data?.deleted_at).toBeNull();
  });
});

describe("workout_reports verdict_code CHECK", () => {
  it("rejects a code outside the closed VerdictCode enum", async () => {
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);

    const { error } = await insertReport(athlete.id, completedWorkoutId, {
      verdictCode: "crushed_it",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("accepts every code the shared enum defines", async () => {
    for (const code of [
      "executed_as_prescribed",
      "under_executed",
      "over_executed",
      "partial_data",
      "unplanned_effort",
    ]) {
      const athlete = await createTestUser();
      const completedWorkoutId = await createCompletedWorkout(athlete.id);
      const { error } = await insertReport(athlete.id, completedWorkoutId, { verdictCode: code });
      expect(error, `verdict_code ${code} should be accepted`).toBeNull();
    }
  });
});

describe("workout_reports delete_user_cascade", () => {
  it("soft-deletes the athlete's reports", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const completedWorkoutId = await createCompletedWorkout(athlete.id);
    const { data: report } = await insertReport(athlete.id, completedWorkoutId);

    await admin.rpc("delete_user_cascade", { user_id: athlete.id });

    const { data } = await admin
      .from("workout_reports")
      .select("deleted_at")
      .eq("id", report!.id)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });
});

describe("workout_reports realtime publication (KTD6)", () => {
  it("is absent from the supabase_realtime publication", async () => {
    const admin = serviceClient();
    const { data, error } = await admin.rpc("realtime_publication_tables");
    expect(error).toBeNull();
    const tables = (data as Array<{ tablename: string }>).map((r) => r.tablename);
    expect(tables).not.toContain("workout_reports");
  });
});
