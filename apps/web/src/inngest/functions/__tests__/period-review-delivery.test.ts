// Tests for the period-review delivery worker and scheduler selection (U10).
//
// Two guarantees carry this unit and both are tested against a fake that models
// the DATABASE honestly rather than assuming the worker did the right thing:
//
//   R13/AE6 -- one email per (athlete, kind, period), ever. The fake enforces
//     the unique index, so a second claim genuinely fails.
//   R15/AE10 -- a failed narration sends NOTHING. A digest without its
//     narration is a table of numbers with no coaching in it.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-stub";
});

import { LlmInvalidOutput, LlmRateLimited } from "@/llm";

const ATHLETE = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000a2";

const mocks = vi.hoisted(() => ({
  entitled: true,
  timezone: "Europe/London",
  facts: null as Record<string, unknown> | null,
  assembleThrows: null as Error | null,
  narrateThrows: null as Error | null,
  narration: { note: "Solid week.", takeaway: "Keep it easy." },
  sendResult: { sent: true } as { sent: boolean; reason?: string },
  sends: [] as Array<Record<string, unknown>>,
  /** The delivery ledger, modelling the unique index on the identity triple. */
  ledger: new Map<string, { status: string; failure_reason: string | null }>(),
  reviews: [] as Array<Record<string, unknown>>,
  email: "athlete@example.com" as string | null,
  deletedAt: null as string | null,
  optedInWeekly: true,
  optedInMonthly: true,
  persistError: null as { code?: string; message: string } | null,
  finishError: null as { message: string } | null,
  /** Candidate rows for the scheduler-selection tests. */
  users: [] as Array<Record<string, unknown>>,
}));

function factsFor(sessions = 5, prescribed = 6) {
  return {
    kind: "weekly",
    periodKey: "2026-W33",
    bounds: { start: "2026-08-10", end: "2026-08-16" },
    totals: {
      sessions,
      durationS: 22800,
      distanceM: 61000,
      load: 340,
      activeDays: 4,
      loadConfidence: "power",
    },
    compliance: { prescribed, completed: sessions, unplanned: 0 },
    duration: { status: "under", prescribed: 25200, actual: 22800, deltaPct: -9.5 },
    load: { status: "under", prescribed: 380, actual: 340, deltaPct: -10.5 },
    sports: [],
    comparison: { available: false },
  };
}

function ledgerKey(row: Record<string, unknown>) {
  return `${row.athlete_id}:${row.kind}:${row.period_key}`;
}

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "period_review_deliveries") {
        return {
          insert(row: Record<string, unknown>) {
            const key = ledgerKey(row);
            // The unique index, modelled. This is what gives the
            // double-delivery tests teeth.
            if (mocks.ledger.has(key)) {
              return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
            }
            mocks.ledger.set(key, { status: "claimed", failure_reason: null });
            return Promise.resolve({ error: null });
          },
          update(patch: Record<string, unknown>) {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                if (Object.keys(filters).length === 3) {
                  const key = `${filters.athlete_id}:${filters.kind}:${filters.period_key}`;
                  const existing = mocks.ledger.get(key);
                  if (existing) {
                    existing.status = patch.status as string;
                    existing.failure_reason = (patch.failure_reason as string | null) ?? null;
                  }
                }
                return builder;
              },
              then(onF: (v: unknown) => unknown) {
                return Promise.resolve({ error: mocks.finishError }).then(onF);
              },
            };
            return builder;
          },
        };
      }
      if (table === "period_reviews") {
        return {
          // The write path is INSERT-with-23505-fallback, never .upsert().
          // `upsert` is deliberately left UNIMPLEMENTED here: the identity
          // index is partial, so a real .upsert({onConflict}) raises 42P10 at
          // runtime, and a fake that quietly accepted it is exactly what let
          // that P0 reach review. Calling it now blows up loudly.
          upsert() {
            throw new Error(
              "period_reviews.upsert() is invalid: the identity index is PARTIAL " +
                "and Postgres raises 42P10. Use persistPeriodReview (INSERT/23505/UPDATE).",
            );
          },
          insert(row: Record<string, unknown>) {
            if (mocks.persistError) return Promise.resolve({ error: mocks.persistError });
            mocks.reviews.push(row);
            return Promise.resolve({ error: null });
          },
          update(patch: Record<string, unknown>) {
            const builder = {
              eq() {
                return builder;
              },
              is() {
                return builder;
              },
              select() {
                return builder;
              },
              maybeSingle() {
                mocks.reviews.push(patch);
                return Promise.resolve({ data: { id: "r-1" }, error: null });
              },
            };
            return builder;
          },
        };
      }
      if (table === "users") {
        return {
          select() {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return builder;
              },
              is() {
                return builder;
              },
              or() {
                return builder;
              },
              maybeSingle() {
                return Promise.resolve({
                  data:
                    filters.id === ATHLETE
                      ? {
                          timezone: mocks.timezone,
                          email: mocks.email,
                          deleted_at: mocks.deletedAt,
                          email_weekly_review: mocks.optedInWeekly,
                          email_monthly_review: mocks.optedInMonthly,
                        }
                      : null,
                  error: null,
                });
              },
              then(onF: (v: unknown) => unknown) {
                return Promise.resolve({ data: mocks.users, error: null }).then(onF);
              },
            };
            return builder;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

vi.mock("@/auth/entitlements", () => ({
  hasActiveEntitlement: vi.fn(async () => mocks.entitled),
}));

vi.mock("@/ai/period-reviews/assemble", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/period-reviews/assemble")>();
  return {
    ...actual,
    readAthleteTimezone: vi.fn(async () => mocks.timezone),
    assemblePeriodReview: vi.fn(async () => {
      if (mocks.assembleThrows) throw mocks.assembleThrows;
      return {
        context: {},
        facts: mocks.facts ?? factsFor(),
        fingerprint: "fp-1",
        // The fact sheet carries the same identity as the facts it was built
        // from, so spreading is enough here.
        factSheet: { ...(mocks.facts ?? factsFor()) },
      };
    }),
  };
});

