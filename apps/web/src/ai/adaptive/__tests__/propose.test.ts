import { describe, expect, it } from "vitest";

import type { EditOp } from "@da2/shared";

import { FixtureProposer } from "@/ai/adaptive/llm";
import type { PlanContext } from "@/ai/adaptive/context";
import { MAX_ATTEMPTS, ProposeError, propose } from "@/ai/adaptive/propose";
import { buildLoadSeries } from "@/training-load/load-series";
import {
  FIXTURE_PLAN_ID,
  FIXTURE_WORKOUT_IDS,
  fixtureCompletedWorkouts,
} from "@/ai/adaptive/__fixtures__/structure";

// A minimal context — propose.ts only forwards it to the proposer.
function ctx(): PlanContext {
  const completed = fixtureCompletedWorkouts();
  return {
    athleteId: "00000000-0000-0000-0000-00000000a711",
    plan: { id: FIXTURE_PLAN_ID, event_date: "2026-09-01" },
    plannedWorkouts: [],
    completedWorkouts: completed,
    loadState: buildLoadSeries(completed, { asOf: "2026-05-25" }),
    asOf: "2026-05-25",
    profile: null,
  };
}

function validModifyOp(): EditOp {
  return {
    op_id: "op-1",
    kind: "modify",
    workout_id: FIXTURE_WORKOUT_IDS.tempoRun,
    changes: { duration_s: 1800, load: 30 },
    reason: "deload the tempo run",
  };
}

describe("propose — happy path", () => {
  it("returns the parsed ops when the proposer yields valid output", async () => {
    const proposer = new FixtureProposer({ ops: [validModifyOp()] });
    const ops = await propose({ proposer, context: ctx(), triggerKind: "weekly" });
    expect(ops).toHaveLength(1);
    expect(ops[0].op_id).toBe("op-1");
    expect(proposer.calls).toBe(1);
  });

  it("returns an empty array for an empty (valid) diff", async () => {
    const proposer = new FixtureProposer({ ops: [] });
    const ops = await propose({ proposer, context: ctx(), triggerKind: "weekly" });
    expect(ops).toEqual([]);
  });
});

describe("propose — retry on invalid JSON", () => {
  it("retries invalid output twice then succeeds on the third attempt", async () => {
    const proposer = new FixtureProposer({
      script: [
        // attempt 0: not even an array
        ["not-an-op"],
        // attempt 1: object missing required fields
        [{ op_id: "x", kind: "modify" }],
        // attempt 2: valid
        [validModifyOp()],
      ],
    });
    const ops = await propose({ proposer, context: ctx(), triggerKind: "weekly" });
    expect(ops).toHaveLength(1);
    expect(proposer.calls).toBe(3);
  });

  it("feeds the validation error back to the proposer on retry", async () => {
    const seenPriorErrors: (string | undefined)[] = [];
    const proposer = {
      calls: 0,
      async propose(input: { priorError?: string }) {
        seenPriorErrors.push(input.priorError);
        this.calls += 1;
        // first call invalid, second valid
        return this.calls === 1 ? [{ bad: true }] : [validModifyOp()];
      },
    };
    await propose({ proposer, context: ctx(), triggerKind: "weekly" });
    expect(seenPriorErrors[0]).toBeUndefined();
    expect(seenPriorErrors[1]).toMatch(/op\[0\] invalid/);
  });
});

describe("propose — error paths", () => {
  it("throws ProposeError when all attempts are invalid", async () => {
    const proposer = new FixtureProposer({ script: [[{ bad: 1 }]] });
    await expect(
      propose({ proposer, context: ctx(), triggerKind: "weekly" })
    ).rejects.toBeInstanceOf(ProposeError);
    // It exhausts the full retry budget.
    expect(proposer.calls).toBe(MAX_ATTEMPTS);
  });

  it("throws ProposeError when the proposer throws on every attempt", async () => {
    const proposer = new FixtureProposer({ failWith: new Error("provider down") });
    await expect(
      propose({ proposer, context: ctx(), triggerKind: "weekly" })
    ).rejects.toBeInstanceOf(ProposeError);
    expect(proposer.calls).toBe(MAX_ATTEMPTS);
  });

  it("rejects duplicate op_ids", async () => {
    const dup = { ...validModifyOp(), op_id: "dup" };
    const proposer = new FixtureProposer({ script: [[dup, { ...dup }]] });
    await expect(
      propose({ proposer, context: ctx(), triggerKind: "weekly" })
    ).rejects.toBeInstanceOf(ProposeError);
  });
});
