// Route tests for POST /api/admin/backups/export. Mocks the admin gate, admin
// client (one-running guard + pending insert), the Inngest client, and audit —
// no live Supabase/Inngest. Validates CSRF, gate, the in-progress guard, and
// the happy dispatch.

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.INNGEST_EVENT_KEY = "evt-key";
  process.env.INNGEST_SIGNING_KEY = "sign-key";
  process.env.BACKUP_ENCRYPTION_KEYS = `1:${"1".repeat(64)}`;
});

const mocks = vi.hoisted(() => ({
  gate: null as unknown,
  active: [] as { id: string }[],
  send: vi.fn(),
}));

vi.mock("@/auth/admin-guard", () => ({
  requireAdmin: vi.fn(async () => mocks.gate),
}));
vi.mock("@/db/admin-audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/inngest/client", () => ({
  inngest: { send: mocks.send, createFunction: vi.fn(() => ({ id: "mock" })) },
}));
vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from() {
      return {
        select() {
          return {
            in() {
              return {
                limit: () => Promise.resolve({ data: mocks.active, error: null }),
              };
            },
          };
        },
        insert() {
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "backup-new" }, error: null }),
            }),
          };
        },
        update() {
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  }),
}));

async function invoke(headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await import("../route");
  return POST(
    new Request("http://localhost:3000/api/admin/backups/export", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", ...headers },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate = { ok: true, sessionId: "sess-1" };
  mocks.active = [];
  mocks.send.mockResolvedValue(undefined);
});

describe("POST /api/admin/backups/export", () => {
  it("rejects cross-site requests (CSRF)", async () => {
    expect((await invoke({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns the gate's 401 when not authenticated", async () => {
    mocks.gate = {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
    expect((await invoke()).status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns 409 when an export is already pending/running", async () => {
    mocks.active = [{ id: "existing" }];
    expect((await invoke()).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("inserts a pending row, dispatches Inngest, and returns 202", async () => {
    const res = await invoke();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "queued", backupId: "backup-new" });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ data: { backupId: "backup-new" } })
    );
  });
});
