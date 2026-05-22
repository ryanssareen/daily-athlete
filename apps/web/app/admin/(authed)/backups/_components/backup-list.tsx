"use client";

// Export list + actions for the backups page: trigger an export, watch it
// resolve (polls while in-flight), download (streams through the session), and
// delete with a type-to-confirm guard. Handles loading / empty / error states.

import { useCallback, useEffect, useState } from "react";

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

// Map export status onto the design's status-pill variants.
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

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
      setError("Couldn't load exports.");
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
  // boolean, not the array, so the interval isn't torn down/recreated on every
  // poll tick (each fetch returns a fresh array reference).
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
      if (!res.ok) setError("Couldn't delete export.");
    } catch {
      setError("Couldn't delete export.");
    } finally {
      setBusy(false);
      setConfirmId(null);
      setConfirmText("");
      void load();
    }
  }

  const runLabel = anyInFlight
    ? "Export running…"
    : busy
      ? "Starting…"
      : "Run export now";
  const totalBytes = backups.reduce((a, b) => a + (b.size_bytes ?? 0), 0);

  return (
    <section className="card exports" aria-labelledby="exports-title">
      <div className="card-head">
        <div className="card-head-body">
          <div className="card-eyebrow">Section 02</div>
          <h2 id="exports-title" className="card-title">
            On-demand exports
          </h2>
          <div className="card-sub">
            Encrypted full-data exports to private storage. Keep one before any
            destructive migration.
          </div>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="btn primary"
            onClick={runExport}
            disabled={busy || anyInFlight}
          >
            {runLabel}
          </button>
        </div>
      </div>

      {error ? (
        <div
          className="alert danger"
          role="alert"
          style={{ margin: "16px 22px 0" }}
        >
          <span className="alert-mark">!</span>
          <div className="alert-body">
            <div className="alert-title">Something went wrong</div>
            <div className="alert-desc">{error}</div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="table-wrap">
          <div className="table-head">
            <div className="th">Export</div>
            <div className="th">Size</div>
            <div className="th">Status</div>
            <div className="th">Created</div>
            <div className="th" style={{ textAlign: "right", justifySelf: "end" }}>
              Actions
            </div>
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-bar" style={{ width: "32%" }} />
              <div className="skeleton-bar" style={{ width: "10%" }} />
              <div className="skeleton-bar" style={{ width: "12%" }} />
              <div className="skeleton-bar" style={{ width: "18%" }} />
            </div>
          ))}
        </div>
      ) : backups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No exports yet.</div>
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
            Run export now
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-head">
            <div className="th">Export</div>
            <div className="th">Size</div>
            <div className="th">Status</div>
            <div className="th">Created</div>
            <div className="th" style={{ textAlign: "right", justifySelf: "end" }}>
              Actions
            </div>
          </div>

          {backups.map((b) => {
            const inFlight = b.status === "pending" || b.status === "running";
            return (
              <div className="table-row" key={b.id}>
                <div className="td">
                  <div className="td-stack">
                    <span className="primary">Database export</span>
                    <span className="secondary">{b.id}</span>
                  </div>
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
                <div className="td mono" style={{ color: "var(--color-ink-muted)" }}>
                  {fmtDate(b.created_at)}
                </div>
                <div className="td td-actions">
                  {b.status === "success" ? (
                    <a
                      className="btn sm"
                      href={`/api/admin/backups/${b.id}/download`}
                    >
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
              {backups.length === 1 ? "export" : "exports"}
              {totalBytes > 0 ? (
                <>
                  {" "}
                  · <strong>{fmtBytes(totalBytes)}</strong> total
                </>
              ) : null}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
