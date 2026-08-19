// Tests for computePeriodFingerprint (U4, KTD3).
//
// These tests ARE the specification of "material change" (R6). Every assertion
// below is a policy decision about when an athlete's cached narrative gets
// thrown away and regenerated at cost, or kept and shown as still-true.
//
// Two failure modes, in tension:
//   - hashing too little -> stale prose presented as current (the report lies)
//   - hashing too much   -> every review goes stale constantly (the signal
//                           becomes noise, and the regeneration bill is
//                           unbounded)

import { describe, expect, it } from "vitest";

import type { PeriodContext } from "../context";
import { computePeriodFingerprint } from "../fingerprint";

function workout(over: Partial<PeriodContext["completed"][number]> = {}) {
  return {
    id: "cw-1",
    sport: "run",
    started_at: "2026-08-12T08:00:00.000Z",
    duration_s: 3000,
    distance_m: 10000,
    summary_stats: { tss: 55 } as Record<string, unknown>,
    matched_planned_workout_id: "pw-1" as string | null,
    ...over,
  };
}

function prescribed(over: Partial<PeriodContext["planned"][number]> = {}) {
  return {
    id: "pw-1",
    sport: "run",
    scheduled_date: "2026-08-12",
    planned_load: 55 as number | null,
    structure: { duration_s: 3600 } as Record<string, unknown> | null,
    ...over,
  };
}

function context(over: Partial<PeriodContext> = {}): PeriodContext {
  return {
    athleteId: "athlete-1",
    kind: "weekly",
    periodKey: "2026-W33",
    bounds: { start: "2026-08-10", end: "2026-08-16" },
    timezone: "Europe/London",
    completed: [workout()],
    planned: [prescribed()],
    previous: null,
    plan: { id: "plan-1", event_date: "2026-10-01", goal: "marathon" },
    profile: null,
    ...over,
  };
}

const BASE = computePeriodFingerprint(context());

// ---------------------------------------------------------------------------
// Stability
// ---------------------------------------------------------------------------

describe("stability", () => {
  it("is deterministic for an identical context", () => {
    expect(computePeriodFingerprint(context())).toBe(BASE);
  });

  it("is unchanged by object key insertion order", () => {
    const reordered = context({
      completed: [
        {
          matched_planned_workout_id: "pw-1",
          summary_stats: { tss: 55 },
          distance_m: 10000,
          duration_s: 3000,
          started_at: "2026-08-12T08:00:00.000Z",
          sport: "run",
          id: "cw-1",
        },
      ],
    });
    expect(computePeriodFingerprint(reordered)).toBe(BASE);
  });

  it("is unchanged by nested key order inside summary_stats", () => {
    const a = context({ completed: [workout({ summary_stats: { tss: 55, np: 210 } })] });
    const b = context({ completed: [workout({ summary_stats: { np: 210, tss: 55 } })] });
    expect(computePeriodFingerprint(a)).toBe(computePeriodFingerprint(b));
  });

  // Postgres makes no ordering promise without ORDER BY. If row order moved the
  // hash, reviews would go stale at random.
  it("is unchanged by row order", () => {
    const forward = context({
      completed: [workout({ id: "cw-1" }), workout({ id: "cw-2" })],
      planned: [prescribed({ id: "pw-1" }), prescribed({ id: "pw-2" })],
    });
    const reversed = context({
      completed: [workout({ id: "cw-2" }), workout({ id: "cw-1" })],
      planned: [prescribed({ id: "pw-2" }), prescribed({ id: "pw-1" })],
    });
    expect(computePeriodFingerprint(reversed)).toBe(computePeriodFingerprint(forward));
  });
});

// ---------------------------------------------------------------------------
// Material changes — the narrative MUST go stale
// ---------------------------------------------------------------------------

