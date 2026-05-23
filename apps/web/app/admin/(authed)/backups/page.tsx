// /admin/backups — Backups page. Three sections: managed-backup status
// (read-only Supabase Management API), the on-demand export list + actions,
// and the restore runbook. Always reflects live status + records the view per
// request; never static.

import { cookies, headers } from "next/headers";

import {
  getManagedBackupStatus,
  type ManagedBackupResult,
} from "@/admin/managed-backups";
import { ADMIN_COOKIE_NAME } from "@/auth/admin-cookie";
import { clientIp, parseSessionToken } from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";

import { BackupList } from "./_components/backup-list";
import { BackupLogs } from "./_components/backup-logs";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function ManagedStatusCard({ status }: { status: ManagedBackupResult }) {
  const ok = status.state === "ok";
  const pitr = ok && status.pitrEnabled;

  return (
    <section className="card" aria-labelledby="managed-title">
      <div className="card-head">
        <div className="card-head-body">
          <div className="card-eyebrow">Section 01</div>
          <h2 id="managed-title" className="card-title">
            Managed backups
            <span className="status muted">
              <span
                className="dot"
                style={{ background: "var(--color-ink-subtle)" }}
              />
              Supabase
            </span>
          </h2>
          <div className="card-sub">
            Platform-managed nightly snapshots + point-in-time recovery.
            Read-only — the owned, downloadable copy is the on-demand export
            below.
          </div>
        </div>
        {ok ? (
          <div className="card-actions">
            <span className={"status " + (pitr ? "ok" : "off")}>
              <span className="dot" />
              {pitr ? "PITR on" : "PITR off"}
            </span>
          </div>
        ) : null}
      </div>

      {status.state === "unconfigured" ? (
        <div className="card-note">
          Not configured. Set <code>SUPABASE_MANAGEMENT_TOKEN</code> and{" "}
          <code>SUPABASE_PROJECT_REF</code> to surface managed-backup status.
        </div>
      ) : status.state === "error" ? (
        <div className="card-note" style={{ color: "var(--color-danger)" }}>
          Couldn’t load managed-backup status
          {status.status ? ` (HTTP ${status.status})` : ""}. Try again later.
        </div>
      ) : status.backupCount === 0 && !status.pitrEnabled ? (
        <div className="card-note">
          No managed backups retained (e.g. Free tier). Point-in-time recovery is{" "}
          <strong style={{ color: "var(--color-ink)" }}>off</strong> — rely on the
          on-demand export below for a restorable copy.
        </div>
      ) : (
        <div className="kv-grid">
          <div className="kv-row">
            <span className="kv-label">Point-in-time recovery</span>
            <span className="kv-value">
              <span className={"status " + (status.pitrEnabled ? "ok" : "off")}>
                <span className="dot" />
                {status.pitrEnabled ? "Enabled" : "Disabled"}
              </span>
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Region</span>
            <span className="kv-value mono">{status.region ?? "—"}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Latest backup</span>
            <span className="kv-value mono">{fmtDate(status.latestBackupAt)}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Retained snapshots</span>
            <span className="kv-value mono">{status.backupCount}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export default async function BackupsPage() {
  const status = await getManagedBackupStatus();

  const [h, c] = await Promise.all([headers(), cookies()]);
  await writeAudit({
    action: "admin.backups.status.view",
    ip: clientIp(h),
    sessionId:
      parseSessionToken(c.get(ADMIN_COOKIE_NAME)?.value)?.sessionId ?? null,
    metadata: { state: status.state },
  });

  const pitrEnabled = status.state === "ok" && status.pitrEnabled;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header className="page-header">
        <div className="page-header-body">
          <div className="page-eyebrow">Operations · Backups</div>
          <h1 className="page-title">Backups</h1>
          <p className="page-desc">
            Supabase manages nightly snapshots and point-in-time recovery. Take an
            on-demand export before risky migrations or to keep a portable copy.
          </p>
        </div>
      </header>

      <ManagedStatusCard status={status} />
      <BackupList />
      <BackupLogs />
      <RestoreSection pitrEnabled={pitrEnabled} />
    </div>
  );
}

function RestoreSection({ pitrEnabled }: { pitrEnabled: boolean }) {
  return (
    <section className="card" aria-labelledby="restore-title">
      <div className="card-head">
        <div className="card-head-body">
          <div className="card-eyebrow">Section 04 · Runbook</div>
          <h2 id="restore-title" className="card-title">
            Restore
            <span className="status warn">
              <span className="dot" />
              Read before running
            </span>
          </h2>
          <div className="card-sub">
            Restore is destructive and deliberate — a manual runbook, not an
            in-place button. Current path:{" "}
            <strong style={{ color: "var(--color-ink)" }}>
              {pitrEnabled
                ? "PITR (point-in-time, in place)"
                : "logical restore from an export"}
            </strong>
            .
          </div>
        </div>
      </div>

      <div className="runbook">
        <div className="runbook-step">
          <span className="runbook-num">01</span>
          <div className="runbook-body">
            <div className="runbook-title">Take a fresh export</div>
            <div className="runbook-desc">
              Run a new on-demand export so you can roll the rollback forward.
              Wait until it shows <code>Ready</code> in the list above.
            </div>
          </div>
        </div>

        <div className="runbook-step">
          <span className="runbook-num">02</span>
          <div className="runbook-body">
            <div className="runbook-title">Stop writes</div>
            <div className="runbook-desc">
              If the incident is ongoing, put the app in maintenance so client
              writes stop reaching the database before you restore.
            </div>
          </div>
        </div>

        <div className="runbook-step">
          <span className="runbook-num">03</span>
          <div className="runbook-body">
            <div className="runbook-title">Confirm the target, then restore</div>
            <div className="runbook-desc">
              Double-check the exact target project and the timestamp or artifact.
              {pitrEnabled
                ? " Use PITR for any point inside the retention window."
                : " Download the export above and pipe it into psql."}{" "}
              Note: <code>strava_tokens</code> is excluded from logical exports —
              Strava connections must be re-linked after a logical restore.
            </div>
          </div>
        </div>

        <div className="runbook-step">
          <span className="runbook-num">04</span>
          <div className="runbook-body">
            <div className="runbook-title">Smoke-test, then resume</div>
            <div className="runbook-desc">
              Confirm row counts match expectations, then clear maintenance. Full
              steps: <code>docs/operational/backup-restore-runbook.md</code>.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
