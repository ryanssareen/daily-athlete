// DB integration tests for the create_ai_plan RPC (migration 0024, plan Unit 5/7).
// Runs against a real local Supabase Postgres and exercises the transactional
// guarantees the SQL owns:
//   - archive-then-create: exactly one active plan, prior plan archived
//   - set-based workout insert with athlete_id/plan_id derived from params
//   - lookup-first idempotency (duplicate request_id -> same plan, no 2nd spend)
//   - ABA replay (a request whose plan was archived by a newer one is NOT recreated)
//   - cross-athlete smuggle ignored (workout JSON athlete_id has no effect)
//   - partial-write rollback (one bad workout rolls back the whole RPC)
//   - one-free-trial atomic flip + trial_exhausted
//
// Prerequisites: `supabase start` (CI provides it). Docker-free local runs skip
// via the harness's connection error.

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

const WORKOUTS = (planLoad = 50) => [
  {
    scheduled_date: "2026-07-01",
    sport: "run",
    structure: {
      duration_s: 3600,
      load: planLoad,
      intensity_target: { kind: "zone", value: 2 },
      phase: "base",
    },
    rationale: "Aerobic base.",
    planned_load: planLoad,
  },
  {
    scheduled_date: "2026-07-03",
    sport: "bike",
    structure: {
      duration_s: 5400,
      load: planLoad,
      intensity_target: { kind: "zone", value: 2 },
      phase: "base",
    },
    rationale: "Endurance ride.",
    planned_load: planLoad,
  },
];

type Admin = ReturnType<typeof serviceClient>;

async function seedPendingAttempt(
  admin: Admin,
  athleteId: string,
  requestId: string
): Promise<void> {
  const { error } = await admin.from("ai_generation_attempts").insert({
    athlete_id: athleteId,
    request_id: requestId,
    inputs: { athlete_id: athleteId, weekly_hours: 8 },
    requester_user_id: athleteId,
    requester_kind: "owner",
    status: "pending",
  });
  if (error) throw new Error(`seedPendingAttempt: ${error.message}`);
}

