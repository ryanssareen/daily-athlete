import { describe, expect, it } from "vitest";

import {
  scanAthleteForMissedBlock,
  selectActivePlanAthletes,
} from "../adaptive-detectors";

// 2026-05-25 12:00Z is a Monday. With graceHours=36 (default), athlete-local
// (UTC) today = 2026-05-25, cutoff = 2026-05-23.
const NOW = new Date("2026-05-25T12:00:00Z");

// A tiny chainable Supabase fake. Each table resolves to its queued result
// either via `.single()` or by being awaited (thenable).
function makeAdmin(results: {
  users?: { data: unknown; error?: unknown };
  athlete_profiles?: { data: unknown; error?: unknown };
  planned_workouts?: { data: unknown; error?: unknown };
  workout_matches?: { data: unknown; error?: unknown };
  plans?: { data: unknown; error?: unknown };
}) {
  return {
    from(table: string) {
      const result = () =>
        results[table as keyof typeof results] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.is = chain;
      builder.gte = chain;
      builder.single = () =>
        results[table as keyof typeof results] ?? { data: null, error: null };
      // For multi-row tables the query is awaited directly (a thenable).
      builder.then = (resolve: (v: unknown) => void) => resolve(result());
      return builder;
    },
  } as never;
}

describe("selectActivePlanAthletes", () => {
  it("dedups athlete ids from active non-deleted plans", async () => {
    const admin = makeAdmin({
      plans: { data: [{ athlete_id: "a1" }, { athlete_id: "a1" }, { athlete_id: "a2" }] },
    });
    expect(await selectActivePlanAthletes(admin)).toEqual(["a1", "a2"]);
  });

  it("returns empty when there are no active plans", async () => {
    expect(await selectActivePlanAthletes(makeAdmin({ plans: { data: [] } }))).toEqual([]);
  });
});

describe("scanAthleteForMissedBlock", () => {
  it("returns a hit with a stable dedup key for a missed block", async () => {
    const admin = makeAdmin({
      users: { data: { timezone: "UTC" } },
      athlete_profiles: { data: { backfill_status: { state: "complete" } } },
      planned_workouts: {
        data: [
          { id: "w1", scheduled_date: "2026-05-18", status: "planned" },
          { id: "w2", scheduled_date: "2026-05-19", status: "planned" },
          { id: "w3", scheduled_date: "2026-05-20", status: "planned" },
        ],
      },
      workout_matches: { data: [] },
    });
    const hit = await scanAthleteForMissedBlock(admin, "a1", NOW);
    expect(hit).not.toBeNull();
    expect(hit?.athlete_id).toBe("a1");
    expect(hit?.first_missed_date).toBe("2026-05-18");
    expect(hit?.missed_count).toBe(3);
    expect(hit?.bucket).toBe("<=3d");
    expect(hit?.dedup_key).toBe("missed-2026-05-18");
  });

  it("suppresses when the Strava integration needs reauth", async () => {
    const admin = makeAdmin({
      users: { data: { timezone: "UTC" } },
      athlete_profiles: { data: { backfill_status: { state: "needs_reauth" } } },
      planned_workouts: {
        data: [{ id: "w1", scheduled_date: "2026-05-18", status: "planned" }],
      },
      workout_matches: { data: [] },
    });
    expect(await scanAthleteForMissedBlock(admin, "a1", NOW)).toBeNull();
  });

  it("returns null when there are no recent planned workouts", async () => {
    const admin = makeAdmin({
      users: { data: { timezone: "UTC" } },
      athlete_profiles: { data: { backfill_status: { state: "complete" } } },
      planned_workouts: { data: [] },
    });
    expect(await scanAthleteForMissedBlock(admin, "a1", NOW)).toBeNull();
  });

  it("returns null when all workouts are matched (clean week)", async () => {
    const admin = makeAdmin({
      users: { data: { timezone: "UTC" } },
      athlete_profiles: { data: { backfill_status: { state: "complete" } } },
      planned_workouts: {
        data: [
          { id: "w1", scheduled_date: "2026-05-18", status: "planned" },
          { id: "w2", scheduled_date: "2026-05-19", status: "planned" },
        ],
      },
      workout_matches: { data: [{ planned_workout_id: "w1" }, { planned_workout_id: "w2" }] },
    });
    expect(await scanAthleteForMissedBlock(admin, "a1", NOW)).toBeNull();
  });
});
