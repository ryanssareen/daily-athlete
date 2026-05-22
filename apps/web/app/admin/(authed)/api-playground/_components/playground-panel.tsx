"use client";

// Catalog-style request panel for the admin API playground: a searchable,
// method-filtered, grouped endpoint list on the left and a request/response
// panel on the right.
//
// Scope is intentionally limited to the server-side allow-list of
// NON-DESTRUCTIVE GET endpoints -- no destructive ops, no full route catalog,
// no arbitrary request bodies. The client only ever sends an endpoint *id* +
// params to POST /api/admin/playground (same-origin => satisfies the CSRF
// guard); the server maps the id to a fixed, gated, audited handler.

import { type CSSProperties, useMemo, useState } from "react";

import type { PublicEndpoint } from "@/admin/playground";

type MethodFilter = "ALL" | "GET";
const METHOD_FILTERS: MethodFilter[] = ["ALL", "GET"];

interface Result {
  status: number;
  body: unknown;
}

export function PlaygroundPanel({ endpoints }: { endpoints: PublicEndpoint[] }) {
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<MethodFilter>("ALL");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [endpointId, setEndpointId] = useState(endpoints[0]?.id ?? "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => endpoints.find((e) => e.id === endpointId),
    [endpoints, endpointId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return endpoints.filter((e) => {
      if (method !== "ALL" && e.method !== method) return false;
      if (!q) return true;
      return `${e.path} ${e.label} ${e.description}`.toLowerCase().includes(q);
    });
  }, [endpoints, query, method]);

  const groups = useMemo(() => {
    const m = new Map<string, PublicEndpoint[]>();
    for (const e of filtered) {
      const arr = m.get(e.group);
      if (arr) arr.push(e);
      else m.set(e.group, [e]);
    }
    return Array.from(m, ([name, items]) => ({ name, items }));
  }, [filtered]);

  function pick(id: string) {
    setEndpointId(id);
    setParams({});
    setResult(null);
    setError(null);
  }

  function toggleGroup(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function send() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpointId, params }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Request failed (${res.status})`);
      }
      setResult((await res.json()) as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  const getCount = endpoints.filter((e) => e.method === "GET").length;

  return (
    <div>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={iconSquare}>
          <BoltIcon />
        </div>
        <div>
          <h1 style={titleStyle}>API Playground</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--color-ink-muted)" }}>
            {endpoints.length} endpoints · {getCount} GET · read-only · audited
          </p>
        </div>
      </header>

      <div style={layout}>
        {/* LEFT: searchable catalog */}
        <aside style={{ ...card, padding: 14 }}>
          <div style={searchWrap}>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search endpoints…"
              style={searchInput}
            />
          </div>

          <div style={pillRow}>
            {METHOD_FILTERS.map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)} style={pill(method === m)}>
                {m}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-ink-muted)", padding: "12px 6px" }}>
              No endpoints match.
            </p>
          ) : (
            groups.map((g) => {
              const open = !collapsed.has(g.name);
              return (
                <div key={g.name} style={{ marginBottom: 4 }}>
                  <button type="button" onClick={() => toggleGroup(g.name)} style={groupHeader}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--color-ink)" }}>
                        {g.name}
                      </span>
                      <span style={countBadge}>{g.items.length}</span>
                    </span>
                    <Chevron open={open} />
                  </button>
                  {open
                    ? g.items.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => pick(e.id)}
                          style={row(e.id === endpointId)}
                        >
                          <span style={methodBadge}>{e.method}</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={rowPath}>{e.path}</span>
                            <span style={rowDesc}>{e.description}</span>
                          </span>
                          <span style={authBadge}>{e.auth}</span>
                        </button>
                      ))
                    : null}
                </div>
              );
            })
          )}
        </aside>

        {/* RIGHT: request + response */}
        <section style={{ display: "grid", gap: 16, minWidth: 0 }}>
          {selected ? (
            <>
              <div style={endpointCard}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={methodBadge}>{selected.method}</span>
                  <code style={pathStyle}>{selected.path}</code>
                  <span style={{ marginLeft: "auto" }}>
                    <span style={safeBadge}>
                      <CheckIcon /> Read-only
                    </span>
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-ink)" }}>
                  {selected.label}
                </div>
                <div style={{ fontSize: 13, color: "var(--color-ink-muted)", marginTop: 2 }}>
                  {selected.description}
                </div>
                <div style={{ marginTop: 10 }}>
                  <span style={authChip}>Auth: {selected.auth}</span>
                </div>
              </div>

              <div style={card}>
                <span style={sectionLabel}>Parameters</span>
                {selected.params.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-subtle)" }}>
                    This endpoint takes no parameters.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {selected.params.map((p) => (
                      <div key={p.name}>
                        <label style={fieldLabel} htmlFor={`param-${p.name}`}>
                          {p.label} <code style={paramName}>{p.name}</code>
                        </label>
                        <input
                          id={`param-${p.name}`}
                          type={p.type === "int" ? "number" : "text"}
                          inputMode={p.type === "int" ? "numeric" : undefined}
                          value={params[p.name] ?? ""}
                          placeholder={p.placeholder}
                          onChange={(e) =>
                            setParams((prev) => ({ ...prev, [p.name]: e.target.value }))
                          }
                          style={textInput}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
                  <button type="button" onClick={send} disabled={loading} style={sendBtn(loading)}>
                    <PlayIcon /> {loading ? "Sending…" : "Send Request"}
                  </button>
                  <span style={helperText}>
                    <CheckIcon /> Read-only · runs as you · every call audited
                  </span>
                </div>
              </div>

              {error ? (
                <div style={card}>
                  <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
                    {error}
                  </p>
                </div>
              ) : result ? (
                <div style={card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <span style={{ ...sectionLabel, marginBottom: 0 }}>Response</span>
                    <span style={statusPill(result.status)}>{result.status}</span>
                  </div>
                  <pre style={preStyle}>{JSON.stringify(result.body, null, 2)}</pre>
                </div>
              ) : null}
            </>
          ) : (
            <div style={card}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-muted)" }}>
                Select an endpoint to begin.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- icons ---------- */

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden={true}>
      <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden={true}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--color-ink-subtle)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
      aria-hidden={true}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden={true}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/* ---------- styles ---------- */

const layout: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "340px minmax(0, 1fr)",
  gap: 20,
  alignItems: "start",
};

const card: CSSProperties = {
  background: "var(--color-paper)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
  padding: 18,
};

const endpointCard: CSSProperties = {
  ...card,
  background: "color-mix(in oklab, var(--color-pine) 5%, var(--color-paper))",
  borderColor: "color-mix(in oklab, var(--color-pine) 22%, var(--color-border))",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--color-ink)",
};

const iconSquare: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  background: "var(--color-clay-soft)",
  color: "var(--color-clay-deep)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const searchWrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px",
  marginBottom: 10,
  border: "1px solid var(--color-border-strong)",
  borderRadius: 10,
  background: "var(--color-canvas)",
  color: "var(--color-ink-subtle)",
};

const searchInput: CSSProperties = {
  flex: 1,
  border: "none",
  outline: "none",
  background: "transparent",
  padding: "9px 0",
  fontSize: 13.5,
  color: "var(--color-ink)",
};

const pillRow: CSSProperties = {
  display: "flex",
  gap: 4,
  padding: 3,
  marginBottom: 10,
  background: "var(--color-canvas-soft)",
  borderRadius: 10,
};

function pill(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: "6px 0",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.03em",
    background: active ? "var(--color-ink)" : "transparent",
    color: active ? "var(--color-canvas)" : "var(--color-ink-muted)",
  };
}

const groupHeader: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 6px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const countBadge: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-ink-subtle)",
  background: "var(--color-canvas-soft)",
  borderRadius: 999,
  padding: "1px 8px",
};

function row(active: boolean): CSSProperties {
  return {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "8px 9px",
    marginBottom: 2,
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    background: active ? "var(--color-clay-soft)" : "transparent",
    boxShadow: active ? "inset 3px 0 0 var(--color-clay)" : "none",
  };
}

const methodBadge: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: "3px 6px",
  borderRadius: 6,
  flexShrink: 0,
  color: "var(--color-pine)",
  background: "color-mix(in oklab, var(--color-pine) 15%, transparent)",
};

const rowPath: CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  color: "var(--color-ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const rowDesc: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--color-ink-subtle)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const authBadge: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  padding: "2px 7px",
  borderRadius: 999,
  flexShrink: 0,
  color: "var(--color-ink-muted)",
  background: "var(--color-canvas-soft)",
  border: "1px solid var(--color-border)",
};

const safeBadge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 9px",
  borderRadius: 999,
  color: "var(--color-pine)",
  background: "color-mix(in oklab, var(--color-pine) 13%, transparent)",
};

const pathStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--color-ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const authChip: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  color: "var(--color-ink-muted)",
  background: "var(--color-canvas-soft)",
  border: "1px solid var(--color-border)",
  borderRadius: 7,
  padding: "3px 8px",
};

const sectionLabel: CSSProperties = {
  display: "block",
  marginBottom: 12,
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-ink-muted)",
};

const fieldLabel: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--color-ink-muted)",
};

const paramName: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--color-ink-subtle)",
  background: "var(--color-canvas-soft)",
  borderRadius: 5,
  padding: "1px 5px",
};

const textInput: CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 9,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-canvas)",
  color: "var(--color-ink)",
  fontSize: 14,
};

function sendBtn(loading: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 18px",
    borderRadius: 10,
    border: "none",
    background: "var(--color-clay)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.65 : 1,
  };
}

const helperText: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12.5,
  color: "var(--color-pine)",
};

const preStyle: CSSProperties = {
  margin: 0,
  padding: 14,
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  background: "var(--color-canvas)",
  color: "var(--color-ink)",
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  lineHeight: 1.5,
  overflow: "auto",
  maxHeight: 460,
};

function statusPill(status: number): CSSProperties {
  const ok = status >= 200 && status < 300;
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 700,
    padding: "2px 10px",
    borderRadius: 999,
    color: ok ? "var(--color-pine)" : "var(--color-danger)",
    background: ok
      ? "color-mix(in oklab, var(--color-pine) 14%, transparent)"
      : "color-mix(in oklab, var(--color-danger) 13%, transparent)",
  };
}
