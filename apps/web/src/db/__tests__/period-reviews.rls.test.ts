// DB integration tests for public.period_reviews and
// public.period_review_deliveries (migration 0029) and the users email
// preference columns (migration 0030). See:
//   docs/plans/2026-08-19-001-feat-period-reviews-and-email-plan.md (U1)
//
// Covers:
//   - RLS positive + negative for athletes and linked coaches
//   - No client write path on either table (service-role only)
//   - Identity uniqueness on (athlete_id, kind, period_key), and that the
//     PARTIAL predicate lets a fresh review follow a soft-deleted one
//   - The delivery ledger's uniqueness holds in EVERY status (the R13/AE6
//     idempotency guarantee)
//   - period_reviews is deliberately NOT soft-deleted by a completed_workouts
//     soft delete (the 0028 trigger's blast radius stops at workout_reports)
//   - Email preference columns default to FALSE (the KTD7 opt-in posture)
//
// Realtime membership is NOT asserted here: realtime-publication.test.ts
// already guards the whole publication against the shared allow-list, and
// neither new table is added to it.
//
// RLS SELECT denial surfaces as 0 rows (not an error); write denial surfaces
// as an error. Prerequisites: `supabase start` must be running (CI provides it).

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

const WEEK_KEY = "2026-W33";
const MONTH_KEY = "2026-08";

async function createCoachLink(
  coachId: string,
  athleteId: string,
  opts: { status?: string; deleted?: boolean } = {},
) {
  const admin = serviceClient();
  const { error } = await admin.from("coach_athlete_links").insert({
    coach_user_id: coachId,
    athlete_user_id: athleteId,
    status: opts.status ?? "active",
    ...(opts.deleted ? { deleted_at: new Date().toISOString() } : {}),
  });
  if (error) throw new Error(`createCoachLink failed: ${error.message}`);
}

async function insertReview(
  athleteId: string,
  opts?: {
    kind?: string;
    periodKey?: string;
    periodStart?: string;
    periodEnd?: string;
    narrative?: string | null;
    fingerprint?: string;
    deleted?: boolean;
  },
) {
  const admin = serviceClient();
  return admin
    .from("period_reviews")
    .insert({
      athlete_id: athleteId,
      kind: opts?.kind ?? "weekly",
      period_key: opts?.periodKey ?? WEEK_KEY,
      period_start: opts?.periodStart ?? "2026-08-10",
      period_end: opts?.periodEnd ?? "2026-08-16",
      narrative: opts?.narrative ?? "You held the plan together through a heavy week.",
      takeaway: "Keep next week's long ride conversational.",
      input_fingerprint: opts?.fingerprint ?? "period-fingerprint-v1",
      model: "test-model",
      ...(opts?.deleted ? { deleted_at: new Date().toISOString() } : {}),
    })
    .select("id, athlete_id, kind, period_key, narrative, deleted_at")
    .single();
}

async function insertDelivery(
  athleteId: string,
  opts?: { kind?: string; periodKey?: string; status?: string; failureReason?: string },
) {
  const admin = serviceClient();
  return admin
    .from("period_review_deliveries")
    .insert({
      athlete_id: athleteId,
      kind: opts?.kind ?? "weekly",
      period_key: opts?.periodKey ?? WEEK_KEY,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.failureReason ? { failure_reason: opts.failureReason } : {}),
    })
    .select("id, status")
    .single();
}

// ---------------------------------------------------------------------------
// period_reviews — RLS
// ---------------------------------------------------------------------------

describe("period_reviews RLS", () => {
  it("athlete can SELECT their own review", async () => {
    const athlete = await createTestUser();
    await insertReview(athlete.id);

    const { data, error } = await athlete.client
      .from("period_reviews")
      .select("id, narrative, period_key")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.period_key).toBe(WEEK_KEY);
  });

  it("another athlete cannot SELECT a review that is not theirs (negative RLS)", async () => {
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    await insertReview(athlete.id);

    const { data, error } = await stranger.client.from("period_reviews").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("linked active coach can SELECT their athlete's review", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id);
    await insertReview(athlete.id);

    const { data, error } = await coach.client
      .from("period_reviews")
      .select("id, period_key")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("coach with no link to the athlete cannot SELECT their review (negative RLS)", async () => {
    const unlinkedCoach = await createTestUser();
    const athlete = await createTestUser();
    await insertReview(athlete.id);

    const { data, error } = await unlinkedCoach.client.from("period_reviews").select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // The coach policy checks `status = 'active' AND deleted_at IS NULL`. The
  // no-link case above only proves the EXISTS subquery needs a row at all;
  // these two prove it needs a LIVE, ACTIVE one — which is what matters when
  // a coaching relationship ends.
  it("a coach whose link was ARCHIVED cannot SELECT the athlete's review", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id, { status: "archived" });
    await insertReview(athlete.id);

    const { data } = await coach.client.from("period_reviews").select("id");
    expect(data).toHaveLength(0);
  });

  it("a coach whose link was SOFT-DELETED cannot SELECT the athlete's review", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id, { deleted: true });
    await insertReview(athlete.id);

    const { data } = await coach.client.from("period_reviews").select("id");
    expect(data).toHaveLength(0);
  });
});

