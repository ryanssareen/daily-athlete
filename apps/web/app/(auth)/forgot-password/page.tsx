"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";

import { createClient } from "@/auth/supabase";

type Status = "idle" | "sending" | "sent" | "error";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    const supabase = createClient();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/update-password")}`,
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-3">
          Reset your password.
        </h1>

        {status === "sent" ? (
          <p className="text-[color:var(--color-ink-muted)]">
            If an account exists for <span className="font-medium">{email}</span>, we&apos;ve
            sent a link to reset your password.
          </p>
        ) : (
          <>
            <p className="text-[color:var(--color-ink-muted)] mb-8">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>

            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <label htmlFor="email" className="sr-only">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                className="px-4 py-3.5 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-paper)] text-base focus:outline-none focus:border-[color:var(--color-ink)] transition"
              />

              <button
                type="submit"
                disabled={status === "sending" || !email}
                className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "sending" ? "Working…" : "Send reset link"}
              </button>

              {status === "error" && errorMsg && (
                <p className="mt-1 text-sm text-[color:var(--color-danger)]">{errorMsg}</p>
              )}
            </form>
          </>
        )}

        <p className="mt-6 text-sm text-[color:var(--color-ink-muted)]">
          <Link
            href={"/sign-in" as Route}
            className="underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)] hover:text-[color:var(--color-ink)] transition"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
