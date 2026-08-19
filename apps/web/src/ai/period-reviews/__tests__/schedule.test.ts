// Tests for the digest scheduling predicates (U10).
//
// AE5 lives here: an hourly UTC cron must select each athlete on exactly ONE
// tick, in their own local time. Getting this wrong is either a silent
// non-delivery or the same email twice, and neither shows up in a unit test of
// anything else.

import { describe, expect, it } from "vitest";

import { DIGEST_LOCAL_HOUR, digestPeriodKey, isDigestDue } from "../schedule";

const LONDON = "Europe/London";
const LA = "America/Los_Angeles";
const SYDNEY = "Australia/Sydney";

/** Every hourly tick across a UTC day, as the cron would fire them. */
function ticksAcross(dayIso: string): Date[] {
  return Array.from({ length: 24 }, (_, h) => new Date(`${dayIso}T${String(h).padStart(2, "0")}:00:00Z`));
}

describe("weekly digest timing", () => {
  // AE5: exactly one tick, and it is the one matching 07:00 local Monday.
  it("selects a Los Angeles athlete on exactly one tick of the day", () => {
    const hits = ticksAcross("2026-08-17").filter((t) => isDigestDue("weekly", LA, t));
    expect(hits).toHaveLength(1);
    // 07:00 PDT = 14:00Z
    expect(hits[0].toISOString()).toBe("2026-08-17T14:00:00.000Z");
  });

  it("selects a London athlete on a different tick for the same week", () => {
    const hits = ticksAcross("2026-08-17").filter((t) => isDigestDue("weekly", LONDON, t));
    expect(hits).toHaveLength(1);
    // 07:00 BST = 06:00Z
    expect(hits[0].toISOString()).toBe("2026-08-17T06:00:00.000Z");
  });

  it("selects a Sydney athlete on the preceding UTC day", () => {
    const hits = ticksAcross("2026-08-16").filter((t) => isDigestDue("weekly", SYDNEY, t));
    // 07:00 Monday AEST = 21:00Z Sunday
    expect(hits).toHaveLength(1);
    expect(hits[0].toISOString()).toBe("2026-08-16T21:00:00.000Z");
  });

  it("selects nobody on a Tuesday", () => {
    const hits = ticksAcross("2026-08-18").filter((t) => isDigestDue("weekly", LONDON, t));
    expect(hits).toHaveLength(0);
  });

  it("selects exactly once across a whole week of ticks", () => {
    const week = Array.from({ length: 7 }, (_, d) =>
      ticksAcross(`2026-08-${String(17 + d).padStart(2, "0")}`),
    ).flat();
    expect(week.filter((t) => isDigestDue("weekly", LONDON, t))).toHaveLength(1);
  });

  // A DST transition must not skip or duplicate an athlete.
  it("selects exactly once in the week containing the UK spring transition", () => {
    // Clocks go forward Sunday 2026-03-29; the following Monday is 2026-03-30.
    const days = ["2026-03-29", "2026-03-30", "2026-03-31"].flatMap(ticksAcross);
    expect(days.filter((t) => isDigestDue("weekly", LONDON, t))).toHaveLength(1);
  });

  it("selects exactly once in the week containing the UK autumn transition", () => {
    // Clocks go back Sunday 2026-10-25; the following Monday is 2026-10-26.
    const days = ["2026-10-25", "2026-10-26", "2026-10-27"].flatMap(ticksAcross);
    expect(days.filter((t) => isDigestDue("weekly", LONDON, t))).toHaveLength(1);
  });
});

describe("monthly digest timing", () => {
  it("selects on the 1st, local", () => {
    const hits = ticksAcross("2026-09-01").filter((t) => isDigestDue("monthly", LONDON, t));
    expect(hits).toHaveLength(1);
  });

  it("selects nobody on the 2nd", () => {
    expect(ticksAcross("2026-09-02").filter((t) => isDigestDue("monthly", LONDON, t))).toHaveLength(
      0,
    );
  });

  it("fires after a 28-day February", () => {
    expect(ticksAcross("2026-03-01").filter((t) => isDigestDue("monthly", LONDON, t))).toHaveLength(
      1,
    );
  });

  it("fires after a 31-day month", () => {
    expect(ticksAcross("2026-09-01").filter((t) => isDigestDue("monthly", LONDON, t))).toHaveLength(
      1,
    );
  });

  it("fires across the year boundary", () => {
    expect(ticksAcross("2027-01-01").filter((t) => isDigestDue("monthly", LONDON, t))).toHaveLength(
      1,
    );
  });
});

describe("cadence independence", () => {
  // The 1st of a month that is also a Monday must fire both, not one.
  it("fires both cadences when the 1st falls on a Monday", () => {
    // 2026-06-01 is a Monday.
    const ticks = ticksAcross("2026-06-01");
    expect(ticks.filter((t) => isDigestDue("weekly", LONDON, t))).toHaveLength(1);
    expect(ticks.filter((t) => isDigestDue("monthly", LONDON, t))).toHaveLength(1);
  });

  it("does not fire the monthly digest on an ordinary Monday", () => {
    expect(ticksAcross("2026-08-17").filter((t) => isDigestDue("monthly", LONDON, t))).toHaveLength(
      0,
    );
  });
});

describe("digestPeriodKey", () => {
  // The digest is about the period that CLOSED. On the Monday it fires, the
  // calendar already reports the new week — mailing that would send everyone a
  // review of a week one hour old and empty.
  it("names the week that just closed, not the one now running", () => {
    const monday = new Date("2026-08-17T06:00:00Z"); // 07:00 BST Monday
    expect(digestPeriodKey("weekly", LONDON, monday)).toBe("2026-W33");
  });

  it("names the month that just closed", () => {
    const first = new Date("2026-09-01T06:00:00Z");
    expect(digestPeriodKey("monthly", LONDON, first)).toBe("2026-08");
  });

  it("crosses the year boundary correctly", () => {
    const first = new Date("2027-01-01T07:00:00Z");
    expect(digestPeriodKey("monthly", "UTC", first)).toBe("2026-12");
  });

  it("resolves per athlete timezone", () => {
    // The same instant is Monday in Sydney and Sunday in London, so the two
    // athletes are looking back at different weeks.
    const instant = new Date("2026-08-16T21:00:00Z");
    expect(digestPeriodKey("weekly", SYDNEY, instant)).toBe("2026-W33");
    expect(digestPeriodKey("weekly", LONDON, instant)).toBe("2026-W32");
  });
});

describe("digest hour", () => {
  // Deliberately different from WEEKLY_REVIEW_LOCAL_HOUR (18) so a digest and
  // an adaptive proposal never land in the same hour and read as one duplicate.
  it("does not collide with the adaptive weekly review hour", async () => {
    const { WEEKLY_REVIEW_LOCAL_HOUR } = await import("@/ai/adaptive/schedule");
    expect(DIGEST_LOCAL_HOUR).not.toBe(WEEKLY_REVIEW_LOCAL_HOUR);
  });
});
