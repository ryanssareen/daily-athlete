// Unit tests for reValidateAndApply (plan Unit 6, apply.ts).
//
// reValidateAndApply re-runs the deterministic invariant validator (Unit 4)
// against CURRENT load in Node, applies the coupled-trigger rule, then calls the
// apply_weekly_review RPC with the surviving op-ids. We inject a fake admin
// client (the function accepts `{ admin }`) so no real DB is touched; the real
// validateOps / isCoupled run unmocked.
//
// Focus scenarios:
//   - independent trigger (workout_swap): surviving ops pass through to the RPC;
//     dropped ops are reported as dropped_invalid alongside RPC outcomes.
//   - coupled trigger (weekly): a re-validation drop aborts the WHOLE proposal
//     to `superseded`; the RPC is NOT called; the proposal is marked superseded.
//   - coupled trigger, no drops: all surviving op-ids pass to the RPC.
//   - the RPC's per-op results (skipped_stale, etc.) flow through unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeeklyReviewRow } from "@da2/shared";

import { reValidateAndApply } from "@/ai/adaptive/apply";

// ---------------------------------------------------------------------------
// Fake admin client
// ---------------------------------------------------------------------------

interface FakeState {
  plannedWorkouts: Record<string, unknown>[];
  completedWorkouts: Record<string, unknown>[];
  rpcResult: Record<string, unknown>;
  rpcArgs: Record<string, unknown> | null;
  supersedeUpdates: Record<string, unknown>[];
  /** users.timezone for the athlete (default "UTC"). */
  timezone?: string;
  /** When set, the users.timezone read returns this error. */
  timezoneError?: string;
}

