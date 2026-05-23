"use client";

// "Backup Management" card — the page's primary surface, modelled on the
// operator screenshot: an icon header with action buttons (run export, download
// latest), the restore-from-file panel, and a backup-history table. Maps the
// screenshot's columns onto da2's real on-demand exports: Users/Workouts come
// from the export's table_counts, Storage from size_bytes, Time from created_at.
// Polls while an export is in flight; delete is type-to-confirm guarded.

import { useCallback, useEffect, useState } from "react";

import { RestorePanel } from "./restore-panel";

interface Backup {
  id: string;
  status: "pending" | "running" | "success" | "failed";
  size_bytes: number | null;
  table_counts: Record<string, number> | null;
  error: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<Backup["status"], string> = {
  pending: "Queued",
  running: "Running",
  success: "Ready",
  failed: "Failed",
};

const STATUS_VARIANT: Record<Backup["status"], string> = {
  pending: "warn",
  running: "warn",
  success: "ok",
  failed: "danger",
};

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtCount(n: number | null | undefined): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const HISTORY_COLS = (
  <div className="table-head">
    <div className="th">Type</div>
    <div className="th">Time</div>
    <div className="th numeric">Users</div>
    <div className="th numeric">Workouts</div>
    <div className="th numeric">Storage</div>
    <div className="th">Status</div>
    <div className="th" style={{ textAlign: "right", justifySelf: "end" }}>
      Actions
    </div>
  </div>
);

export function BackupList() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/backups");
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as { backups: Backup[] };
      setBackups(json.backups ?? []);
      setError(null);
    } catch {
      setError("Couldn't load backups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyInFlight = backups.some(
    (b) => b.status === "pending" || b.status === "running"
  );

  // Poll while an export is in flight so it visibly resolves. Depend on the
  // boolean (not the array) so the interval isn't recreated on every poll tick.
  useEffect(() => {
    if (!anyInFlight) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [anyInFlight, load]);

  async function runExport() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/backups/export", { method: "POST" });
      if (res.status === 409) setError("An export is already running.");
      else if (!res.ok) setError("Couldn't start export.");
      else setError(null);
    } catch {
      setError("Couldn't start export.");
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function confirmDelete(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/backups/${id}`, { method: "DELETE" });
      if (!res.ok) setError("Couldn't delete backup.");
    } catch {
      setError("Couldn't delete backup.");
    } finally {
      setBusy(false);
      setConfirmId(null);
      setConfirmText("");
      void load();
    }
  }

  const latestReady = backups.find((b) => b.status === "success");
  const totalBytes = backups.reduce((a, b) => a + (b.size_bytes ?? 0), 0);

  return (
    <section className="card backups" aria-labelledby="backup-mgmt-title">
      <div className="card-head">
        <div className="bm-head-left">
          <span className="bm-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14a9 3 0 0 0 18 0V5" />
              <path d="M3 12a9 3 0 0 0 18 0" />
            </svg>
          </span>
          <div className="card-head-body">
            <h2 id="backup-mgmt-title" className="card-title">
              Backup Management
            </h2>
            <div className="card-sub">Snapshots, downloads, and recovery</div>
          </div>
        </div>
        <div className="card-actions">
          {latestReady ? (
            <a className="btn" href={`/api/admin/backups/${latestReady.id}/download`}>
              Download latest
            </a>
          ) : null}
          <button
            type="button"
            className="btn primary"
            onClick={runExport}
            disabled={busy || anyInFlight}
          >
            {anyInFlight ? "Export running…" : busy ? "Starting…" : "Run export"}
          </button>
        </div>
      </div>

      <div className="bm-body">
        <RestorePanel onRestored={load} />

        {error ? (
          <div className="alert danger" role="alert">
            <span className="alert-mark">!</span>
            <div className="alert-body">
              <div className="alert-title">Something went wrong</div>
              <div className="alert-desc">{error}</div>
            </div>
          </div>
        ) : null}

        <div className="bm-history-head">Backup history</div>
        <div className="bm-history-note">
          Full encrypted exports to private storage. Users and Workouts are the
          row counts captured at export time.
        </div>
      </div>

      <div className="table-wrap history">
        {HISTORY_COLS}

        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-bar" style={{ width: "22%" }} />
              <div className="skeleton-bar" style={{ width: "28%" }} />
              <div className="skeleton-bar" style={{ width: "10%" }} />
              <div className="skeleton-bar" style={{ width: "12%" }} />
            </div>
          ))
        ) : backups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No backups yet.</div>
            <div className="empty-state-desc">
              Run an on-demand export before your next migration — it lives in
              private storage and downloads as a single encrypted file.
            </div>
            <button
              type="button"
              className="btn primary sm"
              style={{ marginTop: 8 }}
              onClick={runExport}
              disabled={busy || anyInFlight}
            >
              Run export
            </button>
          </div>
        ) : (
          <>
            {backups.map((b) => {
              const inFlight = b.status === "pending" || b.status === "running";
              return (
                <div className="table-row" key={b.id}>
                  <div className="td">
                    <div className="td-stack">
                      <span className="primary">On-demand</span>
                      <span className="status off">
                        <span className="dot" />
                        Full
                      </span>
                    </div>
                  </div>
                  <div className="td mono" style={{ color: "var(--color-ink-muted)" }}>
                    {fmtDate(b.created_at)}
                  </div>
                  <div className="td numeric">
                    {b.status === "success" ? fmtCount(b.table_counts?.users) : "—"}
                  </div>
                  <div className="td numeric">
                    {b.status === "success"
                      ? fmtCount(b.table_counts?.completed_workouts)
                      : "—"}
                  </div>
                  <div className="td numeric">
                    {b.status === "success" ? fmtBytes(b.size_bytes) : "—"}
                  </div>
                  <div className="td">
                    <span className={"status " + STATUS_VARIANT[b.status]}>
                      <span className="dot" />
                      {STATUS_LABEL[b.status]}
                    </span>
                    {b.status === "failed" && b.error ? (
                      <span
                        style={{
                          display: "block",
                          marginTop: 4,
                          fontSize: 11,
                          color: "var(--color-ink-subtle)",
                        }}
                      >
                        {b.error}
                      </span>
                    ) : null}
                  </div>
                  <div className="td td-actions">
                    {b.status === "success" ? (
                      <a className="btn sm" href={`/api/admin/backups/${b.id}/download`}>
                        Download
                      </a>
                    ) : null}

                    {confirmId === b.id ? (
                      <>
                        <input
                          className="input"
                          style={{ width: 104, padding: "5px 8px", fontSize: 12 }}
                          value={confirmText}
                          onChange={(e) => setConfirmText(e.target.value)}
                          placeholder="type DELETE"
                          aria-label="Type DELETE to confirm"
                        />
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => confirmDelete(b.id)}
                          disabled={busy || confirmText !== "DELETE"}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={() => {
                            setConfirmId(null);
                            setConfirmText("");
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => {
                          setConfirmId(b.id);
                          setConfirmText("");
                        }}
                        disabled={inFlight}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="pagination">
              <span className="pagination-meta">
                <strong>{backups.length}</strong>{" "}
                {backups.length === 1 ? "backup" : "backups"}
                {totalBytes > 0 ? (
                  <>
                    {" "}
                    · <strong>{fmtBytes(totalBytes)}</strong> total
                  </>
                ) : null}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
