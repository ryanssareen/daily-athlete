import { describe, expect, it } from "vitest";
import { GeneratePlanInputSchema } from "@da2/shared";

import { assessFeasibility } from "../feasibility";

const TODAY = "2026-06-08";
const ATHLETE = "00000000-0000-0000-0000-0000000000a1";

function input(over: Partial<{ event_date: string | null }> = {}) {
  return GeneratePlanInputSchema.parse({
    athlete_id: ATHLETE,
    weekly_hours: 8,
    ...over,
  });
}

describe("assessFeasibility", () => {
  it("is feasible with a comfortable runway to the event", () => {
    expect(assessFeasibility(input({ event_date: "2026-09-01" }), TODAY).feasible).toBe(true);
  });

  it("is feasible when there is no event date (open-ended)", () => {
    expect(assessFeasibility(input(), TODAY).feasible).toBe(true);
  });

  it("refuses an event date in the past", () => {
    const r = assessFeasibility(input({ event_date: "2026-05-01" }), TODAY);
    expect(r.feasible).toBe(false);
    expect(r.reason).toMatch(/past/i);
  });

  it("refuses an event too soon to build a safe plan", () => {
    const r = assessFeasibility(input({ event_date: "2026-06-15" }), TODAY); // ~1 week
    expect(r.feasible).toBe(false);
    expect(r.reason).toMatch(/not enough time/i);
  });
});
