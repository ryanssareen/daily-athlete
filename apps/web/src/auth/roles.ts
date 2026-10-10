import "server-only";

import { cache } from "react";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

export type Role = "athlete" | "coach";

export type UserWithRoles = {
  user: User;
  roles: Role[];
  timezone: string;
  onboarded: boolean;
};

// Both the (athlete)/(coach) layouts AND the page they wrap call this on
// every request (22 call sites) -- each call did its own auth.getUser()
// network round trip + `users` table query. React's per-request cache()
// dedupes those into one call for the whole render pass, so a layout+page
// pair costs one auth check instead of two.
export const getUserWithRoles = cache(async (): Promise<UserWithRoles | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Independent queries -- run together so the layout pays one round trip
  // to the DB region instead of two in series.
  const [{ data }, { data: profileRow }] = await Promise.all([
    supabase
      .from("users")
      .select("role_flags, timezone")
      .eq("id", user.id)
      .maybeSingle(),
    // service-role: explicit user filter required
    createAdminClient()
      .from("athlete_profiles")
      .select("manual_fields")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const roles = (data?.role_flags ?? ["athlete"]) as Role[];
  const timezone = (data?.timezone as string | null) ?? "UTC";
  const manualFields = (profileRow?.manual_fields ?? {}) as Record<string, unknown>;
  const onboarded = typeof manualFields.onboarded_at === "string";
  return { user, roles, timezone, onboarded };
});

// Return a literal union so callers using `redirect()` under Next.js'
// typedRoutes get a `Route`-assignable value (a bare `string` no longer
// satisfies redirect/Link in Next.js 15.5+).
export function landingPathForRoles(roles: Role[]): "/roster" | "/athlete" {
  if (roles.includes("coach")) return "/roster";
  return "/athlete";
}
