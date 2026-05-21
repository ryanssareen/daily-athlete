// Authenticated admin shell. The (authed) route group lets /admin/login live
// OUTSIDE this gate (no redirect-to-self loop) while /admin, /admin/backups,
// and /admin/users render inside it. This layout is the authoritative session
// gate (middleware only checks cookie presence at the Edge).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ADMIN_COOKIE_NAME, ADMIN_LOGIN_PATH } from "@/auth/admin-cookie";
import { verifyAdminSession } from "@/auth/admin-session";

import { AdminNav } from "./_components/admin-nav";

export default async function AdminAuthedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const store = await cookies();
  const { valid } = await verifyAdminSession(store.get(ADMIN_COOKIE_NAME)?.value);
  if (!valid) redirect(ADMIN_LOGIN_PATH);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-canvas)",
      }}
    >
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
        }}
      >
        <div
          style={{
            padding: "20px 16px 16px",
            borderBottom: "1px solid var(--color-border)",
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: "-0.02em",
            color: "var(--color-ink)",
          }}
        >
          DA2 Admin
        </div>
        <div style={{ flex: 1 }}>
          <AdminNav />
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: 32 }}>{children}</main>
    </div>
  );
}
