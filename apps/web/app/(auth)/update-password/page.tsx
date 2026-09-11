"use client";

import { useState } from "react";

import { createClient } from "@/auth/supabase";

type Status = "idle" | "saving" | "saved" | "error";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setErrorMsg("Passwords don't match.");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("saved");
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-3">
          Set a new password.
        </h1>

        {status === "saved" ? (
          <>
            <p className="text-[color:var(--color-ink-muted)] mb-8">
              Your password has been updated.
            </p>
            <a href="/" className="btn btn-primary w-full justify-center inline-flex">
              Continue
            </a>
          </>
        ) : (
          <>
            <p className="text-[color:var(--color-ink-muted)] mb-8">
              Choose a new password for your account.
            </p>

            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label htmlFor="password" className="sr-only">New password</label>
              <input
                id="password"
                type="password"
                value={password}
                required
                minLength={8}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                autoFocus
                className="px-4 py-3.5 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-paper)] text-base focus:outline-none focus:border-[color:var(--color-ink)] transition"
              />

              <label htmlFor="confirmPassword" className="sr-only">Confirm new password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                required
                minLength={8}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                className="px-4 py-3.5 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-paper)] text-base focus:outline-none focus:border-[color:var(--color-ink)] transition"
              />

              <button
                type="submit"
                disabled={status === "saving" || !password || !confirmPassword}
                className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "saving" ? "Working…" : "Update password"}
              </button>

              {status === "error" && errorMsg && (
                <p className="mt-1 text-sm text-[color:var(--color-danger)]">{errorMsg}</p>
              )}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
