import { describe, expect, it, vi } from "vitest";

import { selectDueAthletes } from "../weekly-review-scheduler";
import { resolveRunContext } from "../adaptive-run";

// A tiny chainable Supabase fake: each table gets a queued result.
function makeAdmin(results: {
  plans?: { data: unknown; error?: unknown };
  users?: { data: unknown; error?: unknown };
  coach_athlete_links?: { data: unknown; error?: unknown };
  userSingle?: { data: unknown; error?: unknown };
}) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = vi.fn(chain);
      builder.eq = vi.fn(chain);
      builder.in = vi.fn(chain);
      builder.is = vi.fn(chain);
      builder.limit = vi.fn(() => results[table as keyof typeof results] ?? { data: [], error: null });
      builder.single = vi.fn(() => results.userSingle ?? { data: null, error: null });
      // For plans/users the query is awaited directly (a thenable).
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(results[table as keyof typeof results] ?? { data: [], error: null });
      return builder;
    },
  } as never;
}

describe("selectDueAthletes", () => {
  // 2026-05-31 22:00Z = Sunday 18:00 America/New_York.
  const now = new Date("2026-05-31T22:00:00Z");

  it("returns athletes whose local time is Sunday 18:00", async () => {
    const admin = makeAdmin({
      plans: { data: [{ athlete_id: "a1" }, { athlete_id: "a1" }, { athlete_id: "a2" }] },
      users: {
        data: [
          { id: "a1", timezone: "America/New_York" }, // due
          { id: "a2", timezone: "Europe/London" }, // 23:00 local -> not due
        ],
      },
    });
    const due = await selectDueAthletes(admin, now);
    expect(due.map((d) => d.athlete_id)).toEqual(["a1"]);
    expect(due[0]?.week_key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("returns empty when no athletes have active plans", async () => {
    const admin = makeAdmin({ plans: { data: [] } });
    expect(await selectDueAthletes(admin, now)).toEqual([]);
  });

  it("defaults a null timezone to UTC", async () => {
    const utcNow = new Date("2026-05-31T18:00:00Z"); // Sunday 18:00 UTC
    const admin = makeAdmin({
      plans: { data: [{ athlete_id: "a3" }] },
      users: { data: [{ id: "a3", timezone: null }] },
    });
    const due = await selectDueAthletes(admin, utcNow);
    expect(due.map((d) => d.athlete_id)).toEqual(["a3"]);
  });
});

describe("resolveRunContext", () => {
  const now = new Date("2026-05-31T22:00:00Z");

  it("resolves coach recipient when an active link exists", async () => {
    const admin = makeAdmin({
      userSingle: { data: { timezone: "America/New_York" } },
      coach_athlete_links: { data: [{ id: "link-1" }] },
    });
    const ctx = await resolveRunContext(admin, "a1", now);
    expect(ctx.recipient).toBe("coach");
    expect(ctx.asOf).toBe("2026-05-31");
    expect(ctx.timezone).toBe("America/New_York");
  });

  it("resolves athlete recipient when no coach link exists", async () => {
    const admin = makeAdmin({
      userSingle: { data: { timezone: "UTC" } },
      coach_athlete_links: { data: [] },
    });
    const ctx = await resolveRunContext(admin, "a2", now);
    expect(ctx.recipient).toBe("athlete");
  });
});
