import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getUserWithRoles } from "@/auth/roles";
import { AppNav } from "@/components/app-nav";
import { createAdminClient } from "@/db/admin";

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }}>
      <span
        style={{
          display: "inline-block",
          width: 28,
          height: 28,
          borderRadius: "50%",
          background:
            "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <span
        style={{
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: "-0.02em",
          color: "var(--color-ink)",
        }}
      >
        DA2
      </span>
    </div>
  );
}

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
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas)" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: "var(--color-paper)",
          borderRight: "1px solid var(--color-border)",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            padding: "20px 16px 16px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <Wordmark />
        </div>

        {/* Nav */}
        <div style={{ flex: 1 }}>
          <AppNav
            role="athlete"
            email={session.user.email ?? ""}
            theme={theme}
          />
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0, padding: 32 }}>{children}</main>
    </div>
  );
}
