// DB integration tests for db/plans.ts (listPlans/getPlan/archivePlan/
// softDeletePlan) and the archive_plan/soft_delete_plan RPCs (migration
// 0027, plan Unit 1).
//
// Companion files: plans.test.ts (raw plans table schema/RLS/CHECK
// constraints), create-ai-plan.test.ts (the create_ai_plan RPC this
// migration's cascade pattern mirrors).

import { describe, expect, it } from "vitest";

import { archivePlan, getPlan, listPlans, softDeletePlan } from "../plans";
import { createTestUser, serviceClient } from "./setup";

type Admin = ReturnType<typeof serviceClient>;

async function insertPlan(
  admin: Admin,
  athleteId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await admin
    .from("plans")
    .insert({
      athlete_id: athleteId,
      status: "active",
      source: "ai_generated",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertPlan: ${error.message}`);
  return data.id as string;
}

async function insertPlannedWorkout(
  admin: Admin,
  athleteId: string,
  planId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await admin
    .from("planned_workouts")
    .insert({
      athlete_id: athleteId,
      plan_id: planId,
      scheduled_date: "2026-09-01",
      sport: "run",
      status: "planned",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertPlannedWorkout: ${error.message}`);
  return data.id as string;
}

describe("listPlans", () => {
  it("returns only the athlete's own plans, excludes soft-deleted, newest first", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const other = await createTestUser();

    const older = await insertPlan(admin, user.id, {
      status: "archived",
      archived_at: new Date().toISOString(),
    });
    // Ensure ordering is unambiguous even with same-millisecond created_at.
    await new Promise((r) => setTimeout(r, 10));
    const newer = await insertPlan(admin, user.id);
    const deleted = await insertPlan(admin, user.id, {
      status: "archived",
      archived_at: new Date().toISOString(),
    });
    await admin
      .from("plans")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deleted);
    await insertPlan(admin, other.id);

    const result = await listPlans(admin, user.id);
    expect(result.map((p) => p.id)).toEqual([newer, older]);
  });

  it("returns an empty array, not an error, for an athlete with no plans", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    expect(await listPlans(admin, user.id)).toEqual([]);
  });
});

describe("getPlan", () => {
  it("returns the plan when owned and not deleted", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);

    const result = await getPlan(admin, user.id, planId);
    expect(result?.id).toBe(planId);
  });

  it("returns null for another athlete's plan", async () => {
    const admin = serviceClient();
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const planId = await insertPlan(admin, owner.id);

    expect(await getPlan(admin, stranger.id, planId)).toBeNull();
  });

  it("returns null for a soft-deleted plan", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);
    await admin
      .from("plans")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", planId);

    expect(await getPlan(admin, user.id, planId)).toBeNull();
  });
});

describe("archivePlan", () => {
  it("transitions an active plan to archived and sets archived_at", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);

    const result = await archivePlan(admin, user.id, planId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.status).toBe("archived");
      expect(result.plan.archived_at).not.toBeNull();
    }
  });

  it("is idempotent on an already-archived plan, does not touch archived_at again", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);

    const first = await archivePlan(admin, user.id, planId);
    const firstArchivedAt = first.ok ? first.plan.archived_at : null;
    await new Promise((r) => setTimeout(r, 10));
    const second = await archivePlan(admin, user.id, planId);

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.plan.archived_at).toBe(firstArchivedAt);
    }
  });

  it("returns not_found for another athlete's plan", async () => {
    const admin = serviceClient();
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const planId = await insertPlan(admin, owner.id);

    expect(await archivePlan(admin, stranger.id, planId)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns not_found for a soft-deleted plan -- archiving a gone plan is not resurrecting it", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);
    await admin
      .from("plans")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", planId);

    expect(await archivePlan(admin, user.id, planId)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("succeeds on the athlete's only active plan, leaving zero active plans without a unique-index violation", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);

    const result = await archivePlan(admin, user.id, planId);
    expect(result.ok).toBe(true);

    const { data: active } = await admin
      .from("plans")
      .select("id")
      .eq("athlete_id", user.id)
      .eq("status", "active")
      .is("deleted_at", null);
    expect(active).toEqual([]);
  });

  it("soft-deletes only the plan's planned-status workouts, leaving completed workouts untouched", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);
    const plannedA = await insertPlannedWorkout(admin, user.id, planId);
    const plannedB = await insertPlannedWorkout(admin, user.id, planId, {
      scheduled_date: "2026-09-02",
    });
    const completed = await insertPlannedWorkout(admin, user.id, planId, {
      scheduled_date: "2026-08-25",
      status: "completed",
    });

    await archivePlan(admin, user.id, planId);

    const { data: rows } = await admin
      .from("planned_workouts")
      .select("id, deleted_at")
      .in("id", [plannedA, plannedB, completed]);
    const byId = new Map(rows!.map((r) => [r.id, r.deleted_at]));
    expect(byId.get(plannedA)).not.toBeNull();
    expect(byId.get(plannedB)).not.toBeNull();
    expect(byId.get(completed)).toBeNull();
  });
});

describe("softDeletePlan", () => {
  it("sets deleted_at on an active plan", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);

    const result = await softDeletePlan(admin, user.id, planId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.deleted_at).not.toBeNull();
  });

  it("sets deleted_at on an archived plan", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id, {
      status: "archived",
      archived_at: new Date().toISOString(),
    });

    const result = await softDeletePlan(admin, user.id, planId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.deleted_at).not.toBeNull();
  });

  it("is idempotent on an already-deleted plan (no error)", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);

    const first = await softDeletePlan(admin, user.id, planId);
    const second = await softDeletePlan(admin, user.id, planId);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.plan.deleted_at).toBe(first.plan.deleted_at);
    }
  });

  it("returns not_found for another athlete's plan", async () => {
    const admin = serviceClient();
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const planId = await insertPlan(admin, owner.id);

    expect(await softDeletePlan(admin, stranger.id, planId)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("succeeds on the athlete's only active plan, leaving zero active plans", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);

    const result = await softDeletePlan(admin, user.id, planId);
    expect(result.ok).toBe(true);

    const { data: active } = await admin
      .from("plans")
      .select("id")
      .eq("athlete_id", user.id)
      .eq("status", "active")
      .is("deleted_at", null);
    expect(active).toEqual([]);
  });

  it("also soft-deletes planned-status workouts when called directly on an active plan (no prior archive step)", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);
    const planned = await insertPlannedWorkout(admin, user.id, planId);

    await softDeletePlan(admin, user.id, planId);

    const { data } = await admin
      .from("planned_workouts")
      .select("deleted_at")
      .eq("id", planned)
      .single();
    expect(data!.deleted_at).not.toBeNull();
  });

  it("after archive or delete, a calendar-range read no longer returns the retired plan's workouts", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const planId = await insertPlan(admin, user.id);
    await insertPlannedWorkout(admin, user.id, planId);

    await softDeletePlan(admin, user.id, planId);

    const { data } = await admin
      .from("planned_workouts")
      .select("id")
      .eq("athlete_id", user.id)
      .is("deleted_at", null)
      .gte("scheduled_date", "2026-08-01")
      .lte("scheduled_date", "2026-09-30");
    expect(data).toEqual([]);
  });
});