describe("period_reviews has no client write path", () => {
  it("athlete cannot INSERT their own review", async () => {
    const athlete = await createTestUser();
    const { error } = await athlete.client.from("period_reviews").insert({
      athlete_id: athlete.id,
      kind: "weekly",
      period_key: WEEK_KEY,
      period_start: "2026-08-10",
      period_end: "2026-08-16",
      input_fingerprint: "forged",
    });
    expect(error).not.toBeNull();
  });

  it("athlete cannot UPDATE their own review", async () => {
    const athlete = await createTestUser();
    const { data: seeded } = await insertReview(athlete.id);

    const { data, error } = await athlete.client
      .from("period_reviews")
      .update({ narrative: "rewritten by the client" })
      .eq("id", seeded!.id)
      .select("id");
    // No UPDATE policy: PostgREST reports this as zero affected rows rather
    // than an error, because the row is visible to SELECT but not writable.
    expect(error === null ? data : []).toHaveLength(0);
  });

  it("athlete cannot DELETE their own review", async () => {
    const athlete = await createTestUser();
    const { data: seeded } = await insertReview(athlete.id);

    await athlete.client.from("period_reviews").delete().eq("id", seeded!.id);

    const admin = serviceClient();
    const { data } = await admin.from("period_reviews").select("id").eq("id", seeded!.id);
    expect(data).toHaveLength(1); // still there
  });
});

// ---------------------------------------------------------------------------
// period_reviews — identity uniqueness
// ---------------------------------------------------------------------------

