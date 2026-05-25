// DB integration tests for public.weekly_reviews (migration 0019).
// Covers:
//   - RLS positive + negative for athletes and linked coaches
//   - No client write path (status is RPC-only): self-UPDATE is denied
//   - Partial unique index: one open plan-scoped proposal per athlete
//   - Workout-scoped proposals are exempt from the single-open index
//   - delete_user_cascade soft-deletes the athlete's proposals
//
// Prerequisites: `supabase start` must be running locally (CI provides it).

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

async function createActivePlan(athleteId: string) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("plans")
    .insert({ athlete_id: athleteId, status: "active", source: "ai_generated" })
    .select("id")
    .single();
  if (error) throw new Error(`createActivePlan failed: ${error.message}`);
  return data.id as string;
}

async function createCoachLink(coachId: string, athleteId: string) {
  const admin = serviceClient();
  const { error } = await admin
    .from("coach_athlete_links")
    .insert({ coach_user_id: coachId, athlete_user_id: athleteId, status: "active" });
  if (error) throw new Error(`createCoachLink failed: ${error.message}`);
}

async function insertProposal(
  athleteId: string,
  planId: string,
  opts?: { scope?: "plan" | "workout"; recipient?: "athlete" | "coach"; status?: string },
) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("weekly_reviews")
    .insert({
      athlete_id: athleteId,
      plan_id: planId,
      trigger_kind: "weekly",
      scope: opts?.scope ?? "plan",
      recipient: opts?.recipient ?? "athlete",
      status: opts?.status ?? "proposed",
      proposed_changes: [],
    })
    .select("id, status")
    .single();
  return { data, error };
}

describe("weekly_reviews RLS", () => {
  it("athlete can SELECT their own proposal", async () => {
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    await insertProposal(athlete.id, planId);

    const { data, error } = await athlete.client
      .from("weekly_reviews")
      .select("id, status")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("proposed");
  });

  it("linked coach can SELECT their athlete's proposal", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    await createCoachLink(coach.id, athlete.id);
    await insertProposal(athlete.id, planId, { recipient: "coach" });

    const { data, error } = await coach.client
      .from("weekly_reviews")
      .select("id")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("unlinked third user cannot SELECT another athlete's proposal", async () => {
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    await insertProposal(athlete.id, planId);

    const { data, error } = await stranger.client
      .from("weekly_reviews")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("athlete cannot directly UPDATE status (no UPDATE policy; RPC-only)", async () => {
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const { data: proposal } = await insertProposal(athlete.id, planId);

    // RLS with no UPDATE policy: the update matches no rows -> status unchanged.
    await athlete.client
      .from("weekly_reviews")
      .update({ status: "accepted" })
      .eq("id", proposal!.id);

    const admin = serviceClient();
    const { data } = await admin
      .from("weekly_reviews")
      .select("status")
      .eq("id", proposal!.id)
      .single();
    expect(data?.status).toBe("proposed");
  });
});

describe("weekly_reviews single-open invariant", () => {
  it("a second open plan-scoped proposal for the same athlete raises 23505", async () => {
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);

    const first = await insertProposal(athlete.id, planId, { scope: "plan" });
    expect(first.error).toBeNull();

    const second = await insertProposal(athlete.id, planId, { scope: "plan" });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });

  it("a workout-scoped proposal coexists with an open plan-scoped one", async () => {
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);

    const planScoped = await insertProposal(athlete.id, planId, { scope: "plan" });
    expect(planScoped.error).toBeNull();

    const workoutScoped = await insertProposal(athlete.id, planId, { scope: "workout" });
    expect(workoutScoped.error).toBeNull();
  });

  it("a superseded plan-scoped row does not block a new open one", async () => {
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const admin = serviceClient();

    const first = await insertProposal(athlete.id, planId, { scope: "plan" });
    await admin
      .from("weekly_reviews")
      .update({ status: "superseded", decided_at: new Date().toISOString() })
      .eq("id", first.data!.id);

    const second = await insertProposal(athlete.id, planId, { scope: "plan" });
    expect(second.error).toBeNull();
  });
});

describe("weekly_reviews delete_user_cascade", () => {
  it("soft-deletes the athlete's proposals", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const { data: proposal } = await insertProposal(athlete.id, planId);

    await admin.rpc("delete_user_cascade", { user_id: athlete.id });

    const { data } = await admin
      .from("weekly_reviews")
      .select("deleted_at")
      .eq("id", proposal!.id)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });
});