async function activePlans(admin: Admin, athleteId: string) {
  const { data, error } = await admin
    .from("plans")
    .select("id, status")
    .eq("athlete_id", athleteId)
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function callRpc(
  admin: Admin,
  athleteId: string,
  requestId: string,
  opts: { workouts?: unknown[]; consumeTrial?: boolean } = {}
) {
  return admin.rpc("create_ai_plan", {
    p_athlete_id: athleteId,
    p_request_id: requestId,
    p_plan: { event_type: null, event_date: null },
    p_workouts: opts.workouts ?? WORKOUTS(),
    p_consume_trial: opts.consumeTrial ?? false,
  });
}

describe("create_ai_plan RPC", () => {
  it("archives any active plan and creates exactly one new active plan + workouts", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    // Pre-existing active plan to be archived.
    const { data: prior } = await admin
      .from("plans")
      .insert({ athlete_id: athlete.id, status: "active", source: "coach_assigned" })
      .select("id")
      .single();

    const requestId = crypto.randomUUID();
    await seedPendingAttempt(admin, athlete.id, requestId);
    const { data, error } = await callRpc(admin, athlete.id, requestId);

    expect(error).toBeNull();
    expect(data.outcome).toBe("ok");
    expect(data.workout_count).toBe(2);

    const active = await activePlans(admin, athlete.id);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(data.plan_id);

    // Prior plan archived.
    const { data: priorRow } = await admin
      .from("plans")
      .select("status, archived_at")
      .eq("id", prior!.id)
      .single();
    expect(priorRow!.status).toBe("archived");
    expect(priorRow!.archived_at).not.toBeNull();

    // Workouts derive athlete_id/plan_id from params, source-tagged.
    const { data: wks } = await admin
      .from("planned_workouts")
      .select("athlete_id, plan_id, sport, version")
      .eq("plan_id", data.plan_id);
    expect(wks).toHaveLength(2);
    for (const w of wks!) {
      expect(w.athlete_id).toBe(athlete.id);
      expect(w.plan_id).toBe(data.plan_id);
      expect(w.version).toBe(1);
    }

    // The attempt is now succeeded with the new plan id.
    const { data: attempt } = await admin
      .from("ai_generation_attempts")
      .select("status, plan_id")
      .eq("athlete_id", athlete.id)
      .eq("request_id", requestId)
      .single();
    expect(attempt!.status).toBe("succeeded");
    expect(attempt!.plan_id).toBe(data.plan_id);
  });

  it("is idempotent on duplicate request_id (same plan, no second active, no extra workouts)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const requestId = crypto.randomUUID();
    await seedPendingAttempt(admin, athlete.id, requestId);

    const first = await callRpc(admin, athlete.id, requestId);
    const second = await callRpc(admin, athlete.id, requestId);

    expect(first.data.outcome).toBe("ok");
    expect(second.data.outcome).toBe("ok");
    expect(second.data.idempotent).toBe(true);
    expect(second.data.plan_id).toBe(first.data.plan_id);

    expect(await activePlans(admin, athlete.id)).toHaveLength(1);
    const { data: wks } = await admin
      .from("planned_workouts")
      .select("id")
      .eq("plan_id", first.data.plan_id);
    expect(wks).toHaveLength(2); // not 4
  });

  it("replaying an older request after a newer one returns the OLD plan id, recreates nothing (ABA)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const r1 = crypto.randomUUID();
    const r2 = crypto.randomUUID();
    await seedPendingAttempt(admin, athlete.id, r1);
    await seedPendingAttempt(admin, athlete.id, r2);

    const p1 = (await callRpc(admin, athlete.id, r1)).data.plan_id; // P1 active
    const p2 = (await callRpc(admin, athlete.id, r2)).data.plan_id; // archives P1, P2 active
    const replay = await callRpc(admin, athlete.id, r1); // replay R1

    expect(replay.data.outcome).toBe("ok");
    expect(replay.data.idempotent).toBe(true);
    expect(replay.data.plan_id).toBe(p1); // returns P1 status-agnostically

    const active = await activePlans(admin, athlete.id);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(p2); // P2 still the active one; no P3 created
    expect(p1).not.toBe(p2);
  });

  it("derives athlete_id from params, ignoring a smuggled cross-athlete id in the workout JSON", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const requestId = crypto.randomUUID();
    await seedPendingAttempt(admin, athlete.id, requestId);

    const smuggled = WORKOUTS().map((w) => ({ ...w, athlete_id: stranger.id, plan_id: stranger.id }));
    const { data } = await callRpc(admin, athlete.id, requestId, { workouts: smuggled });

    const { data: wks } = await admin
      .from("planned_workouts")
      .select("athlete_id")
      .eq("plan_id", data.plan_id);
    for (const w of wks!) expect(w.athlete_id).toBe(athlete.id);
  });

  it("rolls back the entire RPC when one workout is malformed (prior active plan intact)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const { data: prior } = await admin
      .from("plans")
      .insert({ athlete_id: athlete.id, status: "active", source: "coach_assigned" })
      .select("id")
      .single();
    const requestId = crypto.randomUUID();
    await seedPendingAttempt(admin, athlete.id, requestId);

    const bad = WORKOUTS();
    (bad[1] as { sport: string }).sport = "not_a_sport"; // violates the sport CHECK
    const { error } = await callRpc(admin, athlete.id, requestId, { workouts: bad });

    expect(error).not.toBeNull(); // 23514 propagates -> whole RPC rolls back

    // No new plan; the prior active plan is untouched.
    const active = await activePlans(admin, athlete.id);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(prior!.id);
  });

  it("consumes the one free trial atomically; a second trial request is trial_exhausted", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const r1 = crypto.randomUUID();
    const r2 = crypto.randomUUID();
    await seedPendingAttempt(admin, athlete.id, r1);
    await seedPendingAttempt(admin, athlete.id, r2);

    const first = await callRpc(admin, athlete.id, r1, { consumeTrial: true });
    expect(first.data.outcome).toBe("ok");

    // Trial marker now exists.
    const { data: trial } = await admin
      .from("ai_plan_trials")
      .select("user_id, plan_id")
      .eq("user_id", athlete.id)
      .single();
    expect(trial!.user_id).toBe(athlete.id);
    expect(trial!.plan_id).toBe(first.data.plan_id);

    // A different trial request finds the trial spent -> no plan.
    const second = await callRpc(admin, athlete.id, r2, { consumeTrial: true });
    expect(second.data.outcome).toBe("trial_exhausted");
    expect(await activePlans(admin, athlete.id)).toHaveLength(1); // still just the first
  });
});
