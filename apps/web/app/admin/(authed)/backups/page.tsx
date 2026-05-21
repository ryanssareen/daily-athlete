// /admin/backups — Backups page. Unit 3 renders the managed-backup status
// section (read-only Supabase Management API). Units 4-6 add the on-demand
// export list, actions, and the restore runbook to this page.

import { cookies, headers } from "next/headers";

import {
  getManagedBackupStatus,
  type ManagedBackupResult,
} from "@/admin/managed-backups";
import { ADMIN_COOKIE_NAME } from "@/auth/admin-cookie";
import { clientIp, parseSessionToken } from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";

import { BackupList } from "./_components/backup-list";

// Always reflect live status + record the view per request; never static.
export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "6px 0",
        fontSize: 14,
      }}
    >
      <span style={{ color: "var(--color-ink-muted)" }}>{label}</span>
      <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function ManagedStatusCard({ status }: { status: ManagedBackupResult }) {
  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-paper)",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 16, color: "var(--color-ink)" }}>
        Managed backups (Supabase)
      </h2>
      <p
        style={{
          margin: "0 0 14px",
          fontSize: 13,
          color: "var(--color-ink-muted)",
        }}
      >
        Platform-managed backups &amp; point-in-time recovery. Read-only — the
        owned, downloadable backup is the on-demand export below.
      </p>

      {status.state === "unconfigured" ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-muted)" }}>
          Not configured. Set <code>SUPABASE_MANAGEMENT_TOKEN</code> and{" "}
          <code>SUPABASE_PROJECT_REF</code> to surface managed-backup status.
        </p>
      ) : status.state === "error" ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          Couldn&apos;t load managed-backup status
          {status.status ? ` (HTTP ${status.status})` : ""}. Try again later.
        </p>
      ) : status.backupCount === 0 && !status.pitrEnabled ? (
        <div>
          <Row label="Point-in-time recovery" value="Off" />
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 13,
              color: "var(--color-ink-muted)",
            }}
          >
            No managed backups retained (e.g. Free tier). Rely on the on-demand
            export below for a restorable copy.
          </p>
        </div>
      ) : (
        <div>
          <Row
            label="Point-in-time recovery"
            value={status.pitrEnabled ? "On" : "Off"}
          />
          <Row label="Region" value={status.region ?? "—"} />
          <Row label="Latest backup" value={fmtDate(status.latestBackupAt)} />
          <Row label="Retained backups" value={String(status.backupCount)} />
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

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 22, color: "var(--color-ink)" }}>
        Backups
      </h1>
      <ManagedStatusCard status={status} />

      <section style={{ marginTop: 28 }}>
        <h2
          style={{ margin: "0 0 12px", fontSize: 16, color: "var(--color-ink)" }}
        >
          On-demand exports
        </h2>
        <BackupList />
      </section>
    </div>
  );
}
