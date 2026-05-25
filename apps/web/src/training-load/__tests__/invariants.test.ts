import { describe, expect, it } from "vitest";

import { buildLoadSeries, type LoadWorkoutInput } from "@/training-load/load-series";
import {
  isoWeekKey,
  validateOps,
  type ValidatableOp,
  type ValidatablePlan,
  type ValidatablePlannedWorkout,
  type ValidateContext,
} from "@/training-load/invariants";

const ASOF = "2026-03-15";

// A calm, mid-block load state well clear of every load-trend floor/cap, so
// volume-ramp / coach-protection / event tests isolate ONE invariant at a time.
function calmLoadState() {
  const workouts: LoadWorkoutInput[] = [];
  for (let i = 0; i < 84; i++) {
    workouts.push({
      started_at: addDays("2026-01-01", i),
      duration_s: 3600,
      summary_stats: { tss: 50 },
    });
  }
  return buildLoadSeries(workouts, { asOf: ASOF });
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function plannedRow(over: Partial<ValidatablePlannedWorkout>): ValidatablePlannedWorkout {
  return {
    id: "w-1",
    scheduled_date: "2026-03-18",
    duration_s: 3600,
    load: null,
    status: "planned",
    edited_by_kind: "ai_review",
    edited_at: null,
    ...over,
  };
}

function baseCtx(over: Partial<ValidateContext> = {}): ValidateContext {
  return {
    plannedWorkouts: [],
    loadState: calmLoadState(),
    asOf: ASOF,
    ...over,
  };
}

describe("isoWeekKey", () => {
  it("groups days in the same ISO week", () => {
    // 2026-03-16 is a Monday; the week runs Mon..Sun.
    expect(isoWeekKey("2026-03-16")).toBe(isoWeekKey("2026-03-22"));
    expect(isoWeekKey("2026-03-16")).not.toBe(isoWeekKey("2026-03-23"));
  });
});

describe("validateOps — weekly volume ramp", () => {
  it("drops an op pushing weekly volume +25% with reason volume_ramp", () => {
    // Existing week: two 60-min planned runs = 7200s baseline.
    const planned = [
      plannedRow({ id: "w-a", scheduled_date: "2026-03-16", duration_s: 3600 }),
      plannedRow({ id: "w-b", scheduled_date: "2026-03-18", duration_s: 3600 }),
    ];
    // Insert a 30-min (1800s) run → +25% over 7200s baseline.
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "insert",
      workout_id: null,
      target_date: "2026-03-20", // same ISO week
      duration_s: 1800,
    };
    const res = validateOps(
      { event_date: null },
      [op],
      baseCtx({ plannedWorkouts: planned })
    );
    expect(res.valid).toHaveLength(0);
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0].reason).toBe("volume_ramp");
  });

  it("passes a deload op (volume cut) — never flagged by the ramp cap", () => {
    const planned = [
      plannedRow({ id: "w-a", scheduled_date: "2026-03-16", duration_s: 3600 }),
      plannedRow({ id: "w-b", scheduled_date: "2026-03-18", duration_s: 3600 }),
    ];
    // Modify w-b down to 30 min (a cut).
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "modify",
      workout_id: "w-b",
      target_date: "2026-03-18",
      duration_s: 1800,
    };
    const res = validateOps(
      { event_date: null },
      [op],
      baseCtx({ plannedWorkouts: planned })
    );
    expect(res.dropped).toHaveLength(0);
    expect(res.valid).toHaveLength(1);
  });

  it("passes a small +5% bump (within the ~10% cap)", () => {
    const planned = [
      plannedRow({ id: "w-a", scheduled_date: "2026-03-16", duration_s: 36000 }),
    ];
    // +1800s on a 36000s week ≈ +5%.
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "insert",
      workout_id: null,
      target_date: "2026-03-18",
      duration_s: 1800,
    };
    const res = validateOps(
      { event_date: null },
      [op],
      baseCtx({ plannedWorkouts: planned })
    );
    expect(res.valid).toHaveLength(1);
  });
});