function makeFakeAdmin(state: FakeState) {
  class SelectFake {
    constructor(private table: string) {}
    select() {
      return this;
    }
    eq() {
      return this;
    }
    is() {
      return this._resolve();
    }
    maybeSingle() {
      // users.timezone lookup for the athlete-local "today".
      if (state.timezoneError) {
        return Promise.resolve({ data: null, error: { message: state.timezoneError } });
      }
      return Promise.resolve({ data: { timezone: state.timezone ?? "UTC" }, error: null });
    }
    private _resolve() {
      if (this.table === "planned_workouts") {
        return Promise.resolve({ data: state.plannedWorkouts, error: null });
      }
      if (this.table === "completed_workouts") {
        return Promise.resolve({ data: state.completedWorkouts, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    }
  }

  class UpdateFake {
    constructor(private patch: Record<string, unknown>) {}
    eq() {
      return this;
    }
    then(onFulfilled: (v: { data: null; error: null }) => unknown) {
      state.supersedeUpdates.push(this.patch);
      return Promise.resolve({ data: null, error: null }).then(onFulfilled);
    }
  }

  class TableFake {
    constructor(private table: string) {}
    select() {
      return new SelectFake(this.table).select();
    }
    update(patch: Record<string, unknown>) {
      return new UpdateFake(patch);
    }
  }

  return {
    from(table: string) {
      return new TableFake(table);
    },
    rpc(_fn: string, args: Record<string, unknown>) {
      state.rpcArgs = args;
      return Promise.resolve({ data: state.rpcResult, error: null });
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function reviewWith(
  triggerKind: WeeklyReviewRow["trigger_kind"],
  proposedChanges: WeeklyReviewRow["proposed_changes"],
  over: Partial<WeeklyReviewRow> = {}
): WeeklyReviewRow {
  return {
    id: "rev-1",
    athlete_id: "ath-1",
    plan_id: "plan-1",
    trigger_kind: triggerKind,
    scope: triggerKind === "workout_swap" ? "workout" : "plan",
    recipient: "athlete",
    status: "proposed",
    proposed_changes: proposedChanges,
    narrative: null,
    event_date_snapshot: null,
    earliest_affected_date: null,
    generated_at: "2026-05-25T00:00:00.000Z",
    decided_at: null,
    created_at: "2026-05-25T00:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

const UUID_A = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  // nothing global
});

describe("reValidateAndApply", () => {
  it("coupled trigger: a re-validation drop aborts the whole proposal to superseded (RPC not called)", async () => {
    const state: FakeState = {
      // One existing planned workout, COACH-edited → coach_protected drop.
      plannedWorkouts: [
        {
          id: UUID_A,
          scheduled_date: "2026-06-10",
          structure: { duration_s: 3600 },
          planned_load: 50,
          status: "planned",
          edited_by_kind: "coach",
          edited_at: "2026-05-24T00:00:00.000Z",
        },
      ],
      completedWorkouts: [],
      rpcResult: { status: "accepted", superseded: false, results: [] },
      rpcArgs: null,
      supersedeUpdates: [],
    };
    const admin = makeFakeAdmin(state);

    const review = reviewWith("weekly", [
      {
        op: {
          op_id: "op-1",
          kind: "modify",
          workout_id: UUID_A,
          changes: { duration_s: 7200 },
          reason: "bump",
        },
        baseline: { version: 1 },
      },
    ]);

    const result = await reValidateAndApply(review, ["op-1"], "ath-1", {
      admin: admin as never,
    });

    expect(result.superseded).toBe(true);
    expect(result.status).toBe("superseded");
    expect(state.rpcArgs).toBeNull(); // RPC NOT called
    expect(state.supersedeUpdates).toHaveLength(1);
    expect(state.supersedeUpdates[0].status).toBe("superseded");
    expect(result.results[0].outcome).toBe("superseded");
  });

  it("independent trigger (workout_swap): dropped ops do NOT abort; survivors pass to the RPC", async () => {
    const state: FakeState = {
      plannedWorkouts: [
        {
          id: UUID_A,
          scheduled_date: "2026-06-10",
          structure: { duration_s: 3600 },
          planned_load: 50,
          status: "planned",
          edited_by_kind: "coach", // → coach_protected drop
          edited_at: "2026-05-24T00:00:00.000Z",
        },
      ],
      completedWorkouts: [],
      rpcResult: {
        status: "accepted",
        superseded: false,
        results: [],
      },
      rpcArgs: null,
      supersedeUpdates: [],
    };
    const admin = makeFakeAdmin(state);

    const review = reviewWith("workout_swap", [
      {
        op: {
          op_id: "op-coach",
          kind: "modify",
          workout_id: UUID_A,
          changes: { duration_s: 7200 },
          reason: "bump",
        },
        baseline: { version: 1 },
      },
    ]);

    const result = await reValidateAndApply(review, ["op-coach"], "ath-1", {
      admin: admin as never,
    });

    // Not superseded — independent triggers partial-apply.
    expect(result.superseded).toBe(false);
    // The dropped op is surfaced as dropped_invalid; RPC still called (with no
    // surviving op-ids in this case).
    expect(state.rpcArgs).not.toBeNull();
    expect(state.rpcArgs?.p_accepted_op_ids).toEqual([]);
    const droppedResult = result.results.find((r) => r.op_id === "op-coach");
    expect(droppedResult?.outcome).toBe("dropped_invalid");
    expect(droppedResult?.detail).toBe("coach_protected");
  });

  it("coupled trigger, no drops: all surviving op-ids pass to the RPC and results flow through", async () => {
    const state: FakeState = {
      plannedWorkouts: [
        {
          id: UUID_A,
          scheduled_date: "2026-06-10",
          structure: { duration_s: 3600 },
          planned_load: 50,
          status: "planned",
          edited_by_kind: "athlete", // not protected
          edited_at: null,
        },
      ],
      completedWorkouts: [],
      rpcResult: {
        status: "accepted",
        superseded: false,
        results: [{ op_id: "op-skip", outcome: "applied" }],
      },
      rpcArgs: null,
      supersedeUpdates: [],
    };
    const admin = makeFakeAdmin(state);

    const review = reviewWith("weekly", [
      {
        op: {
          op_id: "op-skip",
          kind: "skip",
          workout_id: UUID_A,
          reason: "rest",
        },
        baseline: { version: 1 },
      },
    ]);

    const result = await reValidateAndApply(review, ["op-skip"], "ath-1", {
      admin: admin as never,
    });

    expect(result.superseded).toBe(false);
    expect(result.status).toBe("accepted");
    expect(state.rpcArgs?.p_accepted_op_ids).toEqual(["op-skip"]);
    expect(state.rpcArgs?.p_review_id).toBe("rev-1");
    expect(state.rpcArgs?.p_actor_user_id).toBe("ath-1");
    expect(result.results).toEqual([{ op_id: "op-skip", outcome: "applied" }]);
  });

  it("passes the RPC's per-op skipped_stale results through unchanged (partially_accepted)", async () => {
    const state: FakeState = {
      plannedWorkouts: [
        {
          id: UUID_A,
          scheduled_date: "2026-06-10",
          structure: { duration_s: 3600 },
          planned_load: 50,
          status: "planned",
          edited_by_kind: "athlete",
          edited_at: null,
        },
      ],
      completedWorkouts: [],
      rpcResult: {
        status: "partially_accepted",
        superseded: false,
        results: [
          { op_id: "op-skip", outcome: "skipped_stale", detail: "workout changed" },
        ],
      },
      rpcArgs: null,
      supersedeUpdates: [],
    };
    const admin = makeFakeAdmin(state);

    const review = reviewWith("weekly", [
      {
        op: { op_id: "op-skip", kind: "skip", workout_id: UUID_A, reason: "rest" },
        baseline: { version: 1 },
      },
    ]);

    const result = await reValidateAndApply(review, ["op-skip"], "ath-1", {
      admin: admin as never,
    });

    expect(result.status).toBe("partially_accepted");
    expect(result.results[0].outcome).toBe("skipped_stale");
  });

  describe("athlete-local today", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Unattributed edit 14 days before Jun 2: inside the 14-day protection
    // window on Jun 2, outside it on Jun 3.
    const recentlyEdited = (): FakeState => ({
      plannedWorkouts: [
        {
          id: UUID_A,
          scheduled_date: "2026-06-10",
          structure: { duration_s: 3600 },
          planned_load: 50,
          status: "planned",
          edited_by_kind: null,
          edited_at: "2026-05-19T00:00:00.000Z",
        },
      ],
      completedWorkouts: [],
      rpcResult: { status: "accepted", superseded: false, results: [] },
      rpcArgs: null,
      supersedeUpdates: [],
    });
    const skipReview = () =>
      reviewWith("weekly", [
        {
          op: { op_id: "op-skip", kind: "skip", workout_id: UUID_A, reason: "rest" },
          baseline: { version: 1 },
        },
      ]);

    it("measures the protection window from the athlete's day, not the UTC day", async () => {
      // 20:00 UTC Jun 2 == 01:30 IST Jun 3.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-06-02T20:00:00.000Z"));

      // UTC athlete: still Jun 2 -> edit is 14 days old -> protected -> coupled abort.
      const utcState = recentlyEdited();
      const utc = await reValidateAndApply(skipReview(), ["op-skip"], "ath-1", {
        admin: makeFakeAdmin(utcState) as never,
      });
      expect(utc.status).toBe("superseded");

      // IST athlete: already Jun 3 -> 15 days old -> not protected -> applied.
      const istState = { ...recentlyEdited(), timezone: "Asia/Calcutta" };
      const ist = await reValidateAndApply(skipReview(), ["op-skip"], "ath-1", {
        admin: makeFakeAdmin(istState) as never,
      });
      expect(ist.superseded).toBe(false);
      expect(istState.rpcArgs).not.toBeNull();
    });

    it("propagates a users.timezone read failure instead of defaulting to UTC", async () => {
      const state = { ...recentlyEdited(), timezoneError: "users read boom" };
      await expect(
        reValidateAndApply(skipReview(), ["op-skip"], "ath-1", { admin: makeFakeAdmin(state) as never })
      ).rejects.toThrow(/fetchAthleteTimezone failed/);
      expect(state.rpcArgs).toBeNull();
    });
  });
});
