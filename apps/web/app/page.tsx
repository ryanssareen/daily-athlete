import Link from "next/link";
import { redirect } from "next/navigation";

import { ArrowUpRight } from "lucide-react";

import { getUserWithRoles, landingPathForRoles } from "@/auth/roles";

export default async function LandingPage() {
  const session = await getUserWithRoles();
  if (session) {
    redirect(landingPathForRoles(session.roles));
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <Hero />
      <FeatureTriad />
      <PlatformBand />
      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 backdrop-blur-md bg-[color:var(--color-canvas)]/80 border-b border-[color:var(--color-border)]">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/sign-in"
            className="px-4 py-2 rounded-full hover:bg-[color:var(--color-canvas-soft)] transition"
          >
            Coach sign-in
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-block w-7 h-7 rounded-full"
        style={{
          background:
            "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
        }}
        aria-hidden="true"
      />
      <span className="font-medium tracking-tight text-[15px]">DA2</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <BackgroundGrid />
      <div className="mx-auto max-w-6xl px-6 pt-24 pb-32 lg:pt-32 lg:pb-40 relative">
        <p className="eyebrow mb-8">Endurance training · 2026</p>

        <h1 className="display max-w-3xl">
          Plans that adapt to{" "}
          <span className="relative inline-block">
            <span className="relative z-10">your last workout</span>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-1 h-3 -z-0"
              style={{ background: "var(--color-clay-soft)" }}
            />
          </span>
          .
        </h1>

        <p className="lead mt-8 max-w-xl">
          DA2 generates a periodized training plan for your next race, syncs with
          Strava to track every session, and lets you bring a coach into the loop
          when you want one.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link className="btn btn-primary" href="/sign-in">
            Get early athlete access
            <ArrowUpRight size={16} strokeWidth={2.25} />
          </Link>
          <Link className="btn btn-secondary" href="/sign-in">
            I&apos;m a coach
          </Link>
        </div>

        <SportsRow />
      </div>
    </section>
  );
}

function BackgroundGrid() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage:
          "linear-gradient(to right, color-mix(in oklab, var(--color-border) 60%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--color-border) 60%, transparent) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
        maskImage:
          "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)",
      }}
    />
  );
}

function SportsRow() {
  const items = ["Swim", "Bike", "Run", "Triathlon", "Strength", "Mobility"];
  return (
    <div className="mt-16 lg:mt-24 flex flex-wrap gap-x-8 gap-y-2 text-sm text-[color:var(--color-ink-subtle)]">
      <span className="eyebrow">Built for</span>
      {items.map((item, i) => (
        <span key={item} className="flex items-center gap-3">
          {i > 0 && <span className="text-[color:var(--color-border-strong)]">·</span>}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function FeatureTriad() {
  const features: Array<{
    n: string;
    title: string;
    body: string;
  }> = [
    {
      n: "01",
      title: "AI plan generation, race-specific",
      body:
        "Tell us your event date, training history, and weekly hours. DA2 produces a periodized plan from base through taper — multi-sport for triathlons, brick workouts and all.",
    },
    {
      n: "02",
      title: "Strava-synced. Plans adapt automatically",
      body:
        "Every workout you log updates the next week. Missed a session? The plan re-balances. Crushed it? Volume nudges up. A weekly review proposes changes — you accept, edit, or reject.",
    },
    {
      n: "03",
      title: "A coach, when you want one",
      body:
        "Invite a coach to view, edit, and comment on your plan. They become a collaborator on top of the AI, not a replacement for it. Pause coach access any time.",
    },
  ];

  return (
    <section
      className="border-t"
      style={{ borderColor: "var(--color-border)", background: "var(--color-canvas-soft)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
        <div className="max-w-2xl mb-16 lg:mb-20">
          <p className="eyebrow mb-4">How it works</p>
          <h2 className="h2">
            Built around the loop endurance athletes already live in.
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {features.map((f) => (
            <article
              key={f.n}
              className="p-7 lg:p-8 rounded-2xl bg-[color:var(--color-paper)] border border-[color:var(--color-border)] flex flex-col gap-4 hover:border-[color:var(--color-border-strong)] transition"
            >
              <span className="font-mono text-xs text-[color:var(--color-ink-subtle)]">
                {f.n}
              </span>
              <h3 className="text-xl font-semibold tracking-tight leading-snug">
                {f.title}
              </h3>
              <p className="text-[color:var(--color-ink-muted)] text-[15px] leading-relaxed">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function PlatformBand() {
  return (
    <section
      className="border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-24 lg:py-28 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
        <div className="lg:col-span-7">
          <p className="eyebrow mb-4">Platforms</p>
          <h2 className="h2">
            Athletes train on iOS and Android.
            <br />
            <span className="text-[color:var(--color-ink-subtle)]">
              Coaches use this site.
            </span>
          </h2>
        </div>
        <div className="lg:col-span-5">
          <ul className="space-y-3 text-[15px] text-[color:var(--color-ink-muted)]">
            <Bullet>The athlete app launches on iOS and Android (TestFlight + Play internal track first).</Bullet>
            <Bullet>The coach experience lives in the browser. No install, no app store.</Bullet>
            <Bullet>Strava is the only third-party integration in v1. Garmin and HealthKit follow.</Bullet>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-2.5 flex-none w-1.5 h-1.5 rounded-full"
        style={{ background: "var(--color-clay)" }}
      />
      <span>{children}</span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function SiteFooter() {
  return (
    <footer
      className="mt-auto border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-sm text-[color:var(--color-ink-subtle)]">
        <div className="flex items-center gap-3">
          <Wordmark />
          <span>© 2026</span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/sign-in" className="hover:text-[color:var(--color-ink)]">
            Coach sign-in
          </Link>
          <Link href="/privacy" className="hover:text-[color:var(--color-ink)]">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
