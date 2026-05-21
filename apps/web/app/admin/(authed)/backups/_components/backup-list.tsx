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
  running: "Running…",
  success: "Ready",
  failed: "Failed",
};

const STATUS_COLOR: Record<Backup["status"], string> = {
  pending: "var(--color-ink-muted)",
  running: "var(--color-clay)",
  success: "var(--color-pine)",
  failed: "var(--color-danger)",
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

  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-paper)",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-muted)" }}>
          Encrypted full-data exports to private storage.
        </p>
        <button
          type="button"
          onClick={runExport}
          disabled={busy || anyInFlight}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: "var(--color-clay)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || anyInFlight ? "not-allowed" : "pointer",
            opacity: busy || anyInFlight ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {anyInFlight ? "Export running…" : "Run export"}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-danger)" }}
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-muted)" }}>
          Loading…
        </p>
      ) : backups.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-muted)" }}>
          No exports yet. Run one to create a downloadable backup.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {backups.map((b) => (
            <li
              key={b.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 0",
                borderTop: "1px solid var(--color-border)",
                fontSize: 13,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--color-ink)" }}>
                  {fmtDate(b.created_at)}
                </div>
                <div style={{ color: "var(--color-ink-muted)", fontSize: 12 }}>
                  <span style={{ color: STATUS_COLOR[b.status], fontWeight: 600 }}>
                    {STATUS_LABEL[b.status]}
                  </span>
                  {b.status === "success" ? ` · ${fmtBytes(b.size_bytes)}` : ""}
                  {b.status === "failed" && b.error ? ` · ${b.error}` : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {b.status === "success" ? (
                  <a
                    href={`/api/admin/backups/${b.id}/download`}
                    style={{
                      fontSize: 13,
                      color: "var(--color-clay)",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    Download
                  </a>
                ) : null}

                {confirmId === b.id ? (
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="type DELETE"
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--color-border-strong)",
                        background: "var(--color-canvas)",
                        color: "var(--color-ink)",
                        fontSize: 12,
                        width: 110,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => confirmDelete(b.id)}
                      disabled={busy || confirmText !== "DELETE"}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "none",
                        background: "var(--color-danger)",
                        color: "white",
                        fontSize: 12,
                        cursor:
                          busy || confirmText !== "DELETE"
                            ? "not-allowed"
                            : "pointer",
                        opacity: busy || confirmText !== "DELETE" ? 0.6 : 1,
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmId(null);
                        setConfirmText("");
                      }}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--color-border-strong)",
                        background: "transparent",
                        color: "var(--color-ink-muted)",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmId(b.id);
                      setConfirmText("");
                    }}
                    disabled={b.status === "pending" || b.status === "running"}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--color-border-strong)",
                      background: "transparent",
                      color: "var(--color-ink-muted)",
                      fontSize: 12,
                      cursor:
                        b.status === "pending" || b.status === "running"
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
