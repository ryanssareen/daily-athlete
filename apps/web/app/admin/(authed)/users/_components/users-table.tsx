"use client";

// Search + paginated table for the user directory. Debounced search resets to
// page 0; pagination is prev/next over the server's exact total. Handles
// loading / empty / error states.

import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string;
  display_name: string | null;
  email: string | null;
}

const PAGE_SIZE = 25;

export function UsersTable() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: String(PAGE_SIZE),
      });
      if (q) params.set("q", q);
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as { users: Row[]; total: number };
      setRows(json.users ?? []);
      setTotal(json.total ?? 0);
      setError(null);
    } catch {
      setError("Couldn't load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search; any [search, page] change reloads. Searching resets to
  // page 0 via the input handler so we never query a stale offset.
  useEffect(() => {
    const t = setTimeout(() => void load(search, page), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, page, load]);

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div>
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
          {search ? "No users match that search." : "No users yet."}
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={tdStyle}>{r.display_name ?? "—"}</td>
                  <td style={tdStyle}>{r.email ?? "—"}</td>
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
