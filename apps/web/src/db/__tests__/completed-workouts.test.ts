// DB integration tests for public.completed_workouts (migration 0008).
// Covers:
//   - R14: canonical row per real-world effort (Strava + manual)
//   - R15: partial unique index for Strava idempotency
//   - R17 (storage half): soft-delete via UPDATE deleted_at
//   - R21: manual-then-Strava merge via superseded_by_id self-FK trail
//   - CHECK constraints (source, sport, strava_activity_id_required, no_self_supersede)
//   - RLS positive + negative
//   - FK cascade from auth.users
//   - CompletedWorkoutRowSchema Zod-roundtrip against real PostgREST data
//   - getRecentWorkouts / getWorkoutsInRange / getAthleteWorkouts exclude superseded rows
//   - getCoachRoster weekCount + lastActivityAt exclude superseded rows
//   - getThisWeekStats excludes superseded rows (transitively via getWorkoutsInRange)
//
// Companion file: workout-matches.test.ts.

import { describe, expect, it } from "vitest";

import { CompletedWorkoutRowSchema } from "@da2/shared";

import { getAthleteWorkouts, getCoachRoster } from "../roster";
import { getRecentWorkouts, getThisWeekStats, getWorkoutsInRange } from "../workouts";
import { createTestUser, serviceClient } from "./setup";

