import { describe, expect, it } from "vitest";

import type { GenerateStructuredParams, LlmClient, LlmResult } from "@/llm";
import { LlmRateLimited } from "@/llm";

import type { PlanContext } from "../context";
import { LlmProposer } from "../llm-proposer";
import { propose, ProposeError } from "../propose";

const WID = "00000000-0000-0000-0000-0000000000e1";

const CONTEXT = {
  athleteId: "00000000-0000-0000-0000-0000000000a1",
  plan: { id: "00000000-0000-0000-0000-00000000p1a0", event_date: null },
  plannedWorkouts: [
    {
      id: WID,
      scheduled_date: "2026-06-20",
      duration_s: 3600,
      load: 50,
      status: "planned",
      edited_by_kind: "ai_review",
      edited_at: null,
      version: 1,
    },
  ],
  completedWorkouts: [],
  loadState: { series: [], ctl: 40, atl: 40, tsb: 0, ctlRampPerWeek: 0, powerConfidenceRatio: 0 },
  asOf: "2026-06-15",
  profile: null,
} as unknown as PlanContext;

const VALID_OP = {
  op_id: "o1",
  kind: "move",
  workout_id: WID,
  to_date: "2026-06-22",
  reason: "Shift the long run to the weekend.",
};

class FakeClient implements LlmClient {
  readonly calls: GenerateStructuredParams[] = [];
  constructor(private readonly script: Array<unknown | Error>) {}
  async generateStructured(params: GenerateStructuredParams): Promise<LlmResult> {
    const i = this.calls.length;
    this.calls.push(params);
    const r = this.script[Math.min(i, this.script.length - 1)];
    if (r instanceof Error) throw r;
    return { json: r, usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1 } };
  }
}

describe("LlmProposer", () => {
  it("returns the model's raw candidate ops and builds a framed prompt", async () => {
    const client = new FakeClient([[VALID_OP]]);
    const proposer = new LlmProposer(client);
    const ops = await proposer.propose({ context: CONTEXT, triggerKind: "weekly" });
    expect(ops).toEqual([VALID_OP]);
    expect(client.calls[0].prompt).toContain(WID);
    expect(client.calls[0].system).toMatch(/weekly review/i);
  });

  it("passes priorError feedback into the prompt", async () => {
    const client = new FakeClient([[]]);
    const proposer = new LlmProposer(client);
    await proposer.propose({ context: CONTEXT, triggerKind: "manual", priorError: "op[0] invalid" });
    expect(client.calls[0].prompt).toMatch(/previous response was invalid: op\[0\] invalid/i);
  });

  it("returns an empty array unchanged (a valid no-change diff)", async () => {
    const proposer = new LlmProposer(new FakeClient([[]]));
    expect(await proposer.propose({ context: CONTEXT, triggerKind: "weekly" })).toEqual([]);
  });
});

describe("propose() with LlmProposer", () => {
  it("parses valid ops end-to-end", async () => {
    const proposer = new LlmProposer(new FakeClient([[VALID_OP]]));
    const ops = await propose({ proposer, context: CONTEXT, triggerKind: "weekly" });
    expect(ops).toHaveLength(1);
    expect(ops[0].op_id).toBe("o1");
  });

  it("retries malformed output then succeeds", async () => {
    const client = new FakeClient([[{ kind: "bogus" }], [VALID_OP]]);
    const proposer = new LlmProposer(client);
    const ops = await propose({ proposer, context: CONTEXT, triggerKind: "weekly" });
    expect(ops).toHaveLength(1);
    expect(client.calls).toHaveLength(2);
  });

  it("propagates a rate-limit instead of burning retries (back-off contract)", async () => {
    const client = new FakeClient([new LlmRateLimited("slow down", 30)]);
    const proposer = new LlmProposer(client);
    await expect(
      propose({ proposer, context: CONTEXT, triggerKind: "weekly" })
    ).rejects.toBeInstanceOf(LlmRateLimited);
    // Exactly one call — the rate-limit was NOT retried 3x.
    expect(client.calls).toHaveLength(1);
  });

  it("still exhausts retries (ProposeError) on persistent invalid output", async () => {
    const proposer = new LlmProposer(new FakeClient([[{ kind: "bogus" }]]));
    await expect(
      propose({ proposer, context: CONTEXT, triggerKind: "weekly" })
    ).rejects.toBeInstanceOf(ProposeError);
  });
});
