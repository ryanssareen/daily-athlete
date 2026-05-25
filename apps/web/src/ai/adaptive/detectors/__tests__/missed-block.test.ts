import { describe, expect, it } from "vitest";

import {
  bucketGap,
  detectMissedBlock,
  type DetectorMatch,
  type DetectorPlannedWorkout,
} from "@/ai/adaptive/detectors/missed-block";

// "Now" is fixed so the grace boundary is deterministic. 2026-05-25 is a Monday.
// In UTC, athlete-local today = 2026-05-25, graceHours=36 -> graceDays=2 ->
// cutoff = 2026-05-23 (workouts scheduled on/before the 23rd can be missed).
const NOW = new Date("2026-05-25T12:00:00Z");
const TZ = "UTC";

function pw(
  id: string,
  scheduled_date: string,
  status = "planned",
): DetectorPlannedWorkout {
  return { id, scheduled_date, status };
}
function match(planned_workout_id: string): DetectorMatch {
  return { planned_workout_id };
}

describe("bucketGap", () => {
  it("maps span days to named strategies", () => {
    expect(bucketGap(1)).toBe("<=3d");
    expect(bucketGap(3)).toBe("<=3d");
    expect(bucketGap(4)).toBe("4-7d");
    expect(bucketGap(7)).toBe("4-7d");
    expect(bucketGap(8)).toBe("1-2w");
    expect(bucketGap(14)).toBe("1-2w");
    expect(bucketGap(15)).toBe(">2w");
    expect(bucketGap(30)).toBe(">2w");
  });
});

describe("detectMissedBlock", () => {
  it("flags 5 consecutive planned-and-unmatched days past grace with the right bucket", () => {
    // Mon 18 .. Fri 22 — all planned, none matched, all past the 36h grace.
    const plannedWorkouts = [
      pw("w1", "2026-05-18"),
      pw("w2", "2026-05-19"),
      pw("w3", "2026-05-20"),
      pw("w4", "2026-05-21"),
      pw("w5", "2026-05-22"),
    ];
    const result = detectMissedBlock({
      plannedWorkouts,
      matches: [],
      timezone: TZ,
      now: NOW,
    });
    expect(result.missed).toBe(true);
    expect(result.firstMissedDate).toBe("2026-05-18");
    expect(result.missedCount).toBe(5);
    // span = 18..22 inclusive = 5 days -> "4-7d" (unplanned rest week)
    expect(result.bucket).toBe("4-7d");
  });

  it("buckets a 2-day gap as <=3d (resume as-is)", () => {
    const result = detectMissedBlock({
      plannedWorkouts: [pw("w1", "2026-05-21"), pw("w2", "2026-05-22")],
      matches: [],
      timezone: TZ,
      now: NOW,
    });
    expect(result.missed).toBe(true);
    expect(result.bucket).toBe("<=3d");
    expect(result.missedCount).toBe(2);
  });

  it("buckets a >2 week gap as >2w (back up a block)", () => {
    // 16 consecutive days ending well before the cutoff.
    const days: DetectorPlannedWorkout[] = [];
    for (let i = 0; i < 16; i++) {
      const d = new Date(Date.parse("2026-05-05T00:00:00Z") + i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      days.push(pw(`w${i}`, d));
    }
    const result = detectMissedBlock({
      plannedWorkouts: days,
      matches: [],
      timezone: TZ,
      now: NOW,
    });
    expect(result.missed).toBe(true);
    expect(result.bucket).toBe(">2w");
    expect(result.firstMissedDate).toBe("2026-05-05");
  });

  it("excludes skipped and moved workouts (not missed)", () => {
    const plannedWorkouts = [
      pw("w1", "2026-05-18", "skipped"),
      pw("w2", "2026-05-19", "moved"),
      pw("w3", "2026-05-20", "completed"),
    ];
    const result = detectMissedBlock({
      plannedWorkouts,
      matches: [],
      timezone: TZ,
      now: NOW,
    });
    expect(result.missed).toBe(false);
    expect(result.missedCount).toBe(0);
  });

  it("does NOT flag a workout younger than the 36h grace window", () => {
    // Scheduled today (2026-05-25) and yesterday (2026-05-24): both inside the
    // 36h grace from end-of-local-day, so neither is flagged.
    const result = detectMissedBlock({
      plannedWorkouts: [pw("w1", "2026-05-24"), pw("w2", "2026-05-25")],
      matches: [],
      timezone: TZ,
      now: NOW,
    });
    expect(result.missed).toBe(false);
  });

  it("does not count a matched workout as missed", () => {
    // w1..w3 planned in the past; w2 has a live match -> only w1, w3 are missed,
    // and the match breaks the contiguous run (most-recent run is just w3).
    const plannedWorkouts = [
      pw("w1", "2026-05-18"),
      pw("w2", "2026-05-19"),
      pw("w3", "2026-05-20"),
    ];
    const result = detectMissedBlock({
      plannedWorkouts,
      matches: [match("w2")],
      timezone: TZ,
      now: NOW,
    });
    // w1 and w3 are still missed, but the matched w2 sits between them, so the
    // most-recent contiguous run is only w3 (2026-05-20).
    expect(result.missed).toBe(true);
    expect(result.firstMissedDate).toBe("2026-05-20");
    expect(result.missedCount).toBe(1);
    expect(result.bucket).toBe("<=3d");
  });

  it("returns not-missed when all workouts are matched", () => {
    const plannedWorkouts = [pw("w1", "2026-05-18"), pw("w2", "2026-05-19")];
    const result = detectMissedBlock({
      plannedWorkouts,
      matches: [match("w1"), match("w2")],
      timezone: TZ,
      now: NOW,
    });
    expect(result.missed).toBe(false);
  });

  it("returns not-missed for an empty plan", () => {
    expect(
      detectMissedBlock({ plannedWorkouts: [], matches: [], timezone: TZ, now: NOW })
        .missed,
    ).toBe(false);
  });

  it("respects a custom graceHours", () => {
    // With graceHours=12 (graceDays=1), a workout scheduled yesterday (the 24th)
    // becomes flaggable; cutoff = today - 1 = 2026-05-24.
    const result = detectMissedBlock({
      plannedWorkouts: [pw("w1", "2026-05-24")],
      matches: [],
      timezone: TZ,
      now: NOW,
      graceHours: 12,
    });
    expect(result.missed).toBe(true);
    expect(result.firstMissedDate).toBe("2026-05-24");
  });
});
