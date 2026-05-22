"use client";

// Search + paginated user directory with moderation. A view toggle switches
// between the active directory and the soft-deleted "grace window" list (where
// rows can be restored). Per-row actions live in <ModerationActions>. Debounced
// search resets to page 0; pagination is prev/next over the server's exact
// total; a completed action bumps a refresh key to reload the current view.

import { useCallback, useEffect, useState } from "react";

import { ModerationActions } from "./moderation-actions";

interface Row {
  id: string;
  display_name: string | null;
  email: string | null;
  disabled_at: string | null;
  deleted_at: string | null;
}

type View = "active" | "deleted";

const PAGE_SIZE = 25;
const GRACE_DAYS = 30;

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return 0;
  const purgeMs =
    new Date(deletedAt).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeMs - Date.now()) / (24 * 60 * 60 * 1000)));
}

function StatusPill({ row, view }: { row: Row; view: View }) {
  if (view === "deleted") {
    return (
      <span className="status warn">
        <span className="dot" />
        Deleting · {daysLeft(row.deleted_at)}d
      </span>
    );
  }
  if (row.disabled_at) {
    return (
      <span className="status danger">
        <span className="dot" />
        Disabled
      </span>
    );
  }
  return (
    <span className="status ok">
      <span className="dot" />
      Active
    </span>
  );
}

export function UsersTable() {
  const [view, setView] = useState<View>("active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(
    async (v: View, q: string, p: number, signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          pageSize: String(PAGE_SIZE),
          status: v,
        });
        if (q) params.set("q", q);
        const res = await fetch(`/api/admin/users?${params.toString()}`, {
          signal,
        });
        if (!res.ok) throw new Error("load failed");
        const json = (await res.json()) as { users: Row[]; total: number };
        setRows(json.users ?? []);
        setTotal(json.total ?? 0);
        setError(null);
      } catch (e) {
        // A superseded request was aborted by the cleanup — ignore it so a
        // slow earlier response can't overwrite a newer one (last-wins race).
        if ((e as Error)?.name === "AbortError") return;
        setError("Couldn't load users.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    []
  );

  // Debounce search; any [view, search, page, refreshKey] change reloads.
  // Searching / switching views resets to page 0 via the handlers so we never
  // query a stale offset. The AbortController cancels an in-flight request when
  // a newer one supersedes it.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(
      () => void load(view, search, page, ctrl.signal),
      search ? 350 : 0
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [view, search, page, refreshKey, load]);

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const start = page * PAGE_SIZE;
  const showingTo = Math.min(start + PAGE_SIZE, total);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  function switchView(next: View) {
    setView(next);
    setPage(0);
    setSearch("");
  }

  return (
    <section className="card users">
      <div className="card-head">
        <div className="card-head-body">
          <div className="card-eyebrow">
            {view === "deleted" ? "Grace window" : "Directory"}
          </div>
          <h2 className="card-title">
            {view === "deleted" ? "Pending deletion" : "All accounts"}
          </h2>
        </div>
        <div
          className="card-actions"
          style={{ flexWrap: "wrap", justifyContent: "flex-end" }}
        >
          <div className="seg" role="tablist" aria-label="User view">
            <button
              type="button"
              role="tab"
              aria-selected={view === "active"}
              className={"btn sm" + (view === "active" ? " primary" : "")}
              onClick={() => switchView("active")}
            >
              Active
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "deleted"}
              className={"btn sm" + (view === "deleted" ? " primary" : "")}
              onClick={() => switchView("deleted")}
            >
              Deleted
            </button>
          </div>
          <label className="search">
            <span className="search-glyph">/</span>
            <input
              className="input"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search name or email"
            />
          </label>
        </div>
      </div>

      {error ? (
        <div className="empty-state">
          <div className="empty-state-title">Couldn’t load users.</div>
          <div className="empty-state-desc">
            Something went wrong fetching the directory. Try again in a moment.
          </div>
          <button
            type="button"
            className="btn sm"
            style={{ marginTop: 8 }}
            onClick={() => void load(view, search, page)}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="table-wrap">
          <div className="table-head">
            <div className="th">Name</div>
            <div className="th">Email</div>
            <div className="th">Status</div>
            <div className="th" style={{ textAlign: "right", justifySelf: "end" }}>
              Actions
            </div>
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-bar" style={{ width: "34%" }} />
              <div className="skeleton-bar" style={{ width: "44%" }} />
              <div className="skeleton-bar" style={{ width: "16%" }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">
            {view === "deleted" ? "Nothing pending deletion." : "No matches."}
          </div>
          <div className="empty-state-desc">
            {view === "deleted"
              ? "No accounts are in the 30-day grace window."
              : search
                ? `Nothing matches “${search}”. Try a different name or email.`
                : "No users yet."}
          </div>
          {search && view === "active" ? (
            <button
              type="button"
              className="btn sm"
              style={{ marginTop: 8 }}
              onClick={() => setSearch("")}
            >
              Clear search
            </button>
          ) : null}
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-head">
            <div className="th">Name</div>
            <div className="th">Email</div>
            <div className="th">Status</div>
            <div className="th" style={{ textAlign: "right", justifySelf: "end" }}>
              Actions
            </div>
          </div>
          {rows.map((r) => (
            <div className="table-row" key={r.id}>
              <div className="td">{r.display_name ?? "—"}</div>
              <div
                className="td mono"
                style={{ color: "var(--color-ink-muted)", fontSize: 13 }}
              >
                {r.email ?? "—"}
              </div>
              <div className="td">
                <StatusPill row={r} view={view} />
              </div>
              <div className="td td-actions">
                <ModerationActions user={r} view={view} onChanged={reload} />
              </div>
            </div>
          ))}

          {total > PAGE_SIZE ? (
            <div className="pagination">
              <span className="pagination-meta">
                <strong>
                  {start + 1}–{showingTo}
                </strong>{" "}
                of <strong>{total.toLocaleString()}</strong>
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
                <span className="pagination-meta" style={{ padding: "0 4px" }}>
                  page <strong>{page + 1}</strong> / {maxPage + 1}
                </span>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                  disabled={page >= maxPage}
                  aria-disabled={page >= maxPage}
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
