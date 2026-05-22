// /admin/users — user directory + moderation. Thin server shell; the client
// table fetches /api/admin/users (which audits each view) and posts moderation
// actions to /api/admin/users/[id]/moderation.

import { UsersTable } from "./_components/users-table";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--color-ink)" }}>
        Users
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-ink-muted)" }}>
        Directory by name and email. Disable blocks sign-in; delete soft-deletes
        with a 30-day grace window and can be restored.
      </p>
      <UsersTable />
    </div>
  );
}
