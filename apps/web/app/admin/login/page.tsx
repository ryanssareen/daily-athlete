"use client";

// Admin login page (/admin/login). Lives OUTSIDE the (authed) group so the
// session gate doesn't redirect it to itself. Posts the shared password to
// /api/admin/login; the browser stamps Sec-Fetch-Site: same-origin, which the
// route's CSRF guard requires.

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => null);
      console.log("[admin-login] response", res.status, body);
      if (res.ok) {
        router.replace("/admin");
        router.refresh();
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts. Try again in a few minutes.");
      } else if (res.status === 401) {
        setError("Incorrect password.");
      } else if (body?.debug) {
        setError(`[${body.debug.phase}] ${body.debug.message}`);
      } else {
        setError(`Error ${res.status}: ${JSON.stringify(body)}`);
      }
    } catch (err) {
      console.error("[admin-login] request failed", err);
      setError(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-canvas)",
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--color-paper)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: "var(--color-ink)" }}>
            DA2 Admin
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--color-ink-muted)",
            }}
          >
            Enter the operator password to continue.
          </p>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-canvas)",
              color: "var(--color-ink)",
              fontSize: 14,
            }}
          />
        </label>

        {error ? (
          <p
            role="alert"
            style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            background: "var(--color-clay)",
            color: "white",
            fontSize: 14,
            fontWeight: 600,
            cursor: busy || password.length === 0 ? "not-allowed" : "pointer",
            opacity: busy || password.length === 0 ? 0.6 : 1,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