describe("validateOps — coach protection", () => {
  it("drops an op targeting a coach-edited row (coach_protected)", () => {
    const planned = [plannedRow({ id: "w-coach", edited_by_kind: "coach" })];
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "modify",
      workout_id: "w-coach",
      target_date: "2026-03-18",
      duration_s: 1800, // even a cut is protected
    };
    const res = validateOps({ event_date: null }, [op], baseCtx({ plannedWorkouts: planned }));
    expect(res.valid).toHaveLength(0);
    expect(res.dropped[0].reason).toBe("coach_protected");
  });

  it("drops an op targeting a recently-edited NULL-attribution row (conservative)", () => {
    const planned = [
      plannedRow({
        id: "w-unknown",
        edited_by_kind: null,
        edited_at: addDays(ASOF, -3) + "T12:00:00Z", // 3 days ago
      }),
    ];
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "modify",
      workout_id: "w-unknown",
      target_date: "2026-03-18",
      duration_s: 1800,
    };
    const res = validateOps({ event_date: null }, [op], baseCtx({ plannedWorkouts: planned }));
    expect(res.dropped[0].reason).toBe("coach_protected");
  });

  it("allows an op targeting an OLD NULL-attribution row (outside the window)", () => {
    const planned = [
      plannedRow({
        id: "w-old",
        edited_by_kind: null,
        edited_at: addDays(ASOF, -60) + "T12:00:00Z", // 60 days ago
        duration_s: 3600,
      }),
    ];
    // A cut, so volume ramp doesn't interfere.
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "modify",
      workout_id: "w-old",
      target_date: "2026-03-18",
      duration_s: 1800,
    };
    const res = validateOps({ event_date: null }, [op], baseCtx({ plannedWorkouts: planned }));
    expect(res.valid).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it("allows an op on an ai_review row with no edit timestamp", () => {
    const planned = [plannedRow({ id: "w-ai", edited_by_kind: "ai_review", edited_at: null })];
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "skip", // skip removes load — no other invariant fires
      workout_id: "w-ai",
      target_date: "2026-03-18",
    };
    const res = validateOps({ event_date: null }, [op], baseCtx({ plannedWorkouts: planned }));
    expect(res.valid).toHaveLength(1);
  });
});

describe("validateOps — event-date invariants (no-op when null)", () => {
  const insertNearEvent: ValidatableOp = {
    op_id: "op-1",
    kind: "insert",
    workout_id: null,
    target_date: "2026-03-25", // 10 days after asOf
    duration_s: 3600,
  };

  it("drops an op scheduled PAST event_date (past_event)", () => {
    const plan: ValidatablePlan = { event_date: "2026-03-20" };
    const op: ValidatableOp = { ...insertNearEvent, target_date: "2026-03-22" }; // after event
    const res = validateOps(plan, [op], baseCtx());
    expect(res.dropped[0].reason).toBe("past_event");
  });

  it("the SAME past-event op passes when event_date is NULL", () => {
    const plan: ValidatablePlan = { event_date: null };
    const op: ValidatableOp = { ...insertNearEvent, target_date: "2026-03-22" };
    const res = validateOps(plan, [op], baseCtx());
    expect(res.valid).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it("drops a new/heavier load op inside the taper window (taper_window)", () => {
    // Event 2026-03-22; taper window = 14 days → [03-08, 03-22]. Insert lands inside.
    const plan: ValidatablePlan = { event_date: "2026-03-22" };
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "insert",
      workout_id: null,
      target_date: "2026-03-18", // 4 days before event, inside taper
      duration_s: 3600,
    };
    const res = validateOps(plan, [op], baseCtx());
    expect(res.dropped[0].reason).toBe("taper_window");
  });

  it("allows a load CUT (skip) inside the taper window", () => {
    const plan: ValidatablePlan = { event_date: "2026-03-22" };
    const planned = [plannedRow({ id: "w-taper", scheduled_date: "2026-03-18" })];
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "skip",
      workout_id: "w-taper",
      target_date: "2026-03-18",
    };
    const res = validateOps(plan, [op], baseCtx({ plannedWorkouts: planned }));
    expect(res.valid).toHaveLength(1);
  });

  it("taper + past-event are no-ops with null event_date; ramp/TSB still apply", () => {
    const plan: ValidatablePlan = { event_date: null };
    // A huge insert that WOULD breach the volume ramp on an existing week.
    const planned = [plannedRow({ id: "w-a", scheduled_date: "2026-03-18", duration_s: 3600 })];
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "insert",
      workout_id: null,
      target_date: "2026-03-18",
      duration_s: 7200, // +200% on a 3600s week
    };
    const res = validateOps(plan, [op], baseCtx({ plannedWorkouts: planned }));
    // Not past_event / taper (those no-op); the volume ramp still catches it.
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0].reason).toBe("volume_ramp");
  });
});