describe("material changes", () => {
  it("changes when a workout's duration changes", () => {
    expect(computePeriodFingerprint(context({ completed: [workout({ duration_s: 3600 })] }))).not.toBe(
      BASE,
    );
  });

  it("changes when a workout's distance changes", () => {
    expect(computePeriodFingerprint(context({ completed: [workout({ distance_m: 12000 })] }))).not.toBe(
      BASE,
    );
  });

  it("changes when a workout's sport changes", () => {
    expect(computePeriodFingerprint(context({ completed: [workout({ sport: "bike" })] }))).not.toBe(
      BASE,
    );
  });

  // AE3: Strava enrichment landing after the review was written.
  it("changes when summary_stats gains enrichment", () => {
    const enriched = context({
      completed: [workout({ summary_stats: { tss: 55, zones: [1, 2, 3], laps: 4 } })],
    });
    expect(computePeriodFingerprint(enriched)).not.toBe(BASE);
  });

  it("changes when a workout is added to the period", () => {
    const more = context({ completed: [workout(), workout({ id: "cw-2" })] });
    expect(computePeriodFingerprint(more)).not.toBe(BASE);
  });

  // This is how a SOFT-DELETED workout invalidates the review: it drops out of
  // the context read, so it drops out of this projection. Migration 0029
  // deliberately has no soft-delete cascade for exactly this reason.
  it("changes when a workout is removed from the period", () => {
    expect(computePeriodFingerprint(context({ completed: [] }))).not.toBe(BASE);
  });

  it("changes when a workout's plan match changes", () => {
    expect(
      computePeriodFingerprint(context({ completed: [workout({ matched_planned_workout_id: "pw-9" })] })),
    ).not.toBe(BASE);
  });

  it("changes when a workout becomes unmatched", () => {
    expect(
      computePeriodFingerprint(context({ completed: [workout({ matched_planned_workout_id: null })] })),
    ).not.toBe(BASE);
  });

  it("changes when the prescribed set gains a workout", () => {
    expect(
      computePeriodFingerprint(context({ planned: [prescribed(), prescribed({ id: "pw-2" })] })),
    ).not.toBe(BASE);
  });

  it("changes when a prescription's structure is edited", () => {
    expect(
      computePeriodFingerprint(context({ planned: [prescribed({ structure: { duration_s: 5400 } })] })),
    ).not.toBe(BASE);
  });

  it("changes when a prescription's load is edited", () => {
    expect(computePeriodFingerprint(context({ planned: [prescribed({ planned_load: 80 })] }))).not.toBe(
      BASE,
    );
  });

  it("changes when a prescription is rescheduled within the period", () => {
    expect(
      computePeriodFingerprint(context({ planned: [prescribed({ scheduled_date: "2026-08-14" })] })),
    ).not.toBe(BASE);
  });

  // The takeaway is written TOWARD the goal and event date. An athlete who
  // changes their event has invalidated the advice in every stored takeaway.
  it("changes when the plan goal changes", () => {
    expect(
      computePeriodFingerprint(
        context({ plan: { id: "plan-1", event_date: "2026-10-01", goal: "70.3" } }),
      ),
    ).not.toBe(BASE);
  });

  it("changes when the event date moves", () => {
    expect(
      computePeriodFingerprint(
        context({ plan: { id: "plan-1", event_date: "2026-11-01", goal: "marathon" } }),
      ),
    ).not.toBe(BASE);
  });

  it("changes when the plan disappears entirely", () => {
    expect(computePeriodFingerprint(context({ plan: null }))).not.toBe(BASE);
  });

  // Two different periods must never collide, or one athlete's review could be
  // served from another period's cache.
  it("differs between period keys", () => {
    expect(computePeriodFingerprint(context({ periodKey: "2026-W32" }))).not.toBe(BASE);
  });

  it("differs between period kinds", () => {
    expect(
      computePeriodFingerprint(context({ kind: "monthly", periodKey: "2026-08" })),
    ).not.toBe(BASE);
  });
});

// ---------------------------------------------------------------------------
// Non-material changes — the cached narrative MUST be reused (AE4)
// ---------------------------------------------------------------------------

describe("non-material changes", () => {
  // The projection is built as a fresh literal naming only the material
  // fields, so these are structurally incapable of moving the hash. Each of
  // these assertions is worth an LLM call per athlete per period.
  it("ignores a workout's started_at correction", () => {
    expect(
      computePeriodFingerprint(context({ completed: [workout({ started_at: "2026-08-12T08:05:00.000Z" })] })),
    ).toBe(BASE);
  });

  it("ignores the athlete profile entirely", () => {
    expect(
      computePeriodFingerprint(
        context({ profile: { manual_fields: { ftp: 260 }, baselines: { ftp: 250 } } }),
      ),
    ).toBe(BASE);
  });

  it("ignores the plan id", () => {
    expect(
      computePeriodFingerprint(
        context({ plan: { id: "plan-renamed", event_date: "2026-10-01", goal: "marathon" } }),
      ),
    ).toBe(BASE);
  });

  it("ignores the athlete's timezone", () => {
    // The timezone already determines WHICH rows are in the period; once the
    // set is fixed, re-hashing the zone would invalidate every historical
    // review the moment an athlete travels.
    expect(computePeriodFingerprint(context({ timezone: "America/Los_Angeles" }))).toBe(BASE);
  });

  // CTL/ATL/TSB move whenever the athlete logs anything. Hashing them would
  // mark every past review stale after the next ride -- the deliberate
  // permanent exclusion.
  it("ignores the prior period's contents", () => {
    expect(
      computePeriodFingerprint(
        context({ previous: { key: "2026-W32", completed: [workout({ id: "cw-prev" })] } }),
      ),
    ).toBe(BASE);
  });

  it("ignores the athlete id", () => {
    // Ownership is enforced by the query, not the hash; including it would add
    // nothing and would leak an id into a value stored in plain text.
    expect(computePeriodFingerprint(context({ athleteId: "athlete-9" }))).toBe(BASE);
  });
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("output shape", () => {
  it("is a sha256 hex digest", () => {
    expect(BASE).toMatch(/^[0-9a-f]{64}$/);
  });
});
