import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";

export default function SignUpChoicePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-4">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-2 text-sm text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] transition"
        >
          <ArrowLeft size={16} strokeWidth={2.25} />
          Back to sign in
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <p className="eyebrow mb-3">Create account</p>
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-3">
            How will you use this?
          </h1>
          <p className="text-[color:var(--color-ink-muted)] mb-10">
            Choose the account type that fits your role.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link
              href={"/sign-up/coach" as Route}
              className="group flex flex-col gap-4 rounded-2xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-paper)] p-7 hover:border-[color:var(--color-ink)] hover:bg-[color:var(--color-canvas-soft)] transition no-underline"
            >
              <span
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl"
                style={{ background: "var(--color-clay-soft)", color: "var(--color-clay-deep)" }}
              >
                📋
              </span>
              <div>
                <p className="font-semibold text-[color:var(--color-ink)] text-lg leading-snug mb-1">
                  Coach
                </p>
                <p className="text-sm text-[color:var(--color-ink-muted)] leading-relaxed">
                  Manage a roster, assign training plans, and track athlete progress.
                </p>
              </div>
              <span className="mt-auto text-sm font-medium text-[color:var(--color-ink)] group-hover:underline underline-offset-4">
                Continue as coach →
              </span>
            </Link>

            <Link
              href={"/sign-up/athlete" as Route}
              className="group flex flex-col gap-4 rounded-2xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-paper)] p-7 hover:border-[color:var(--color-ink)] hover:bg-[color:var(--color-canvas-soft)] transition no-underline"
            >
              <span
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl"
                style={{ background: "color-mix(in oklab, var(--color-ink) 8%, transparent)", color: "var(--color-ink)" }}
              >
                🏃
              </span>
              <div>
                <p className="font-semibold text-[color:var(--color-ink)] text-lg leading-snug mb-1">
                  Athlete
                </p>
                <p className="text-sm text-[color:var(--color-ink-muted)] leading-relaxed">
                  Log workouts, sync Strava, and follow your training plan.
                </p>
              </div>
              <span className="mt-auto text-sm font-medium text-[color:var(--color-ink)] group-hover:underline underline-offset-4">
                Continue as athlete →
              </span>
            </Link>
          </div>

          <p className="mt-8 text-sm text-[color:var(--color-ink-muted)]">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)] hover:text-[color:var(--color-ink)] transition"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
