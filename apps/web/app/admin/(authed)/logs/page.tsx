// /admin/logs — read-only viewer for the append-only admin audit trail. Thin
// server shell; the client table fetches /api/admin/logs (which audits each
// view). Every admin operation (backups, users, auth, playground) lands here.

import { LogsTable } from "./_components/logs-table";

export const dynamic = "force-dynamic";

export default function AdminLogsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header className="page-header">
        <div className="page-header-body">
          <div className="page-eyebrow">Operator console</div>
          <h1 className="page-title">Logs</h1>
          <p className="page-desc">
            Append-only audit trail of every admin operation — backups, users,
            auth, and API calls. Read-only.
          </p>
        </div>
      </header>

      <LogsTable />
    </div>
  );
}
