import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getUserWithRoles } from "@/auth/roles";

// Sibling route group to `(athlete)` so the onboarding flow doesn't
// inherit the dashboard sidebar. Same auth posture: athlete-only, signed
// in. Coach users are bounced to /roster the same as in the dashboard
// layout.
export default async function AthleteOnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getUserWithRoles();
  if (!session) {
    redirect("/sign-in");
  }
  if (!session.roles.includes("athlete")) {
    redirect("/roster");
  }

  return <>{children}</>;
}
