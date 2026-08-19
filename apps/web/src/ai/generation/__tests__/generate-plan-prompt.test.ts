// Unit tests for buildGenerationPrompt's PLAN HORIZON rules.
//
// The horizon is a correctness bound before it is a cost bound: asked for a
// whole season in one JSON object the model does not decline, it gets cut off
// mid-array and the response fails to parse. Measured against the real model,
// an unbounded request for an athlete with an event ~11 weeks out returned
// `finish_reason: "length"` and invalid JSON; bounded to 4 weeks it returned
// 28 valid workouts and stopped cleanly.

import { describe, expect, it } from "vitest";
import { GeneratePlanInputSchema } from "@da2/shared";

import { addDays } from "@/training-load";

import type { GenerationContext } from "../context";
import {
  buildGenerationPrompt,
  PLAN_GENERATION_MAX_TOKENS,
  PLAN_HORIZON_WEEKS,
} from "../prompts/generate-plan";

const TODAY = "2026-08-19";
const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const HORIZON_END = addDays(TODAY, PLAN_HORIZON_WEEKS * 7 - 1);

const CTX: GenerationContext = {
  load: { seedCtl: 36, seedAtl: 40, recentWeeklyTss: 240 },
  sparseProfile: false,
};

function input(over: Record<string, unknown> = {}) {
  return GeneratePlanInputSchema.parse({ athlete_id: ATHLETE, weekly_hours: 8, ...over });
}

function build(over: Record<string, unknown> = {}) {
  return buildGenerationPrompt(input(over), CTX, TODAY);
}

describe("buildGenerationPrompt — plan horizon", () => {
  it("bounds an event that is beyond the horizon to the first block", () => {
    // Event ~11 weeks out: the whole-season request is what truncated.
    const { system, prompt } = build({ event_date: "2026-11-01" });

    expect(system).toContain("PLAN HORIZON");
    expect(system).toContain(HORIZON_END);
    expect(prompt).toContain(`plan through (do not schedule past this date): ${HORIZON_END}`);
  });

  it("does NOT ask for a taper when the event is beyond the horizon", () => {
    const { system } = build({ event_date: "2026-11-01" });

    // A taper four weeks into a twelve-week build is actively harmful advice,
    // not merely premature.
    expect(system).toContain("do NOT taper in this block");
    expect(system).not.toMatch(/taper in the final week/i);
  });

  it("plans through to an event that falls INSIDE the horizon, taper and all", () => {
    const eventDate = addDays(TODAY, 10); // comfortably inside 4 weeks
    const { system, prompt } = build({ event_date: eventDate });

    expect(system).toContain(`The event on ${eventDate} falls inside this block`);
    expect(system).toContain("taper in the final week");
    // The plan runs to the EVENT, not to the horizon end.
    expect(prompt).toContain(`plan through (do not schedule past this date): ${eventDate}`);
    expect(system).not.toContain("do NOT taper in this block");
  });

  it("treats an event on the horizon's last day as inside it (boundary)", () => {
    const { system, prompt } = build({ event_date: HORIZON_END });

    expect(system).toContain(`The event on ${HORIZON_END} falls inside this block`);
    expect(prompt).toContain(`plan through (do not schedule past this date): ${HORIZON_END}`);
  });

  it("treats an event one day past the horizon as outside it (boundary)", () => {
    const justPast = addDays(HORIZON_END, 1);
    const { system } = build({ event_date: justPast });

    expect(system).toContain("PLAN HORIZON");
    expect(system).toContain("do NOT taper in this block");
  });

  it("bounds an open-ended plan too, and keeps the no-taper framing", () => {
    const { system, prompt } = build();

    expect(system).toContain("PLAN HORIZON");
    expect(system).toContain("No event date");
    expect(prompt).toContain(`plan through (do not schedule past this date): ${HORIZON_END}`);
  });

  it("still anchors the calendar and keeps the safety guardrails", () => {
    // The horizon must not have displaced anything that was already load-bearing.
    const { system } = build({ event_date: "2026-11-01" });

    expect(system).toContain(`CALENDAR ANCHOR — today is ${TODAY}`);
    expect(system).toContain("Never give medical or diagnostic advice");
    expect(system).toContain("Ramp weekly training load");
  });
});

describe("PLAN_GENERATION_MAX_TOKENS", () => {
  it("leaves headroom over a measured 4-week plan without approaching the TPM allowance", () => {
    // Observed completions ranged 4,993-6,000+ across live runs, so the floor
    // must clear the top of that range; the provider's free allowance is
    // 8,000/min counted UP FRONT alongside a ~1,000-token prompt, which sets
    // the ceiling.
    expect(PLAN_GENERATION_MAX_TOKENS).toBeGreaterThan(6_000);
    expect(PLAN_GENERATION_MAX_TOKENS).toBeLessThanOrEqual(7_000);
  });
});
