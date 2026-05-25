// DB integration tests for public.planned_workouts (migration 0007).
// Covers:
//   - R8 (ad-hoc workouts via plan_id NULL)
//   - CHECK constraints (sport, status)
//   - FK behaviour: plan_id ON DELETE SET NULL (only on hard-delete);
//     athlete_id ON DELETE CASCADE
//   - The cross-athlete plan_id surprise (no SQL constraint connects
//     planned_workouts.athlete_id to plans.athlete_id) -- documented
//     for future contributors so it doesn't waste investigation time
//   - RLS positive + negative
//   - Edit attribution columns (app-set, no trigger)
//   - PlannedWorkoutRowSchema parses real PostgREST-returned rows
//   - planned_workouts_athlete_date partial index excludes soft-deleted
//     rows from calendar reads
//
// Companion file: plans.test.ts (DB tests for the parent table).

import { describe, expect, it } from "vitest";

import { PlannedWorkoutRowSchema } from "@da2/shared";

import { createTestUser, serviceClient } from "./setup";

describe("planned_workouts table", () => {
  it("ad-hoc workout (plan_id NULL) inserts and is readable", async () => {
    const user = await createTestUser();

    const { error: insertErr } = await user.client
      .from("planned_workouts")
      .insert({
        athlete_id: user.id,
        plan_id: null,
        scheduled_date: "2026-05-20",
        sport: "run",
      });
    expect(insertErr).toBeNull();

    const { data, error } = await user.client
      .from("planned_workouts")
      .select("sport, plan_id, status")
      .eq("athlete_id", user.id)
      .single();
    expect(error).toBeNull();
    expect(data?.sport).toBe("run");
    expect(data?.plan_id).toBeNull();
    expect(data?.status).toBe("planned"); // default
  });

  it("plan-attached workout: plan_id pointing at existing plan inserts cleanly", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { data: plan } = await admin
      .from("plans")
      .insert({
        athlete_id: user.id,
        status: "active",
        source: "ai_generated",
      })
      .select()
      .single();

    const { error } = await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      plan_id: plan?.id,
      scheduled_date: "2026-05-20",
      sport: "bike",
    });
    expect(error).toBeNull();
  });

  it("plan_id pointing at non-existent plan -> FK violation 23503", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      plan_id: "00000000-0000-0000-0000-000000000000",
      scheduled_date: "2026-05-20",
      sport: "swim",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("unknown sport rejected by CHECK constraint", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      scheduled_date: "2026-05-20",
      sport: "rowing",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("unknown status rejected by CHECK constraint", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      scheduled_date: "2026-05-20",
      sport: "run",
      status: "in_progress",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("edit attribution columns persist when set by UPDATE (no trigger interference)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      scheduled_date: "2026-05-20",
      sport: "run",
    });

    const editedAt = new Date().toISOString();
    await admin
      .from("planned_workouts")
      .update({
        edited_by_kind: "athlete",
        edited_by_user_id: user.id,
        edited_at: editedAt,
        rationale: "Bumped to harder session.",
      })
      .eq("athlete_id", user.id);

    const { data } = await admin
      .from("planned_workouts")
      .select("edited_by_kind, edited_by_user_id, edited_at, rationale")
      .eq("athlete_id", user.id)
      .single();

    expect(data?.edited_by_kind).toBe("athlete");
    expect(data?.edited_by_user_id).toBe(user.id);
    expect(data?.rationale).toBe("Bumped to harder session.");
    expect(data?.edited_at).toBeTruthy();
  });

  it("SQL accepts cross-athlete plan_id: planned_workouts.athlete_id need not match plans.athlete_id (documented surprise)", async () => {
    // The migration explicitly documents that no SQL constraint enforces
    // this cross-row consistency. Ad-hoc workouts require athlete_id
    // independently of plan_id. This test pins that surprising behaviour
    // so a future contributor doesn't waste time hunting for the
    // constraint they expect to exist. App-layer code is the only guard.
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    const { data: planB } = await admin
      .from("plans")
      .insert({
        athlete_id: userB.id,
        status: "active",
        source: "ai_generated",
      })
      .select()
      .single();

    // User A's workout pointing at user B's plan -- SQL says yes.
    const { error } = await admin.from("planned_workouts").insert({
      athlete_id: userA.id,
      plan_id: planB?.id,
      scheduled_date: "2026-05-20",
      sport: "run",
    });
    expect(error).toBeNull();
  });

  it("athlete A cannot see athlete B's workouts (RLS negative)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    await admin.from("planned_workouts").insert([
      {
        athlete_id: userA.id,
        scheduled_date: "2026-05-20",
        sport: "run",
      },
      {
        athlete_id: userB.id,
        scheduled_date: "2026-05-20",
        sport: "bike",
      },
    ]);

    const { data, error } = await userA.client
      .from("planned_workouts")
      .select("athlete_id, sport")
      .eq("athlete_id", userB.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("athlete A cannot INSERT a workout for athlete B (RLS WITH CHECK)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const { error } = await userA.client.from("planned_workouts").insert({
      athlete_id: userB.id,
      scheduled_date: "2026-05-20",
      sport: "run",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("calendar query: athlete + date range + deleted_at IS NULL returns ordered subset", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // Seed: 5 workouts across a 3-week window, plus one soft-deleted
    // workout inside the query window.
    const rows = [
      { athlete_id: user.id, scheduled_date: "2026-05-18", sport: "run" },
      { athlete_id: user.id, scheduled_date: "2026-05-20", sport: "bike" },
      { athlete_id: user.id, scheduled_date: "2026-05-22", sport: "swim" },
      {
        athlete_id: user.id,
        scheduled_date: "2026-05-25",
        sport: "strength",
      },
      // Outside the queried window:
      {
        athlete_id: user.id,
        scheduled_date: "2026-06-15",
        sport: "mobility",
      },
      // Inside the window but soft-deleted:
      {
        athlete_id: user.id,
        scheduled_date: "2026-05-21",
        sport: "run",
        deleted_at: new Date().toISOString(),
      },
    ];
    await admin.from("planned_workouts").insert(rows);

    const { data, error } = await user.client
      .from("planned_workouts")
      .select("scheduled_date, sport")
      .eq("athlete_id", user.id)
      .gte("scheduled_date", "2026-05-18")
      .lte("scheduled_date", "2026-05-31")
      .is("deleted_at", null)
      .order("scheduled_date", { ascending: true });

    expect(error).toBeNull();
    expect(data?.map((r) => r.scheduled_date)).toEqual([
      "2026-05-18",
      "2026-05-20",
      "2026-05-22",
      "2026-05-25",
    ]);
    // Soft-deleted row excluded; out-of-window row excluded.
    expect(data).toHaveLength(4);
  });

  it("FK cascade: deleting auth.users removes planned_workouts rows", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      scheduled_date: "2026-05-20",
      sport: "run",
    });

    await admin.auth.admin.deleteUser(user.id);

    const { data } = await admin
      .from("planned_workouts")
      .select("athlete_id")
      .eq("athlete_id", user.id);
    expect(data).toEqual([]);
  });

  it("FK SET NULL: hard-deleting a plan leaves planned_workouts.plan_id NULL", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { data: plan } = await admin
      .from("plans")
      .insert({
        athlete_id: user.id,
        status: "active",
        source: "ai_generated",
      })
      .select()
      .single();

    await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      plan_id: plan?.id,
      scheduled_date: "2026-05-20",
      sport: "run",
    });

    // Hard-delete the plan via service role (no DELETE policy for JWT
    // clients; this simulates the future account-deletion cascade).
    await admin.from("plans").delete().eq("id", plan?.id);

    const { data: workout } = await admin
      .from("planned_workouts")
      .select("plan_id, athlete_id")
      .eq("athlete_id", user.id)
      .single();

    expect(workout?.plan_id).toBeNull();
    expect(workout?.athlete_id).toBe(user.id);
  });

  it("PlannedWorkoutRowSchema parses a real PostgREST-returned row", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("planned_workouts").insert({
      athlete_id: user.id,
      scheduled_date: "2026-05-20",
      sport: "run",
      structure: { warmup: { duration_min: 10 }, main: { duration_min: 30 } },
      planned_load: 65.5,
      rationale: "Easy aerobic session.",
      edited_by_kind: "athlete",
      edited_by_user_id: user.id,
      edited_at: new Date().toISOString(),
    });

    const { data, error } = await admin
      .from("planned_workouts")
      .select(
        "id, athlete_id, plan_id, scheduled_date, sport, structure, planned_load, status, rationale, edited_by_kind, edited_by_user_id, edited_at, version, created_at, deleted_at",
      )
      .eq("athlete_id", user.id)
      .single();

    expect(error).toBeNull();
    const parsed = PlannedWorkoutRowSchema.parse(data);
    expect(parsed.sport).toBe("run");
    expect(parsed.status).toBe("planned");
    expect(parsed.planned_load).toBe(65.5);
    expect(parsed.edited_by_kind).toBe("athlete");
  });
});
