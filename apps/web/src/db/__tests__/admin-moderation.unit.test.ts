// Unit tests for the moderation DB layer. createAdminClient is mocked with a
// minimal supabase chain (select->eq->maybeSingle, update->eq, and
// auth.admin.updateUserById) so we assert state-transition logic, the
// discriminated results, the ban toggles, and that infra errors throw — with no
// live Supabase.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as { id: string; deleted_at: string | null; disabled_at: string | null } | null,
  updateError: null as { message: string } | null,
  banError: null as { message: string } | null,
  updates: [] as { table: string; payload: Record<string, unknown>; id: string }[],
  bans: [] as { id: string; attrs: Record<string, unknown> }[],
}));

vi.mock("@/db/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.row, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          state.updates.push({ table, payload, id });
          return { error: state.updateError };
        },
      }),
    }),
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          state.bans.push({ id, attrs });
          return { error: state.banError };
        },
      },
    },
  }),
}));

import {
  disableUser,
  enableUser,
  MODERATION_GRACE_DAYS,
  purgeEligibleAt,
  restoreUser,
  softDeleteUser,
} from "../admin-moderation";

const USER = "11111111-1111-1111-1111-111111111111";
const active = { id: USER, deleted_at: null, disabled_at: null };

beforeEach(() => {
  state.row = { ...active };
  state.updateError = null;
  state.banError = null;
  state.updates = [];
  state.bans = [];
});

describe("disableUser", () => {
  it("disables an active user: stamps disabled_at + reason, bans login", async () => {
    const res = await disableUser(USER, "abuse");
    expect(res).toEqual({ ok: true });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.table).toBe("users");
    expect(state.updates[0]!.id).toBe(USER);
    expect(state.updates[0]!.payload.disabled_reason_code).toBe("abuse");
    expect(state.updates[0]!.payload.disabled_at).toEqual(expect.any(String));
    expect(state.bans).toEqual([{ id: USER, attrs: { ban_duration: "876000h" } }]);
  });

  it("returns not_found when the user does not exist (no writes)", async () => {
    state.row = null;
    const res = await disableUser(USER, "spam");
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(state.updates).toHaveLength(0);
    expect(state.bans).toHaveLength(0);
  });

  it("returns conflict when already disabled", async () => {
    state.row = { ...active, disabled_at: "2026-05-01T00:00:00+00:00" };
    expect(await disableUser(USER, "spam")).toEqual({ ok: false, error: "conflict" });
    expect(state.updates).toHaveLength(0);
  });

  it("returns conflict when the user is soft-deleted", async () => {
    state.row = { ...active, deleted_at: "2026-05-01T00:00:00+00:00" };
    expect(await disableUser(USER, "spam")).toEqual({ ok: false, error: "conflict" });
  });

  it("throws when the ban API errors (surfaces as 500 upstream)", async () => {
    state.banError = { message: "gotrue down" };
    await expect(disableUser(USER, "spam")).rejects.toThrow(/ban toggle failed/);
  });

  it("throws when the row update errors", async () => {
    state.updateError = { message: "db down" };
    await expect(disableUser(USER, "spam")).rejects.toThrow(/disableUser update failed/);
    expect(state.bans).toHaveLength(0); // never reaches the ban step
  });
});

describe("enableUser", () => {
  it("re-enables a disabled user: clears state, lifts ban", async () => {
    state.row = { ...active, disabled_at: "2026-05-01T00:00:00+00:00" };
    const res = await enableUser(USER);
    expect(res).toEqual({ ok: true });
    expect(state.updates[0]!.payload).toEqual({
      disabled_at: null,
      disabled_reason_code: null,
    });
    expect(state.bans).toEqual([{ id: USER, attrs: { ban_duration: "none" } }]);
  });

  it("returns conflict when the user is not disabled", async () => {
    expect(await enableUser(USER)).toEqual({ ok: false, error: "conflict" });
  });

  it("returns not_found for a missing user", async () => {
    state.row = null;
    expect(await enableUser(USER)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("softDeleteUser", () => {
  it("soft-deletes an active user: sets deleted_at + reason, bans login", async () => {
    const res = await softDeleteUser(USER, "tos_violation");
    expect(res).toEqual({ ok: true });
    expect(state.updates[0]!.payload.deleted_at).toEqual(expect.any(String));
    expect(state.updates[0]!.payload.disabled_reason_code).toBe("tos_violation");
    expect(state.bans).toEqual([{ id: USER, attrs: { ban_duration: "876000h" } }]);
  });

  it("returns conflict when already deleted", async () => {
    state.row = { ...active, deleted_at: "2026-05-01T00:00:00+00:00" };
    expect(await softDeleteUser(USER, "fraud")).toEqual({ ok: false, error: "conflict" });
  });
});

describe("restoreUser", () => {
  it("restores a recently-deleted user within grace: clears state, lifts ban", async () => {
    state.row = { ...active, deleted_at: new Date().toISOString() };
    const res = await restoreUser(USER);
    expect(res).toEqual({ ok: true });
    expect(state.updates[0]!.payload).toEqual({
      deleted_at: null,
      disabled_at: null,
      disabled_reason_code: null,
    });
    expect(state.bans).toEqual([{ id: USER, attrs: { ban_duration: "none" } }]);
  });

  it("returns conflict when the user is not deleted", async () => {
    expect(await restoreUser(USER)).toEqual({ ok: false, error: "conflict" });
  });

  it("returns conflict when the grace window has elapsed", async () => {
    const longAgo = new Date(
      Date.now() - (MODERATION_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString();
    state.row = { ...active, deleted_at: longAgo };
    expect(await restoreUser(USER)).toEqual({ ok: false, error: "conflict" });
    expect(state.updates).toHaveLength(0);
  });
});

describe("purgeEligibleAt", () => {
  it("is deleted_at + MODERATION_GRACE_DAYS", () => {
    const deletedAt = "2026-05-01T00:00:00.000Z";
    const expected = new Date("2026-05-31T00:00:00.000Z").getTime(); // +30d
    expect(purgeEligibleAt(deletedAt).getTime()).toBe(expected);
  });
});
