// Route tests for GET /api/admin/logs. Mocks the gate, listAuditLog, and audit
// (no DB). Verifies the gate, the server-side filter allow-list (raw user input
// can't reach the LIKE), pagination passthrough, the 500 path, and that the
// audit metadata is NON-PII (filter key + counts, never log row contents).

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: null as unknown,
  result: null as unknown,
}));

vi.mock("@/auth/admin-guard", () => ({
  requireAdmin: vi.fn(async () => mocks.gate),
}));
vi.mock("@/db/admin-audit", () => ({
  writeAudit: vi.fn(),
  listAuditLog: vi.fn(async () => mocks.result),
}));

import { listAuditLog, writeAudit } from "@/db/admin-audit";

const mockList = vi.mocked(listAuditLog);
const mockAudit = vi.mocked(writeAudit);

async function invoke(qs = ""): Promise<Response> {
  const { GET } = await import("../route");
  return GET(new Request(`http://localhost:3000/api/admin/logs${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate = { ok: true, sessionId: "sess-1" };
  mocks.result = {
    entries: [
      { id: "a1", action: "admin.backups.delete", target: "b1", metadata: {}, source: "ip s", created_at: "2026-05-22T00:00:00Z", target_user_id: null },
    ],
    page: 0,
    pageSize: 50,
    hasMore: false,
  };
});

describe("GET /api/admin/logs", () => {
  it("returns the gate's 401 when not authenticated", async () => {
    mocks.gate = {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
    expect((await invoke()).status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("maps the 'backups' filter to its action prefix", async () => {
    await invoke("?filter=backups&page=2&pageSize=10");
    expect(mockList).toHaveBeenCalledWith({
      actionPrefix: "admin.backups",
      page: 2,
      pageSize: 10,
    });
  });

  it("falls back to all (undefined prefix) for an unknown/injected filter", async () => {
    await invoke("?filter=%27%20OR%201%3D1%20--");
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ actionPrefix: undefined })
    );
  });

  it("returns 500 when the read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("db down"));
    expect((await invoke()).status).toBe(500);
  });

  it("audits the view with NON-PII metadata (filter + counts, no row contents)", async () => {
    await invoke("?filter=backups");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.logs.view",
        sessionId: "sess-1",
        metadata: { results: 1, page: 0, filter: "backups" },
      })
    );
    const arg = mockAudit.mock.calls[0]?.[0];
    expect(JSON.stringify(arg)).not.toContain("admin.backups.delete");
  });
});
