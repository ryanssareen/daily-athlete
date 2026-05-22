// Route tests for GET /api/admin/users. Mocks the gate, listUsers, and audit
// (no DB). Verifies the gate, query parsing, and that the audit metadata is
// non-PII (never the search term).

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: null as unknown,
  result: null as unknown,
}));

vi.mock("@/auth/admin-guard", () => ({
  requireAdmin: vi.fn(async () => mocks.gate),
}));
vi.mock("@/db/admin-audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/db/admin-users", () => ({ listUsers: vi.fn(async () => mocks.result) }));

import { writeAudit } from "@/db/admin-audit";
import { listUsers } from "@/db/admin-users";

const mockList = vi.mocked(listUsers);
const mockAudit = vi.mocked(writeAudit);

async function invoke(qs = ""): Promise<Response> {
  const { GET } = await import("../route");
  return GET(new Request(`http://localhost:3000/api/admin/users${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate = { ok: true, sessionId: "sess-1" };
  mocks.result = {
    users: [{ id: "u1", display_name: "A", email: "a@b.com" }],
    total: 1,
    page: 0,
    pageSize: 25,
  };
});

describe("GET /api/admin/users", () => {
  it("returns the gate's 401 when not authenticated", async () => {
    mocks.gate = {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
    expect((await invoke()).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("parses q/page/pageSize and passes them through (default active status)", async () => {
    const res = await invoke("?q=alice&page=2&pageSize=10");
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({
      search: "alice",
      page: 2,
      pageSize: 10,
      status: "active",
    });
  });

  it("passes status=deleted through for the grace-window view", async () => {
    await invoke("?status=deleted");
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ status: "deleted" })
    );
  });

  it("audits the view with NON-PII metadata (never the search term)", async () => {
    await invoke("?q=alice@secret.com");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.users.view" })
    );
    const auditArg = mockAudit.mock.calls[0]?.[0];
    expect(JSON.stringify(auditArg)).not.toContain("alice@secret.com");
  });
});
