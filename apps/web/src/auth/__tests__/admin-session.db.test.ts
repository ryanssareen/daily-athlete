// DB-backed tests for admin session lifecycle + lockout. Requires a local
// Supabase stack (`supabase start` + local-dev keys sourced into the env);
// see src/db/__tests__/setup.ts. Cleans the two admin tables after each test.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_SECRET = "correct-horse-battery-staple";
  process.env.ADMIN_SESSION_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
});

import { serviceClient } from "@/db/__tests__/setup";
import {
  GLOBAL_MAX_FAILURES,
  PER_IP_MAX_FAILURES,
  clearLoginAttempts,
  createAdminSession,
  evaluateLockout,
  parseSessionToken,
  recordLoginAttempt,
  revokeAdminSession,
  verifyAdminSession,
} from "../admin-session";

let sc: ReturnType<typeof serviceClient>;

beforeAll(() => {
  sc = serviceClient();
});

afterEach(async () => {
  await sc.from("admin_sessions").delete().gte("created_at", "1970-01-01T00:00:00Z");
  await sc
    .from("admin_login_attempts")
    .delete()
    .gte("created_at", "1970-01-01T00:00:00Z");
});

describe("admin session lifecycle (DB)", () => {
  it("creates a session that then verifies", async () => {
    const { token } = await createAdminSession();
    const res = await verifyAdminSession(token);
    expect(res.valid).toBe(true);
    expect(res.sessionId).toBe(parseSessionToken(token)!.sessionId);
  });

  it("rejects a revoked session", async () => {
    const { token } = await createAdminSession();
    await revokeAdminSession(parseSessionToken(token)!.sessionId);
    expect((await verifyAdminSession(token)).valid).toBe(false);
  });

  it("rejects a session whose row is past absolute expiry", async () => {
    const { token } = await createAdminSession();
    const sid = parseSessionToken(token)!.sessionId;
    await sc
      .from("admin_sessions")
      .update({ expires_at: "2000-01-01T00:00:00Z" })
      .eq("id", sid);
    expect((await verifyAdminSession(token)).valid).toBe(false);
  });

  it("rejects an idle session (last_seen too old)", async () => {
    const { token } = await createAdminSession();
    const sid = parseSessionToken(token)!.sessionId;
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await sc.from("admin_sessions").update({ last_seen_at: old }).eq("id", sid);
    expect((await verifyAdminSession(token)).valid).toBe(false);
  });

  it("treats an unknown session id as invalid (HMAC must verify first)", async () => {
    // A syntactically plausible but unsigned token never reaches the DB.
    expect(
      (await verifyAdminSession("deadbeef.9999999999.cafebabe")).valid
    ).toBe(false);
  });
});

describe("lockout (DB)", () => {
  it("locks an IP after the per-IP threshold, and clears on success", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < PER_IP_MAX_FAILURES; i++) {
      await recordLoginAttempt(ip, false);
    }
    expect((await evaluateLockout(ip)).allowed).toBe(false);
    await clearLoginAttempts(ip);
    expect((await evaluateLockout(ip)).allowed).toBe(true);
  });

  it("never blocks a clean IP during a global flood (operator self-recovery)", async () => {
    const rows = Array.from({ length: GLOBAL_MAX_FAILURES }, (_, i) => ({
      ip: `198.51.100.${i % 254}`,
      success: false,
    }));
    await sc.from("admin_login_attempts").insert(rows);

    // Operator on a clean IP: allowed despite the global flood.
    expect((await evaluateLockout("203.0.113.99")).allowed).toBe(true);
    // An IP that itself has a recent failure IS caught by the global backoff.
    await recordLoginAttempt("203.0.113.99", false);
    expect((await evaluateLockout("203.0.113.99")).allowed).toBe(false);
  });
});
