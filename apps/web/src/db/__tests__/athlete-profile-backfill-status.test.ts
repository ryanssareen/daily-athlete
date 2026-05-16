// Integration tests for migration 0009_athlete_profiles_backfill_status.sql
// + the `BackfillStatusColumnSchema` contract from
// packages/shared/src/strava-backfill.ts.
//
// Coverage:
// - Column exists with the documented default `{}`.
// - The new `athlete_profiles_backfill_status_well_formed` CHECK constraint
//   rejects malformed JSONB (string, non-object, unknown state value,
//   non-strava provider) and accepts the documented shapes.
// - The lockstep trigger from migration 0005 NO-OPS for backfill_status-only
//   writes (manual_field_edited_at unchanged). This is the load-bearing
//   "trigger isolation" pin -- if a future trigger change starts watching
//   backfill_status, this regression catches it.
// - RLS: athlete-self SELECT works for own row; cross-athlete SELECT returns
//   no rows.
// - Service-role writes succeed (the Inngest worker path).

import { describe, expect, it } from "vitest";

import { BackfillStatusColumnSchema } from "@da2/shared";

import { createTestUser, serviceClient } from "./setup";

const PG_CHECK_VIOLATION = "23514";

type BackfillStatusRow = {
  backfill_status: Record<string, unknown>;
  manual_field_edited_at: Record<string, string>;
};

async function readBackfillRow(userId: string): Promise<BackfillStatusRow> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("athlete_profiles")
    .select("backfill_status, manual_field_edited_at")
    .eq("user_id", userId)
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("profile row missing");
  return data as BackfillStatusRow;
}

describe("athlete_profiles.backfill_status (migration 0009)", () => {
  it("INSERT without backfill_status leaves the documented '{}' default", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin
      .from("athlete_profiles")
      .insert({ user_id: user.id });
    expect(error).toBeNull();

    const row = await readBackfillRow(user.id);
    expect(row.backfill_status).toEqual({});

    // Round-trips through the Zod contract as `state: undefined`.
    const parsed = BackfillStatusColumnSchema.parse(row.backfill_status);
    expect(parsed.state).toBeUndefined();
  });

  it("accepts a documented queued status", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin
      .from("athlete_profiles")
      .insert({
        user_id: user.id,
        backfill_status: { provider: "strava", state: "queued" },
      });
    expect(error).toBeNull();

    const row = await readBackfillRow(user.id);
    expect(row.backfill_status).toEqual({
      provider: "strava",
      state: "queued",
    });
  });

  it("accepts an in_progress status with counts", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("athlete_profiles").insert({
      user_id: user.id,
      backfill_status: {
        provider: "strava",
        state: "in_progress",
        completed: 100,
        estimated_total: 200,
      },
    });
    expect(error).toBeNull();

    const row = await readBackfillRow(user.id);
    expect(row.backfill_status.state).toBe("in_progress");
    expect(row.backfill_status.completed).toBe(100);
  });
});

describe("athlete_profiles_backfill_status_well_formed CHECK (migration 0009)", () => {
  it("rejects a string (non-object jsonb)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // Insert the row first with the default so the conditional UPDATE
    // exercises the CHECK on its own.
    await admin.from("athlete_profiles").insert({ user_id: user.id });

    const { error } = await admin
      .from("athlete_profiles")
      .update({ backfill_status: "queued" as unknown as Record<string, unknown> })
      .eq("user_id", user.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("rejects an unknown state value", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    await admin.from("athlete_profiles").insert({ user_id: user.id });

    const { error } = await admin
      .from("athlete_profiles")
      .update({
        backfill_status: { provider: "strava", state: "bogus" } as Record<
          string,
          unknown
        >,
      })
      .eq("user_id", user.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("rejects a non-strava provider", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    await admin.from("athlete_profiles").insert({ user_id: user.id });

    const { error } = await admin
      .from("athlete_profiles")
      .update({
        backfill_status: { provider: "garmin", state: "queued" } as Record<
          string,
          unknown
        >,
      })
      .eq("user_id", user.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("rejects an object with no state when not the empty default", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    await admin.from("athlete_profiles").insert({ user_id: user.id });

    // No `state` key + non-empty: must fail the CHECK.
    const { error } = await admin
      .from("athlete_profiles")
      .update({
        backfill_status: { provider: "strava" } as Record<string, unknown>,
      })
      .eq("user_id", user.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("accepts the empty default {} (documented initial value)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();
    await admin.from("athlete_profiles").insert({ user_id: user.id });

    const { error } = await admin
      .from("athlete_profiles")
      .update({ backfill_status: {} as Record<string, unknown> })
      .eq("user_id", user.id);
    expect(error).toBeNull();
  });
});

describe("athlete_profiles lockstep trigger isolation under backfill_status writes", () => {
  it("backfill_status-only UPDATE does NOT mutate manual_field_edited_at", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // Seed with manual_fields so the trigger has stamps to potentially churn.
    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34, weight_kg: 72 },
    });
    const before = await readBackfillRow(user.id);
    const beforeStamps = before.manual_field_edited_at;
    expect(Object.keys(beforeStamps).sort()).toEqual(["age", "weight_kg"]);

    // Sleep slightly so an unexpected re-stamp would produce a different
    // timestamp value.
    await new Promise((r) => setTimeout(r, 5));

    // Write only backfill_status. The lockstep trigger watches manual_fields
    // only and should no-op (IS NOT DISTINCT FROM passes through).
    const { error } = await admin
      .from("athlete_profiles")
      .update({
        backfill_status: { provider: "strava", state: "in_progress", completed: 50 },
      })
      .eq("user_id", user.id);
    expect(error).toBeNull();

    const after = await readBackfillRow(user.id);
    expect(after.manual_field_edited_at).toEqual(beforeStamps);
    expect(after.backfill_status.state).toBe("in_progress");
    expect(after.backfill_status.completed).toBe(50);
  });
});

describe("athlete_profiles.backfill_status RLS posture", () => {
  it("athlete can SELECT their own backfill_status through RLS", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      backfill_status: { provider: "strava", state: "complete", completed: 200 },
    });

    // Use the JWT-bound client (athlete-self SELECT policy).
    const { data, error } = await user.client
      .from("athlete_profiles")
      .select("backfill_status")
      .eq("user_id", user.id)
      .single();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data?.backfill_status as Record<string, unknown>).state).toBe(
      "complete",
    );
  });

  it("athlete A cannot SELECT athlete B's backfill_status", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    // Seed userB's row only.
    await admin.from("athlete_profiles").insert({
      user_id: userB.id,
      backfill_status: { provider: "strava", state: "in_progress", completed: 10 },
    });

    // A tries to read B's row. RLS should hide it -- expect 0 rows, no error.
    const { data, error } = await userA.client
      .from("athlete_profiles")
      .select("backfill_status")
      .eq("user_id", userB.id);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
