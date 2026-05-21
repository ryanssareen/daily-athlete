// DB-backed tests for the append-only admin audit log. Requires a local
// Supabase stack (see setup.ts). The table is immutable, so tests CANNOT be
// cleaned up with DELETE (the trigger rejects it) — each test uses a unique
// action marker and asserts on its own rows instead.

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "@/db/__tests__/setup";
import { writeAudit } from "@/db/admin-audit";

const sc = serviceClient();
const marker = () => `test.${crypto.randomUUID()}`;

describe("admin_audit_log (append-only)", () => {
  it("writeAudit inserts a row with action + source", async () => {
    const action = marker();
    await writeAudit({ action, ip: "203.0.113.1", sessionId: "sess-1" });

    const { data } = await sc
      .from("admin_audit_log")
      .select("action, source, created_at")
      .eq("action", action)
      .single();
    expect(data?.action).toBe(action);
    expect(data?.source).toBe("203.0.113.1 sess-1");
    expect(data?.created_at).toBeTruthy();
  });

  it("rejects UPDATE via the service-role client (trigger, not RLS)", async () => {
    const action = marker();
    await writeAudit({ action });
    const { error } = await sc
      .from("admin_audit_log")
      .update({ action: `${action}.tampered` })
      .eq("action", action);
    expect(error).toBeTruthy();
    expect(error?.message ?? "").toMatch(/append-only|not permitted/i);
  });

  it("rejects DELETE via the service-role client", async () => {
    const action = marker();
    await writeAudit({ action });
    const { error } = await sc
      .from("admin_audit_log")
      .delete()
      .eq("action", action);
    expect(error).toBeTruthy();
    expect(error?.message ?? "").toMatch(/append-only|not permitted/i);
  });

  it("survives a user deletion: FK SET NULL scrubs target_user_id, row intact", async () => {
    const user = await createTestUser();
    const action = marker();
    await writeAudit({ action, targetUserId: user.id });

    // Deleting the user fires the FK ON DELETE SET NULL cascade, which is an
    // UPDATE on the audit row — the immutability trigger must PERMIT exactly
    // this cascade (otherwise the user would be undeletable).
    const { error: delErr } = await sc.auth.admin.deleteUser(user.id);
    expect(delErr).toBeFalsy();

    const { data } = await sc
      .from("admin_audit_log")
      .select("action, target_user_id")
      .eq("action", action)
      .single();
    expect(data?.action).toBe(action); // row preserved
    expect(data?.target_user_id).toBeNull(); // reference scrubbed
  });
});
