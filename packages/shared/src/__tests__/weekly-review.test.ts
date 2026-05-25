import { describe, expect, it } from "vitest";

import {
  EditOpResultSchema,
  EditOpSchema,
  NARRATIVE_MAX_LENGTH,
  ProposedEditSchema,
  REASON_MAX_LENGTH,
  StructureChangeSchema,
} from "../edit-op";
import { WeeklyReviewRowSchema } from "../weekly-review";
import { WorkoutEditRowSchema } from "../workout-edit";

const UUID = "00000000-0000-4000-8000-000000000000";
const UUID2 = "11111111-1111-4111-8111-111111111111";

function isoNow() {
  return new Date().toISOString();
}

describe("StructureChangeSchema", () => {
  it("accepts the frozen subset with pinned units", () => {
    const parsed = StructureChangeSchema.parse({
      duration_s: 3600,
      load: 65,
      intensity_target: { kind: "ftp_pct", value: 75 },
    });
    expect(parsed.duration_s).toBe(3600);
  });

  it("rejects unknown structure keys (strict)", () => {
    expect(() =>
      StructureChangeSchema.parse({ duration_min: 60 }),
    ).toThrow();
  });

  it("rejects an out-of-range training zone", () => {
    expect(() =>
      StructureChangeSchema.parse({ intensity_target: { kind: "zone", value: 9 } }),
    ).toThrow();
  });

  it("rejects a non-integer duration", () => {
    expect(() => StructureChangeSchema.parse({ duration_s: 60.5 })).toThrow();
  });
});

describe("EditOpSchema", () => {
  it("accepts a move op", () => {
    const op = EditOpSchema.parse({
      op_id: "op-1",
      kind: "move",
      workout_id: UUID,
      to_date: "2026-06-02",
      reason: "shift the long run off a missed day",
    });
    expect(op.kind).toBe("move");
  });

  it("accepts an insert op with no workout_id", () => {
    const op = EditOpSchema.parse({
      op_id: "op-2",
      kind: "insert",
      on_date: "2026-06-03",
      sport: "run",
      structure: { duration_s: 1800, load: 30 },
      reason: "add a recovery run",
    });
    expect(op.kind).toBe("insert");
  });

  it("rejects a move op missing to_date", () => {
    expect(() =>
      EditOpSchema.parse({ op_id: "x", kind: "move", workout_id: UUID, reason: "r" }),
    ).toThrow();
  });

  it("rejects a malformed date", () => {
    expect(() =>
      EditOpSchema.parse({
        op_id: "x",
        kind: "move",
        workout_id: UUID,
        to_date: "June 2",
        reason: "r",
      }),
    ).toThrow();
  });

  it("rejects a reason over the length cap", () => {
    expect(() =>
      EditOpSchema.parse({
        op_id: "x",
        kind: "skip",
        workout_id: UUID,
        reason: "a".repeat(REASON_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });
});

describe("ProposedEditSchema", () => {
  it("carries a version baseline for an existing-row op", () => {
    const pe = ProposedEditSchema.parse({
      op: { op_id: "op-1", kind: "skip", workout_id: UUID, reason: "rest" },
      baseline: { version: 3, status: "planned" },
    });
    expect(pe.baseline?.version).toBe(3);
  });

  it("allows a null baseline for insert ops", () => {
    const pe = ProposedEditSchema.parse({
      op: {
        op_id: "op-2",
        kind: "insert",
        on_date: "2026-06-03",
        sport: "bike",
        structure: { duration_s: 3600 },
        reason: "brick",
      },
      baseline: null,
    });
    expect(pe.baseline).toBeNull();
  });
});

describe("EditOpResultSchema", () => {
  it("accepts known outcomes", () => {
    expect(
      EditOpResultSchema.parse({ op_id: "op-1", outcome: "skipped_stale" }).outcome,
    ).toBe("skipped_stale");
  });

  it("rejects an unknown outcome", () => {
    expect(() =>
      EditOpResultSchema.parse({ op_id: "op-1", outcome: "exploded" }),
    ).toThrow();
  });
});

describe("WeeklyReviewRowSchema", () => {
  const base = {
    id: UUID,
    athlete_id: UUID2,
    plan_id: UUID,
    trigger_kind: "weekly",
    scope: "plan",
    recipient: "athlete",
    status: "proposed",
    proposed_changes: [],
    narrative: "Looks on track; one small shift.",
    event_date_snapshot: "2026-09-01",
    earliest_affected_date: "2026-06-01",
    generated_at: isoNow(),
    decided_at: null,
    created_at: isoNow(),
    deleted_at: null,
  };

  it("parses a valid proposed row", () => {
    expect(WeeklyReviewRowSchema.parse(base).status).toBe("proposed");
  });

  it("accepts a null event_date_snapshot (no-event plan)", () => {
    expect(
      WeeklyReviewRowSchema.parse({ ...base, event_date_snapshot: null })
        .event_date_snapshot,
    ).toBeNull();
  });

  it("rejects an unknown trigger_kind", () => {
    expect(() =>
      WeeklyReviewRowSchema.parse({ ...base, trigger_kind: "vibes" }),
    ).toThrow();
  });

  it("rejects an unknown recipient", () => {
    expect(() =>
      WeeklyReviewRowSchema.parse({ ...base, recipient: "robot" }),
    ).toThrow();
  });

  it("rejects a narrative over the length cap", () => {
    expect(() =>
      WeeklyReviewRowSchema.parse({ ...base, narrative: "a".repeat(NARRATIVE_MAX_LENGTH + 1) }),
    ).toThrow();
  });
});

describe("WorkoutEditRowSchema", () => {
  it("parses an ai_review audit row", () => {
    const row = WorkoutEditRowSchema.parse({
      id: UUID,
      athlete_id: UUID2,
      planned_workout_id: UUID,
      weekly_review_id: UUID2,
      actor_role: "ai_review",
      actor_user_id: UUID2,
      field_diff: { scheduled_date: { from: "2026-06-01", to: "2026-06-02" } },
      created_at: isoNow(),
    });
    expect(row.actor_role).toBe("ai_review");
  });

  it("allows null planned_workout_id and actor_user_id (scrubbed references)", () => {
    const row = WorkoutEditRowSchema.parse({
      id: UUID,
      athlete_id: UUID2,
      planned_workout_id: null,
      weekly_review_id: null,
      actor_role: "athlete",
      actor_user_id: null,
      field_diff: {},
      created_at: isoNow(),
    });
    expect(row.planned_workout_id).toBeNull();
  });

  it("rejects an unknown actor_role", () => {
    expect(() =>
      WorkoutEditRowSchema.parse({
        id: UUID,
        athlete_id: UUID2,
        planned_workout_id: null,
        weekly_review_id: null,
        actor_role: "system",
        actor_user_id: null,
        field_diff: {},
        created_at: isoNow(),
      }),
    ).toThrow();
  });
});
