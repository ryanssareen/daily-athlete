import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createClient } from "@/auth/server";

export default async function CoachLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in");
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
        <h2 style={{ fontSize: 18, marginBottom: 24 }}>DA2 Coach</h2>
        <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Link href="/roster">Roster</Link>
          <Link href="/profile">Profile</Link>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 32 }}>{children}</main>
    </div>
  );
}
