import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support — DA2",
  description:
    "Get help with Daily Athlete — contact support, connect Strava, manage your data, or report a bug.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-24 w-full">
        <p className="eyebrow mb-3">Daily Athlete</p>
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-4">
          Support
        </h1>
        <p className="text-[color:var(--color-ink-muted)] text-[15px] leading-relaxed mb-8">
          Questions, bugs, or account help — reach us directly and we&apos;ll get
          back to you. We typically respond within 24–48 hours.
        </p>

        {/* Contact card */}
        <div className="my-2 p-6 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-paper)]">
          <p className="font-semibold text-[color:var(--color-ink)]">
            Daily Athlete Support
          </p>
          <div className="mt-3 flex flex-col gap-2 text-sm text-[color:var(--color-ink-muted)]">
            <p>
              Email:{" "}
              <ContactLink href="mailto:support@da2.coach">
                support@da2.coach
              </ContactLink>
            </p>
            <p>
              Phone / WhatsApp:{" "}
              <ContactLink href="tel:+919871513139">+91 9871513139</ContactLink>
            </p>
            <p>Hours: Mon–Sat, 9:00 AM – 7:00 PM IST</p>
          </div>
        </div>

        <Section title="Getting started">
          <P>
            Create an account with your email and password (or continue with
            Google or Apple), then build your first training plan from the
            dashboard. Your plan adapts each week based on the workouts you log
            or sync.
          </P>
        </Section>

        <Section title="Connecting Strava">
          <P>
            Open <strong>Settings → Connect Strava</strong> and authorize access.
            Once connected, we pull your recent activities and keep your calendar
            in sync. You can disconnect at any time from Settings, which revokes
            our access to new data.
          </P>
        </Section>

        <Section title="Units, theme, and preferences">
          <P>
            Switch between <strong>km / miles</strong>, <strong>m / yards</strong>{" "}
            for swims, and <strong>kg / lbs</strong> under{" "}
            <strong>Settings → Units</strong>. Light, dark, and system themes are
            under <strong>Settings → Appearance</strong>. Changes apply across the
            app immediately.
          </P>
        </Section>

        <Section title="Logging an activity">
          <P>
            Tap the <strong>+</strong> button on the Dashboard or Calendar to log
            a workout manually — pick the sport, date, duration, and optional
            distance and notes. Synced Strava activities appear automatically in
            your Activities feed and calendar.
          </P>
        </Section>

        <Section title="Your data — export and deletion">
          <P>
            You can view and update your profile anytime in Settings. To request
            a full export of your data, or to{" "}
            <strong>delete your account and all associated data</strong>, email{" "}
            <ContactLink href="mailto:support@da2.coach">
              support@da2.coach
            </ContactLink>{" "}
            from your account email and we&apos;ll process it within 30 days. See
            our{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)] hover:text-[color:var(--color-ink)] transition"
            >
              Privacy Policy
            </Link>{" "}
            for full details on your rights.
          </P>
        </Section>

        <Section title="Coaches and athletes">
          <P>
            Coaches can invite athletes, view their plans and workouts, and assign
            sessions. Athletes can remove a coach link at any time from Settings.
            Need help with an invite? Email us with both account emails and
            we&apos;ll sort it out.
          </P>
        </Section>

        <Section title="Report a bug or request a feature">
          <P>
            Found something broken or have an idea? Email{" "}
            <ContactLink href="mailto:support@da2.coach">
              support@da2.coach
            </ContactLink>{" "}
            with a short description and, if possible, a screenshot and your
            device model and iOS version. It helps us reproduce and fix issues
            faster.
          </P>
        </Section>
      </article>

      <SiteFooter />
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function SiteHeader() {
  return (
    <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-canvas)]/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span
            className="inline-block w-7 h-7 rounded-full"
            style={{
              background:
                "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
            }}
            aria-hidden="true"
          />
          <span className="font-medium tracking-tight text-[15px]">DA2</span>
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

function SiteFooter() {
  return (
    <footer
      className="mt-auto border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="mx-auto max-w-6xl px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-sm text-[color:var(--color-ink-subtle)]">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="inline-block w-7 h-7 rounded-full"
              style={{
                background:
                  "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
              }}
              aria-hidden="true"
            />
            <span className="font-medium tracking-tight text-[15px]">DA2</span>
          </Link>
          <span>© 2026</span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/support" className="hover:text-[color:var(--color-ink)]">
            Support
          </Link>
          <Link href="/privacy" className="hover:text-[color:var(--color-ink)]">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-[color:var(--color-ink)]">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="text-xl font-semibold tracking-tight leading-snug mb-4">
        {title}
      </h2>
      <div className="flex flex-col gap-4 text-[color:var(--color-ink-muted)] text-[15px] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function ContactLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)] hover:text-[color:var(--color-ink)] transition"
    >
      {children}
    </a>
  );
}
