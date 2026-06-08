import { describe, expect, it } from "vitest";
import { GeneratePlanInputSchema } from "@da2/shared";

import { addDays } from "@/training-load";
import type { GenerateStructuredParams, LlmClient, LlmResult } from "@/llm";
import { LlmRateLimited } from "@/llm";

import type { GenerationContext } from "../context";
import { generate, MAX_PARSE_ATTEMPTS } from "../generate";

const TODAY = "2026-06-08";
const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const START = "2026-06-15";

const CTX: GenerationContext = {
  load: { seedCtl: 40, seedAtl: 40, recentWeeklyTss: 300 },
  sparseProfile: false,
};

function input() {
  return GeneratePlanInputSchema.parse({ athlete_id: ATHLETE, weekly_hours: 8 });
}

// Build a schema-valid plan JSON from a per-week TSS array.
function planJson(weeklyTss: number[], over: { rationale?: string } = {}) {
  const offsets = [0, 1, 3, 5];
  const workouts = weeklyTss.flatMap((wt, wi) =>
    offsets.map((off) => {
      const per = wt / offsets.length;
      return {
        scheduled_date: addDays(START, wi * 7 + off),
        sport: "run",
        structure: {
          duration_s: 3600,
          load: per,
          intensity_target: { kind: "zone", value: 2 },
          phase: wi === 0 ? "base" : "build",
        },
        rationale: over.rationale ?? "Aerobic session.",
        planned_load: per,
      };
    })
  );
  return { event_type: null, event_date: null, workouts };
}

const SAFE = planJson([200, 200]); // below the 300 baseline -> safe
const UNSAFE = planJson([500, 500]); // +66% over baseline -> volume_ramp
const CONTENT_BAD = planJson([200, 200], {
  rationale: "Take ibuprofen and run through the pain.",
});

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

describe("generate", () => {
  it("returns a safe plan on the happy path (one call)", async () => {
    const client = new FakeClient([SAFE]);
    const result = await generate(input(), CTX, { client, today: TODAY });
    expect(result.status).toBe("ok");
    expect(client.calls).toHaveLength(1);
  });

  it("short-circuits an infeasible ask without calling the model", async () => {
    const client = new FakeClient([SAFE]);
    const past = GeneratePlanInputSchema.parse({
      athlete_id: ATHLETE,
      weekly_hours: 8,
      event_date: "2026-05-01",
    });
    const result = await generate(past, CTX, { client, today: TODAY });
    expect(result.status).toBe("infeasible");
    expect(client.calls).toHaveLength(0);
  });

  it("retries malformed output then succeeds", async () => {
    const client = new FakeClient([{ bad: 1 }, { also: "bad" }, SAFE]);
    const result = await generate(input(), CTX, { client, today: TODAY });
    expect(result.status).toBe("ok");
    expect(client.calls).toHaveLength(3);
  });

  it("gives up after the parse-attempt ceiling on always-invalid output", async () => {
    const client = new FakeClient([{ bad: 1 }]);
    const result = await generate(input(), CTX, { client, today: TODAY });
    expect(result.status).toBe("infeasible");
    expect(client.calls).toHaveLength(MAX_PARSE_ATTEMPTS);
  });

  it("hard-rejects a plan with disallowed content (no regeneration)", async () => {
    const client = new FakeClient([CONTENT_BAD]);
    const result = await generate(input(), CTX, { client, today: TODAY });
    expect(result.status).toBe("infeasible");
    expect(client.calls).toHaveLength(1);
  });

  it("regenerates an unsafe plan with the violation fed back, then succeeds", async () => {
    const client = new FakeClient([UNSAFE, SAFE]);
    const result = await generate(input(), CTX, { client, today: TODAY });
    expect(result.status).toBe("ok");
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].prompt).toMatch(/unsafe and was rejected/i);
  });

  it("refuses when every regeneration stays unsafe", async () => {
    const client = new FakeClient([UNSAFE]);
    const result = await generate(input(), CTX, { client, today: TODAY });
    expect(result.status).toBe("infeasible");
    if (result.status === "infeasible") {
      expect(result.reason).toMatch(/safe training limits/i);
    }
  });

  it("propagates a rate-limit error so the worker can back off", async () => {
    const client = new FakeClient([new LlmRateLimited("slow down", 30)]);
    await expect(generate(input(), CTX, { client, today: TODAY })).rejects.toBeInstanceOf(
      LlmRateLimited
    );
  });
});
