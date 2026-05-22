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
      <section className="card">
        <div className="empty-state">
          <div className="empty-state-title">No endpoints exposed.</div>
          <div className="empty-state-desc">
            The server-side allow-list is empty.
          </div>
        </div>
      </section>
    );
  }

  const ok = result ? result.status >= 200 && result.status < 300 : false;

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-head-body">
          <div className="card-eyebrow">Request</div>
          <h2 className="card-title">Endpoint</h2>
          {selected ? <div className="card-sub">{selected.description}</div> : null}
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="btn primary"
            onClick={send}
            disabled={loading || !selected}
          >
            {loading ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      <div
        style={{ padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <label className="field" style={{ maxWidth: 360 }}>
          <span className="field-label">Endpoint</span>
          <select
            className="input"
            value={endpointId}
            onChange={(e) => pick(e.target.value)}
          >
            {endpoints.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>

        {selected && selected.params.length > 0 ? (
          <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
            {selected.params.map((p) => (
              <label className="field" key={p.name}>
                <span className="field-label">{p.label}</span>
                <input
                  className="input"
                  type={p.type === "int" ? "number" : "text"}
                  inputMode={p.type === "int" ? "numeric" : undefined}
                  value={params[p.name] ?? ""}
                  placeholder={p.placeholder}
                  onChange={(e) =>
                    setParams((prev) => ({ ...prev, [p.name]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="alert danger" role="alert">
            <span className="alert-mark">!</span>
            <div className="alert-body">
              <div className="alert-title">Request failed</div>
              <div className="alert-desc">{error}</div>
            </div>
          </div>
        ) : null}

        {result ? (
          <div>
            <div
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
            >
              <span className="field-label">Status</span>
              <span className={"status " + (ok ? "ok" : "danger")}>
                <span className="dot" />
                {result.status}
              </span>
            </div>
            <pre
              style={{
                margin: 0,
                padding: "12px 14px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-canvas-soft)",
                color: "var(--color-ink)",
                fontFamily: "var(--font-mono)",
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
    </section>
  );
}
