// DB integration tests for the apply_weekly_review / reject_weekly_review RPCs
// (migration 0022, plan Unit 6). These run against a real local Supabase
// Postgres and exercise the transaction-local checks the SQL RPC owns:
//   - accept-all → status 'accepted', ops applied, workout_edits appended
//   - per-op version staleness → that op skipped_stale, status partially_accepted
//   - completed/matched refusal → refused_completed
//   - delete op → soft-delete (deleted_at set, never hard-deleted)
//   - plan-context change (event_date) → whole proposal superseded
//   - already-decided → idempotent guard (already_decided=true)
//   - reject happy + reject of an already-decided proposal (changed=false)
//
// NOTE: route-level non-recipient rejection (403) is covered by the pure-unit
// route tests; this file covers ONLY the SQL RPC behavior.
//
// Prerequisites: `supabase start` must be running locally (CI provides it).
// Docker-free local runs will skip via the harness's connection error.

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createActivePlan(athleteId: string, eventDate?: string | null) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("plans")
    .insert({
      athlete_id: athleteId,
      status: "active",
      source: "ai_generated",
      event_date: eventDate ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createActivePlan failed: ${error.message}`);
  return data.id as string;
}

async function createPlannedWorkout(
  athleteId: string,
  planId: string,
  over: Record<string, unknown> = {}
) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("planned_workouts")
    .insert({
      athlete_id: athleteId,
      plan_id: planId,
      scheduled_date: "2026-06-10",
      sport: "run",
      structure: { duration_s: 3600 },
      planned_load: 50,
      status: "planned",
      ...over,
    })
    .select("id, version, status")
    .single();
  if (error) throw new Error(`createPlannedWorkout failed: ${error.message}`);
  return data as { id: string; version: number; status: string };
}

async function insertProposal(
  athleteId: string,
  planId: string,
  proposedChanges: unknown[],
  over: Record<string, unknown> = {}
) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("weekly_reviews")
    .insert({
      athlete_id: athleteId,
      plan_id: planId,
      trigger_kind: "weekly",
      scope: "plan",
      recipient: "athlete",
      status: "proposed",
      proposed_changes: proposedChanges,
      ...over,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertProposal failed: ${error.message}`);
  return data.id as string;
}

function modifyOp(opId: string, workoutId: string, version: number) {
  return {
    op: {
      op_id: opId,
      kind: "modify",
      workout_id: workoutId,
      changes: { duration_s: 5400 },
      reason: "extend the long run",
    },
    baseline: { version },
  };
}

// ---------------------------------------------------------------------------
// apply_weekly_review
// ---------------------------------------------------------------------------

