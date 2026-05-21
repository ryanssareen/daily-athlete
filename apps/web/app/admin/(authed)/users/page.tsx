// /admin/users — read-only user directory. Thin server shell; the client
// table fetches /api/admin/users (which audits each view).

import { UsersTable } from "./_components/users-table";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--color-ink)" }}>
        Users
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-ink-muted)" }}>
        Read-only directory by name and email.
      </p>
      <UsersTable />
    </div>
  );
}
