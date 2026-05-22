// /admin/users — user directory + moderation. Thin server shell; the client
// table fetches /api/admin/users (which audits each view) and posts moderation
// actions to /api/admin/users/[id]/moderation.

import { UsersTable } from "./_components/users-table";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header className="page-header">
        <div className="page-header-body">
          <div className="page-eyebrow">Console · Users</div>
          <h1 className="page-title">Users</h1>
          <p className="page-desc">
            Directory by name and email. Disable blocks sign-in; delete
            soft-deletes with a 30-day grace window and can be restored.
          </p>
        </div>
      </header>

      <UsersTable />
    </div>
  );
}
