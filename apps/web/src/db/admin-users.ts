import "server-only";

// Read-only, admin-only cross-user directory: name + email, searchable +
// paginated. A deliberate RLS-bypass exception (service-role) — callers MUST
// gate on the admin session before invoking this.
//
// Safety:
// - minimal columns only (id, display_name, email) — never role_flags/tokens.
// - deleted_at IS NULL on BOTH the row query AND the exact count (else
//   inflated totals + trailing empty pages of ghost rows).
// - stable ORDER BY (created_at, id) so offset pagination never dups/skips.
// - page size clamped server-side so a crafted pageSize can't pull the whole
//   PII set in one read.
// - search is sanitized before going into the PostgREST .or() filter string.

import { createAdminClient } from "@/db/admin";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

export interface AdminUserRow {
  id: string;
  display_name: string | null;
  email: string | null;
  // Moderation state (0018). disabled_at => login-blocked; deleted_at => in the
  // soft-delete grace window (only populated in the "deleted" view).
  disabled_at: string | null;
  deleted_at: string | null;
}

export type AdminUserStatusFilter = "active" | "deleted";

export interface AdminUsersPage {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Sanitize a search term for safe use inside a PostgREST `.or()` filter string.
 * Keeps only name/email-plausible chars, which drops the structural
 * metacharacters PostgREST uses to parse filters (comma, parens, `*`, `%`) —
 * preventing filter injection from the raw `.or()` interpolation. `_` is kept
 * (valid in emails); it acts as a single-char ilike wildcard, which is harmless
 * over-matching for a substring search.
 */
export function sanitizeSearch(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9@.\-_ ]/g, "");
}

export function clampPageSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.floor(n)), MAX_PAGE_SIZE);
}

export async function listUsers(opts: {
  search?: string;
  page?: number;
  pageSize?: number;
  /** "active" (default) lists live rows; "deleted" lists soft-deleted rows
   * (in their grace window) so the operator can restore them. */
  status?: AdminUserStatusFilter;
}): Promise<AdminUsersPage> {
  const admin = createAdminClient();
  const pageSize = clampPageSize(opts.pageSize ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(opts.page)
    ? Math.max(0, Math.floor(opts.page as number))
    : 0;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // service-role: explicit user filter required (admin cross-user read).
  // Minimal columns only — never role_flags/tokens. deleted_at filter is on
  // BOTH the row query AND the exact count (PostgREST applies it to both).
  let query = admin
    .from("users")
    .select("id, display_name, email, disabled_at, deleted_at", {
      count: "exact",
    });
  query =
    opts.status === "deleted"
      ? query.not("deleted_at", "is", null)
      : query.is("deleted_at", null);

  const search = opts.search ? sanitizeSearch(opts.search) : "";
  if (search) {
    query = query.or(
      `display_name.ilike.*${search}*,email.ilike.*${search}*`
    );
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);

  if (error) throw new Error(`listUsers failed: ${error.message}`);

  return {
    users: (data ?? []) as AdminUserRow[],
    total: count ?? 0,
    page,
    pageSize,
  };
}
