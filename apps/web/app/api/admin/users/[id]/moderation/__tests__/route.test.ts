// Route tests for POST /api/admin/users/[id]/moderation. Mirrors the admin
// login route test: the DB/email/gate deps are mocked while isSameOriginRequest
// + clientIp stay real (imported from @/auth/admin-session), so this validates
// the route's control flow — CSRF, gate, validation, dispatch, best-effort
// email, and NON-PII audit — without a live Supabase.

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: { ok: true, sessionId: "sess-1" } as unknown,
  result: { ok: true } as unknown,
  email: "user@example.com" as string | null,
}));

vi.mock("@/auth/admin-guard", () => ({
  requireAdmin: vi.fn(async () => mocks.gate),
}));
vi.mock("@/db/admin-audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/email/moderation-emails", () => ({
  notifyModeration: vi.fn(async () => ({ sent: true })),
}));
vi.mock("@/db/admin-moderation", () => ({
  MODERATION_GRACE_DAYS: 30,
  disableUser: vi.fn(async () => mocks.result),
  enableUser: vi.fn(async () => mocks.result),
  softDeleteUser: vi.fn(async () => mocks.result),
  restoreUser: vi.fn(async () => mocks.result),
  getUserEmail: vi.fn(async () => mocks.email),
}));

import { writeAudit } from "@/db/admin-audit";
import {
  disableUser,
  enableUser,
  getUserEmail,
  restoreUser,
  softDeleteUser,
} from "@/db/admin-moderation";
import { notifyModeration } from "@/email/moderation-emails";

const ID = "11111111-1111-1111-1111-111111111111";

async function invoke(
  body: unknown,
  headers: Record<string, string> = {},
  id: string = ID
): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request(`http://localhost:3000/api/admin/users/${id}/moderation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate = { ok: true, sessionId: "sess-1" };
  mocks.result = { ok: true };
  mocks.email = "user@example.com";
  vi.mocked(notifyModeration).mockResolvedValue({ sent: true });
});

describe("POST /api/admin/users/[id]/moderation", () => {
  it("rejects cross-site requests (CSRF) before dispatching", async () => {
    const res = await invoke(
      { action: "disable", reasonCode: "abuse" },
      { "sec-fetch-site": "cross-site" }
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(disableUser)).not.toHaveBeenCalled();
  });

  it("fails closed when Sec-Fetch-Site is absent", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`http://localhost:3000/api/admin/users/${ID}/moderation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      }),
      { params: Promise.resolve({ id: ID }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns the gate's 401 when not authenticated", async () => {
    mocks.gate = {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
    const res = await invoke({ action: "enable" });
    expect(res.status).toBe(401);
    expect(vi.mocked(enableUser)).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid id", async () => {
    const res = await invoke({ action: "enable" }, {}, "not-a-uuid");
    expect(res.status).toBe(400);
    expect(vi.mocked(enableUser)).not.toHaveBeenCalled();
  });

  it("returns 400 on an unparseable body", async () => {
    const res = await invoke("{not json");
    expect(res.status).toBe(400);
  });

  it("returns 400 on an unknown action", async () => {
    const res = await invoke({ action: "frobnicate" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when disable is missing a reasonCode", async () => {
    const res = await invoke({ action: "disable" });
    expect(res.status).toBe(400);
    expect(vi.mocked(disableUser)).not.toHaveBeenCalled();
  });

  it("disable: 200, dispatches with the reason code, audits, emails", async () => {
    const res = await invoke({ action: "disable", reasonCode: "abuse" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailed: true });
    expect(vi.mocked(disableUser)).toHaveBeenCalledWith(ID, "abuse");
    expect(vi.mocked(notifyModeration)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.users.disable",
        targetUserId: ID,
        metadata: { reasonCode: "abuse", emailed: true },
      })
    );
  });

  it("enable: 200, no email is sent", async () => {
    const res = await invoke({ action: "enable" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailed: false });
    expect(vi.mocked(enableUser)).toHaveBeenCalledWith(ID);
    expect(vi.mocked(notifyModeration)).not.toHaveBeenCalled();
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.users.enable" })
    );
  });

  it("delete: 200, soft-deletes + audits admin.users.delete", async () => {
    const res = await invoke({ action: "delete", reasonCode: "tos_violation" });
    expect(res.status).toBe(200);
    expect(vi.mocked(softDeleteUser)).toHaveBeenCalledWith(ID, "tos_violation");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.users.delete" })
    );
  });

  it("restore: 200, restores + audits admin.users.restore", async () => {
    const res = await invoke({ action: "restore" });
    expect(res.status).toBe(200);
    expect(vi.mocked(restoreUser)).toHaveBeenCalledWith(ID);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.users.restore" })
    );
  });

  it("never writes PII (free-text reason / email) to the audit log", async () => {
    await invoke({
      action: "disable",
      reasonCode: "abuse",
      reason: "user emailed threats to alice@secret.com",
    });
    const auditArg = vi.mocked(writeAudit).mock.calls[0]?.[0];
    const serialized = JSON.stringify(auditArg);
    expect(serialized).not.toContain("alice@secret.com");
    expect(serialized).not.toContain("threats");
  });

  it("maps a not_found result to 404", async () => {
    mocks.result = { ok: false, error: "not_found" };
    const res = await invoke({ action: "enable" });
    expect(res.status).toBe(404);
  });

  it("maps a conflict result to 409", async () => {
    mocks.result = { ok: false, error: "conflict" };
    const res = await invoke({ action: "restore" });
    expect(res.status).toBe(409);
  });

  it("emailed=false (no PII fetch) when the user has no email on file", async () => {
    mocks.email = null;
    const res = await invoke({ action: "delete", reasonCode: "fraud" });
    expect(await res.json()).toEqual({ ok: true, emailed: false });
    expect(vi.mocked(getUserEmail)).toHaveBeenCalledWith(ID);
    expect(vi.mocked(notifyModeration)).not.toHaveBeenCalled();
  });

  it("email failure is best-effort: action still 200 with emailed=false", async () => {
    vi.mocked(notifyModeration).mockRejectedValue(new Error("brevo down"));
    const res = await invoke({ action: "disable", reasonCode: "spam" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailed: false });
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reasonCode: "spam", emailed: false } })
    );
  });
});
