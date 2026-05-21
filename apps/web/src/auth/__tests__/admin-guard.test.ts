// Tests for the authoritative /api/admin route gate. verifyAdminSession is
// mocked (its own DB-backed behavior is covered elsewhere); this proves the
// gate rejects a request whose cookie passes the Edge presence check but fails
// real verification — the security-critical "junk cookie still 401s" path.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth/admin-session", () => ({ verifyAdminSession: vi.fn() }));

import { verifyAdminSession } from "@/auth/admin-session";

import { requireAdmin } from "../admin-guard";

const mockVerify = vi.mocked(verifyAdminSession);

function req(cookie?: string): Request {
  return new Request("http://localhost:3000/api/admin/x", {
    headers: cookie ? { cookie } : {},
  });
}

describe("requireAdmin", () => {
  it("allows a valid session and returns the session id", async () => {
    mockVerify.mockResolvedValue({ valid: true, sessionId: "s1" });
    const gate = await requireAdmin(req("da2-admin-session=tok"));
    expect(gate).toEqual({ ok: true, sessionId: "s1" });
  });

  it("401s a forged/invalid session even when a cookie is present", async () => {
    mockVerify.mockResolvedValue({ valid: false });
    const gate = await requireAdmin(req("da2-admin-session=junk"));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
  });

  it("401s when no cookie is present", async () => {
    mockVerify.mockResolvedValue({ valid: false });
    const gate = await requireAdmin(req());
    expect(gate.ok).toBe(false);
    expect(mockVerify).toHaveBeenCalledWith(undefined);
  });
});
