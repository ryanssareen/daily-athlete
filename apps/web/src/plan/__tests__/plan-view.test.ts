import { describe, expect, it } from "vitest";

import { PlanViewSchema, type PlanRow } from "@da2/shared";

import { buildPlanView, PlanViewNotFoundError } from "../plan-view";

import { fakeAdmin } from "./fake-admin";

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";
const PLAN_ID = "00000000-0000-0000-0000-0000000000c3";
const NOW = new Date("2026-10-16T12:00:00Z");

const plan: PlanRow = {
  id: PLAN_ID,
  athlete_id: ATHLETE,
  status: "active",
  event_type: "Half marathon",
  event_date: "2026-11-09",
  source: "ai_generated",
  created_from_review_id: null,
  created_at: "2026-10-01T00:00:00Z",
  archived_at: null,
  deleted_at: null,
} as PlanRow;

function planned(
  id: string,
  scheduled_date: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    scheduled_date,
    sport: "run",
    status,
    structure: { duration_s: 2700 },
    rationale: null,
    planned_load: 40,
    ...overrides,
  };
}

const PLANNED_ROWS = [
  planned("p1", "2026-10-13", "completed", { rationale: "Easy aerobic" }),
  planned("p2", "2026-10-14", "skipped"),
  planned("p3", "2026-10-16", "planned"),
  planned("p4", "2026-10-20", "moved"),
];

describe("buildPlanView", () => {
  it("returns a schema-valid view with verdicts on matched completed sessions only", async () => {
    const { client } = fakeAdmin({
      planned_workouts: { data: PLANNED_ROWS },
      workout_matches: {
        data: [
          {
            id: "m1",
            planned_workout_id: "p1",
            completed_workout_id: "c1",
            confidence: 1,
            matched_at: "2026-10-13T08:00:00Z",
          },
        ],
      },
      completed_workouts: {
        data: [
          {
            id: "c1",
            started_at: "2026-10-13T07:00:00Z",
            duration_s: 2700,
            distance_m: 8000,
            sport: "run",
            summary_stats: {},
          },
        ],
      },
    });

    const view = await buildPlanView(client, ATHLETE, plan, "UTC", NOW);

    expect(() => PlanViewSchema.parse(view)).not.toThrow();
    const sessions = view.weeks.flatMap((w) => w.sessions);
    expect(sessions.find((s) => s.id === "p1")?.verdict).not.toBeNull();
    expect(sessions.find((s) => s.id === "p3")?.verdict).toBeNull();
    expect(view.weeks.find((w) => w.start === "2026-10-12")?.skippedCount).toBe(1);
    expect(view.weeks.find((w) => w.start === "2026-10-19")?.sessions.map((s) => s.id)).toEqual(["p4"]);
    expect(view.sectionErrors).toEqual([]);
  });

  it("throws before any query when the plan belongs to another athlete", async () => {
    const { client, queries } = fakeAdmin({});
    await expect(buildPlanView(client, OTHER, plan, "UTC", NOW)).rejects.toBeInstanceOf(
      PlanViewNotFoundError,
    );
    expect(queries).toHaveLength(0);
  });

  it("returns an empty-state view for a plan with no workouts", async () => {
    const { client } = fakeAdmin({ planned_workouts: { data: [] } });
    const view = await buildPlanView(client, ATHLETE, plan, "UTC", NOW);
    expect(view.weeks).toEqual([]);
    expect(view.story.paragraphs.length).toBeGreaterThan(0);
    expect(view.forecast.status).toBe("unavailable-complete");
  });

  it("degrades verdicts to a section error when the matches read fails", async () => {
    const { client } = fakeAdmin({
      planned_workouts: { data: PLANNED_ROWS },
      workout_matches: { error: { message: "boom" } },
    });
    const view = await buildPlanView(client, ATHLETE, plan, "UTC", NOW);
    expect(view.sectionErrors).toContain("verdicts");
    expect(view.story.paragraphs.length).toBeGreaterThan(0);
    expect(view.weeks.length).toBeGreaterThan(0);
  });

  it("degrades the forecast to a section error when the history read fails", async () => {
    const { client } = fakeAdmin({
      planned_workouts: { data: PLANNED_ROWS },
      completed_workouts: { error: { message: "boom" } },
    });
    const view = await buildPlanView(client, ATHLETE, plan, "UTC", NOW);
    expect(view.sectionErrors).toContain("forecast");
    expect(view.forecast.status).toBe("unavailable-no-data");
  });

  it("filters every athlete-data query by athlete and excludes soft-deleted rows", async () => {
    const { client, queries } = fakeAdmin({
      planned_workouts: { data: PLANNED_ROWS },
      workout_matches: {
        data: [
          {
            id: "m1",
            planned_workout_id: "p1",
            completed_workout_id: "c1",
            confidence: 1,
            matched_at: "2026-10-13T08:00:00Z",
          },
        ],
      },
      completed_workouts: { data: [] },
    });
    await buildPlanView(client, ATHLETE, plan, "UTC", NOW);

    for (const q of queries) {
      if (q.table === "planned_workouts" || q.table === "completed_workouts") {
        expect(q.filters).toContainEqual({ op: "eq", column: "athlete_id", value: ATHLETE });
      }
      expect(q.filters).toContainEqual({ op: "is", column: "deleted_at", value: null });
    }
    expect(queries.some((q) => q.table === "workout_matches")).toBe(true);
  });

  it("chunks large id lists for the matches read", async () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      planned(`p${i}`, "2026-10-13", "completed"),
    );
    const { client, queries } = fakeAdmin({ planned_workouts: { data: rows } });
    await buildPlanView(client, ATHLETE, plan, "UTC", NOW);
    const matchQueries = queries.filter((q) => q.table === "workout_matches");
    expect(matchQueries).toHaveLength(3);
  });
});
