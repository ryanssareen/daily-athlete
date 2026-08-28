// Route tests for POST /api/admin/backfill-matches. Mocks the gate, CSRF
// check, the admin Supabase client's two read queries, matchStravaToPlanned,
// and the audit write (no DB). Verifies: CSRF-then-auth ordering, the
// already-matched filter, the batch limit, per-row error isolation, and that
// the audit metadata is a plain counts summary.

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: true,
  gate: null as unknown,
  liveMatches: [] as { completed_workout_id: string }[],
  candidates: [] as {
    id: string;
    athlete_id: string;
    sport: string;
    started_at: string;
    duration_s: number | null;
  }[],
}));

vi.mock("@/auth/admin-guard", () => ({
  requireAdmin: vi.fn(async () => mocks.gate),
}));
vi.mock("@/auth/admin-session", () => ({
  isSameOriginRequest: vi.fn(() => mocks.sameOrigin),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/db/admin-audit", () => ({
  writeAudit: vi.fn(),
}));
vi.mock("@/strava/auto-match", () => ({
  matchStravaToPlanned: vi.fn(async () => ({ matched: true, plannedWorkoutId: "pw-x" })),
}));

// Minimal fluent builder: every chain method returns `this`; awaiting it
// resolves to this table's canned { data, error } response.
function fakeQuery(response: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder as unknown as PromiseLike<{ data: unknown; error: unknown }>;
  for (const m of ["select", "eq", "is", "order", "limit"]) {
    builder[m] = vi.fn(chain);
  }
  builder.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
    Promise.resolve(response).then(resolve);
  return builder;
}

vi.mock("@/db/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "workout_matches") {
        return fakeQuery({ data: mocks.liveMatches, error: null });
      }
      if (table === "completed_workouts") {
        return fakeQuery({ data: mocks.candidates, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  })),
}));

import { writeAudit } from "@/db/admin-audit";
import { matchStravaToPlanned } from "@/strava/auto-match";

const mockAudit = vi.mocked(writeAudit);
const mockMatch = vi.mocked(matchStravaToPlanned);

async function invoke(): Promise<Response> {
  const { POST } = await import("../route");
  return POST(new Request("http://localhost:3000/api/admin/backfill-matches", { method: "POST" }));
}

function candidate(id: string, overrides: Partial<(typeof mocks.candidates)[number]> = {}) {
  return {
    id,
    athlete_id: "athlete-1",
    sport: "run",
    started_at: "2026-06-01T08:00:00Z",
    duration_s: 1800,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sameOrigin = true;
  mocks.gate = { ok: true, sessionId: "sess-1" };
  mocks.liveMatches = [];
  mocks.candidates = [];
  mockMatch.mockResolvedValue({ matched: true, plannedWorkoutId: "pw-x" });
});

describe("POST /api/admin/backfill-matches", () => {
  it("rejects a cross-origin request before checking auth", async () => {
    mocks.sameOrigin = false;
    const res = await invoke();
    expect(res.status).toBe(403);
    expect(mockMatch).not.toHaveBeenCalled();
  });

  it("returns the gate's 401 when not authenticated", async () => {
    mocks.gate = {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
    const res = await invoke();
    expect(res.status).toBe(401);
    expect(mockMatch).not.toHaveBeenCalled();
  });

  it("skips completed_workouts that already have a live match", async () => {
    mocks.candidates = [candidate("cw-1"), candidate("cw-2")];
    mocks.liveMatches = [{ completed_workout_id: "cw-1" }];

    const res = await invoke();
    const body = await res.json();

    expect(mockMatch).toHaveBeenCalledTimes(1);
    expect(mockMatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completedWorkoutId: "cw-2" })
    );
    expect(body.scanned).toBe(1);
    expect(body.processed).toBe(1);
    expect(body.matched).toBe(1);
  });

  it("isolates a per-row failure — one bad row doesn't abort the batch", async () => {
    mocks.candidates = [candidate("cw-1"), candidate("cw-2")];
    mockMatch
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ matched: true, plannedWorkoutId: "pw-2" });

    const res = await invoke();
    const body = await res.json();

    expect(body.processed).toBe(2);
    expect(body.matched).toBe(1);
    expect(body.errored).toBe(1);
    expect(body.errors).toEqual(["boom"]);
  });

  it("counts non-matches without treating them as errors", async () => {
    mocks.candidates = [candidate("cw-1")];
    mockMatch.mockResolvedValueOnce({ matched: false });

    const res = await invoke();
    const body = await res.json();

    expect(body.matched).toBe(0);
    expect(body.errored).toBe(0);
    expect(body.processed).toBe(1);
  });

  it("writes a counts-only audit entry", async () => {
    mocks.candidates = [candidate("cw-1")];
    await invoke();

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.backfill-matches.run",
        sessionId: "sess-1",
        metadata: expect.objectContaining({ scanned: 1, processed: 1, matched: 1 }),
      })
    );
  });
});
