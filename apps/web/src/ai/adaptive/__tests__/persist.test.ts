import { beforeEach, describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProposedEdit } from "@da2/shared";

import { persistNoChanges, persistProposal } from "@/ai/adaptive/persist";

// ---------------------------------------------------------------------------
// Mock admin client — captures rpc() calls + table inserts.
// ---------------------------------------------------------------------------

interface FakeState {
  // rpc behaviour
  rpcResult: { data: unknown; error: { message: string; code?: string } | null };
  lastRpcName: string | null;
  lastRpcArgs: Record<string, unknown> | null;
  // insert behaviour
  insertResult: { data: unknown; error: { message: string; code?: string } | null };
  lastInsertTable: string | null;
  lastInsertRow: Record<string, unknown> | null;
}

const state: FakeState = {
  rpcResult: { data: "new-review-id", error: null },
  lastRpcName: null,
  lastRpcArgs: null,
  insertResult: { data: { id: "inserted-id" }, error: null },
  lastInsertTable: null,
  lastInsertRow: null,
};

function makeAdmin(): SupabaseClient {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      state.lastRpcName = name;
      state.lastRpcArgs = args;
      return Promise.resolve(state.rpcResult);
    },
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          state.lastInsertTable = table;
          state.lastInsertRow = row;
          return {
            select() {
              return {
                single() {
                  return Promise.resolve(state.insertResult);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function changes(): ProposedEdit[] {
  return [
    {
      op: {
        op_id: "op-1",
        kind: "skip",
        workout_id: "00000000-0000-0000-0000-0000000000e2",
        reason: "rest",
      },
      baseline: { version: 2, status: "planned" },
    },
  ];
}

function baseArgs() {
  return {
    admin: makeAdmin(),
    athleteId: "00000000-0000-0000-0000-00000000a711",
    planId: "00000000-0000-0000-0000-0000000091a0",
    recipient: "athlete" as const,
    narrative: "Weekly review: 1 change proposed.",
    eventDateSnapshot: "2026-09-01",
    earliestAffectedDate: "2026-06-03",
  };
}

beforeEach(() => {
  state.rpcResult = { data: "new-review-id", error: null };
  state.lastRpcName = null;
  state.lastRpcArgs = null;
  state.insertResult = { data: { id: "inserted-id" }, error: null };
  state.lastInsertTable = null;
  state.lastInsertRow = null;
});

describe("persistProposal — plan-scoped (RPC path)", () => {
  it("calls propose_weekly_review and returns proposed + reviewId", async () => {
    state.rpcResult = { data: "review-123", error: null };
    const res = await persistProposal({
      ...baseArgs(),
      triggerKind: "weekly",
      scope: "plan",
      proposedChanges: changes(),
    });
    expect(state.lastRpcName).toBe("propose_weekly_review");
    expect(state.lastRpcArgs?.p_trigger_kind).toBe("weekly");
    expect(state.lastRpcArgs?.p_athlete_id).toBe(baseArgs().athleteId);
    expect(res.outcome).toBe("proposed");
    expect(res.reviewId).toBe("review-123");
    expect(res.opCount).toBe(1);
  });

  it("returns suppressed when the RPC returns NULL", async () => {
    state.rpcResult = { data: null, error: null };
    const res = await persistProposal({
      ...baseArgs(),
      triggerKind: "weekly",
      scope: "plan",
      proposedChanges: changes(),
    });
    expect(res.outcome).toBe("suppressed");
    expect(res.reviewId).toBeUndefined();
    expect(res.opCount).toBe(0);
  });

  it("returns lost_race on a 23505 (clean no-op, not an error)", async () => {
    state.rpcResult = {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    };
    const res = await persistProposal({
      ...baseArgs(),
      triggerKind: "event_change",
      scope: "plan",
      proposedChanges: changes(),
    });
    expect(res.outcome).toBe("lost_race");
    expect(res.opCount).toBe(0);
  });

  it("rethrows a non-23505 RPC error", async () => {
    state.rpcResult = {
      data: null,
      error: { message: "boom", code: "42501" },
    };
    await expect(
      persistProposal({
        ...baseArgs(),
        triggerKind: "weekly",
        scope: "plan",
        proposedChanges: changes(),
      })
    ).rejects.toThrow(/propose_weekly_review failed/);
  });
});

describe("persistProposal — workout-scoped (direct insert)", () => {
  it("inserts directly (no RPC) and returns proposed", async () => {
    state.insertResult = { data: { id: "wk-review-9" }, error: null };
    const res = await persistProposal({
      ...baseArgs(),
      triggerKind: "workout_swap",
      scope: "workout",
      proposedChanges: changes(),
    });
    expect(state.lastRpcName).toBeNull();
    expect(state.lastInsertTable).toBe("weekly_reviews");
    expect(state.lastInsertRow?.scope).toBe("workout");
    expect(state.lastInsertRow?.status).toBe("proposed");
    expect(res.outcome).toBe("proposed");
    expect(res.reviewId).toBe("wk-review-9");
  });
});

describe("persistNoChanges — direct insert, never the RPC", () => {
  it("inserts a no_changes row directly so it can't supersede a pending proposal", async () => {
    state.insertResult = { data: { id: "nc-1" }, error: null };
    const res = await persistNoChanges({
      ...baseArgs(),
      triggerKind: "weekly",
      scope: "plan",
    });
    expect(state.lastRpcName).toBeNull();
    expect(state.lastInsertTable).toBe("weekly_reviews");
    expect(state.lastInsertRow?.status).toBe("no_changes");
    expect(state.lastInsertRow?.proposed_changes).toEqual([]);
    expect(res.outcome).toBe("no_changes");
    expect(res.reviewId).toBe("nc-1");
    expect(res.opCount).toBe(0);
  });
});
