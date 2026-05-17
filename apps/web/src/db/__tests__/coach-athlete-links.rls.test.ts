// DB integration tests for public.coach_athlete_links (migration 0010).
// Covers:
//   - RLS positive + negative for athletes and coaches
//   - Partial unique index: one active coach per athlete
//   - Coach SELECT policies on plans, planned_workouts, completed_workouts, workout_matches
//   - role_flags self-update lock (WITH CHECK fix from 0010)
//   - delete_user_cascade stub soft-deletes coach_athlete_links on both sides
//
// Prerequisites: `supabase start` must be running locally.

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createCoachLink(
  coachId: string,
  athleteId: string,
  status: "active" | "archived" = "active",
) {
  const admin = serviceClient();
  const { data, error } = await admin.from("coach_athlete_links").insert({
    coach_user_id: coachId,
    athlete_user_id: athleteId,
    status,
  }).select("id").single();
  if (error) throw new Error(`createCoachLink failed: ${error.message}`);
  return data.id as string;
}

async function createActivePlan(athleteId: string) {
  const admin = serviceClient();
  const { data, error } = await admin.from("plans").insert({
    athlete_id: athleteId,
    status: "active",
    source: "ai_generated",
  }).select("id").single();
  if (error) throw new Error(`createActivePlan failed: ${error.message}`);
  return data.id as string;
}

async function createPlannedWorkout(athleteId: string) {
  const admin = serviceClient();
  const { data, error } = await admin.from("planned_workouts").insert({
    athlete_id: athleteId,
    scheduled_date: "2026-06-01",
    sport: "run",
    structure: {},
  }).select("id").single();
  if (error) throw new Error(`createPlannedWorkout failed: ${error.message}`);
  return data.id as string;
}

async function createCompletedWorkout(athleteId: string) {
  const admin = serviceClient();
  const { data, error } = await admin.from("completed_workouts").insert({
    athlete_id: athleteId,
    source: "manual",
    started_at: new Date().toISOString(),
    sport: "run",
    summary_stats: {},
  }).select("id").single();
  if (error) throw new Error(`createCompletedWorkout failed: ${error.message}`);
  return data.id as string;
}

