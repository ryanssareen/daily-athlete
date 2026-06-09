// Unit tests for the athlete proposal-review surface (Unit 11).
//
// The web vitest env is Node-only (no jsdom / testing-library is installed and
// `pnpm install` is unavailable), so — exactly like the mobile strava test —
// we cover the surface's *decision logic* through the pure helpers it is built
// on (proposal-view.ts) plus the fetch-shaped `defaultProposalApi` with a
// stubbed global fetch. The React component is a thin shell over these, so this
// asserts the contract that drives every required state without a renderer.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditOpResult, WeeklyReviewRow, WeeklyReviewStatus } from "@da2/shared";

import { defaultProposalApi } from "@/adaptive/ProposalReview";
import {
  appliedOutcomes,
  bannerFor,
  outcomeMessage,
  preservedInvariants,
  selectionSummary,
  toOpRows,
  triggerLabel,
  viewKindForStatus,
  wasSuperseded,
} from "@/adaptive/proposal-view";

// --- Fixtures ----------------------------------------------------------------

function review(overrides: Partial<WeeklyReviewRow> = {}): WeeklyReviewRow {
  return {
    id: "rev-1",
    athlete_id: "ath-1",
    plan_id: "plan-1",
    trigger_kind: "missed_block",
    scope: "plan",
    recipient: "athlete",
    status: "proposed",
    proposed_changes: [
      {
        op: {
          op_id: "op-move",
          kind: "move",
          workout_id: "22222222-2222-2222-2222-222222222222",
          to_date: "2026-06-02",
          reason: "Shift your long run to the weekend.",
        },
        baseline: { version: 3, status: "planned" },
      },
      {
        op: {
          op_id: "op-modify",
          kind: "modify",
          workout_id: "33333333-3333-3333-3333-333333333333",
          changes: { duration_s: 2700, load: 55 },
          reason: "Trim Tuesday to keep weekly load in range.",
        },
        baseline: { version: 2, status: "planned" },
      },
    ],
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

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Trigger-label mapping ---------------------------------------------------

describe("triggerLabel", () => {
  it("maps each trigger kind to athlete-facing copy", () => {
    expect(triggerLabel("weekly")).toBe("Weekly review");
    expect(triggerLabel("missed_block")).toBe("Based on missed workouts");
    expect(triggerLabel("event_change")).toBe("You moved your event date");
    expect(triggerLabel("manual")).toBe("A review you requested");
  });
});

// --- Diff rendering (happy path: a proposed row renders a diff) ---------------

describe("toOpRows (before -> after diff)", () => {
  it("renders before/after/reason per op, sorted by target date", () => {
    const rows = toOpRows(review(), "UTC");
    expect(rows).toHaveLength(2);
    const move = rows.find((r) => r.opId === "op-move")!;
    expect(move.verb).toBe("Move");
    expect(move.before).toBeTruthy();
    expect(move.after).toContain("Jun");
    expect(move.reason).toBe("Shift your long run to the weekend.");
    // dated op (move) sorts before the undated modify op.
    expect(rows[0].opId).toBe("op-move");
  });

  it("formats an insert with no before-value", () => {
    const r = review({
      proposed_changes: [
        {
          op: {
            op_id: "op-ins",
            kind: "insert",
            on_date: "2026-06-05",
            sport: "run",
            structure: { duration_s: 1800 },
            reason: "Add an easy aerobic run.",
          },
          baseline: null,
        },
      ],
    });
    const [row] = toOpRows(r, "UTC");
    expect(row.before).toBeNull();
    expect(row.after).toContain("Add run");
  });
});

// --- Preserved-invariant callouts --------------------------------------------

describe("preservedInvariants", () => {
  it("always asserts load balance; adds taper when an event is in play", () => {
    expect(preservedInvariants(review())).toEqual(["Load balance maintained"]);
    expect(preservedInvariants(review({ event_date_snapshot: "2026-09-01" }))).toContain(
      "Taper protected"
    );
  });
});

// --- Cherry-pick selection (modify sends the selected op_ids) -----------------

describe("selectionSummary (cherry-pick)", () => {
  const ids = ["op-move", "op-modify"];

  it("all selected -> Accept all", () => {
    const s = selectionSummary(ids, new Set(ids));
    expect(s.selectedCount).toBe(2);
    expect(s.ctaLabel).toBe("Accept all changes");
    expect(s.ctaEnabled).toBe(true);
    expect(s.selectedIds).toEqual(ids);
  });

  it("subset selected -> Apply N changes, with only those op_ids", () => {
    const s = selectionSummary(ids, new Set(["op-modify"]));
    expect(s.selectedCount).toBe(1);
    expect(s.ctaLabel).toBe("Apply 1 change");
    expect(s.selectedIds).toEqual(["op-modify"]);
    expect(s.ctaEnabled).toBe(true);
  });

  it("none selected -> CTA disabled (reject only)", () => {
    const s = selectionSummary(ids, new Set());
    expect(s.selectedCount).toBe(0);
    expect(s.ctaEnabled).toBe(false);
    expect(s.ctaLabel).toBe("Select a change to apply");
  });
});

// --- Required view states ----------------------------------------------------

describe("viewKindForStatus (state routing)", () => {
  it("proposed is actionable; no_changes is its own state; rest are terminal", () => {
    expect(viewKindForStatus("proposed")).toBe("proposed");
    expect(viewKindForStatus("no_changes")).toBe("no_changes");
    const terminal: WeeklyReviewStatus[] = [
      "accepted",
      "partially_accepted",
      "rejected",
      "superseded",
      "expired",
    ];
    for (const s of terminal) expect(viewKindForStatus(s)).toBe("terminal");
  });
});

describe("stale-skip outcomes", () => {
  it("marks non-applied ops as skipped with copy; applied ops clean", () => {
    const results: EditOpResult[] = [
      { op_id: "op-move", outcome: "applied" },
      { op_id: "op-modify", outcome: "skipped_stale" },
    ];
    const outcomes = appliedOutcomes(results);
    expect(outcomes[0].skipped).toBe(false);
    expect(outcomes[1].skipped).toBe(true);
    expect(outcomes[1].message).toBe("Workout changed — this change was skipped");
  });

  it("a superseded apply tells the athlete a fresh review is coming", () => {
    expect(wasSuperseded("superseded")).toBe(true);
    expect(wasSuperseded("accepted")).toBe(false);
  });

  it("maps every outcome to athlete-facing copy (or null for applied)", () => {
    expect(outcomeMessage("applied")).toBeNull();
    expect(outcomeMessage("refused_completed")).toMatch(/completed/i);
    expect(outcomeMessage("dropped_coach_protected")).toMatch(/coach/i);
  });
});

// --- Banner (review-ready surface) -------------------------------------------

describe("bannerFor", () => {
  it("surfaces the most recent pending proposal with trigger label + count", () => {
    const b = bannerFor([review()]);
    expect(b).not.toBeNull();
    expect(b!.headline).toBe("Your plan was reviewed — 2 changes proposed");
    expect(b!.triggerLabel).toBe("Based on missed workouts");
  });

  it("returns null when nothing is pending (no_changes / terminal only)", () => {
    expect(bannerFor([review({ status: "no_changes", proposed_changes: [] })])).toBeNull();
    expect(bannerFor([review({ status: "accepted" })])).toBeNull();
    expect(bannerFor([])).toBeNull();
  });
});

// --- API client (accept / reject / lapsed) -----------------------------------

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("defaultProposalApi", () => {
  it("accept POSTs the selected op_ids and returns the apply result", async () => {
    const fetchSpy = mockFetch(200, {
      status: "accepted",
      superseded: false,
      results: [{ op_id: "op-modify", outcome: "applied" }],
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await defaultProposalApi.accept("rev-1", ["op-modify"]);
    expect("lapsed" in res).toBe(false);
    if (!("lapsed" in res)) expect(res.status).toBe("accepted");

    const call = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/weekly-review/rev-1/accept");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({ op_ids: ["op-modify"] });
  });

  it("accept surfaces 402 (lapsed entitlement) as { lapsed: true }", async () => {
    vi.stubGlobal("fetch", mockFetch(402, { error: "payment_required" }));
    const res = await defaultProposalApi.accept("rev-1", ["op-move"]);
    expect(res).toEqual({ lapsed: true });
  });

  it("reject POSTs with no body and returns the new status", async () => {
    const fetchSpy = mockFetch(200, { status: "rejected", changed: true });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await defaultProposalApi.reject("rev-1");
    expect(res.status).toBe("rejected");
    const call = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/weekly-review/rev-1/reject");
    expect(call[1].method).toBe("POST");
  });

  it("list returns the proposals array", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { proposals: [review()] }));
    const rows = await defaultProposalApi.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("rev-1");
  });

  it("get throws on a non-OK response (drives the error state)", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { error: "internal" }));
    await expect(defaultProposalApi.get("rev-1")).rejects.toThrow();
  });
});
