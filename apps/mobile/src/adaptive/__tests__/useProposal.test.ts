// Unit tests for the mobile proposal surface's decision logic (Unit 11).
//
// The mobile vitest env is Node-only and must not import react-native / expo
// (per vitest.config.ts), so — like the strava-machine tests — we cover the
// pure helpers that useProposal.ts + the weekly-review modal are built on
// (proposal-view.ts). These drive every required state: diff render, cherry-pick
// op_ids, stale-skip, no_changes, lapsed routing, banner copy, and which
// proposal the hook selects from the GET list.

import { describe, expect, it } from "vitest";

import type { ProposedEdit, WeeklyReviewRow } from "@da2/shared";

import {
  appliedOutcomes,
  bannerFor,
  outcomeMessage,
  preservedInvariants,
  selectActiveProposal,
  selectionSummary,
  toOpRows,
  triggerLabel,
  viewKindForStatus,
  wasSuperseded,
} from "../proposal-view";

// --- Fixtures ----------------------------------------------------------------

const MOVE: ProposedEdit = {
  op: {
    op_id: "op-move",
    kind: "move",
    workout_id: "22222222-2222-2222-2222-222222222222",
    to_date: "2026-06-02",
    reason: "Shift your long run to the weekend.",
  },
  baseline: { version: 3, status: "planned" },
};

const MODIFY: ProposedEdit = {
  op: {
    op_id: "op-modify",
    kind: "modify",
    workout_id: "33333333-3333-3333-3333-333333333333",
    changes: { duration_s: 2700, load: 55 },
    reason: "Trim Tuesday to keep weekly load in range.",
  },
  baseline: { version: 2, status: "planned" },
};

function review(overrides: Partial<WeeklyReviewRow> = {}): WeeklyReviewRow {
  return {
    id: "rev-1",
    athlete_id: "ath-1",
    plan_id: "plan-1",
    trigger_kind: "missed_block",
    scope: "plan",
    recipient: "athlete",
    status: "proposed",
    proposed_changes: [MOVE, MODIFY],
    narrative: "You missed two sessions — here is a lighter path back.",
    event_date_snapshot: null,
    earliest_affected_date: "2026-06-01",
    generated_at: "2026-05-25T08:00:00Z",
    decided_at: null,
    created_at: "2026-05-25T08:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

// --- Trigger-label mapping ---------------------------------------------------

describe("triggerLabel", () => {
  it("maps trigger kinds to athlete-facing copy", () => {
    expect(triggerLabel("missed_block")).toBe("Based on missed workouts");
    expect(triggerLabel("weekly")).toBe("Weekly review");
    expect(triggerLabel("event_change")).toBe("You moved your event date");
  });
});

// --- Diff render (happy path) ------------------------------------------------

describe("toOpRows", () => {
  it("renders before/after/reason per op, dated ops first", () => {
    const rows = toOpRows(review(), "UTC");
    expect(rows).toHaveLength(2);
    expect(rows[0].opId).toBe("op-move"); // dated -> first
    expect(rows[0].before).toBeTruthy();
    expect(rows[0].after).toContain("Jun");
    expect(rows[0].reason).toBe("Shift your long run to the weekend.");
  });
});

// --- Which proposal the hook shows -------------------------------------------

describe("selectActiveProposal", () => {
  it("prefers the most recent pending proposal", () => {
    const older = review({ id: "old", generated_at: "2026-05-20T08:00:00Z" });
    const newer = review({ id: "new", generated_at: "2026-05-25T08:00:00Z" });
    expect(selectActiveProposal([older, newer])?.id).toBe("new");
  });

  it("falls back to the most recent terminal/no_changes when none pending", () => {
    const done = review({ id: "done", status: "accepted" });
    expect(selectActiveProposal([done])?.id).toBe("done");
  });

  it("ignores soft-deleted rows", () => {
    const deleted = review({ id: "d", deleted_at: "2026-05-25T09:00:00Z" });
    expect(selectActiveProposal([deleted])).toBeNull();
  });
});

// --- Cherry-pick selection (modify sends selected op_ids) --------------------

describe("selectionSummary", () => {
  const ids = ["op-move", "op-modify"];

  it("all selected -> Accept all", () => {
    const s = selectionSummary(ids, new Set(ids));
    expect(s.ctaLabel).toBe("Accept all changes");
    expect(s.selectedIds).toEqual(ids);
    expect(s.ctaEnabled).toBe(true);
  });

  it("subset -> Apply N changes with only those op_ids", () => {
    const s = selectionSummary(ids, new Set(["op-move"]));
    expect(s.ctaLabel).toBe("Apply 1 change");
    expect(s.selectedIds).toEqual(["op-move"]);
  });

  it("none selected -> disabled", () => {
    const s = selectionSummary(ids, new Set());
    expect(s.ctaEnabled).toBe(false);
  });
});

// --- States ------------------------------------------------------------------

describe("viewKindForStatus", () => {
  it("routes proposed / no_changes / terminal", () => {
    expect(viewKindForStatus("proposed")).toBe("proposed");
    expect(viewKindForStatus("no_changes")).toBe("no_changes");
    expect(viewKindForStatus("rejected")).toBe("terminal");
    expect(viewKindForStatus("expired")).toBe("terminal");
  });
});

describe("stale-skip", () => {
  it("marks skipped ops with copy after an accept", () => {
    const outcomes = appliedOutcomes([
      { op_id: "op-move", outcome: "applied" },
      { op_id: "op-modify", outcome: "skipped_stale" },
    ]);
    expect(outcomes[0].skipped).toBe(false);
    expect(outcomes[1].skipped).toBe(true);
    expect(outcomes[1].message).toBe("Workout changed — this change was skipped");
  });

  it("flags a superseded apply", () => {
    expect(wasSuperseded("superseded")).toBe(true);
    expect(wasSuperseded("partially_accepted")).toBe(false);
  });

  it("maps outcomes to copy", () => {
    expect(outcomeMessage("applied")).toBeNull();
    expect(outcomeMessage("dropped_coach_protected")).toMatch(/coach/i);
  });
});

describe("preservedInvariants", () => {
  it("always load balance; taper when an event is involved", () => {
    expect(preservedInvariants(review())).toEqual(["Load balance maintained"]);
    expect(preservedInvariants(review({ trigger_kind: "event_change" }))).toContain("Taper protected");
  });
});

// --- Banner ------------------------------------------------------------------

describe("bannerFor", () => {
  it("builds review-ready copy with count + trigger label", () => {
    const b = bannerFor([review()]);
    expect(b?.headline).toBe("Your plan was reviewed — 2 changes proposed");
    expect(b?.triggerLabel).toBe("Based on missed workouts");
  });

  it("hides for no_changes / terminal", () => {
    expect(bannerFor([review({ status: "no_changes", proposed_changes: [] })])).toBeNull();
    expect(bannerFor([review({ status: "accepted" })])).toBeNull();
  });
});
