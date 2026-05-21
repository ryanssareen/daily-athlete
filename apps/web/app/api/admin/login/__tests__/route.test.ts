// Route tests for POST /api/admin/login. The DB-touching session/lockout
// functions are mocked (vi.mock keeps clientIp + isSameOriginRequest real), so
// this validates the route's control flow — CSRF, lockout, password branch,
// cookie issuance — without a live Supabase.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ADMIN_PASSWORD = "correct-horse-battery-staple";
  process.env.ADMIN_SESSION_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
});

vi.mock("@/auth/admin-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/admin-session")>();
  return {
    ...actual,
    evaluateLockout: vi.fn(),
    recordLoginAttempt: vi.fn(),
    clearLoginAttempts: vi.fn(),
    createAdminSession: vi.fn(),
    verifyAdminPassword: vi.fn(),
  };
});

vi.mock("@/db/admin-audit", () => ({ writeAudit: vi.fn() }));

import {
  clearLoginAttempts,
  createAdminSession,
  evaluateLockout,
  recordLoginAttempt,
  verifyAdminPassword,
} from "@/auth/admin-session";

const mockLockout = vi.mocked(evaluateLockout);
const mockCreate = vi.mocked(createAdminSession);
const mockVerify = vi.mocked(verifyAdminPassword);
const mockRecord = vi.mocked(recordLoginAttempt);
const mockClear = vi.mocked(clearLoginAttempts);

beforeEach(() => {
  vi.clearAllMocks();
  mockLockout.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mockCreate.mockResolvedValue({
    token: "sid.9999999999.hmac",
    maxAgeSeconds: 43200,
  });
  mockRecord.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
  mockVerify.mockReturnValue(false);
});

async function invoke(
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/admin/login", () => {
  it("rejects cross-site requests (CSRF) before checking the password", async () => {
    const res = await invoke({ password: "x" }, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("fails closed when Sec-Fetch-Site is absent", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "x" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 429 with Retry-After when locked out", async () => {
    mockLockout.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });
    const res = await invoke({ password: "x" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("900");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns 401 and records a failure on a wrong password", async () => {
    mockVerify.mockReturnValue(false);
    const res = await invoke({ password: "wrong" });
    expect(res.status).toBe(401);
    expect(mockRecord).toHaveBeenCalledWith(expect.any(String), false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 200 + Set-Cookie on a correct password", async () => {
    mockVerify.mockReturnValue(true);
    const res = await invoke({ password: "correct" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("da2-admin-session=");
    expect(setCookie).toContain("sid.9999999999.hmac");
    expect(mockRecord).toHaveBeenCalledWith(expect.any(String), true);
    expect(mockClear).toHaveBeenCalled();
  });

  it("returns 400 on an unparseable body", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
  });
});
