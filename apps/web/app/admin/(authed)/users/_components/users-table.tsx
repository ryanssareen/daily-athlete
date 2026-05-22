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
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  function switchView(next: View) {
    setView(next);
    setPage(0);
    setSearch("");
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => switchView("active")}
          style={tabStyle(view === "active")}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => switchView("deleted")}
          style={tabStyle(view === "deleted")}
        >
          Deleted (in grace)
        </button>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder="Search name or email…"
        style={{
          width: "100%",
          maxWidth: 320,
          padding: "9px 12px",
          borderRadius: 8,
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-paper)",
          color: "var(--color-ink)",
          fontSize: 14,
          marginBottom: 16,
        }}
      />

      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : loading ? (
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>
          {view === "deleted"
            ? "No accounts are pending deletion."
            : search
              ? "No users match that search."
              : "No users yet."}
        </p>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--color-canvas-soft)" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={tdStyle}>{r.display_name ?? "—"}</td>
                  <td style={tdStyle}>{r.email ?? "—"}</td>
                  <td style={tdStyle}>
                    {view === "deleted" ? (
                      <Badge tone="warn">{`Deleting · ${daysLeft(r.deleted_at)}d left`}</Badge>
                    ) : r.disabled_at ? (
                      <Badge tone="danger">Disabled</Badge>
                    ) : (
                      <Badge tone="ok">Active</Badge>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <ModerationActions user={r} view={view} onChanged={reload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && total > PAGE_SIZE ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 14,
            fontSize: 13,
            color: "var(--color-ink-muted)",
          }}
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0}
            style={pageBtnStyle(page <= 0)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {maxPage + 1}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={page >= maxPage}
            style={pageBtnStyle(page >= maxPage)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "ok" | "danger" | "warn";
  children: React.ReactNode;
}): React.ReactElement {
  const color =
    tone === "danger"
      ? "var(--color-danger)"
      : tone === "warn"
        ? "var(--color-ink)"
        : "var(--color-ink-muted)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {children}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontWeight: 600,
  color: "var(--color-ink-muted)",
  fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: "var(--color-ink)",
};

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--color-border-strong)",
    background: "transparent",
    color: disabled ? "var(--color-ink-subtle)" : "var(--color-ink)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
  };
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 8,
    border: "1px solid var(--color-border-strong)",
    background: active ? "var(--color-ink)" : "transparent",
    color: active ? "var(--color-paper)" : "var(--color-ink)",
    cursor: "pointer",
    fontSize: 13,
  };
}