describe("period_reviews identity uniqueness", () => {
  it("rejects a second LIVE review for the same (athlete, kind, period_key)", async () => {
    const athlete = await createTestUser();
    await insertReview(athlete.id);

    const { error } = await insertReview(athlete.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");
  });

  it("allows the same period for a DIFFERENT kind", async () => {
    const athlete = await createTestUser();
    await insertReview(athlete.id, { kind: "weekly", periodKey: WEEK_KEY });

    const { error } = await insertReview(athlete.id, {
      kind: "monthly",
      periodKey: MONTH_KEY,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    expect(error).toBeNull();
  });

  it("allows the same period for a different athlete", async () => {
    const athleteA = await createTestUser();
    const athleteB = await createTestUser();
    await insertReview(athleteA.id);

    const { error } = await insertReview(athleteB.id);
    expect(error).toBeNull();
  });

  // This is the reason the index is PARTIAL rather than plain.
  it("allows a fresh review after the previous one was soft-deleted", async () => {
    const athlete = await createTestUser();
    await insertReview(athlete.id, { deleted: true });

    const { error } = await insertReview(athlete.id);
    expect(error).toBeNull();
  });

  it("rejects a malformed period_key at the CHECK", async () => {
    const athlete = await createTestUser();
    const { error } = await insertReview(athlete.id, { periodKey: "last-week" });
    expect(error).not.toBeNull();
  });

  it("rejects a kind outside the closed vocabulary", async () => {
    const athlete = await createTestUser();
    const { error } = await insertReview(athlete.id, { kind: "quarterly" });
    expect(error).not.toBeNull();
  });

  it("rejects a period whose end precedes its start", async () => {
    const athlete = await createTestUser();
    const { error } = await insertReview(athlete.id, {
      periodStart: "2026-08-16",
      periodEnd: "2026-08-10",
    });
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// period_review_deliveries — the idempotency guarantee (KTD10 / R13 / AE6)
// ---------------------------------------------------------------------------

describe("period_review_deliveries", () => {
  it("athlete can SELECT their own delivery record", async () => {
    const athlete = await createTestUser();
    await insertDelivery(athlete.id);

    const { data, error } = await athlete.client
      .from("period_review_deliveries")
      .select("id, status");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("another athlete cannot SELECT someone else's delivery record", async () => {
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    await insertDelivery(athlete.id);

    const { data } = await stranger.client.from("period_review_deliveries").select("id");
    expect(data).toHaveLength(0);
  });

  // No coach policy — what landed in an athlete's personal inbox is not
  // coaching data. This asserts that absence deliberately.
  it("a linked coach cannot SELECT their athlete's delivery records", async () => {
    const coach = await createTestUser();
    const athlete = await createTestUser();
    await createCoachLink(coach.id, athlete.id);
    await insertDelivery(athlete.id);

    const { data } = await coach.client.from("period_review_deliveries").select("id");
    expect(data).toHaveLength(0);
  });

  it("athlete cannot INSERT a delivery record (would let them forge a send)", async () => {
    const athlete = await createTestUser();
    const { error } = await athlete.client.from("period_review_deliveries").insert({
      athlete_id: athlete.id,
      kind: "weekly",
      period_key: WEEK_KEY,
    });
    expect(error).not.toBeNull();
  });

  it("athlete cannot DELETE a delivery record (would unlock a duplicate send)", async () => {
    const athlete = await createTestUser();
    const { data: seeded } = await insertDelivery(athlete.id);

    await athlete.client.from("period_review_deliveries").delete().eq("id", seeded!.id);

    const admin = serviceClient();
    const { data } = await admin
      .from("period_review_deliveries")
      .select("id")
      .eq("id", seeded!.id);
    expect(data).toHaveLength(1);
  });

  // AE6: a retried or overlapping scheduler tick cannot claim the same period
  // twice. Asserted for every status, because the index is deliberately NOT
  // partial — a terminal 'sent' or 'failed' row must block a re-claim just as
  // firmly as an in-flight 'claimed' one.
  it.each(["claimed", "sent", "failed"])(
    "rejects a second claim for the same period when the first is %s",
    async (status) => {
      const athlete = await createTestUser();
      await insertDelivery(athlete.id, { status });

      const { error } = await insertDelivery(athlete.id);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
    },
  );

  it("allows the same period key for a different cadence", async () => {
    const athlete = await createTestUser();
    await insertDelivery(athlete.id, { kind: "weekly", periodKey: WEEK_KEY });

    const { error } = await insertDelivery(athlete.id, {
      kind: "monthly",
      periodKey: MONTH_KEY,
    });
    expect(error).toBeNull();
  });

  it("rejects a status outside the closed vocabulary", async () => {
    const athlete = await createTestUser();
    const { error } = await insertDelivery(athlete.id, { status: "bounced" });
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Blast radius of the 0028 soft-delete trigger
// ---------------------------------------------------------------------------

// 0028 added a trigger that soft-deletes workout_reports when a
// completed_workouts row is soft-deleted. A period review is about a PERIOD,
// not a workout, and must survive one session being removed from it — the
// fingerprint is what registers the change (the review goes stale), not a
// tombstone. This test pins that boundary so a future migration that widens
// the trigger has to break it deliberately.
describe("completed_workouts soft-delete does not cascade to period_reviews", () => {
  it("leaves the period review live when a workout inside the period is soft-deleted", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();

    const { data: workout, error: workoutErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: athlete.id,
        source: "manual",
        started_at: "2026-08-12T09:00:00Z",
        sport: "run",
        summary_stats: {},
      })
      .select("id")
      .single();
    if (workoutErr) throw new Error(workoutErr.message);

    const { data: review } = await insertReview(athlete.id);

    await admin
      .from("completed_workouts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", workout!.id);

    const { data } = await admin
      .from("period_reviews")
      .select("id, deleted_at")
      .eq("id", review!.id)
      .single();
    expect(data?.deleted_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Account deletion cascade
// ---------------------------------------------------------------------------

describe("delete_user_cascade covers period_reviews", () => {
  it("soft-deletes the athlete's period reviews", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const { data: review } = await insertReview(athlete.id);

    const { error } = await admin.rpc("delete_user_cascade", { user_id: athlete.id });
    expect(error).toBeNull();

    const { data } = await admin
      .from("period_reviews")
      .select("deleted_at")
      .eq("id", review!.id)
      .single();
    expect(data?.deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Email preferences (migration 0030)
// ---------------------------------------------------------------------------

describe("users email preference columns", () => {
  it("default to FALSE for a newly-created user (the opt-in posture)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();

    const { data, error } = await admin
      .from("users")
      .select("email_weekly_review, email_monthly_review")
      .eq("id", athlete.id)
      .single();
    expect(error).toBeNull();
    expect(data?.email_weekly_review).toBe(false);
    expect(data?.email_monthly_review).toBe(false);
  });

  it("athlete can read their own preferences under their own JWT", async () => {
    const athlete = await createTestUser();

    const { data, error } = await athlete.client
      .from("users")
      .select("email_weekly_review, email_monthly_review")
      .eq("id", athlete.id)
      .single();
    expect(error).toBeNull();
    expect(data?.email_weekly_review).toBe(false);
  });

  it("athlete cannot read another athlete's preferences", async () => {
    const athlete = await createTestUser();
    const stranger = await createTestUser();

    const { data } = await stranger.client
      .from("users")
      .select("email_weekly_review")
      .eq("id", athlete.id);
    expect(data).toHaveLength(0);
  });
});
