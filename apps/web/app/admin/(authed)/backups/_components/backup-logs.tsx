"use client";

// Backup activity log on the backups page: the recent backup-scoped slice of
// the admin audit trail (exports, downloads, deletes, status checks). Fetches
// the existing, gated, audited /api/admin/logs?filter=backups endpoint — the
// same data the dedicated /admin/logs page shows, narrowed to backups. Read
// only; handles loading / empty / error.

import Link from "next/link";
import { useEffect, useState } from "react";

interface Row {
  id: string;
  action: string;
  target_user_id: string | null;
  target: string | null;
  metadata: Record<string, unknown>;
  source: string | null;
  created_at: string;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtMeta(meta: Record<string, unknown>): string {
  const keys = Object.keys(meta ?? {});
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = meta[k];
      return `${k}=${v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)}`;
    })
    .join(" · ");
}

export function BackupLogs() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/logs?filter=backups&pageSize=15", {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { entries: Row[] };
        setRows(json.entries ?? []);
        setError(null);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError("Couldn’t load backup activity.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

  return (
    <section className="card logs" aria-labelledby="backup-activity-title">
      <div className="card-head">
        <div className="card-head-body">
          <div className="card-eyebrow">Activity</div>
          <h2 id="backup-activity-title" className="card-title">
            Backup activity
          </h2>
          <div className="card-sub">
            Recent backup operations from the audit trail — exports, downloads,
            deletes, and status checks.
          </div>
        </div>
        <div className="card-actions">
          <Link href="/admin/logs" className="btn sm ghost">
            All logs →
          </Link>
        </div>
      </div>

      {error ? (
        <div className="empty-state">
          <div className="empty-state-title">{error}</div>
          <div className="empty-state-desc">
            Something went wrong fetching the backup activity.
          </div>
        </div>
      ) : loading ? (
        <div className="table-wrap">
          <div className="table-head">
            <div className="th">Time</div>
            <div className="th">Action</div>
            <div className="th">Target</div>
            <div className="th">Source</div>
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-bar" style={{ width: "55%" }} />
              <div className="skeleton-bar" style={{ width: "65%" }} />
              <div className="skeleton-bar" style={{ width: "35%" }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No backup activity yet.</div>
          <div className="empty-state-desc">
            Exports, downloads, and deletes will appear here as they happen.
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-head">
            <div className="th">Time</div>
            <div className="th">Action</div>
            <div className="th">Target</div>
            <div className="th">Source</div>
          </div>
          {rows.map((r) => {
            const meta = fmtMeta(r.metadata);
            return (
              <div className="table-row" key={r.id}>
                <div className="td mono" style={{ color: "var(--color-ink-muted)", fontSize: 13 }}>
                  {fmtTime(r.created_at)}
                </div>
                <div className="td td-stack">
                  <span className="primary mono" style={{ fontSize: 13 }}>{r.action}</span>
                  {meta ? <span className="secondary">{meta}</span> : null}
                </div>
                <div className="td mono" style={{ color: "var(--color-ink-muted)", fontSize: 13 }}>
                  {r.target ?? r.target_user_id ?? "—"}
                </div>
                <div className="td mono" style={{ color: "var(--color-ink-subtle)", fontSize: 12.5 }}>
                  {r.source ?? "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
