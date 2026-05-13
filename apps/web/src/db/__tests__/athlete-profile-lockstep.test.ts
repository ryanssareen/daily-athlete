// Tests for the auto-stamping trigger on athlete_profiles.manual_field_edited_at
// from migration 0005_athlete_profiles_lockstep_trigger.sql. The trigger
// is the DB-side enforcement of the R5 invariant ("derivation never
// overwrites manual fields") -- callers no longer write
// manual_field_edited_at directly.

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

type ProfileRow = {
  user_id: string;
  manual_fields: Record<string, unknown>;
  manual_field_edited_at: Record<string, string>;
  baselines: Record<string, unknown>;
  derived_at: string | null;
};

async function readProfile(userId: string): Promise<ProfileRow> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("athlete_profiles")
    .select("user_id, manual_fields, manual_field_edited_at, baselines, derived_at")
    .eq("user_id", userId)
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("profile row missing");
  return data as ProfileRow;
}

describe("athlete_profiles lockstep trigger (migration 0005)", () => {
  it("INSERT stamps every top-level key of manual_fields", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34, weight_kg: 72 },
    });
    expect(error).toBeNull();

    const row = await readProfile(user.id);
    expect(Object.keys(row.manual_field_edited_at).sort()).toEqual([
      "age",
      "weight_kg",
    ]);
    expect(typeof row.manual_field_edited_at.age).toBe("string");
    expect(typeof row.manual_field_edited_at.weight_kg).toBe("string");
  });

  it("INSERT with empty manual_fields produces empty edited_at", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: {},
    });
    expect(error).toBeNull();

    const row = await readProfile(user.id);
    expect(row.manual_field_edited_at).toEqual({});
  });

  it("UPDATE that adds a key stamps only the new key", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34 },
    });
    const before = await readProfile(user.id);
    const ageStamp = before.manual_field_edited_at.age;

    await admin
      .from("athlete_profiles")
      .update({ manual_fields: { age: 34, weight_kg: 72 } })
      .eq("user_id", user.id);

    const after = await readProfile(user.id);
    expect(after.manual_field_edited_at.age).toBe(ageStamp);
    expect(typeof after.manual_field_edited_at.weight_kg).toBe("string");
  });

  it("UPDATE that changes an existing key's value refreshes that key's stamp", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34 },
    });
    const before = await readProfile(user.id);
    const beforeStamp = before.manual_field_edited_at.age;

    // Wait a beat so the transaction times differ at the precision we
    // care about. PG's now() is microsecond-precise; in practice
    // consecutive transactions are far enough apart that the stamps
    // differ without sleeping, but be defensive.
    await new Promise((r) => setTimeout(r, 5));

    await admin
      .from("athlete_profiles")
      .update({ manual_fields: { age: 35 } })
      .eq("user_id", user.id);

    const after = await readProfile(user.id);
    expect(after.manual_field_edited_at.age).not.toBe(beforeStamp);
  });

  it("UPDATE that removes a key drops that key from edited_at too", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34, weight_kg: 72 },
    });

    await admin
      .from("athlete_profiles")
      .update({ manual_fields: { weight_kg: 72 } })
      .eq("user_id", user.id);

    const after = await readProfile(user.id);
    expect(Object.keys(after.manual_field_edited_at)).toEqual(["weight_kg"]);
  });

  it("UPDATE with no-op manual_fields change leaves edited_at byte-identical", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34 },
    });
    const before = await readProfile(user.id);

    await new Promise((r) => setTimeout(r, 5));

    // Write the same manual_fields back.
    await admin
      .from("athlete_profiles")
      .update({ manual_fields: { age: 34 } })
      .eq("user_id", user.id);

    const after = await readProfile(user.id);
    expect(after.manual_field_edited_at).toEqual(before.manual_field_edited_at);
  });

  it("derivation-only UPDATE (baselines, derived_at) leaves edited_at untouched", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34, weight_kg: 72 },
    });
    const before = await readProfile(user.id);

    await new Promise((r) => setTimeout(r, 5));

    // Simulate derivation: write baselines + derived_at, do NOT touch
    // manual_fields. This is the R5 invariant in practice.
    const nowIso = new Date().toISOString();
    await admin
      .from("athlete_profiles")
      .update({
        baselines: {
          per_sport: { run: { z2_pace_s_per_km: 300 } },
          confidence: "med",
        },
        derived_at: nowIso,
      })
      .eq("user_id", user.id);

    const after = await readProfile(user.id);
    expect(after.manual_fields).toEqual(before.manual_fields);
    expect(after.manual_field_edited_at).toEqual(before.manual_field_edited_at);
    expect(after.baselines).not.toEqual(before.baselines);
  });

  it("trigger overrides any value the caller writes for manual_field_edited_at", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // Caller tries to set both manual_fields AND a bogus historical stamp.
    // The trigger must overwrite the bogus stamp with now().
    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: { age: 34 },
      manual_field_edited_at: { age: "2020-01-01T00:00:00+00:00" },
    });

    const row = await readProfile(user.id);
    expect(row.manual_field_edited_at.age).not.toBe("2020-01-01T00:00:00+00:00");
    // Sanity: still a string-shaped timestamp
    expect(typeof row.manual_field_edited_at.age).toBe("string");
    // Sanity: it parses as a Date in the recent past (within last 60s).
    const stampMs = Date.parse(row.manual_field_edited_at.age);
    expect(Date.now() - stampMs).toBeLessThan(60_000);
  });

  it("target_event sub-shape changes count as one key change", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("athlete_profiles").insert({
      user_id: user.id,
      manual_fields: {
        target_event: { type: "marathon", date: "2026-10-15" },
      },
    });
    const before = await readProfile(user.id);
    const beforeStamp = before.manual_field_edited_at.target_event;

    await new Promise((r) => setTimeout(r, 5));

    // Edit inner field; from the trigger's perspective, target_event is
    // one top-level key and its value changed.
    await admin
      .from("athlete_profiles")
      .update({
        manual_fields: {
          target_event: { type: "marathon", date: "2026-11-01" },
        },
      })
      .eq("user_id", user.id);

    const after = await readProfile(user.id);
    expect(after.manual_field_edited_at.target_event).not.toBe(beforeStamp);
    expect(Object.keys(after.manual_field_edited_at)).toEqual(["target_event"]);
  });

  it("works under the JWT-bound RLS path (athlete updating own profile)", async () => {
    const user = await createTestUser();

    // Athlete inserts their own profile via the JWT-bound client (RLS-allowed).
    const { error: insertErr } = await user.client
      .from("athlete_profiles")
      .insert({
        user_id: user.id,
        manual_fields: { age: 34 },
      });
    expect(insertErr).toBeNull();

    // Athlete updates own profile via JWT-bound client.
    const { error: updateErr } = await user.client
      .from("athlete_profiles")
      .update({ manual_fields: { age: 35, weight_kg: 72 } })
      .eq("user_id", user.id);
    expect(updateErr).toBeNull();

    const row = await readProfile(user.id);
    expect(Object.keys(row.manual_field_edited_at).sort()).toEqual([
      "age",
      "weight_kg",
    ]);
  });
});
