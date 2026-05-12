// Smoke test for the vitest + Supabase test harness. Proves:
//  1. The runner is wired (test executes at all).
//  2. Service-role client can reach Postgres.
//  3. createTestUser() returns a JWT-bound client and the user is mirrored
//     into public.users via the existing auth trigger (migration 0001).
//  4. RLS is enforced under the JWT path: own row visible, another user's
//     row not visible.
//  5. Track-and-cleanup isolation: state from one test does not leak into
//     the next.
//
// Future tests under apps/web/src/db/__tests__/ should follow the same
// pattern: createTestUser() per actor, assert via the JWT-bound client.

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

describe("vitest + Supabase harness smoke", () => {
  it("can query the local DB via the service-role client", async () => {
    const admin = serviceClient();
    // `auth.users` count is a cheap sanity check: the call requires both a
    // working network round-trip to PostgREST and a valid service-role JWT.
    const { count, error } = await admin
      .from("users")
      .select("*", { head: true, count: "exact" });
    expect(error).toBeNull();
    expect(typeof count).toBe("number");
  });

  it("creates an auth user and mirrors it into public.users", async () => {
    const user = await createTestUser();
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const admin = serviceClient();
    const { data, error } = await admin
      .from("users")
      .select("id, email, role_flags, timezone")
      .eq("id", user.id)
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBe(user.id);
    expect(data?.email).toBe(user.email);
    expect(data?.role_flags).toEqual(["athlete"]);
    expect(data?.timezone).toBe("UTC");
  });

  it("returns only the caller's row via the JWT-bound client", async () => {
    const user = await createTestUser();

    const { data, error } = await user.client.from("users").select("id, email");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(user.id);
  });

  it("hides another user's row from the JWT-bound client (RLS negative)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    // userA cannot see userB's row.
    const { data: visibleToA, error: errA } = await userA.client
      .from("users")
      .select("id")
      .eq("id", userB.id);
    expect(errA).toBeNull();
    expect(visibleToA).toEqual([]);

    // userB cannot see userA's row.
    const { data: visibleToB, error: errB } = await userB.client
      .from("users")
      .select("id")
      .eq("id", userA.id);
    expect(errB).toBeNull();
    expect(visibleToB).toEqual([]);

    // Sanity: each user still sees their own.
    const { data: ownA } = await userA.client.from("users").select("id");
    expect(ownA?.[0]?.id).toBe(userA.id);
  });

  it("cleans up across tests: previous test users are gone", async () => {
    // This test runs after the previous four, which collectively created
    // four users. afterEach should have hard-deleted all of them.
    // The exact pre-existing user count depends on the DB state, but the
    // emails we generated end in @da2.test and should be zero.
    const admin = serviceClient();
    const { count, error } = await admin
      .from("users")
      .select("*", { head: true, count: "exact" })
      .like("email", "vitest-%@da2.test");
    expect(error).toBeNull();
    expect(count).toBe(0);
  });
});
