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

// --- read side (logs viewer) -------------------------------------------
//
// The audit log is append-only and write-only by design; this is the ONLY
// read path, used by GET /api/admin/logs to surface the trail in the console.
// Reads stay service-role (the table is service-role-only) but are gated +
// audited at the route. No mutation is possible here.

export interface AuditLogRow {
  id: string;
  action: string;
  target_user_id: string | null;
  target: string | null;
  metadata: Record<string, unknown>;
  source: string | null;
  created_at: string;
}

export interface ListAuditOptions {
  /**
   * Filter to actions starting with this prefix (e.g. "admin.backups"). MUST be
   * a server-controlled constant, never raw user input — it goes into a LIKE.
   */
  actionPrefix?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditPage {
  entries: AuditLogRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

const AUDIT_COLUMNS = "id, action, target_user_id, target, metadata, source, created_at";

/** Read a page of audit entries, newest first. Throws on DB error. */
export async function listAuditLog(opts: ListAuditOptions = {}): Promise<AuditPage> {
  const page = Number.isFinite(opts.page) && (opts.page ?? 0) >= 0 ? Math.floor(opts.page!) : 0;
  const pageSize = Math.min(Math.max(Math.floor(opts.pageSize ?? 50), 1), 100);
  const from = page * pageSize;
  // Inclusive range of pageSize+1 rows: the extra row tells us hasMore without
  // a separate count query.
  const to = from + pageSize;

  const admin = createAdminClient();
  // service-role: admin_audit_log is a service-role-only table.
  let query = admin
    .from("admin_audit_log")
    .select(AUDIT_COLUMNS)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (opts.actionPrefix) query = query.like("action", `${opts.actionPrefix}%`);

  const { data, error } = await query;
  if (error) throw new Error(`audit log read failed: ${error.code ?? error.message}`);

  const rows = (data ?? []) as AuditLogRow[];
  const hasMore = rows.length > pageSize;
  return { entries: hasMore ? rows.slice(0, pageSize) : rows, page, pageSize, hasMore };
}
