// Unit tests for PATCH /api/coach/links/[id]/archive
//
// Dependencies mocked:
// - @/auth/server (JWT client for resolveAuth)
// - @/db/admin (service-role for coach_athlete_links lookup + update)
//
// Scenarios:
// - coach archives own link → 204, row soft-deleted (status='archived', deleted_at set)
// - different coach → 403
// - link not found → 404
// - missing Bearer → 401

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  // coach_athlete_links rows keyed by link id.
  links: new Map<
    string,
    { id: string; coach_user_id: string; athlete_user_id: string; status: string }
  >(),
  // Captures the last update call.
  lastUpdate: null as { id: string; fields: Record<string, unknown> } | null,
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: (_token?: string) =>
        Promise.resolve({ data: { user: mocks.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== "coach_athlete_links") {
        throw new Error(`unexpected table: ${table}`);
      }
      return new FakeLinksTable();
    },
  }),
}));

class FakeLinksTable {
  private _linkId: string | null = null;
  private _pendingFields: Record<string, unknown> | null = null;

  select(_cols: string) {
    return this;
  }
  eq(col: string, value: string) {
    if (col === "id") this._linkId = value;
    return this;
  }
  async maybeSingle() {
    if (!this._linkId) return { data: null, error: null };
    const row = mocks.links.get(this._linkId);
    if (!row) return { data: null, error: null };
    return { data: row, error: null };
  }
  update(fields: Record<string, unknown>) {
    this._pendingFields = fields;
    return this;
  }
  // Vitest awaits the query builder — make it thenable.
  then(
    resolve: (v: { error: null }) => unknown,
    _reject?: (e: unknown) => unknown,
  ) {
    if (this._linkId && this._pendingFields) {
      mocks.lastUpdate = { id: this._linkId, fields: this._pendingFields };
    }
    return Promise.resolve({ error: null }).then(resolve);
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function invokeRoute(
  linkId: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<Response> {
  const { PATCH } = await import(
    "../../../app/api/coach/links/[id]/archive/route"
  );
  return PATCH(
    new Request(
      `http://localhost:3000/api/coach/links/${linkId}/archive`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(opts.headers ?? {}),
        },
      },
    ),
    // Next.js App Router passes params as a Promise<{ id: string }>.
    { params: Promise.resolve({ id: linkId }) },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/coach/links/[id]/archive", () => {
  beforeEach(() => {
    mocks.authUser = null;
    mocks.links.clear();
    mocks.lastUpdate = null;
  });

  it("returns 401 when no authenticated user", async () => {
    const res = await invokeRoute("link-1");
    expect(res.status).toBe(401);
  });

  it("returns 401 with missing Bearer token", async () => {
    const res = await invokeRoute("link-1", { headers: {} });
    expect(res.status).toBe(401);
  });

  it("returns 404 when link id not found", async () => {
    mocks.authUser = { id: "coach-a" };
    // No link in the map.

    const res = await invokeRoute("nonexistent-link", {
      headers: { Authorization: "Bearer jwt" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when link belongs to a different coach", async () => {
    mocks.authUser = { id: "coach-b" }; // different coach
    mocks.links.set("link-owned-by-a", {
      id: "link-owned-by-a",
      coach_user_id: "coach-a", // owner
      athlete_user_id: "athlete-1",
      status: "active",
    });

    const res = await invokeRoute("link-owned-by-a", {
      headers: { Authorization: "Bearer jwt" },
    });
    expect(res.status).toBe(403);
    expect(mocks.lastUpdate).toBeNull();
  });

  it("returns 204 and soft-deletes the link when coach archives their own link", async () => {
    mocks.authUser = { id: "coach-owner" };
    mocks.links.set("link-active", {
      id: "link-active",
      coach_user_id: "coach-owner",
      athlete_user_id: "athlete-2",
      status: "active",
    });

    const res = await invokeRoute("link-active", {
      headers: { Authorization: "Bearer jwt" },
    });
    expect(res.status).toBe(204);

    // Verify the update payload.
    expect(mocks.lastUpdate?.id).toBe("link-active");
    expect(mocks.lastUpdate?.fields.status).toBe("archived");
    expect(mocks.lastUpdate?.fields.deleted_at).toBeTruthy();
  });
});
