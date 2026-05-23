"use client";

// Read-only audit-trail table. A filter segment scopes to a category (all /
// backups / users / playground); pagination is prev/next over the server's
// hasMore flag (the log is append-only and unbounded, so there's no cheap
// total). Mirrors the users directory's design-system markup. Handles
// loading / empty / error states; an AbortController drops superseded loads.

import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string;
  action: string;
  target_user_id: string | null;
  target: string | null;
  metadata: Record<string, unknown>;
  source: string | null;
  created_at: string;
}

type Filter = "all" | "backups" | "users" | "playground";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "backups", label: "Backups" },
  { key: "users", label: "Users" },
  { key: "playground", label: "API" },
];

const PAGE_SIZE = 50;

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

export function LogsTable() {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (f: Filter, p: number, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          filter: f,
          page: String(p),
          pageSize: String(PAGE_SIZE),
        });
        const res = await fetch(`/api/admin/logs?${params.toString()}`, { signal });
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { entries: Row[]; hasMore: boolean };
        setRows(json.entries ?? []);
        setHasMore(Boolean(json.hasMore));
        setError(null);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError("Couldn’t load logs.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(filter, page, ctrl.signal);
    return () => ctrl.abort();
  }, [filter, page, load]);

  function switchFilter(next: Filter) {
    setFilter(next);
    setPage(0);
  }

  return (
    <section className="card logs">
      <div className="card-head">
        <div className="card-head-body">
          <div className="card-eyebrow">Audit trail</div>
          <h2 className="card-title">Recent activity</h2>
        </div>
        <div className="card-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div className="seg" role="tablist" aria-label="Log filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={"btn sm" + (filter === f.key ? " primary" : "")}
                onClick={() => switchFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <div className="empty-state">
          <div className="empty-state-title">{error}</div>
          <div className="empty-state-desc">Something went wrong fetching the audit trail.</div>
          <button
            type="button"
            className="btn sm"
            style={{ marginTop: 8 }}
            onClick={() => void load(filter, page)}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="table-wrap">
          <div className="table-head">
            <div className="th">Time</div>
            <div className="th">Action</div>
            <div className="th">Target</div>
            <div className="th">Source</div>
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-bar" style={{ width: "60%" }} />
              <div className="skeleton-bar" style={{ width: "70%" }} />
              <div className="skeleton-bar" style={{ width: "40%" }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No activity yet.</div>
          <div className="empty-state-desc">
            {filter === "all"
              ? "Admin operations will appear here as they happen."
              : "No entries for this filter."}
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

          {(page > 0 || hasMore) ? (
            <div className="pagination">
              <span className="pagination-meta">
                page <strong>{page + 1}</strong>
              </span>
              <span className="pagination-ctrls">
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page <= 0}
                  aria-disabled={page <= 0}
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  aria-disabled={!hasMore}
                >
                  Next →
                </button>
              </span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
