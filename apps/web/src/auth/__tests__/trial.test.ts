// Pure-unit tests for the one-free-plan trial gate (Unit 7). The ai_plan_trials
// read is faked and hasActiveEntitlement is mocked, so no DB is needed; the
// atomic consumption itself lives in the create_ai_plan RPC and is covered by
// the DB-backed create-ai-plan tests.

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entitled: false,
  trialRow: null as { user_id: string } | null,
  trialError: null as { code: string } | null,
}));

vi.mock("@/auth/entitlements", () => ({
  hasActiveEntitlement: vi.fn(async () => mocks.entitled),
}));

import { hasActiveEntitlement } from "@/auth/entitlements";
import { isTrialEligible, resolveGenerationAccess } from "../trial";

const USER = "00000000-0000-0000-0000-0000000000c3";

// Fake supabase client whose ai_plan_trials read returns the mocked row/error.
function fakeClient(): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: mocks.trialRow, error: mocks.trialError }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entitled = false;
  mocks.trialRow = null;
  mocks.trialError = null;
});

describe("isTrialEligible", () => {
  it("eligible when no marker row exists", async () => {
    expect(await isTrialEligible(fakeClient(), USER)).toBe(true);
  });

  it("ineligible once the marker row exists", async () => {
    mocks.trialRow = { user_id: USER };
    expect(await isTrialEligible(fakeClient(), USER)).toBe(false);
  });

  it("fails closed (ineligible) on a read error", async () => {
    mocks.trialError = { code: "57014" };
    expect(await isTrialEligible(fakeClient(), USER)).toBe(false);
  });
});

describe("resolveGenerationAccess", () => {
  it("entitled → allowed, no trial consumed", async () => {
    mocks.entitled = true;
    const a = await resolveGenerationAccess(fakeClient(), USER);
    expect(a).toEqual({ allowed: true, entitled: true, trialEligible: false });
    // Short-circuits before touching the trial marker.
    expect(hasActiveEntitlement).toHaveBeenCalledTimes(1);
  });

  it("never-paid with trial available → allowed via trial", async () => {
    mocks.entitled = false;
    mocks.trialRow = null;
    const a = await resolveGenerationAccess(fakeClient(), USER);
    expect(a).toEqual({ allowed: true, entitled: false, trialEligible: true });
  });

  it("never-paid with trial spent → not allowed", async () => {
    mocks.entitled = false;
    mocks.trialRow = { user_id: USER };
    const a = await resolveGenerationAccess(fakeClient(), USER);
    expect(a).toEqual({ allowed: false, entitled: false, trialEligible: false });
  });
});
