"use client";

// Request panel for the admin API playground. Pick an allow-listed endpoint,
// fill its params, POST to /api/admin/playground (same-origin => satisfies the
// CSRF guard), and render the live status + JSON. No URL/path is ever sent --
// only the endpoint id + params; the server maps the id to a fixed endpoint.

import { useMemo, useState } from "react";

import type { PublicEndpoint } from "@/admin/playground";

interface Result {
  status: number;
  body: unknown;
}

export function PlaygroundPanel({ endpoints }: { endpoints: PublicEndpoint[] }) {
  const [endpointId, setEndpointId] = useState(endpoints[0]?.id ?? "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => endpoints.find((e) => e.id === endpointId),
    [endpoints, endpointId]
  );

  function pick(id: string) {
    setEndpointId(id);
    setParams({});
    setResult(null);
    setError(null);
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

  if (endpoints.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>
        No endpoints are exposed.
      </p>
    );
  }

  return (
    <div>
      <label style={labelStyle} htmlFor="endpoint">
        Endpoint
      </label>
      <select
        id="endpoint"
        value={endpointId}
        onChange={(e) => pick(e.target.value)}
        style={{ ...inputStyle, maxWidth: 360 }}
      >
        {endpoints.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>

      {selected ? (
        <p style={{ margin: "8px 0 16px", fontSize: 12, color: "var(--color-ink-muted)" }}>
          {selected.description}
        </p>
      ) : null}

      {selected && selected.params.length > 0 ? (
        <div style={{ display: "grid", gap: 12, marginBottom: 16, maxWidth: 360 }}>
          {selected.params.map((p) => (
            <div key={p.name}>
              <label style={labelStyle} htmlFor={`param-${p.name}`}>
                {p.label}
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
                style={inputStyle}
              />
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={send}
        disabled={loading || !selected}
        style={{
          padding: "9px 16px",
          borderRadius: 8,
          border: "none",
          background: "var(--color-clay)",
          color: "white",
          fontSize: 14,
          fontWeight: 600,
          cursor: loading || !selected ? "not-allowed" : "pointer",
          opacity: loading || !selected ? 0.6 : 1,
        }}
      >
        {loading ? "Sending…" : "Send"}
      </button>

      {error ? (
        <p role="alert" style={{ marginTop: 16, fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              fontSize: 13,
              color: "var(--color-ink-muted)",
            }}
          >
            <span>Status</span>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                fontWeight: 600,
                fontSize: 12,
                color: "white",
                background:
                  result.status >= 200 && result.status < 300
                    ? "var(--color-clay)"
                    : "var(--color-danger)",
              }}
            >
              {result.status}
            </span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 14,
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: "var(--color-canvas-soft)",
              color: "var(--color-ink)",
              fontSize: 12.5,
              lineHeight: 1.5,
              overflow: "auto",
              maxHeight: 480,
            }}
          >
            {JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-ink-muted)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-paper)",
  color: "var(--color-ink)",
  fontSize: 14,
};
