/**
 * E2E for the Unit-3 route handlers (`/api/health`, `/api/me`,
 * `/api/me/entitlements`). Hits the deployed Vercel app with a real Supabase
 * access token minted by exchanging a test user's password for a session.
 *
 * The unit tests in `tests/api/` already cover handler logic with a fake
 * Supabase client; this suite proves the chain through PostgREST works
 * end-to-end (auth → user-scoped client → real query → response shape).
 */
import { expect, test } from "@playwright/test";

import {
  createConfirmedUser,
  deleteUser,
  getAccessToken,
  type TestUser,
} from "./helpers/supabase-admin";

test.describe("/api/health (no auth)", () => {
  test("GET returns 200 with {status: 'ok'} and Content-Type application/json", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("does not require a bearer (200 even with no Authorization header)", async ({
    request,
  }) => {
    const res = await request.get("/api/health", { headers: {} });
    expect(res.status()).toBe(200);
  });
});

test.describe("/api/me + /api/me/entitlements (with real bearer)", () => {
  let user: TestUser;
  let token: string;

  test.beforeAll(async () => {
    user = await createConfirmedUser();
    token = await getAccessToken(user);
  });

  test.afterAll(async () => {
    if (user?.id) await deleteUser(user.id);
  });

  test("GET /api/me without bearer → 401 with WWW-Authenticate Bearer", async ({
    request,
  }) => {
    const res = await request.get("/api/me");
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toBe("Bearer");
    expect(await res.json()).toEqual({ detail: "missing bearer token" });
  });

  test("GET /api/me with malformed bearer → 401 'invalid token' (no decode-reason leak)", async ({
    request,
  }) => {
    const res = await request.get("/api/me", {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ detail: "invalid token" });
    // Belt-and-suspenders: nothing about JWT internals leaks to the wire.
    expect(JSON.stringify(body)).not.toMatch(/expired|signature|jwt|decode/i);
  });

  test("GET /api/me with valid bearer → 200, public UserOut shape, no deleted_at", async ({
    request,
  }) => {
    const res = await request.get("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.email).toBe(user.email);
    expect(Array.isArray(body.role_flags)).toBe(true);
    expect(typeof body.timezone).toBe("string");
    expect(typeof body.created_at).toBe("string");
    // Public shape — soft-delete column never reaches the wire.
    expect("deleted_at" in body).toBe(false);
  });

  test("PATCH /api/me with valid display_name → 200; subsequent GET reflects it", async ({
    request,
  }) => {
    const newName = `e2e-patched-${Date.now()}`;
    const patchRes = await request.patch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      data: { display_name: newName },
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).display_name).toBe(newName);

    const getRes = await request.get("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);
    expect((await getRes.json()).display_name).toBe(newName);
  });

  test("PATCH /api/me with empty display_name → 400 (Zod min(1))", async ({ request }) => {
    const res = await request.patch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      data: { display_name: "" },
    });
    expect(res.status()).toBe(400);
  });

  test("PATCH /api/me with display_name > 120 chars → 400", async ({ request }) => {
    const res = await request.patch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      data: { display_name: "x".repeat(121) },
    });
    expect(res.status()).toBe(400);
  });

  test("PATCH /api/me with malformed JSON body → 400 (not 500)", async ({ request }) => {
    const res = await request.patch("/api/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: "{this is not json",
    });
    expect(res.status()).toBe(400);
  });

  test("GET /api/me/entitlements with valid bearer → 200 and an array (empty for new user)", async ({
    request,
  }) => {
    const res = await request.get("/api/me/entitlements", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // New users have no entitlements seeded.
    expect(body).toEqual([]);
  });

  test("GET /api/me/entitlements without bearer → 401", async ({ request }) => {
    const res = await request.get("/api/me/entitlements");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ detail: "missing bearer token" });
  });
});
