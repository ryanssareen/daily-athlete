/**
 * GET /api/me/entitlements — caller's entitlement rows.
 *
 * Parity with `apps/api/src/api/me.py::list_entitlements`:
 *
 *   200 → [{entitlement_key, active, expires_at}]
 *   401 → {"detail": ...}  (same shapes as /me)
 *
 * Empty list when the caller has none. RLS would already bound the result to
 * the caller's rows in production, but we ALSO include an explicit
 * `eq("user_id", claims.sub)` to keep this tier's defense-in-depth posture
 * identical to Python's (see AGENTS.md "RLS posture").
 */
import { verifyBearerWithToken } from "@/server/auth";
import { ApiError, respondError } from "@/server/errors";
import { createUserScopedClient } from "@/server/supabase";

export const dynamic = "force-dynamic";

interface EntitlementRow {
  entitlement_key: string;
  active: boolean;
  expires_at: string | null;
  /** PostgREST may return additional columns; we project explicitly below. */
  [extra: string]: unknown;
}

interface EntitlementOut {
  entitlement_key: string;
  active: boolean;
  expires_at: string | null;
}

function entitlementOut(row: EntitlementRow): EntitlementOut {
  return {
    entitlement_key: row.entitlement_key,
    active: row.active,
    expires_at: row.expires_at,
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { claims, token } = await verifyBearerWithToken(request);
    const supabase = createUserScopedClient(token);
    const { data, error } = await supabase
      .from("entitlements")
      .select("entitlement_key, active, expires_at")
      .eq("user_id", claims.sub);
    if (error) {
      throw new ApiError(500, "internal error", {}, error);
    }
    const rows = (data ?? []) as EntitlementRow[];
    return Response.json(rows.map(entitlementOut));
  } catch (err) {
    return respondError(err);
  }
}
