import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/auth/server";

export type Role = "athlete" | "coach";

export type UserWithRoles = {
  user: User;
  roles: Role[];
  timezone: string;
};

export async function getUserWithRoles(): Promise<UserWithRoles | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("role_flags, timezone")
    .eq("id", user.id)
    .maybeSingle();

  const roles = (data?.role_flags ?? ["athlete"]) as Role[];
  const timezone = (data?.timezone as string | null) ?? "UTC";
  return { user, roles, timezone };
}

// Return a literal union so callers using `redirect()` under Next.js'
// typedRoutes get a `Route`-assignable value (a bare `string` no longer
// satisfies redirect/Link in Next.js 15.5+).
export function landingPathForRoles(roles: Role[]): "/roster" | "/athlete" {
  if (roles.includes("coach")) return "/roster";
  return "/athlete";
}
