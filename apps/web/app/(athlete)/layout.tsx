import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getUserWithRoles } from "@/auth/roles";
import { AppShell } from "@/components/app-shell";
import { createAdminClient } from "@/db/admin";

export default async function AthleteLayout({ children }: { children: ReactNode }) {
  const session = await getUserWithRoles();
  if (!session) {
    redirect("/sign-in");
  }
  if (!session.roles.includes("athlete")) {
    redirect("/roster");
  }

  // First-time athletes get bounced into the onboarding flow until they
  // mark it complete. We look at athlete_profiles.manual_fields.onboarded_at
  // as the single source of truth — see /api/onboarding/save. The
  // onboarding page lives in the sibling `(athlete-onboarding)` route
  // group so it does NOT inherit this layout, which means the redirect
  // can't loop on itself.
  const admin = createAdminClient();
  // service-role: explicit user filter required
  const { data: profileRow } = await admin
    .from("athlete_profiles")
    .select("manual_fields")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const manualFields = (profileRow?.manual_fields ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof manualFields.onboarded_at !== "string") {
    redirect("/athlete/onboarding" as Route);
  }

  const cookieStore = await cookies();
  const theme = cookieStore.get("da2-theme")?.value ?? "light";

  return (
    <AppShell role="athlete" email={session.user.email ?? ""} theme={theme}>
      {children}
    </AppShell>
  );
}
