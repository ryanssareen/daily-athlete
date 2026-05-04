import type { User } from "@supabase/supabase-js";

import { createClient } from "@/auth/server";

export type Role = "athlete" | "coach";

export type UserWithRoles = {
  user: User;
  roles: Role[];
};

export async function getUserWithRoles(): Promise<UserWithRoles | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("role_flags")
    .eq("id", user.id)
    .maybeSingle();

  const roles = (data?.role_flags ?? ["athlete"]) as Role[];
  return { user, roles };
}

export function landingPathForRoles(roles: Role[]): string {
  if (roles.includes("coach")) return "/roster";
  return "/athlete";
}
