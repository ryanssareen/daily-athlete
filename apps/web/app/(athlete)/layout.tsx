import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getUserWithRoles } from "@/auth/roles";

export default async function AthleteLayout({ children }: { children: ReactNode }) {
  const session = await getUserWithRoles();
  if (!session) {
    redirect("/sign-in");
  }
  if (!session.roles.includes("athlete")) {
    redirect("/roster");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 220,
          padding: 24,
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <h2 style={{ fontSize: 18, marginBottom: 24 }}>DA2 Athlete</h2>
        <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link href="/athlete">Today</Link>
          <Link href="/athlete/calendar">Calendar</Link>
          <Link href="/athlete/profile">Profile</Link>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 32 }}>{children}</main>
    </div>
  );
}
