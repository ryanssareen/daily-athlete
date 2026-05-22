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

  // .admin-scope confines the ported design's generic class names (.card,
  // .btn, .status, .table-row…) to the admin tree so they never collide with
  // the global marketing/onboarding styles. See globals.css.
  return (
    <div className="admin-scope admin-shell">
      <AdminNav />
      <main className="admin-main">
        <div className="admin-content">
          <div className="admin-container">{children}</div>
        </div>
      </main>
    </div>
  );
}