describe("apply_weekly_review RPC", () => {
  it("accept-all: applies the op, appends workout_edits, status → accepted", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const wk = await createPlannedWorkout(athlete.id, planId);
    const reviewId = await insertProposal(athlete.id, planId, [
      modifyOp("op-1", wk.id, wk.version),
    ]);

    const { data, error } = await admin.rpc("apply_weekly_review", {
      p_review_id: reviewId,
      p_accepted_op_ids: ["op-1"],
      p_actor_user_id: athlete.id,
    });
    expect(error).toBeNull();
    const res = data as { status: string; results: { op_id: string; outcome: string }[] };
    expect(res.status).toBe("accepted");
    expect(res.results).toHaveLength(1);
    expect(res.results[0].outcome).toBe("applied");

    // Workout edited with ai_review attribution.
    const { data: wkRow } = await admin
      .from("planned_workouts")
      .select("structure, edited_by_kind, edited_by_user_id")
      .eq("id", wk.id)
      .single();
    expect((wkRow?.structure as { duration_s: number }).duration_s).toBe(5400);
    expect(wkRow?.edited_by_kind).toBe("ai_review");
    expect(wkRow?.edited_by_user_id).toBe(athlete.id);

    // workout_edits audit row appended with the weekly_review_id.
    const { data: edits } = await admin
      .from("workout_edits")
      .select("actor_role, weekly_review_id")
      .eq("planned_workout_id", wk.id);
    expect((edits ?? []).length).toBe(1);
    expect(edits?.[0]?.actor_role).toBe("ai_review");
    expect(edits?.[0]?.weekly_review_id).toBe(reviewId);

    // Proposal terminal.
    const { data: rev } = await admin
      .from("weekly_reviews")
      .select("status, decided_at")
      .eq("id", reviewId)
      .single();
    expect(rev?.status).toBe("accepted");
    expect(rev?.decided_at).not.toBeNull();
  });

  it("per-op version staleness: a changed target is skipped_stale → partially_accepted", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const wk = await createPlannedWorkout(athlete.id, planId);
    // Baseline captured at version=wk.version, but the proposal references a
    // STALE baseline (version - 1) so the RPC's version compare mismatches.
    const reviewId = await insertProposal(athlete.id, planId, [
      modifyOp("op-1", wk.id, wk.version - 1),
    ]);

    const { data } = await admin.rpc("apply_weekly_review", {
      p_review_id: reviewId,
      p_accepted_op_ids: ["op-1"],
      p_actor_user_id: athlete.id,
    });
    const res = data as { status: string; results: { outcome: string }[] };
    expect(res.results[0].outcome).toBe("skipped_stale");
    expect(res.status).toBe("partially_accepted");
  });

  it("completed/matched refusal: an op on a completed workout is refused_completed", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const wk = await createPlannedWorkout(athlete.id, planId, { status: "completed" });
    const reviewId = await insertProposal(athlete.id, planId, [
      modifyOp("op-1", wk.id, wk.version),
    ]);

    const { data } = await admin.rpc("apply_weekly_review", {
      p_review_id: reviewId,
      p_accepted_op_ids: ["op-1"],
      p_actor_user_id: athlete.id,
    });
    const res = data as { results: { outcome: string }[] };
    expect(res.results[0].outcome).toBe("refused_completed");
  });

  it("delete op: soft-deletes (deleted_at set), never hard-deletes", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const wk = await createPlannedWorkout(athlete.id, planId);
    const reviewId = await insertProposal(athlete.id, planId, [
      {
        op: { op_id: "op-del", kind: "delete", workout_id: wk.id, reason: "remove" },
        baseline: { version: wk.version },
      },
    ]);

    const { data } = await admin.rpc("apply_weekly_review", {
      p_review_id: reviewId,
      p_accepted_op_ids: ["op-del"],
      p_actor_user_id: athlete.id,
    });
    const res = data as { status: string };
    expect(res.status).toBe("accepted");

    const { data: wkRow } = await admin
      .from("planned_workouts")
      .select("deleted_at")
      .eq("id", wk.id)
      .maybeSingle();
    // Row still exists (soft delete) with deleted_at set.
    expect(wkRow).not.toBeNull();
    expect(wkRow?.deleted_at).not.toBeNull();
  });

  it("plan-context change (event_date moved) → whole proposal superseded", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    // Snapshot event_date = null at generation, but the plan now has a date.
    const planId = await createActivePlan(athlete.id, "2026-09-01");
    const wk = await createPlannedWorkout(athlete.id, planId);
    const reviewId = await insertProposal(
      athlete.id,
      planId,
      [modifyOp("op-1", wk.id, wk.version)],
      { event_date_snapshot: null } // mismatch → superseded
    );

    const { data } = await admin.rpc("apply_weekly_review", {
      p_review_id: reviewId,
      p_accepted_op_ids: ["op-1"],
      p_actor_user_id: athlete.id,
    });
    const res = data as { status: string; superseded: boolean };
    expect(res.superseded).toBe(true);
    expect(res.status).toBe("superseded");

    const { data: rev } = await admin
      .from("weekly_reviews")
      .select("status")
      .eq("id", reviewId)
      .single();
    expect(rev?.status).toBe("superseded");
  });

  it("already-decided: a second apply returns already_decided=true and does not re-apply", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const wk = await createPlannedWorkout(athlete.id, planId);
    const reviewId = await insertProposal(athlete.id, planId, [
      modifyOp("op-1", wk.id, wk.version),
    ]);

    await admin.rpc("apply_weekly_review", {
      p_review_id: reviewId,
      p_accepted_op_ids: ["op-1"],
      p_actor_user_id: athlete.id,
    });
    const { data } = await admin.rpc("apply_weekly_review", {
      p_review_id: reviewId,
      p_accepted_op_ids: ["op-1"],
      p_actor_user_id: athlete.id,
    });
    const res = data as { already_decided?: boolean; status: string };
    expect(res.already_decided).toBe(true);
    expect(res.status).toBe("accepted");
  });
});

// ---------------------------------------------------------------------------
// reject_weekly_review
// ---------------------------------------------------------------------------

describe("reject_weekly_review RPC", () => {
  it("rejects a proposed proposal → status rejected, changed=true", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const reviewId = await insertProposal(athlete.id, planId, []);

    const { data } = await admin.rpc("reject_weekly_review", { p_review_id: reviewId });
    const res = data as { status: string; changed: boolean };
    expect(res.status).toBe("rejected");
    expect(res.changed).toBe(true);
  });

  it("rejecting an already-decided proposal is a no-op (changed=false)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const planId = await createActivePlan(athlete.id);
    const reviewId = await insertProposal(athlete.id, planId, []);

    await admin.rpc("reject_weekly_review", { p_review_id: reviewId });
    const { data } = await admin.rpc("reject_weekly_review", { p_review_id: reviewId });
    const res = data as { status: string; changed: boolean };
    expect(res.changed).toBe(false);
    expect(res.status).toBe("rejected");
  });
});
