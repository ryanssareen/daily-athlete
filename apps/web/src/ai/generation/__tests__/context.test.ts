import { describe, expect, it } from "vitest";

import { addDays, type LoadWorkoutInput } from "@/training-load";

import { derivePlanLoadContext } from "../context";

const AS_OF = "2026-06-08";

describe("derivePlanLoadContext", () => {
  it("cold-starts at zero with no completed workouts", () => {
    const ctx = derivePlanLoadContext([], AS_OF);
    expect(ctx.seedCtl).toBe(0);
    expect(ctx.seedAtl).toBe(0);
    expect(ctx.recentWeeklyTss).toBeUndefined();
  });

  it("derives a positive seed and a recent weekly baseline from history", () => {
    // 28 consecutive days of ~50 TSS ending on AS_OF.
    const completed: LoadWorkoutInput[] = Array.from({ length: 28 }, (_, i) => ({
      started_at: addDays(AS_OF, -(27 - i)),
      duration_s: 3600,
      summary_stats: { tss: 50 },
    }));
    const ctx = derivePlanLoadContext(completed, AS_OF);
    expect(ctx.seedCtl).toBeGreaterThan(10);
    expect(ctx.recentWeeklyTss).toBeGreaterThan(300);
    expect(ctx.recentWeeklyTss).toBeLessThan(400);
  });
});
