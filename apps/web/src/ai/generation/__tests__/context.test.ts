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

  it("history beyond the load window does not move the seed (justifies the bounded fetch)", () => {
    // gatherGenerationContext bounds the read to HISTORY_WINDOW_DAYS (~400d).
    // CTL/ATL are EWMAs, so efforts far outside that window contribute
    // negligibly to the seed at AS_OF — windowing the fetch is lossless.
    const recent: LoadWorkoutInput[] = Array.from({ length: 28 }, (_, i) => ({
      started_at: addDays(AS_OF, -(27 - i)),
      duration_s: 3600,
      summary_stats: { tss: 50 },
    }));
    const ancient: LoadWorkoutInput[] = Array.from({ length: 30 }, (_, i) => ({
      started_at: addDays(AS_OF, -(500 + i)),
      duration_s: 3600,
      summary_stats: { tss: 200 },
    }));
    const full = derivePlanLoadContext([...ancient, ...recent], AS_OF);
    const windowed = derivePlanLoadContext(recent, AS_OF);
    expect(Math.abs(full.seedCtl - windowed.seedCtl)).toBeLessThan(0.5);
    expect(Math.abs(full.seedAtl - windowed.seedAtl)).toBeLessThan(0.5);
  });
});