async function createWorkoutMatch(plannedId: string, completedId: string) {
  const admin = serviceClient();
  const { data, error } = await admin.from("workout_matches").insert({
    planned_workout_id: plannedId,
    completed_workout_id: completedId,
    confidence: 1.0,
    method: "manual_user_link",
  }).select("id").single();
  if (error) throw new Error(`createWorkoutMatch failed: ${error.message}`);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// coach_athlete_links RLS
// ---------------------------------------------------------------------------

describe("coach_athlete_links RLS", () => {
  it("athlete can SELECT their own link", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id);

    const { data, error } = await athlete.client
      .from("coach_athlete_links")
      .select("coach_user_id, athlete_user_id, status")
      .eq("athlete_user_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.coach_user_id).toBe(coach.id);
  });

  it("coach can SELECT their own roster entries", async () => {
    const coach = await createTestUser();
    const athlete1 = await createTestUser();
    const athlete2 = await createTestUser();
    await createCoachLink(coach.id, athlete1.id);
    await createCoachLink(coach.id, athlete2.id);

    const { data, error } = await coach.client
      .from("coach_athlete_links")
      .select("athlete_user_id")
      .eq("coach_user_id", coach.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("third user cannot SELECT any coach_athlete_links row", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    await createCoachLink(coach.id, athlete.id);

    const { data, error } = await stranger.client
      .from("coach_athlete_links")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("athlete cannot INSERT a row (coach_user_id = auth.uid() check fails)", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();

    // Athlete tries to insert a row where they are not the coach.
    const { error } = await athlete.client.from("coach_athlete_links").insert({
      coach_user_id: coach.id,
      athlete_user_id: athlete.id,
    });
    expect(error).not.toBeNull();
    // RLS with-check failure → 42501 or PostgREST 403/401 response.
    expect(error?.code === "42501" || error?.message?.toLowerCase().includes("row-level")).toBe(true);
  });

  it("coach can INSERT a row linking themselves to an athlete", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();

    const { error } = await coach.client.from("coach_athlete_links").insert({
      coach_user_id: coach.id,
      athlete_user_id: athlete.id,
    });
    expect(error).toBeNull();
  });

  it("partial unique index: second active link for same athlete raises 23505", async () => {
    const admin = serviceClient();
    const coach1 = await createTestUser();
    const coach2 = await createTestUser();
    const athlete = await createTestUser();

    await admin.from("coach_athlete_links").insert({
      coach_user_id: coach1.id,
      athlete_user_id: athlete.id,
      status: "active",
    });

    const { error } = await admin.from("coach_athlete_links").insert({
      coach_user_id: coach2.id,
      athlete_user_id: athlete.id,
      status: "active",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });

  it("archived row does not block a new active link for same athlete", async () => {
    const admin = serviceClient();
    const coach1 = await createTestUser();
    const coach2 = await createTestUser();
    const athlete = await createTestUser();

    const linkId = await createCoachLink(coach1.id, athlete.id);

    // Archive the existing link.
    await admin.from("coach_athlete_links")
      .update({ status: "archived", deleted_at: new Date().toISOString() })
      .eq("id", linkId);

    // New active link should succeed.
    const { error } = await admin.from("coach_athlete_links").insert({
      coach_user_id: coach2.id,
      athlete_user_id: athlete.id,
      status: "active",
    });
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Coach SELECT policies on related tables
// ---------------------------------------------------------------------------

describe("coach SELECT policies on plans", () => {
  it("linked coach can SELECT athlete's plans", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id);
    await createActivePlan(athlete.id);

    const { data, error } = await coach.client
      .from("plans")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("unlinked coach cannot SELECT another athlete's plans", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createActivePlan(athlete.id);
    // No link created.

    const { data, error } = await coach.client
      .from("plans")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("coach SELECT policies on planned_workouts", () => {
  it("linked coach can SELECT athlete's planned workouts", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id);
    await createPlannedWorkout(athlete.id);

    const { data, error } = await coach.client
      .from("planned_workouts")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("unlinked user cannot SELECT another athlete's planned workouts", async () => {
    const stranger = await createTestUser();
    const athlete = await createTestUser();
    await createPlannedWorkout(athlete.id);

    const { data, error } = await stranger.client
      .from("planned_workouts")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("coach SELECT policies on completed_workouts", () => {
  it("linked coach can SELECT athlete's completed workouts", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id);
    await createCompletedWorkout(athlete.id);

    const { data, error } = await coach.client
      .from("completed_workouts")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("unlinked user cannot SELECT another athlete's completed workouts", async () => {
    const stranger = await createTestUser();
    const athlete = await createTestUser();
    await createCompletedWorkout(athlete.id);

    const { data, error } = await stranger.client
      .from("completed_workouts")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("coach SELECT policies on workout_matches", () => {
  it("linked coach can SELECT workout_matches for their athlete's workouts", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id);
    const plannedId = await createPlannedWorkout(athlete.id);
    const completedId = await createCompletedWorkout(athlete.id);
    await createWorkoutMatch(plannedId, completedId);

    // Coach should see the match via the coach SELECT policy.
    const { data, error } = await coach.client
      .from("workout_matches")
      .select("id, planned_workout_id")
      .eq("planned_workout_id", plannedId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("unlinked user cannot SELECT workout_matches for another athlete's workouts", async () => {
    const stranger = await createTestUser();
    const athlete = await createTestUser();
    const plannedId = await createPlannedWorkout(athlete.id);
    const completedId = await createCompletedWorkout(athlete.id);
    await createWorkoutMatch(plannedId, completedId);

    const { data, error } = await stranger.client
      .from("workout_matches")
      .select("id")
      .eq("planned_workout_id", plannedId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// role_flags self-update lock
// ---------------------------------------------------------------------------

describe("role_flags UPDATE lock", () => {
  it("athlete cannot self-promote role_flags to coach via Supabase client", async () => {
    const user = await createTestUser();

    const { error } = await user.client.from("users").update({
      role_flags: ["coach"],
    }).eq("id", user.id);

    // The WITH CHECK rejects any update where role_flags differs from stored value.
    expect(error).not.toBeNull();
  });

  it("athlete can update display_name without changing role_flags", async () => {
    const user = await createTestUser();

    const { error } = await user.client.from("users").update({
      display_name: "Test Athlete",
    }).eq("id", user.id);

    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// delete_user_cascade stub
// ---------------------------------------------------------------------------

describe("delete_user_cascade function", () => {
  it("soft-deletes coach_athlete_links on coach side when coach is deleted", async () => {
    const admin = serviceClient();
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const linkId = await createCoachLink(coach.id, athlete.id);

    // Call the function as service-role.
    await admin.rpc("delete_user_cascade", { user_id: coach.id });

    const { data } = await admin
      .from("coach_athlete_links")
      .select("status, deleted_at")
      .eq("id", linkId)
      .single();
    expect(data?.status).toBe("archived");
    expect(data?.deleted_at).not.toBeNull();
  });

  it("soft-deletes coach_athlete_links on athlete side when athlete is deleted", async () => {
    const admin = serviceClient();
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const linkId = await createCoachLink(coach.id, athlete.id);

    await admin.rpc("delete_user_cascade", { user_id: athlete.id });

    const { data } = await admin
      .from("coach_athlete_links")
      .select("status, deleted_at")
      .eq("id", linkId)
      .single();
    expect(data?.status).toBe("archived");
    expect(data?.deleted_at).not.toBeNull();
  });
});
