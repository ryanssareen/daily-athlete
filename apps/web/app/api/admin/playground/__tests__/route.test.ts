// Route tests for POST /api/admin/playground. Mocks the gate, audit, and the
// three allow-listed sibling handlers (no DB). Validates CSRF, the gate,
// allow-list enforcement, operator-cookie forwarding, param whitelisting, that
// the audit metadata is NON-PII, and that downstream status/body pass through.

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAYGROUND_ENDPOINTS } from "@/admin/playground";

const mocks = vi.hoisted(() => ({
  gate: null as unknown,
  usersGET: vi.fn(),
  backupsGET: vi.fn(),
  backupsStatusGET: vi.fn(),
}));

vi.mock("@/auth/admin-guard", () => ({
  requireAdmin: vi.fn(async () => mocks.gate),
}));
vi.mock("@/db/admin-audit", () => ({ writeAudit: vi.fn() }));
// Specifiers resolve relative to THIS test file; the route imports the same
// modules as "../users/route" relative to itself (one level shallower), so the
// test must reach them as "../../...".
vi.mock("../../users/route", () => ({ GET: mocks.usersGET }));
vi.mock("../../backups/route", () => ({ GET: mocks.backupsGET }));
vi.mock("../../backups/status/route", () => ({ GET: mocks.backupsStatusGET }));

import { writeAudit } from "@/db/admin-audit";

const mockAudit = vi.mocked(writeAudit);

async function invoke(
  bodyObj: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/admin/playground", {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(bodyObj),
    })
  );
}

async function invokeRaw(rawBody: string): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/admin/playground", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: rawBody,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate = { ok: true, sessionId: "sess-1" };
  // mockImplementation (not mockResolvedValue): a Response body can only be
  // read once, so each call must yield a fresh one.
  mocks.usersGET.mockImplementation(async () =>
    NextResponse.json({ users: [{ id: "u1" }], total: 1 })
  );
  mocks.backupsGET.mockImplementation(async () => NextResponse.json({ backups: [] }));
  mocks.backupsStatusGET.mockImplementation(async () => NextResponse.json({ state: "ok" }));
});

describe("POST /api/admin/playground", () => {
  it("rejects cross-site requests (CSRF) before doing anything", async () => {
    const res = await invoke({ endpointId: "users" }, { "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(mocks.usersGET).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns the gate's 401 when not authenticated", async () => {
    mocks.gate = {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
    const res = await invoke({ endpointId: "users" });
    expect(res.status).toBe(401);
    expect(mocks.usersGET).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("400s an unknown endpoint id (allow-list enforcement)", async () => {
    const res = await invoke({ endpointId: "../../etc/passwd" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_endpoint" });
    expect(mocks.usersGET).not.toHaveBeenCalled();
  });

  it("400s invalid JSON", async () => {
    expect((await invokeRaw("not json")).status).toBe(400);
  });

  it("dispatches every allow-listed endpoint (id <-> handler parity)", async () => {
    for (const endpoint of PLAYGROUND_ENDPOINTS) {
      const res = await invoke({ endpointId: endpoint.id });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { status: number };
      // 400 here would mean the id has no DISPATCH entry.
      expect(json.status).not.toBe(400);
    }
  });

  it("invokes the real handler with the canonical path + whitelisted params, forwarding the operator cookie", async () => {
    const res = await invoke(
      { endpointId: "users", params: { q: "alice", page: "2", pageSize: "99999", evil: "x" } },
      { cookie: "da_admin=secret-token" }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 200, body: { users: [{ id: "u1" }], total: 1 } });

    expect(mocks.usersGET).toHaveBeenCalledTimes(1);
    const downstream = mocks.usersGET.mock.calls[0]![0] as Request;
    const url = new URL(downstream.url);
    expect(url.pathname).toBe("/api/admin/users");
    expect(url.searchParams.get("q")).toBe("alice");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pageSize")).toBe("100"); // clamped to max
    expect(url.searchParams.has("evil")).toBe(false); // dropped (not in spec)
    expect(downstream.headers.get("cookie")).toBe("da_admin=secret-token");
  });

  it("audits the invocation with NON-PII metadata (endpoint + status, never params)", async () => {
    await invoke({ endpointId: "users", params: { q: "alice@secret.com" } });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const arg = mockAudit.mock.calls[0]![0];
    expect(arg).toEqual(
      expect.objectContaining({
        action: "admin.playground.invoke",
        sessionId: "sess-1",
        metadata: { endpoint: "users", status: 200 },
      })
    );
    expect(JSON.stringify(arg)).not.toContain("alice@secret.com");
  });

  it("passes through a downstream non-2xx status + body, and audits that status", async () => {
    // Distinctive value so this can't pass via the real users route's own 500.
    mocks.usersGET.mockImplementation(async () =>
      NextResponse.json({ error: "service_unavailable" }, { status: 503 })
    );
    const res = await invoke({ endpointId: "users" });
    expect(res.status).toBe(200); // the wrapper is 200; the inner status is 503
    expect(await res.json()).toEqual({ status: 503, body: { error: "service_unavailable" } });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { endpoint: "users", status: 503 } })
    );
  });

  it("returns 502 + audits when the downstream handler throws", async () => {
    mocks.usersGET.mockRejectedValue(new Error("boom"));
    const res = await invoke({ endpointId: "users" });
    expect(await res.json()).toEqual({ status: 502, body: { error: "dispatch_failed" } });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { endpoint: "users", status: 502 } })
    );
  });
});