describe("validateOps — load-trend invariants (CTL ramp + TSB floor)", () => {
  it("drops an op that would push projected TSB below the floor (tsb_floor)", () => {
    // Build a state already near the TSB floor, then add a big same-day TSS spike.
    const workouts: LoadWorkoutInput[] = [];
    for (let i = 0; i < 84; i++) {
      // Ramp hard recently so TSB is already very negative.
      const tss = i < 70 ? 40 : 200;
      workouts.push({
        started_at: addDays("2026-01-01", i),
        duration_s: 3600,
        summary_stats: { tss },
      });
    }
    const loadState = buildLoadSeries(workouts, { asOf: ASOF });
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "insert",
      workout_id: null,
      target_date: ASOF,
      load: 400, // huge extra acute load today
    };
    const res = validateOps(
      { event_date: null },
      [op],
      baseCtx({ loadState, completedWorkouts: workouts })
    );
    expect(res.dropped).toHaveLength(1);
    expect(["tsb_floor", "ctl_ramp"]).toContain(res.dropped[0].reason);
  });

  it("a normal-sized op on a calm state passes the load-trend checks", () => {
    const op: ValidatableOp = {
      op_id: "op-1",
      kind: "insert",
      workout_id: null,
      target_date: ASOF,
      load: 40,
    };
    const res = validateOps({ event_date: null }, [op], baseCtx());
    expect(res.valid).toHaveLength(1);
  });
});

describe("validateOps — batch behavior", () => {
  it("keeps safe ops and drops only the unsafe one, preserving op identity", () => {
    const planned = [plannedRow({ id: "w-coach", edited_by_kind: "coach" })];
    const safe: ValidatableOp = {
      op_id: "safe",
      kind: "skip",
      workout_id: null,
      target_date: "2026-03-18",
    };
    const unsafe: ValidatableOp = {
      op_id: "unsafe",
      kind: "modify",
      workout_id: "w-coach",
      target_date: "2026-03-18",
      duration_s: 1800,
    };
    const res = validateOps(
      { event_date: null },
      [safe, unsafe],
      baseCtx({ plannedWorkouts: planned })
    );
    expect(res.valid.map((o) => o.op_id)).toEqual(["safe"]);
    expect(res.dropped.map((d) => d.op.op_id)).toEqual(["unsafe"]);
    expect(res.dropped[0].reason).toBe("coach_protected");
  });

  it("cumulative small bumps that together exceed the cap are caught", () => {
    const planned = [plannedRow({ id: "w-a", scheduled_date: "2026-03-16", duration_s: 10000 })];
    // Two inserts of +600s each into the same week. Baseline 10000s, cap +10% = 11000s.
    // First insert (10600) passes; second (11200) breaches.
    const op1: ValidatableOp = {
      op_id: "op-1",
      kind: "insert",
      workout_id: null,
      target_date: "2026-03-17",
      duration_s: 600,
    };
    const op2: ValidatableOp = {
      op_id: "op-2",
      kind: "insert",
      workout_id: null,
      target_date: "2026-03-18",
      duration_s: 600,
    };
    const res = validateOps(
      { event_date: null },
      [op1, op2],
      baseCtx({ plannedWorkouts: planned })
    );
    expect(res.valid.map((o) => o.op_id)).toEqual(["op-1"]);
    expect(res.dropped.map((d) => d.op.op_id)).toEqual(["op-2"]);
    expect(res.dropped[0].reason).toBe("volume_ramp");
  });
});

describe("validateOps — move ops relocate load (net-zero added TSS)", () => {
  it("keeps a batch of high-load moves without false ctl_ramp/tsb_floor drops", () => {
    // Five existing high-load workouts, each moved to a different day. A move
    // relocates existing load; it adds NO new TSS to the series. If the validator
    // counted each move's full TSS as "added" (the pre-fix bug), 5x150 TSS of
    // phantom load would trip ctl_ramp/tsb_floor and wrongly drop the moves.
    const planned: ValidatablePlannedWorkout[] = [];
    const ops: ValidatableOp[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `w-${i}`;
      planned.push(
        plannedRow({ id, scheduled_date: addDays("2026-03-16", i), duration_s: 3600, load: 150 }),
      );
      ops.push({
        op_id: `op-${i}`,
        kind: "move",
        workout_id: id,
        target_date: addDays("2026-03-23", i), // shift each into the next week
        duration_s: 3600,
        load: 150,
      });
    }
    const res = validateOps({ event_date: null }, ops, baseCtx({ plannedWorkouts: planned }));
    expect(res.dropped).toHaveLength(0);
    expect(res.valid).toHaveLength(5);
  });
});
