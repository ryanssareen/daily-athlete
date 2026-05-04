"use client";

import Link from "next/link";
import { useState } from "react";

import { ArrowLeft, Mail } from "lucide-react";

import { createClient } from "@/auth/supabase";

const SITE_URL = "https://da2-one.vercel.app";
const ROSTER_PATH = "/roster";

type Mode = "password" | "signup" | "magic";
type Status = "idle" | "sending" | "sent" | "error";

export default function SignInPage() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    const supabase = createClient();

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(ROSTER_PATH)}`,
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setStatus("error");
      } else {
        setStatus("sent");
      }
      return;
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(ROSTER_PATH)}`,
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setStatus("error");
      } else if (data.session) {
        // Email confirmation is disabled — user is already signed in.
        window.location.href = ROSTER_PATH;
      } else {
        // Confirmation email required.
        setStatus("sent");
      }
      return;
    }

    // mode === "password"
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      window.location.href = ROSTER_PATH;
    }
  };

  const onGoogleClick = async () => {
    setErrorMsg(null);
    const supabase = createClient();
    const origin = typeof window !== "undefined" ? window.location.origin : SITE_URL;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(ROSTER_PATH)}`,
      },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    }
  };

  const heading =
    mode === "signup" ? "Create your coach account." : "Sign in to your roster.";
  const subline =
    mode === "magic"
      ? "We'll email you a one-time link. No password needed."
      : mode === "signup"
        ? "Use your email and a password — or sign up with Google."
        : "Use your password, or get a one-time email link.";

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] transition"
        >
          <ArrowLeft size={16} strokeWidth={2.25} />
          Back
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <p className="eyebrow mb-3">Coaches</p>
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-3">
            {heading}
          </h1>
          <p className="text-[color:var(--color-ink-muted)] mb-8">{subline}</p>

          {status === "sent" ? (
            <SentState
              email={email}
              variant={mode === "signup" ? "signup" : "magic"}
              onReset={() => {
                setStatus("idle");
                setPassword("");
              }}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={onGoogleClick}
                className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-paper)] hover:bg-[color:var(--color-canvas-soft)] transition font-medium"
              >
                <GoogleGlyph />
                Continue with Google
              </button>

              <div className="my-5 flex items-center gap-3">
                <span
                  className="flex-1 h-px"
                  style={{ background: "var(--color-border)" }}
                />
                <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
                  or
                </span>
                <span
                  className="flex-1 h-px"
                  style={{ background: "var(--color-border)" }}
                />
              </div>

              <form onSubmit={onSubmit} className="flex flex-col gap-3">
                <label htmlFor="email" className="sr-only">
                  Email address
                </label>
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

                {mode !== "magic" && (
                  <>
                    <label htmlFor="password" className="sr-only">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      required
                      minLength={mode === "signup" ? 8 : undefined}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        mode === "signup" ? "Choose a password (8+ chars)" : "Password"
                      }
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      className="px-4 py-3.5 rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-paper)] text-base focus:outline-none focus:border-[color:var(--color-ink)] transition"
                    />
                  </>
                )}

                <button
                  type="submit"
                  disabled={
                    status === "sending" ||
                    !email ||
                    (mode !== "magic" && !password)
                  }
                  className="btn btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === "sending"
                    ? mode === "magic"
                      ? "Sending…"
                      : "Working…"
                    : mode === "magic"
                      ? "Email me a sign-in link"
                      : mode === "signup"
                        ? "Create account"
                        : "Sign in"}
                </button>

                {status === "error" && errorMsg && (
                  <p className="mt-1 text-sm text-[color:var(--color-danger)]">
                    {errorMsg}
                  </p>
                )}
              </form>

              <div className="mt-6 flex flex-col gap-2 text-sm text-[color:var(--color-ink-muted)]">
                {mode === "password" && (
                  <>
                    <ModeLink onClick={() => switchMode(setMode, setStatus, setErrorMsg, "signup")}>
                      Don&apos;t have an account? Sign up
                    </ModeLink>
                    <ModeLink onClick={() => switchMode(setMode, setStatus, setErrorMsg, "magic")}>
                      Email me a one-time sign-in link instead
                    </ModeLink>
                  </>
                )}
                {mode === "signup" && (
                  <>
                    <ModeLink onClick={() => switchMode(setMode, setStatus, setErrorMsg, "password")}>
                      Already have an account? Sign in
                    </ModeLink>
                    <ModeLink onClick={() => switchMode(setMode, setStatus, setErrorMsg, "magic")}>
                      Use a magic link instead
                    </ModeLink>
                  </>
                )}
                {mode === "magic" && (
                  <ModeLink onClick={() => switchMode(setMode, setStatus, setErrorMsg, "password")}>
                    Use email + password instead
                  </ModeLink>
                )}
              </div>
            </>
          )}

          <p className="mt-10 text-sm text-[color:var(--color-ink-subtle)]">
            Athletes — the iOS and Android apps are launching soon.{" "}
            <a
              href={SITE_URL}
              className="underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)]"
            >
              Get early access
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}

function switchMode(
  setMode: (m: Mode) => void,
  setStatus: (s: Status) => void,
  setErrorMsg: (e: string | null) => void,
  next: Mode,
) {
  setMode(next);
  setStatus("idle");
  setErrorMsg(null);
}

function ModeLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)] hover:text-[color:var(--color-ink)] transition w-fit"
    >
      {children}
    </button>
  );
}

function SentState({
  email,
  variant,
  onReset,
}: {
  email: string;
  variant: "magic" | "signup";
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-paper)] p-6">
      <div className="flex items-start gap-3">
        <span
          className="flex-none w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: "var(--color-clay-soft)", color: "var(--color-clay-deep)" }}
        >
          <Mail size={18} strokeWidth={2.25} />
        </span>
        <div className="flex-1">
          <h2 className="font-semibold tracking-tight">Check your inbox</h2>
          <p className="text-sm text-[color:var(--color-ink-muted)] mt-1">
            {variant === "signup" ? (
              <>
                We sent a confirmation link to{" "}
                <strong className="text-[color:var(--color-ink)]">{email}</strong>.
                Click it to finish creating your account.
              </>
            ) : (
              <>
                We sent a sign-in link to{" "}
                <strong className="text-[color:var(--color-ink)]">{email}</strong>.
                It expires in 60 minutes.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={onReset}
            className="mt-4 text-sm underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)]"
          >
            Use a different email
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