vi.mock("@/ai/period-reviews/narrate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/period-reviews/narrate")>();
  return {
    ...actual,
    narratePeriod: vi.fn(async () => {
      if (mocks.narrateThrows) throw mocks.narrateThrows;
      return mocks.narration;
    }),
  };
});

vi.mock("@/email/period-review-email", () => ({
  sendPeriodDigest: vi.fn(async (args: Record<string, unknown>) => {
    mocks.sends.push(args);
    return mocks.sendResult;
  }),
}));

vi.mock("@/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/llm")>();
  return { ...actual, createLlmClient: vi.fn(() => ({ generateStructured: vi.fn() })) };
});

// The worker CORE is exported for exactly this reason -- the same shape
// runGeneratePlan uses. No Inngest runtime needed.
async function runDelivery(over: Record<string, unknown> = {}) {
  const { runPeriodReviewDelivery } = await import("../period-review-delivery");
  const { createAdminClient } = await import("@/db/admin");
  return runPeriodReviewDelivery({
    admin: createAdminClient() as never,
    event: { data: { athlete_id: ATHLETE, kind: "weekly", period_key: "2026-W33", ...over } },
  });
}

beforeEach(() => {
  mocks.entitled = true;
  mocks.timezone = "Europe/London";
  mocks.facts = null;
  mocks.assembleThrows = null;
  mocks.narrateThrows = null;
  mocks.sendResult = { sent: true };
  mocks.sends = [];
  mocks.ledger = new Map();
  mocks.reviews = [];
  mocks.email = "athlete@example.com";
  mocks.deletedAt = null;
  mocks.optedInWeekly = true;
  mocks.optedInMonthly = true;
  mocks.persistError = null;
  mocks.finishError = null;
  mocks.users = [];
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("delivery", () => {
  it("claims, persists, sends, and marks the delivery sent", async () => {
    const result = await runDelivery();
    expect(result.outcome).toBe("sent");
    expect(mocks.sends).toHaveLength(1);
    expect(mocks.reviews).toHaveLength(1);
    expect(mocks.ledger.get(`${ATHLETE}:weekly:2026-W33`)?.status).toBe("sent");
  });

  it("persists the review before sending, so the email's link lands on it", async () => {
    await runDelivery();
    expect(mocks.reviews[0]).toMatchObject({
      athlete_id: ATHLETE,
      kind: "weekly",
      period_key: "2026-W33",
      narrative: mocks.narration.note,
      input_fingerprint: "fp-1",
    });
  });
});

// ---------------------------------------------------------------------------
// Consent re-check at send time
// ---------------------------------------------------------------------------

describe("consent", () => {
  // The window between the scheduler tick and this run is small but real, and
  // an Inngest backlog or a replayed manual trigger widens it arbitrarily.
  // Mailing someone who just unsubscribed is the exact failure the opt-in
  // posture exists to prevent.
  it("does not mail an athlete who unsubscribed after the tick", async () => {
    mocks.optedInWeekly = false;
    const result = await runDelivery();
    expect(result.outcome).toBe("opted_out");
    expect(mocks.sends).toEqual([]);
  });

  it("does not mail a soft-deleted account", async () => {
    mocks.deletedAt = "2026-08-18T00:00:00.000Z";
    const result = await runDelivery();
    expect(result.outcome).toBe("opted_out");
    expect(mocks.sends).toEqual([]);
  });

  it("checks the cadence being delivered, not the other one", async () => {
    mocks.optedInWeekly = true;
    mocks.optedInMonthly = false;
    const monthly = await runDelivery({ kind: "monthly", period_key: "2026-08" });
    expect(monthly.outcome).toBe("opted_out");

    const weekly = await runDelivery();
    expect(weekly.outcome).toBe("sent");
  });

  it("does not even claim when consent is withdrawn", async () => {
    mocks.optedInWeekly = false;
    await runDelivery();
    expect(mocks.ledger.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R13 / AE6 — never twice
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("sends exactly one email when the worker runs twice for the same period", async () => {
    await runDelivery();
    const second = await runDelivery();
    expect(second.outcome).toBe("already_claimed");
    expect(mocks.sends).toHaveLength(1);
  });

  // A terminal 'failed' claim must still block a re-send: the index is not
  // partial on status.
  it("does not re-send a period whose earlier delivery failed", async () => {
    mocks.narrateThrows = new LlmRateLimited("429");
    await runDelivery();
    expect(mocks.sends).toEqual([]);

    mocks.narrateThrows = null;
    const second = await runDelivery();
    expect(second.outcome).toBe("already_claimed");
    expect(mocks.sends).toEqual([]);
  });

  it("claims before doing any work, so a losing racer never narrates", async () => {
    await runDelivery();
    mocks.sends = [];
    mocks.reviews = [];
    await runDelivery();
    expect(mocks.reviews).toEqual([]);
  });

  it("treats a different period as a separate delivery", async () => {
    await runDelivery();
    const other = await runDelivery({ period_key: "2026-W32" });
    expect(other.outcome).toBe("sent");
    expect(mocks.sends).toHaveLength(2);
  });

  it("treats a different cadence as a separate delivery", async () => {
    await runDelivery();
    const monthly = await runDelivery({ kind: "monthly", period_key: "2026-08" });
    expect(monthly.outcome).toBe("sent");
  });

  it("treats a different athlete as a separate delivery", async () => {
    await runDelivery();
    mocks.email = "other@example.com";
    const other = await runDelivery({ athlete_id: OTHER });
    expect(other.outcome).not.toBe("already_claimed");
  });
});

// ---------------------------------------------------------------------------
// R15 / AE10 — a failed narration sends nothing
// ---------------------------------------------------------------------------

describe("narration failure", () => {
  it("sends no email when the model is rate-limited", async () => {
    mocks.narrateThrows = new LlmRateLimited("429");
    const result = await runDelivery();
    expect(result.outcome).toBe("llm_rate_limited");
    expect(mocks.sends).toEqual([]);
  });

  it("persists no partial review when narration fails", async () => {
    mocks.narrateThrows = new LlmRateLimited("429");
    await runDelivery();
    expect(mocks.reviews).toEqual([]);
  });

  it("records a non-PII failure reason on the ledger", async () => {
    mocks.narrateThrows = new LlmRateLimited("429");
    await runDelivery();
    const entry = mocks.ledger.get(`${ATHLETE}:weekly:2026-W33`);
    expect(entry?.status).toBe("failed");
    expect(entry?.failure_reason).toBe("llm_rate_limited");
  });

  it("distinguishes unusable model output from a rate limit", async () => {
    mocks.narrateThrows = new LlmInvalidOutput("no json");
    const result = await runDelivery();
    expect(result.outcome).toBe("llm_invalid_output");
    expect(mocks.sends).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Other outcomes
// ---------------------------------------------------------------------------

describe("gating and edge cases", () => {
  // AE7 — enforced HERE, not in the scheduler, so a lapsed subscription
  // between tick and run is caught.
  it("sends nothing for an unentitled athlete and does not even claim", async () => {
    mocks.entitled = false;
    const result = await runDelivery();
    expect(result.outcome).toBe("not_entitled");
    expect(mocks.sends).toEqual([]);
    expect(mocks.ledger.size).toBe(0);
  });

  // AS2 — an email reporting zero against zero is noise.
  it("skips a period with nothing completed and nothing prescribed", async () => {
    mocks.facts = factsFor(0, 0);
    const result = await runDelivery();
    expect(result.outcome).toBe("no_data");
    expect(mocks.sends).toEqual([]);
  });

  // But a missed block IS worth reporting.
  it("still sends when nothing was completed but sessions were prescribed", async () => {
    mocks.facts = factsFor(0, 4);
    const result = await runDelivery();
    expect(result.outcome).toBe("sent");
    expect(mocks.sends).toHaveLength(1);
  });

  // The ledger is athlete-readable; recording a send that never happened would
  // make any future "we emailed you" surface assert a falsehood.
  it("records a skipped period as 'skipped', never as 'sent'", async () => {
    mocks.facts = factsFor(0, 0);
    await runDelivery();
    expect(mocks.ledger.get(`${ATHLETE}:weekly:2026-W33`)?.status).toBe("skipped");
  });

  it("reports a persist failure rather than sending an email for an unsaved review", async () => {
    mocks.persistError = { message: "insert exploded" };
    await expect(runDelivery()).rejects.toThrow();
    expect(mocks.sends).toEqual([]);
    expect(mocks.ledger.get(`${ATHLETE}:weekly:2026-W33`)?.status).toBe("failed");
  });

  // The email HAS gone out; the ledger just failed to record it. Reporting a
  // clean success would hide a row stuck in 'claimed' after a real delivery.
  it("still reports sent when the ledger update fails after a successful send", async () => {
    mocks.finishError = { message: "ledger write failed" };
    const result = await runDelivery();
    expect(result.outcome).toBe("sent");
    expect(mocks.sends).toHaveLength(1);
  });

  it("marks the delivery failed, not sent, when the provider rejects the send", async () => {
    mocks.sendResult = { sent: false, reason: "http_429" };
    const result = await runDelivery();
    expect(result.outcome).toBe("email_failed");
    expect(mocks.ledger.get(`${ATHLETE}:weekly:2026-W33`)?.status).toBe("failed");
  });

  it("reports an unconfigured mailer distinctly from a rejected send", async () => {
    mocks.sendResult = { sent: false, reason: "not_configured" };
    expect((await runDelivery()).outcome).toBe("email_not_configured");
  });

  it("does not send when the athlete has no email address on file", async () => {
    mocks.email = null;
    const result = await runDelivery();
    expect(result.outcome).toBe("email_failed");
    expect(mocks.sends).toEqual([]);
  });

  it("rejects a payload whose period key does not match its kind", async () => {
    await expect(runDelivery({ period_key: "2026-08" })).rejects.toThrow();
  });

  it("rejects a malformed payload permanently", async () => {
    await expect(runDelivery({ athlete_id: "not-a-uuid" })).rejects.toThrow();
  });

  it("returns an outcome slug only — no PII in the function's return", async () => {
    const result = await runDelivery();
    expect(Object.keys(result)).toEqual(["outcome"]);
  });
});

// ---------------------------------------------------------------------------
// Scheduler selection
// ---------------------------------------------------------------------------

describe("selectDueDigests", () => {
  async function select(now: Date) {
    const { selectDueDigests } = await import("../period-review-scheduler");
    const { createAdminClient } = await import("@/db/admin");
    return selectDueDigests(createAdminClient() as never, now);
  }

  // 07:00 BST Monday 2026-08-17 = 06:00Z
  const MONDAY_TICK = new Date("2026-08-17T06:00:00Z");

  it("selects an opted-in athlete whose local week just closed", async () => {
    mocks.users = [
      { id: ATHLETE, timezone: "Europe/London", email_weekly_review: true, email_monthly_review: false },
    ];
    const due = await select(MONDAY_TICK);
    expect(due).toEqual([{ athlete_id: ATHLETE, kind: "weekly", period_key: "2026-W33" }]);
  });

  it("does not select an athlete who opted into the other cadence only", async () => {
    mocks.users = [
      { id: ATHLETE, timezone: "Europe/London", email_weekly_review: false, email_monthly_review: true },
    ];
    expect(await select(MONDAY_TICK)).toEqual([]);
  });

  it("does not select an athlete whose local time is a different hour", async () => {
    mocks.users = [
      { id: ATHLETE, timezone: "America/Los_Angeles", email_weekly_review: true, email_monthly_review: false },
    ];
    expect(await select(MONDAY_TICK)).toEqual([]);
  });

  it("defaults a null timezone to UTC rather than skipping the athlete", async () => {
    mocks.users = [
      { id: ATHLETE, timezone: null, email_weekly_review: true, email_monthly_review: false },
    ];
    // 07:00 UTC Monday
    const due = await select(new Date("2026-08-17T07:00:00Z"));
    expect(due).toHaveLength(1);
  });

  it("selects both cadences when the 1st falls on a Monday", async () => {
    mocks.users = [
      { id: ATHLETE, timezone: "UTC", email_weekly_review: true, email_monthly_review: true },
    ];
    // 2026-06-01 is a Monday.
    const due = await select(new Date("2026-06-01T07:00:00Z"));
    expect(due.map((d) => d.kind).sort()).toEqual(["monthly", "weekly"]);
  });

  it("returns ids and keys only — no addresses in the job payload", async () => {
    mocks.users = [
      {
        id: ATHLETE,
        timezone: "Europe/London",
        email: "athlete@example.com",
        email_weekly_review: true,
        email_monthly_review: false,
      },
    ];
    const due = await select(MONDAY_TICK);
    expect(Object.keys(due[0]).sort()).toEqual(["athlete_id", "kind", "period_key"]);
  });

  it("returns nothing when no one is due", async () => {
    mocks.users = [];
    expect(await select(MONDAY_TICK)).toEqual([]);
  });
});
