import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getUserWithRoles } from "@/auth/roles";
import { AppShell } from "@/components/app-shell";

export default async function CoachLayout({ children }: { children: ReactNode }) {
  const session = await getUserWithRoles();
  if (!session) {
    redirect("/sign-in");
  }
  if (!session.roles.includes("coach")) {
    redirect("/athlete");
  }

  const cookieStore = await cookies();
  const theme = cookieStore.get("da2-theme")?.value ?? "light";

  return (
    <AppShell role="coach" email={session.user.email ?? ""} theme={theme}>
      {children}
    </AppShell>
  );
}
