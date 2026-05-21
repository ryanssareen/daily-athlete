import "server-only";

// writeAudit — append a row to the immutable admin_audit_log. Every admin
// operation (login, logout, status reads, exports, deletes, user-list views)
// calls this. The table is append-only at the DB level (migration 0016), so
// this module only ever INSERTs.
//
// METADATA MUST BE NON-PII: action names, ids, normalized codes, counts —
// never emails, names, secrets, cookie/token values, or signed URLs. The
// table is immutable, so PII written here cannot be erased.

import { createAdminClient } from "@/db/admin";

export interface AuditEntry {
  /** Dotted action name, e.g. "admin.login.success", "admin.users.view". */
  action: string;
  /** Optional FK to the user this action targeted (must exist). */
  targetUserId?: string | null;
  /** Optional non-user target reference, e.g. a backup id. */
  target?: string | null;
  /** Non-PII structured context only (ids, codes, counts). */
  metadata?: Record<string, unknown>;
  /** Request client IP (see admin-session.clientIp). */
  ip?: string | null;
  /** Admin session id, when one exists. */
  sessionId?: string | null;
}

/**
 * Best-effort audit write. Never throws: a failed audit must not crash the
 * operation it records, but it IS logged loudly (non-PII) so a silent gap is
 * visible in logs. Source = "<ip> <sessionId>" (whichever are present).
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const source =
    [entry.ip, entry.sessionId].filter(Boolean).join(" ") || null;
  try {
    const admin = createAdminClient();
    // service-role: admin_audit_log is a service-role-only, append-only table.
    const { error } = await admin.from("admin_audit_log").insert({
      action: entry.action,
      target_user_id: entry.targetUserId ?? null,
      target: entry.target ?? null,
      metadata: entry.metadata ?? {},
      source,
    });
    if (error) {
      console.error(
        "[admin-audit] write failed",
        JSON.stringify({ action: entry.action, code: error.code })
      );
    }
  } catch (err) {
    console.error(
      "[admin-audit] write threw",
      JSON.stringify({
        action: entry.action,
        message: err instanceof Error ? err.message : "unknown",
      })
    );
  }
}
