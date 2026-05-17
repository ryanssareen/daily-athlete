// Unit tests for POST /api/integrations/strava/backfill/retry

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
  process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "test-webhook-token";
});

const mocks = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  stravaTokenExists: true,
  currentBackfillStatus: { state: "failed" } as Record<string, unknown>,
  updateRowCount: 1,
  updateError: null as string | null,
}));

vi.mock("@/auth/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mocks.authUser }, error: null }) },
  }),
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "strava_tokens") {
              return { data: mocks.stravaTokenExists ? { user_id: mocks.authUser?.id } : null };
            }
            return { data: { backfill_status: mocks.currentBackfillStatus } };
          },
        }),
      }),
      update: (payload: unknown) => ({
        eq: () => ({
          filter: () => ({
            select: async () => {
              if (mocks.updateError) {
                return { data: null, error: { message: mocks.updateError } };
              }
              if (mocks.updateRowCount === 0) return { data: [], error: null };
              const bs = (payload as Record<string, unknown>).backfill_status;
              return { data: [{ backfill_status: bs }], error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

// after() is a no-op in tests — we don't want the backfill actually running
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});

vi.mock("@/strava/run-backfill", () => ({
  runBackfillForUser: vi.fn(),
}));

import { POST } from "../route";

function makeRequest(opts: {
  secFetchSite?: string;
  noAuth?: boolean;
}) {
  mocks.authUser = opts.noAuth ? null : { id: "user-uuid-1" };
  const headers: Record<string, string> = {
    Authorization: opts.noAuth ? "" : "Bearer test-jwt",
  };
  if (opts.secFetchSite) headers["sec-fetch-site"] = opts.secFetchSite;
  return new Request("http://localhost/api/integrations/strava/backfill/retry", {
    method: "POST",
    headers,
  });
}

describe("POST /api/integrations/strava/backfill/retry", () => {
  beforeEach(() => {
    mocks.authUser = { id: "user-uuid-1" };
    mocks.stravaTokenExists = true;
    mocks.currentBackfillStatus = { state: "failed" };
    mocks.updateRowCount = 1;
    mocks.updateError = null;
  });

  afterEach(() => vi.clearAllMocks());

  it("returns 403 for cross-origin request (CSRF guard)", async () => {
    const res = await POST(makeRequest({ secFetchSite: "cross-site" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await POST(makeRequest({ noAuth: true }));
    expect(res.status).toBe(401);
  });

  it("returns 422 when no Strava connection", async () => {
    mocks.stravaTokenExists = false;
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("no_strava_connection");
  });

  it("returns 202 + queued status on success", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("queued");
  });

  it("returns 409 already_in_progress when state is queued", async () => {
    mocks.updateRowCount = 0;
    mocks.currentBackfillStatus = { state: "queued" };
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_in_progress");
  });

  it("returns 422 needs_reconnect when state is needs_reauth", async () => {
    mocks.updateRowCount = 0;
    mocks.currentBackfillStatus = { state: "needs_reauth" };
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("needs_reconnect");
  });

  it("returns 500 on DB update error", async () => {
    mocks.updateError = "connection refused";
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(500);
  });

  it("allows same-origin and missing Sec-Fetch-Site", async () => {
    const res1 = await POST(makeRequest({ secFetchSite: "same-origin" }));
    expect(res1.status).toBe(202);
    const res2 = await POST(makeRequest({}));
    expect(res2.status).toBe(202);
  });
});
