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
      if (res.ok) {
        router.replace("/admin");
        router.refresh();
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts. Try again in a few minutes.");
      } else if (res.status === 401) {
        setError("Incorrect password.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-scope login-page">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <div className="login-brand">
          <span className="login-mark" />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span className="login-eyebrow">Daily Athlete</span>
            <h1 className="login-title">DA2 Admin</h1>
          </div>
        </div>

        {error ? (
          <div className="alert danger" role="alert" style={{ marginBottom: 14 }}>
            <span className="alert-mark">!</span>
            <div className="alert-body">
              <div className="alert-title">Sign-in failed</div>
              <div className="alert-desc">{error}</div>
            </div>
          </div>
        ) : null}

        <div className="login-form">
          <label className="field">
            <span className="field-label">Admin password</span>
            <input
              className={"input" + (error ? " has-error" : "")}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              autoComplete="current-password"
              placeholder="••••••••••••"
            />
          </label>

          <button
            className="btn primary lg"
            type="submit"
            disabled={busy || password.length === 0}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>

        <div className="login-foot">
          <span>Operator console</span>
          <span>v2.0</span>
        </div>
      </form>
    </div>
  );
}
