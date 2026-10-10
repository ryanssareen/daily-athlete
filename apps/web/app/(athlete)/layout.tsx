import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getUserWithRoles } from "@/auth/roles";
import { AppShell } from "@/components/app-shell";
import { TimezoneSync } from "@/components/timezone-sync";

export default async function AthleteLayout({ children }: { children: ReactNode }) {
  const session = await getUserWithRoles();
  if (!session) {
    redirect("/sign-in");
  }
  if (!session.roles.includes("athlete")) {
    redirect("/roster");
  }

  // First-time athletes get bounced into the onboarding flow until
  // athlete_profiles.manual_fields.onboarded_at is set (see
  // /api/onboarding/save). The onboarding page lives in the sibling
  // `(athlete-onboarding)` route group, so this redirect can't loop.
  if (!session.onboarded) {
    redirect("/athlete/onboarding" as Route);
  }

  const cookieStore = await cookies();
  const theme = cookieStore.get("da2-theme")?.value ?? "light";

  return (
    <>
      <TimezoneSync currentTimezone={session.timezone} />
      <AppShell role="athlete" email={session.user.email ?? ""} theme={theme}>
        {children}
      </AppShell>
    </>
  );
}
