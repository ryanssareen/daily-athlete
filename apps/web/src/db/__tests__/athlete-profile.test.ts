// Tests for the athlete_profiles row contract:
// - RLS positive + negative (athlete-self policies from migration 0004)
// - PK uniqueness (1:1 with users)
// - First-touch race tolerance via ON CONFLICT DO NOTHING
// - touch_updated_at trigger still fires alongside the lockstep trigger
// - FK cascade from auth.users -> public.users -> athlete_profiles
//   (LOAD-BEARING: this test pins the contract that lets Unit 10's future
//   delete_user_cascade function OMIT athlete_profiles -- the cascade
//   handles teardown automatically. If this test ever needs to relax,
//   Unit 10 must add athlete_profiles to the cascade function first.)
// - AthleteProfileRowSchema parses a real PostgREST-returned row
//   (validates the .datetime({offset: true}) convention from Unit 2)
//
// Trigger semantics for manual_field_edited_at are covered separately
// in athlete-profile-lockstep.test.ts (Unit 3 of #43).

import { describe, expect, it } from "vitest";

import { AthleteProfileRowSchema } from "@da2/shared";

import { createTestUser, serviceClient } from "./setup";

describe("athlete_profiles RLS + cascade + first-touch race", () => {
  it("athlete reads own profile via JWT client (RLS positive)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // Seed the profile via service role (RLS bypass for setup).
    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34 },
    });

    const { data, error } = await user.client
      .from("athlete_profiles")
      .select("user_id, manual_fields")
      .eq("user_id", user.id)
      .single();

    expect(error).toBeNull();
    expect(data?.user_id).toBe(user.id);
    expect(data?.manual_fields).toEqual({ age: 34 });
  });

  it("athlete cannot read another athlete's profile (RLS negative)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    await admin
      .from("athlete_profiles")
      .insert([
        { user_id: userA.id, manual_fields: { age: 30 } },
        { user_id: userB.id, manual_fields: { age: 40 } },
      ]);

    const { data, error } = await userA.client
      .from("athlete_profiles")
      .select("user_id")
      .eq("user_id", userB.id);

    // RLS returns zero rows rather than 42501 for SELECT.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("athlete cannot UPDATE another athlete's profile (RLS denial)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    await admin
      .from("athlete_profiles")
      .insert({ user_id: userB.id, manual_fields: { age: 40 } });

    // userA attempts to mutate userB's row. RLS UPDATE policy requires
    // auth.uid() = user_id; the WHERE clause does not match the
    // policy condition for userA, so the UPDATE affects zero rows.
    // Either zero-rows-affected or a 42501 is acceptable depending on
    // PostgREST behaviour; just verify the row was NOT changed.
    await userA.client
      .from("athlete_profiles")
      .update({ manual_fields: { age: 999 } })
      .eq("user_id", userB.id);

    const { data } = await admin
      .from("athlete_profiles")
      .select("manual_fields")
      .eq("user_id", userB.id)
      .single();

    expect(data?.manual_fields).toEqual({ age: 40 });
  });

  it("athlete cannot INSERT a profile for another user (RLS WITH CHECK denial)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const { error } = await userA.client
      .from("athlete_profiles")
      .insert({ user_id: userB.id, manual_fields: { age: 99 } });

    // RLS WITH CHECK should reject this since auth.uid() != user_id.
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("second INSERT for the same user_id raises PK violation (1:1 invariant)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error: firstErr } = await admin
      .from("athlete_profiles")
      .insert({ user_id: user.id, manual_fields: {} });
    expect(firstErr).toBeNull();

    const { error: secondErr } = await admin
      .from("athlete_profiles")
      .insert({ user_id: user.id, manual_fields: { age: 30 } });

    expect(secondErr).not.toBeNull();
    expect(secondErr?.code).toBe("23505");
  });

  it("two concurrent first-touch INSERTs (ON CONFLICT DO NOTHING) settle to exactly one row", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // Simulates the mobile + web simultaneous open scenario. Both clients
    // attempt the initial INSERT; the unique constraint on user_id ensures
    // only one wins, and ON CONFLICT DO NOTHING swallows the loser's error.
    const concurrent = [
      admin
        .from("athlete_profiles")
        .insert({ user_id: user.id, manual_fields: { age: 30 } })
        .select(),
      admin
        .from("athlete_profiles")
        .insert({ user_id: user.id, manual_fields: { age: 40 } })
        .select(),
    ];

    // Note: supabase-js doesn't expose ON CONFLICT DO NOTHING directly via
    // .insert(); use .upsert with onConflict and ignoreDuplicates instead.
    // Re-issue using that semantics:
    const results = await Promise.all([
      admin
        .from("athlete_profiles")
        .upsert(
          { user_id: user.id, manual_fields: { age: 30 } },
          { onConflict: "user_id", ignoreDuplicates: true },
        ),
      admin
        .from("athlete_profiles")
        .upsert(
          { user_id: user.id, manual_fields: { age: 40 } },
          { onConflict: "user_id", ignoreDuplicates: true },
        ),
    ]);

    // Either both succeed (ON CONFLICT DO NOTHING swallows the loser) or
    // one wins. Neither should error.
    for (const r of results) {
      expect(r.error).toBeNull();
    }

    // Suppress unused-var warning for the earlier setup block; we deliberately
    // didn't await it.
    void concurrent;

    const { data } = await admin
      .from("athlete_profiles")
      .select("user_id, manual_fields")
      .eq("user_id", user.id);

    expect(data).toHaveLength(1);
  });

  it("touch_updated_at trigger advances updated_at on UPDATE", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin
      .from("athlete_profiles")
      .insert({ user_id: user.id, manual_fields: { age: 30 } });

    const { data: before } = await admin
      .from("athlete_profiles")
      .select("updated_at")
      .eq("user_id", user.id)
      .single();

    // Wait a beat so the next transaction's now() is observably later.
    await new Promise((r) => setTimeout(r, 5));

    await admin
      .from("athlete_profiles")
      .update({ manual_fields: { age: 31 } })
      .eq("user_id", user.id);

    const { data: after } = await admin
      .from("athlete_profiles")
      .select("updated_at")
      .eq("user_id", user.id)
      .single();

    expect(after?.updated_at).not.toBe(before?.updated_at);
    expect(Date.parse(after?.updated_at ?? "")).toBeGreaterThan(
      Date.parse(before?.updated_at ?? ""),
    );
  });

  it("FK cascade: deleting the auth user removes athlete_profiles row (LOAD-BEARING)", async () => {
    // This test pins the contract that lets Unit 10's future
    // delete_user_cascade function OMIT athlete_profiles. If this test
    // ever fails or must be relaxed, Unit 10 must explicitly add
    // athlete_profiles to its delete list before relying on the cascade.
    const user = await createTestUser();
    const admin = serviceClient();

    await admin
      .from("athlete_profiles")
      .insert({ user_id: user.id, manual_fields: { age: 30 } });

    // Confirm seeded.
    const { data: beforeRow } = await admin
      .from("athlete_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    expect(beforeRow?.user_id).toBe(user.id);

    // Delete the auth.users row. The trigger network is:
    //   auth.users (DELETE) -> public.users (FK CASCADE)
    //                      -> athlete_profiles (FK CASCADE on user_id)
    await admin.auth.admin.deleteUser(user.id);

    const { data: afterRow } = await admin
      .from("athlete_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    expect(afterRow).toBeNull();
  });

  it("AthleteProfileRowSchema parses a real PostgREST-returned row", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34, weight_kg: 72 },
      baselines: { confidence: "low" },
      weekly_volume_ewma: { run_min: 120 },
    });

    const { data, error } = await admin
      .from("athlete_profiles")
      .select(
        "user_id, baselines, weekly_volume_ewma, manual_fields, manual_field_edited_at, derived_at, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .single();

    expect(error).toBeNull();

    // The real test: the offset-format timestamps PostgREST returns must
    // parse against AthleteProfileRowSchema. Without the
    // .datetime({offset: true}) fix from Unit 2, this would fail.
    const parsed = AthleteProfileRowSchema.parse(data);
    expect(parsed.user_id).toBe(user.id);
    expect(parsed.manual_fields).toEqual({ age: 34, weight_kg: 72 });
    expect(parsed.derived_at).toBeNull();
    // manual_field_edited_at populated by lockstep trigger
    expect(Object.keys(parsed.manual_field_edited_at).sort()).toEqual([
      "age",
      "weight_kg",
    ]);
  });
});
