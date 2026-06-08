// RLS tests for public.ai_generation_attempts and public.ai_plan_trials
// (migration 0024). Mandatory for new user-scoped tables. Confirms:
//   - athlete-self SELECT works; a forged request_id cannot hijack/oracle
//     another athlete's generation (the composite key is scoped by auth.uid())
//   - no client write path (rows are owned by the service-role worker/RPC)
//
// RLS SELECT denial surfaces as 0 rows (not an error); write denial surfaces as
// an error. Prerequisites: `supabase start` (CI provides it).

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

type Admin = ReturnType<typeof serviceClient>;

async function seedAttempt(admin: Admin, athleteId: string): Promise<string> {
  const requestId = crypto.randomUUID();
  const { error } = await admin.from("ai_generation_attempts").insert({
    athlete_id: athleteId,
    request_id: requestId,
    inputs: { athlete_id: athleteId, weekly_hours: 8 },
    requester_user_id: athleteId,
    requester_kind: "owner",
    status: "pending",
  });
  if (error) throw new Error(`seedAttempt: ${error.message}`);
  return requestId;
}

describe("ai_generation_attempts RLS", () => {
  it("athlete can SELECT their own attempt", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    await seedAttempt(admin, athlete.id);

    const { data, error } = await athlete.client
      .from("ai_generation_attempts")
      .select("id, status")
      .eq("athlete_id", athlete.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("pending");
  });

  it("a stranger cannot SELECT another athlete's attempt (0 rows, not an error)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    await seedAttempt(admin, athlete.id);

    const { data, error } = await stranger.client
      .from("ai_generation_attempts")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a stranger cannot read another athlete's attempt even by guessing the request_id", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const requestId = await seedAttempt(admin, athlete.id);

    const { data } = await stranger.client
      .from("ai_generation_attempts")
      .select("id")
      .eq("request_id", requestId);
    expect(data).toHaveLength(0); // composite key is gated by auth.uid()=athlete_id
  });

  it("no client INSERT path (service-role only)", async () => {
    const athlete = await createTestUser();
    const { error } = await athlete.client.from("ai_generation_attempts").insert({
      athlete_id: athlete.id,
      request_id: crypto.randomUUID(),
      inputs: {},
      status: "succeeded",
    });
    expect(error).not.toBeNull(); // RLS denies INSERT
  });
});

describe("ai_plan_trials RLS", () => {
  it("athlete can SELECT their own trial marker; a stranger cannot", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const { error: seedErr } = await admin
      .from("ai_plan_trials")
      .insert({ user_id: athlete.id });
    if (seedErr) throw new Error(seedErr.message);

    const own = await athlete.client
      .from("ai_plan_trials")
      .select("user_id")
      .eq("user_id", athlete.id);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);

    const other = await stranger.client.from("ai_plan_trials").select("user_id");
    expect(other.error).toBeNull();
    expect(other.data).toHaveLength(0);
  });

  it("no client INSERT path (service-role only)", async () => {
    const athlete = await createTestUser();
    const { error } = await athlete.client
      .from("ai_plan_trials")
      .insert({ user_id: athlete.id });
    expect(error).not.toBeNull();
  });
});

describe("ai_generation_attempts / ai_plan_trials account-deletion cascade", () => {
  it("are removed when the athlete account is hard-deleted (FK ON DELETE CASCADE)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const requestId = await seedAttempt(admin, athlete.id);
    await admin.from("ai_plan_trials").insert({ user_id: athlete.id });

    // Hard account delete (mirrors the account-deletion cascade path).
    await admin.auth.admin.deleteUser(athlete.id);

    const { data: attempts } = await admin
      .from("ai_generation_attempts")
      .select("id")
      .eq("request_id", requestId);
    const { data: trials } = await admin
      .from("ai_plan_trials")
      .select("user_id")
      .eq("user_id", athlete.id);
    expect(attempts ?? []).toHaveLength(0);
    expect(trials ?? []).toHaveLength(0);
  });
});
