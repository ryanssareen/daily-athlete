// DB integration tests for public.plans (migration 0007).
// Covers:
//   - R7 enforcement via partial unique index plans_one_active_per_athlete
//     (including archive-then-create and soft-delete-then-create transitions)
//   - CHECK constraints (status, source, archived_at-implies-archived)
//   - RLS positive + negative
//   - FK cascade from auth.users -> public.users -> plans
//   - PlanRowSchema parses real PostgREST-returned rows
//
// Companion file: planned-workouts.test.ts (DB tests for the other table).

import { describe, expect, it } from "vitest";

import { PlanRowSchema } from "@da2/shared";

import { createTestUser, serviceClient } from "./setup";

describe("plans table", () => {
  it("athlete inserts an active plan and reads it back via JWT client", async () => {
    const user = await createTestUser();

    const { error: insertErr } = await user.client.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
    });
    expect(insertErr).toBeNull();

    const { data, error } = await user.client
      .from("plans")
      .select("athlete_id, status, source")
      .eq("athlete_id", user.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("active");
  });

  it("archive-then-create transition: both rows coexist", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
    });

    // Archive the existing active plan.
    await admin
      .from("plans")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("athlete_id", user.id);

    // Now a new active plan should be insertable.
    const { error: secondErr } = await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
    });
    expect(secondErr).toBeNull();

    const { data } = await admin
      .from("plans")
      .select("status")
      .eq("athlete_id", user.id);
    expect(data).toHaveLength(2);
    expect(data?.map((r) => r.status).sort()).toEqual(["active", "archived"]);
  });

  it("soft-delete-then-create transition: deleted row doesn't block new active", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
    });

    // Soft-delete the existing active plan.
    await admin
      .from("plans")
      .update({ deleted_at: new Date().toISOString() })
      .eq("athlete_id", user.id);

    // New active should now succeed.
    const { error } = await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
    });
    expect(error).toBeNull();
  });

  it("two active plans for same athlete -> 23505 (partial unique index)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
    });

    const { error } = await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "coach_assigned",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });

  it("unknown status rejected by CHECK constraint", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("plans").insert({
      athlete_id: user.id,
      status: "paused",
      source: "ai_generated",
    });
    expect(error).not.toBeNull();
    // Postgres CHECK violation code
    expect(error?.code).toBe("23514");
  });

  it("unknown source rejected by CHECK constraint", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "stripe",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("archived status without archived_at rejected by CHECK constraint", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // plans_archived_at_matches_status: status='archived' requires
    // archived_at IS NOT NULL.
    const { error } = await admin.from("plans").insert({
      athlete_id: user.id,
      status: "archived",
      source: "ai_generated",
      // archived_at intentionally omitted
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("athlete A cannot see athlete B's plan (RLS negative)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    await admin.from("plans").insert([
      { athlete_id: userA.id, status: "active", source: "ai_generated" },
      { athlete_id: userB.id, status: "active", source: "ai_generated" },
    ]);

    const { data: visibleToA, error } = await userA.client
      .from("plans")
      .select("athlete_id")
      .eq("athlete_id", userB.id);

    expect(error).toBeNull();
    expect(visibleToA).toEqual([]);
  });

  it("athlete A cannot INSERT a plan for athlete B (RLS WITH CHECK)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const { error } = await userA.client.from("plans").insert({
      athlete_id: userB.id,
      status: "active",
      source: "ai_generated",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("FK cascade: deleting auth.users removes plan rows (load-bearing)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
    });

    await admin.auth.admin.deleteUser(user.id);

    const { data } = await admin
      .from("plans")
      .select("athlete_id")
      .eq("athlete_id", user.id);
    expect(data).toEqual([]);
  });

  it("PlanRowSchema parses a real PostgREST-returned row", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "ai_generated",
      event_type: "marathon",
      event_date: "2026-10-15",
    });

    const { data, error } = await admin
      .from("plans")
      .select(
        "id, athlete_id, status, event_type, event_date, source, created_from_review_id, created_at, archived_at, deleted_at",
      )
      .eq("athlete_id", user.id)
      .single();

    expect(error).toBeNull();
    const parsed = PlanRowSchema.parse(data);
    expect(parsed.status).toBe("active");
    expect(parsed.source).toBe("ai_generated");
    expect(parsed.event_type).toBe("marathon");
    expect(parsed.event_date).toBe("2026-10-15");
    expect(parsed.created_from_review_id).toBeNull();
  });

  it("plans_athlete_lookup index excludes soft-deleted plans from listing", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("plans").insert([
      { athlete_id: user.id, status: "active", source: "ai_generated" },
    ]);
    // Soft-delete it, then insert a fresh active one
    await admin
      .from("plans")
      .update({ deleted_at: new Date().toISOString() })
      .eq("athlete_id", user.id);
    await admin.from("plans").insert({
      athlete_id: user.id,
      status: "active",
      source: "coach_assigned",
    });

    // Listing path: filter deleted_at IS NULL
    const { data } = await admin
      .from("plans")
      .select("source")
      .eq("athlete_id", user.id)
      .is("deleted_at", null);

    expect(data).toHaveLength(1);
    expect(data?.[0]?.source).toBe("coach_assigned");
  });
});