describe("completed_workouts table", () => {
  it("athlete inserts a Strava completion and reads it back via JWT (R14)", async () => {
    const user = await createTestUser();

    const { error: insertErr } = await user.client
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "strava",
        strava_activity_id: 1234567890,
        started_at: new Date().toISOString(),
        sport: "run",
        distance_m: 5000,
        duration_s: 1500,
        summary_stats: { avg_hr_bpm: 148, tss_equivalent: 32 },
      });
    expect(insertErr).toBeNull();

    const { data, error } = await user.client
      .from("completed_workouts")
      .select("source, strava_activity_id, sport, distance_m, duration_s")
      .eq("athlete_id", user.id)
      .single();
    expect(error).toBeNull();
    expect(data?.source).toBe("strava");
    expect(data?.sport).toBe("run");
  });

  it("manual completions with NULL strava_activity_id can coexist (multiple per day)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error: err1 } = await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "manual",
      strava_activity_id: null,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "mobility",
    });
    expect(err1).toBeNull();

    const { error: err2 } = await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "manual",
      strava_activity_id: null,
      started_at: "2026-05-13T18:00:00+00:00",
      sport: "strength",
    });
    expect(err2).toBeNull();

    const { data } = await admin
      .from("completed_workouts")
      .select("sport")
      .eq("athlete_id", user.id);
    expect(data).toHaveLength(2);
  });

  it("R15: same (athlete_id, strava_activity_id) twice without ON CONFLICT raises 23505", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const row = {
      athlete_id: user.id,
      source: "strava",
      strava_activity_id: 5555555555,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "run",
    };

    const { error: err1 } = await admin.from("completed_workouts").insert(row);
    expect(err1).toBeNull();

    const { error: err2 } = await admin.from("completed_workouts").insert(row);
    expect(err2).not.toBeNull();
    expect(err2?.code).toBe("23505");
  });

  it("R15: supabase-js .upsert() with partial-index conflict target raises 42P10 (documented limitation)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const baseRow = {
      athlete_id: user.id,
      source: "strava" as const,
      strava_activity_id: 7777777777,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "bike" as const,
    };

    // supabase-js's .upsert() with onConflict generates
    // `INSERT ... ON CONFLICT (athlete_id, strava_activity_id) DO UPDATE`
    // WITHOUT the WHERE strava_activity_id IS NOT NULL predicate. Postgres
    // can't infer the partial unique index without the predicate and
    // returns 42P10 ("no unique or exclusion constraint matches").
    // Webhook handlers therefore CANNOT use supabase-js .upsert() for R15
    // idempotency -- they must use the INSERT + catch-23505 + UPDATE
    // fallback (see next test) or a Postgres function via .rpc().
    const { error } = await admin
      .from("completed_workouts")
      .upsert(baseRow, { onConflict: "athlete_id,strava_activity_id" });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42P10");
  });

  it("R15: INSERT + catch 23505 + UPDATE fallback is the supported idempotency pattern", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const baseRow = {
      athlete_id: user.id,
      source: "strava" as const,
      strava_activity_id: 7777777778,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "bike" as const,
      distance_m: 30000,
      duration_s: 3600,
      summary_stats: { avg_power_w: 200 },
    };

    // First webhook delivery: insert succeeds
    const { error: err1 } = await admin
      .from("completed_workouts")
      .insert(baseRow);
    expect(err1).toBeNull();

    // Second delivery: insert collides; webhook handler catches 23505 and
    // falls back to UPDATE
    const updatedStats = { avg_power_w: 210, max_power_w: 380 };
    const { error: err2 } = await admin
      .from("completed_workouts")
      .insert({ ...baseRow, summary_stats: updatedStats });
    expect(err2?.code).toBe("23505");

    const { error: updateErr } = await admin
      .from("completed_workouts")
      .update({ summary_stats: updatedStats })
      .eq("athlete_id", user.id)
      .eq("strava_activity_id", baseRow.strava_activity_id);
    expect(updateErr).toBeNull();

    // Exactly one row; latest write wins
    const { data } = await admin
      .from("completed_workouts")
      .select("summary_stats")
      .eq("athlete_id", user.id);
    expect(data).toHaveLength(1);
    expect(
      (data?.[0]?.summary_stats as Record<string, unknown>)?.avg_power_w,
    ).toBe(210);
  });

  it("CHECK rejects source='strava' with NULL strava_activity_id (closes the R15 bypass)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "strava",
      strava_activity_id: null,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "run",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("R17: UPDATE SET deleted_at soft-deletes; SELECT filter excludes the row", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "strava",
      strava_activity_id: 8888888888,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "run",
    });

    await admin
      .from("completed_workouts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("strava_activity_id", 8888888888);

    const { data: live } = await admin
      .from("completed_workouts")
      .select("strava_activity_id")
      .eq("athlete_id", user.id)
      .is("deleted_at", null);
    expect(live).toEqual([]);
  });

  it("R21: manual-then-Strava merge via superseded_by_id", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // INSERT manual row M
    const { data: manualRow, error: manualErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "manual",
        strava_activity_id: null,
        started_at: "2026-05-13T07:00:00+00:00",
        sport: "run",
        distance_m: 5000,
        duration_s: 1500,
      })
      .select()
      .single();
    expect(manualErr).toBeNull();

    // INSERT Strava row S
    const { data: stravaRow, error: stravaErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "strava",
        strava_activity_id: 9999999999,
        started_at: "2026-05-13T07:00:00+00:00",
        sport: "run",
        distance_m: 5042,
        duration_s: 1508,
      })
      .select()
      .single();
    expect(stravaErr).toBeNull();

    // UPDATE M SET superseded_by_id = S.id
    const { error: supersedeErr } = await admin
      .from("completed_workouts")
      .update({ superseded_by_id: stravaRow?.id })
      .eq("id", manualRow?.id);
    expect(supersedeErr).toBeNull();

    // Canonical read: only S (the unsuperseded row)
    const { data: canonical } = await admin
      .from("completed_workouts")
      .select("id, source")
      .eq("athlete_id", user.id)
      .is("superseded_by_id", null);
    expect(canonical).toHaveLength(1);
    expect(canonical?.[0]?.source).toBe("strava");
  });

  it("superseded_by_id pointing at a non-existent UUID -> 23503 FK violation", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { data: row } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "manual",
        strava_activity_id: null,
        started_at: "2026-05-13T07:00:00+00:00",
        sport: "run",
      })
      .select()
      .single();

    const { error } = await admin
      .from("completed_workouts")
      .update({ superseded_by_id: "00000000-0000-0000-0000-000000000000" })
      .eq("id", row?.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23503");
  });

  it("CHECK rejects superseded_by_id = id (self-loop)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { data: row } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "manual",
        strava_activity_id: null,
        started_at: "2026-05-13T07:00:00+00:00",
        sport: "run",
      })
      .select()
      .single();

    const { error } = await admin
      .from("completed_workouts")
      .update({ superseded_by_id: row?.id })
      .eq("id", row?.id);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("CHECK rejects unknown source", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "healthkit",
      strava_activity_id: null,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "run",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("CHECK rejects unknown sport", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    const { error } = await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "manual",
      strava_activity_id: null,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "rowing",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("athlete A cannot see athlete B's completed_workouts (RLS negative)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const admin = serviceClient();

    await admin.from("completed_workouts").insert([
      {
        athlete_id: userA.id,
        source: "manual",
        strava_activity_id: null,
        started_at: "2026-05-13T07:00:00+00:00",
        sport: "run",
      },
      {
        athlete_id: userB.id,
        source: "manual",
        strava_activity_id: null,
        started_at: "2026-05-13T07:00:00+00:00",
        sport: "bike",
      },
    ]);

    const { data, error } = await userA.client
      .from("completed_workouts")
      .select("athlete_id")
      .eq("athlete_id", userB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("athlete A cannot INSERT a completion for athlete B (RLS WITH CHECK)", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    const { error } = await userA.client.from("completed_workouts").insert({
      athlete_id: userB.id,
      source: "manual",
      strava_activity_id: null,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "run",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("FK cascade: deleting auth.users removes completed_workouts rows", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "manual",
      strava_activity_id: null,
      started_at: "2026-05-13T07:00:00+00:00",
      sport: "run",
    });

    await admin.auth.admin.deleteUser(user.id);

    const { data } = await admin
      .from("completed_workouts")
      .select("athlete_id")
      .eq("athlete_id", user.id);
    expect(data).toEqual([]);
  });

  it("CompletedWorkoutRowSchema parses a real PostgREST-returned row", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    await admin.from("completed_workouts").insert({
      athlete_id: user.id,
      source: "strava",
      strava_activity_id: 1010101010,
      started_at: "2026-05-13T06:30:00+00:00",
      sport: "run",
      distance_m: 10000.5,
      duration_s: 2700,
      summary_stats: { avg_hr_bpm: 148, tss_equivalent: 55, zones_hr: { z2: 1800 } },
    });

    const { data, error } = await admin
      .from("completed_workouts")
      .select(
        "id, athlete_id, source, strava_activity_id, started_at, sport, distance_m, duration_s, summary_stats, superseded_by_id, created_at, deleted_at",
      )
      .eq("athlete_id", user.id)
      .single();

    expect(error).toBeNull();
    const parsed = CompletedWorkoutRowSchema.parse(data);
    expect(parsed.source).toBe("strava");
    expect(parsed.distance_m).toBe(10000.5);
    expect(parsed.duration_s).toBe(2700);
    expect((parsed.summary_stats as Record<string, unknown>).tss_equivalent).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Unit 1: canonical read helpers exclude superseded rows
// ---------------------------------------------------------------------------

describe("canonical read helpers exclude superseded rows", () => {
  async function insertSupersededPair(athleteId: string) {
    const admin = serviceClient();

    // Insert manual row M (the old canonical row)
    const { data: manual, error: manualErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: athleteId,
        source: "manual",
        strava_activity_id: null,
        started_at: "2026-05-13T07:00:00+00:00",
        sport: "run",
        duration_s: 1500,
      })
      .select("id")
      .single();
    if (manualErr || !manual) throw new Error(`manual insert failed: ${manualErr?.message}`);

    // Insert Strava row S (the canonical replacement)
    const { data: strava, error: stravaErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: athleteId,
        source: "strava",
        strava_activity_id: 1111111111,
        started_at: "2026-05-13T07:02:00+00:00",
        sport: "run",
        duration_s: 1508,
      })
      .select("id")
      .single();
    if (stravaErr || !strava) throw new Error(`strava insert failed: ${stravaErr?.message}`);

    // Supersede M with S
    await admin
      .from("completed_workouts")
      .update({ superseded_by_id: strava.id })
      .eq("id", manual.id);

    return { manualId: manual.id, stravaId: strava.id };
  }

  it("getRecentWorkouts excludes superseded row and still returns canonical row", async () => {
    const user = await createTestUser();
    const { stravaId } = await insertSupersededPair(user.id);

    const rows = await getRecentWorkouts(user.client, user.id);

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(stravaId);
    // Manual row is superseded — must not appear
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("strava");
  });

  it("getWorkoutsInRange excludes superseded row and still returns canonical row", async () => {
    const user = await createTestUser();
    const { stravaId } = await insertSupersededPair(user.id);

    const rows = await getWorkoutsInRange(
      user.client,
      user.id,
      "2026-05-13T00:00:00Z",
      "2026-05-13T23:59:59Z",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(stravaId);
  });

  it("getAthleteWorkouts excludes superseded row and still returns canonical row", async () => {
    const admin = serviceClient();
    const user = await createTestUser();
    const { stravaId } = await insertSupersededPair(user.id);

    const rows = await getAthleteWorkouts(admin, user.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(stravaId);
  });

  it("getThisWeekStats count excludes superseded rows (transitively via getWorkoutsInRange)", async () => {
    const user = await createTestUser();
    const admin = serviceClient();

    // Insert two rows this week: canonical Strava + superseded manual
    const { data: strava, error: stravaErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "strava",
        strava_activity_id: 2222222222,
        started_at: new Date().toISOString(),
        sport: "run",
        duration_s: 1800,
      })
      .select("id")
      .single();
    expect(stravaErr).toBeNull();

    const { data: manual, error: manualErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: user.id,
        source: "manual",
        strava_activity_id: null,
        started_at: new Date().toISOString(),
        sport: "run",
        duration_s: 1800,
      })
      .select("id")
      .single();
    expect(manualErr).toBeNull();

    // Supersede manual with strava
    await admin
      .from("completed_workouts")
      .update({ superseded_by_id: strava!.id })
      .eq("id", manual!.id);

    const stats = await getThisWeekStats(user.client, user.id);

    // Only the Strava row counts; manual is superseded
    expect(stats.count).toBe(1);
    expect(stats.totalDurationS).toBe(1800);
  });

  it("getCoachRoster weekCount excludes superseded rows within the 7-day window", async () => {
    const admin = serviceClient();
    const coach = await createTestUser();
    const athlete = await createTestUser();

    // Link coach to athlete
    await admin.from("coach_athlete_links").insert({
      coach_user_id: coach.id,
      athlete_user_id: athlete.id,
      status: "active",
    });

    // Insert canonical Strava row within last 7 days
    const { data: strava, error: stravaErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: athlete.id,
        source: "strava",
        strava_activity_id: 3333333333,
        started_at: new Date().toISOString(),
        sport: "run",
        duration_s: 1800,
      })
      .select("id")
      .single();
    expect(stravaErr).toBeNull();

    // Insert superseded manual row (also within last 7 days)
    const { data: manual, error: manualErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: athlete.id,
        source: "manual",
        strava_activity_id: null,
        started_at: new Date().toISOString(),
        sport: "run",
        duration_s: 1800,
      })
      .select("id")
      .single();
    expect(manualErr).toBeNull();

    await admin
      .from("completed_workouts")
      .update({ superseded_by_id: strava!.id })
      .eq("id", manual!.id);

    const roster = await getCoachRoster(admin, coach.id);
    const entry = roster.find((e) => e.athleteId === athlete.id);

    expect(entry).toBeDefined();
    // Superseded row must not inflate weekCount
    expect(entry!.weekCount).toBe(1);
  });

  it("getCoachRoster lastActivityAt reflects canonical (non-superseded) row", async () => {
    const admin = serviceClient();
    const coach = await createTestUser();
    const athlete = await createTestUser();

    await admin.from("coach_athlete_links").insert({
      coach_user_id: coach.id,
      athlete_user_id: athlete.id,
      status: "active",
    });

    // Older manual row M (will be superseded)
    const olderDate = "2026-05-15T07:00:00+00:00";
    const { data: manual, error: manualErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: athlete.id,
        source: "manual",
        strava_activity_id: null,
        started_at: olderDate,
        sport: "run",
      })
      .select("id")
      .single();
    expect(manualErr).toBeNull();

    // Newer Strava row S (canonical)
    const newerDate = "2026-05-15T07:02:00+00:00";
    const { data: strava, error: stravaErr } = await admin
      .from("completed_workouts")
      .insert({
        athlete_id: athlete.id,
        source: "strava",
        strava_activity_id: 4444444444,
        started_at: newerDate,
        sport: "run",
      })
      .select("id")
      .single();
    expect(stravaErr).toBeNull();

    await admin
      .from("completed_workouts")
      .update({ superseded_by_id: strava!.id })
      .eq("id", manual!.id);

    const roster = await getCoachRoster(admin, coach.id);
    const entry = roster.find((e) => e.athleteId === athlete.id);

    expect(entry).toBeDefined();
    // lastActivityAt must come from the Strava row (canonical), not the manual row
    expect(entry!.lastActivityAt).toBe(newerDate);
  });
});
