/**
 * /api/me — current user's profile.
 *
 * Parity with `apps/api/src/api/me.py::get_me / update_me`:
 *
 *   GET /api/me
 *     200 → {id, email, display_name, role_flags, timezone, created_at}
 *     401 → {"detail": "missing bearer token"} or {"detail": "invalid token"}
 *     404 → {"detail": "user not found"}  (also fires when deleted_at is set)
 *
 *   PATCH /api/me
 *     200 → updated UserOut
 *     400 → {"detail": <validation message>}
 *     401, 404 → same shapes as GET
 *
 * The user-scoped Supabase client passes the JWT through as the
 * `Authorization` header so PostgREST sets `request.jwt.claim.sub`
 * automatically. RLS is *not* a defense at this tier — every read
 * carries an explicit `eq("id", claims.sub)` filter (parity with the
 * Python implementation; see `apps/api/src/db/session.py` and AGENTS.md).
 */
import { z } from "zod";

import { verifyBearerWithToken } from "@/server/auth";
import { ApiError, respondError } from "@/server/errors";
import { createUserScopedClient } from "@/server/supabase";

export const dynamic = "force-dynamic";

const USER_COLUMNS = "id, email, display_name, role_flags, timezone, created_at, deleted_at" as const;

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role_flags: string[];
  timezone: string;
  created_at: string;
  deleted_at: string | null;
}

interface UserOut {
  id: string;
  email: string | null;
  display_name: string | null;
  role_flags: string[];
  timezone: string;
  created_at: string;
}

function userOut(row: UserRow): UserOut {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role_flags: row.role_flags,
    timezone: row.timezone,
    created_at: row.created_at,
  };
}

/**
 * PATCH body schema. Both fields use `.nullish()` (= `.optional().nullable()`)
 * so an explicit JSON `null` is treated identically to omitting the key — a
 * no-op update. This mirrors Python's `display_name: str | None = Field(...)`
 * where `None` short-circuits the `if payload.display_name is not None` guard
 * and the field is left untouched. Clients that send `{display_name: null}`
 * to mean "don't update" now get 200 (was 400 under the original `.optional()`).
 */
const UserUpdate = z.object({
  display_name: z.string().min(1).max(120).nullish(),
  timezone: z.string().min(1).max(64).nullish(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { claims, token } = await verifyBearerWithToken(request);
    const supabase = createUserScopedClient(token);
    const { data, error } = await supabase
      .from("users")
      .select(USER_COLUMNS)
      .eq("id", claims.sub)
      .maybeSingle<UserRow>();
    if (error) {
      throw new ApiError(500, "internal error", {}, error);
    }
    if (!data || data.deleted_at !== null) {
      throw new ApiError(404, "user not found");
    }
    return Response.json(userOut(data));
  } catch (err) {
    return respondError(err);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { claims, token } = await verifyBearerWithToken(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new ApiError(400, "invalid json body");
    }
    const parse = UserUpdate.safeParse(rawBody);
    if (!parse.success) {
      // Surface the first issue's message; matches FastAPI's "value error" terseness.
      const issue = parse.error.issues[0];
      throw new ApiError(400, issue?.message ?? "invalid body");
    }

    const supabase = createUserScopedClient(token);

    const { data: existing, error: existingErr } = await supabase
      .from("users")
      .select("id, deleted_at")
      .eq("id", claims.sub)
      .maybeSingle<{ id: string; deleted_at: string | null }>();
    if (existingErr) {
      throw new ApiError(500, "internal error", {}, existingErr);
    }
    if (!existing || existing.deleted_at !== null) {
      throw new ApiError(404, "user not found");
    }

    // Build the update payload. `.nullish()` means parse.data.<field> can be
    // `string | null | undefined`. Treat null and undefined identically — both
    // mean "don't update this field" (Python parity: `if payload.field is not None`).
    const updates: Record<string, string> = {};
    if (parse.data.display_name != null) updates.display_name = parse.data.display_name;
    if (parse.data.timezone != null) updates.timezone = parse.data.timezone;
    if (Object.keys(updates).length > 0) {
      const { error: upErr } = await supabase
        .from("users")
        .update(updates)
        .eq("id", claims.sub);
      if (upErr) {
        throw new ApiError(500, "internal error", {}, upErr);
      }
    }

    const { data: refreshed, error: refreshErr } = await supabase
      .from("users")
      .select(USER_COLUMNS)
      .eq("id", claims.sub)
      .maybeSingle<UserRow>();
    if (refreshErr || !refreshed) {
      throw new ApiError(500, "internal error", {}, refreshErr ?? "refresh returned no row");
    }
    // Re-check soft-delete on the refresh: if a concurrent admin / cascade
    // soft-deleted the row between the existence check and the refresh, return
    // 404 instead of 200. Closes the adversarial-review TOCTOU window where
    // PATCH would silently update a tombstoned row and respond 200.
    if (refreshed.deleted_at !== null) {
      throw new ApiError(404, "user not found");
    }
    return Response.json(userOut(refreshed));
  } catch (err) {
    return respondError(err);
  }
}
