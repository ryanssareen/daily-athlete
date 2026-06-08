import { describe, expect, it } from "vitest";
import type { GeneratedPlan } from "@da2/shared";

import type { GenerateStructuredParams, LlmClient, LlmResult } from "@/llm";

import { judgePlan } from "../judge";

const PLAN: GeneratedPlan = {
  event_type: "marathon",
  event_date: "2026-09-01",
  workouts: [
    {
      scheduled_date: "2026-07-01",
      sport: "run",
      structure: {
        duration_s: 3600,
        load: 50,
        intensity_target: { kind: "zone", value: 2 },
        phase: "base",
      },
      rationale: "Easy aerobic run.",
      planned_load: 50,
    },
  ],
};

class FakeClient implements LlmClient {
  readonly calls: GenerateStructuredParams[] = [];
  constructor(private readonly next: unknown) {}
  async generateStructured(params: GenerateStructuredParams): Promise<LlmResult> {
    this.calls.push(params);
    return { json: this.next, usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1 } };
  }
}

describe("judgePlan", () => {
  it("returns the parsed verdict and includes the plan in the prompt", async () => {
    const client = new FakeClient({ score: 0.85, notes: "Solid base, reasonable taper." });
    const verdict = await judgePlan(client, { plan: PLAN });
    expect(verdict.score).toBe(0.85);
    expect(client.calls[0].prompt).toContain("Candidate plan");
  });

  it("includes a reference plan in the prompt when provided", async () => {
    const client = new FakeClient({ score: 0.7, notes: "ok" });
    await judgePlan(client, { plan: PLAN, reference: PLAN, athleteSummary: "Beginner runner." });
    expect(client.calls[0].prompt).toContain("Reference coach plan");
    expect(client.calls[0].prompt).toContain("Athlete:");
  });

  it("throws when the verdict is out of range / malformed", async () => {
    const client = new FakeClient({ score: 5, notes: "x" });
    await expect(judgePlan(client, { plan: PLAN })).rejects.toThrow(/invalid verdict/i);
  });
});
