// DB integration tests for the generate-plan worker CORE (runGeneratePlan),
// exercised against a real local Supabase Postgres with a MOCKED LlmClient
// (the repo has no @inngest/test; the worker logic is extracted into a testable
// function, the strava-helpers precedent). The Inngest wrapper's error→retry
// mapping mirrors backfill-strava.ts / adaptive-run.ts and is not re-tested here.
//
// Prerequisites: `supabase start` (CI provides it).

import type { LlmClient, LlmResult } from "@/llm";
import { describe, expect, it, vi } from "vitest";

import { createTestUser, serviceClient } from "@/db/__tests__/setup";
import { runGeneratePlan } from "../generate-plan";

type Admin = ReturnType<typeof serviceClient>;

// A small, cold-start-safe plan: single week, 30 TSS each, no event -> passes
// the forward-sim validator (volume baseline 0 skips week 1, <7d series skips
// the CTL ramp, TSB stays well above the -30 floor).
const SAFE_PLAN = {
  event_type: null,
  event_date: null,
  workouts: [
    {
      scheduled_date: "2026-07-01",
      sport: "run",
      structure: {
        duration_s: 2400,
        load: 30,
        intensity_target: { kind: "zone", value: 2 },
        phase: "base",
      },
      rationale: "Easy aerobic run.",
      planned_load: 30,
    },
    {
      scheduled_date: "2026-07-03",
      sport: "bike",
      structure: {
        duration_s: 3000,
        load: 30,
        intensity_target: { kind: "zone", value: 2 },
        phase: "base",
      },
      rationale: "Easy spin.",
      planned_load: 30,
    },
  ],
};

function fakeClient(json: unknown): LlmClient & { calls: () => number } {
  const fn = vi.fn(
    async (): Promise<LlmResult> => ({
      json,
      usage: { inputTokens: 1, outputTokens: 1, latencyMs: 1 },
    })
  );
  return { generateStructured: fn, calls: () => fn.mock.calls.length };
}

async function grantEntitlement(admin: Admin, userId: string): Promise<void> {
  const { error } = await admin.from("entitlements").insert({
    user_id: userId,
    entitlement_key: "ai_plans",
    active: true,
    source: "revenuecat",
  });
  if (error) throw new Error(`grantEntitlement: ${error.message}`);
}

async function seedPending(
  admin: Admin,
  athleteId: string,
  inputs: Record<string, unknown>
): Promise<string> {
  const requestId = crypto.randomUUID();
  const { error } = await admin.from("ai_generation_attempts").insert({
    athlete_id: athleteId,
    request_id: requestId,
    inputs: { athlete_id: athleteId, weekly_hours: 8, ...inputs },
    requester_user_id: athleteId,
    requester_kind: "owner",
    status: "pending",
  });
  if (error) throw new Error(`seedPending: ${error.message}`);
  return requestId;
}

function event(athleteId: string, requestId: string) {
  return {
    athlete_id: athleteId,
    request_id: requestId,
    requester_user_id: athleteId,
    requester_kind: "owner" as const,
  };
}

describe("runGeneratePlan", () => {
  it("entitled athlete: generates, persists, marks the attempt succeeded", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    await grantEntitlement(admin, athlete.id);
    const requestId = await seedPending(admin, athlete.id, {});
    const client = fakeClient(SAFE_PLAN);

    const result = await runGeneratePlan({ admin, client, event: event(athlete.id, requestId) });

    expect(result.status).toBe("ok");
    const planId = (result as { plan_id: string }).plan_id;
    expect(planId).toBeTruthy();
    expect(client.calls()).toBe(1);

    const { data: active } = await admin
      .from("plans")
      .select("id, source")
      .eq("athlete_id", athlete.id)
      .eq("status", "active")
      .is("deleted_at", null);
    expect(active).toHaveLength(1);
    expect(active?.[0]?.source).toBe("ai_generated");

    const { data: attempt } = await admin
      .from("ai_generation_attempts")
      .select("status, plan_id")
      .eq("request_id", requestId)
      .single();
    expect(attempt?.status).toBe("succeeded");
    expect(attempt?.plan_id).toBe(planId);
  });

  it("a succeeded attempt is an idempotent no-op (no model spend)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    await grantEntitlement(admin, athlete.id);
    // A prior plan + a succeeded attempt pointing at it.
    const { data: plan } = await admin
      .from("plans")
      .insert({ athlete_id: athlete.id, status: "active", source: "ai_generated" })
      .select("id")
      .single();
    const requestId = crypto.randomUUID();
    await admin.from("ai_generation_attempts").insert({
      athlete_id: athlete.id,
      request_id: requestId,
      inputs: { athlete_id: athlete.id, weekly_hours: 8 },
      requester_user_id: athlete.id,
      requester_kind: "owner",
      status: "succeeded",
      plan_id: plan!.id,
    });
    const client = fakeClient(SAFE_PLAN);

    const result = await runGeneratePlan({ admin, client, event: event(athlete.id, requestId) });

    expect(result).toEqual({ status: "ok_cached", plan_id: plan!.id });
    expect(client.calls()).toBe(0); // no generation
  });

  it("a past event date is infeasible (no model spend); attempt marked infeasible", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    await grantEntitlement(admin, athlete.id);
    const requestId = await seedPending(admin, athlete.id, {
      event_type: "race",
      event_date: "2020-01-01",
    });
    const client = fakeClient(SAFE_PLAN);

    const result = await runGeneratePlan({ admin, client, event: event(athlete.id, requestId) });

    expect(result.status).toBe("infeasible");
    expect(client.calls()).toBe(0); // feasibility gate short-circuits before the model
    const { data: attempt } = await admin
      .from("ai_generation_attempts")
      .select("status")
      .eq("request_id", requestId)
      .single();
    expect(attempt?.status).toBe("infeasible");
  });

  it("an unentitled, non-trial athlete is skipped (no model spend); attempt failed", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    // No entitlement, but burn the trial first so trialEligible is false.
    await admin.from("ai_plan_trials").insert({ user_id: athlete.id });
    const requestId = await seedPending(admin, athlete.id, {});
    const client = fakeClient(SAFE_PLAN);

    const result = await runGeneratePlan({ admin, client, event: event(athlete.id, requestId) });

    expect(result).toEqual({ status: "skipped", code: "unentitled" });
    expect(client.calls()).toBe(0);
    const { data: attempt } = await admin
      .from("ai_generation_attempts")
      .select("status, error_code")
      .eq("request_id", requestId)
      .single();
    expect(attempt?.status).toBe("failed");
    expect(attempt?.error_code).toBe("unentitled");
  });

  it("never-paid athlete: the trial path generates and consumes the trial", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    // No entitlement, no trial marker -> trial-eligible.
    const requestId = await seedPending(admin, athlete.id, {});
    const client = fakeClient(SAFE_PLAN);

    const result = await runGeneratePlan({ admin, client, event: event(athlete.id, requestId) });

    expect(result.status).toBe("ok");
    const { data: trial } = await admin
      .from("ai_plan_trials")
      .select("user_id, plan_id")
      .eq("user_id", athlete.id)
      .single();
    expect(trial?.user_id).toBe(athlete.id);
    expect(trial?.plan_id).toBe((result as { plan_id: string }).plan_id);
  });
});
