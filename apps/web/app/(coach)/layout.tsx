import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getUserWithRoles } from "@/auth/roles";
import { AppNav } from "@/components/app-nav";

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
            role="coach"
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
