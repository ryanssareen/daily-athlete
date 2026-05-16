import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — DA2",
  description: "The terms under which you may use The Daily Athlete.",
};

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-24 w-full">
        <p className="eyebrow mb-3">Last updated: March 26, 2026</p>
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-10">
          Terms of Service
        </h1>

        <Section title="1. Acceptance of Terms">
          <P>
            By accessing or using The Daily Athlete (&quot;the Service&quot;),
            operated by Rishi Sareen, you agree to be bound by these Terms of Service
            (&quot;Terms&quot;). If you do not agree to these Terms, do not use the
            Service.
          </P>
          <P>
            We reserve the right to modify these Terms at any time. Changes take
            effect when posted on this page. Continued use after changes constitutes
            acceptance.
          </P>
        </Section>

        <Section title="2. Description of Service">
          <P>
            The Daily Athlete is a multi-sport workout tracking platform that allows
            you to:
          </P>
          <UL>
            <LI>
              Log and track workouts across multiple sports (running, cycling,
              swimming, walking, strength training)
            </LI>
            <LI>Sync workout data from third-party services including Strava</LI>
            <LI>
              View training analytics, progress reports, and AI-generated insights
            </LI>
            <LI>
              Set goals, track personal records, and monitor training trends
            </LI>
            <LI>
              Share training summaries (weekly wraps, monthly reviews, yearly wrapped)
            </LI>
            <LI>Import workout history from CSV/XLSX files</LI>
            <LI>Receive AI-powered workout suggestions and coaching</LI>
          </UL>
        </Section>

        <Section title="3. Account Registration">
          <P>To use the Service, you must create an account. You agree to:</P>
          <UL>
            <LI>Provide accurate and complete information during registration</LI>
            <LI>Maintain the security of your account credentials</LI>
            <LI>Notify us immediately of any unauthorized use of your account</LI>
            <LI>Accept responsibility for all activity under your account</LI>
            <LI>Not create multiple accounts or impersonate others</LI>
          </UL>
          <P>
            Usernames must be 3–20 characters, lowercase letters, numbers, and
            underscores only. We reserve the right to reject or reclaim usernames that
            are offensive, misleading, or conflict with reserved words.
          </P>
        </Section>

        <Section title="4. Third-Party Integrations">
          <H3>4.1 Strava</H3>
          <P>
            When you connect your Strava account, you authorize us to access your
            Strava activity data via the Strava API. Your use of Strava is governed by{" "}
            <ExternalA href="https://www.strava.com/legal/terms">
              Strava&apos;s Terms of Service
            </ExternalA>
            . You may disconnect Strava at any time from your Settings page.
          </P>

          <H3>4.2 General</H3>
          <P>
            We are not responsible for the availability, accuracy, or functionality of
            third-party services. Third-party services may change their APIs, rate
            limits, or terms at any time, which may affect the Service&apos;s
            functionality.
          </P>
        </Section>

        <Section title="5. Acceptable Use">
          <P>You agree not to:</P>
          <UL>
            <LI>Use the Service for any unlawful purpose</LI>
            <LI>
              Attempt to gain unauthorized access to the Service or other accounts
            </LI>
            <LI>Interfere with or disrupt the Service or its infrastructure</LI>
            <LI>Upload malicious content, viruses, or harmful code</LI>
            <LI>
              Use automated scripts, bots, or scraping tools to access the Service
            </LI>
            <LI>Abuse API rate limits or intentionally exhaust service quotas</LI>
            <LI>
              Misrepresent your identity or use offensive usernames or content
            </LI>
            <LI>Use the Service to harass, bully, or harm other users</LI>
            <LI>
              Reverse engineer, decompile, or attempt to extract source code from the
              Service
            </LI>
          </UL>
        </Section>

        <Section title="6. User Content">
          <P>
            You retain ownership of all content you create or upload to the Service
            (workouts, notes, photos, comments). By using the Service, you grant us a
            limited, non-exclusive license to store, process, and display your content
            as necessary to operate the Service.
          </P>
          <P>
            Content shared via public profiles or share features (weekly wraps,
            monthly reviews) is visible to anyone with the link. You are responsible
            for the content you make public.
          </P>
        </Section>

        <Section title="7. AI Features">
          <P>
            The Service includes AI-powered features (workout suggestions, training
            reports, coaching insights) powered by third-party AI models
            (Groq/LLaMA). You acknowledge that:
          </P>
          <UL>
            <LI>
              AI-generated content is for informational purposes only and does not
              constitute medical, fitness, or health advice
            </LI>
            <LI>
              AI suggestions may not be appropriate for your specific health
              conditions or fitness level
            </LI>
            <LI>
              You should consult a qualified professional before starting any new
              exercise program
            </LI>
            <LI>
              We are not liable for any injury or harm resulting from following
              AI-generated suggestions
            </LI>
            <LI>AI outputs may contain errors or inaccuracies</LI>
          </UL>
        </Section>

        <Section title="8. Service Availability">
          <P>
            The Service is provided &quot;as is&quot; and &quot;as available.&quot;
            We do not guarantee uninterrupted or error-free operation. We may:
          </P>
          <UL>
            <LI>Modify, suspend, or discontinue features at any time</LI>
            <LI>Perform maintenance that temporarily affects availability</LI>
            <LI>Impose usage limits or rate limits as needed</LI>
          </UL>
          <P>
            The Service currently operates on a free tier with the following resource
            limitations:
          </P>
          <UL>
            <LI>
              <strong>Database:</strong> Shared daily read quota across all users
              (currently 50,000 reads/day). During peak usage, some features may
              temporarily show cached data or be unavailable.
            </LI>
            <LI>
              <strong>AI Features:</strong> Workout suggestions and AI reports are
              subject to third-party API rate limits (approximately 100,000
              tokens/day). When limits are reached, AI features may be temporarily
              unavailable.
            </LI>
            <LI>
              <strong>Storage:</strong> Profile photos and backups are subject to
              storage quotas. Large file uploads may be restricted.
            </LI>
            <LI>
              <strong>Strava Sync:</strong> Subject to Strava&apos;s API rate limits
              (100 requests per 15 minutes, 1,000 per day per application).
            </LI>
          </UL>
          <P>
            These limits may change at our discretion. We will make reasonable efforts
            to notify users of significant changes. The introduction of paid tiers in
            the future will not remove or degrade features currently available on the
            free tier without notice.
          </P>
        </Section>

        <Section title="9. Account Termination">
          <P>
            We reserve the right to suspend or terminate your account if you violate
            these Terms, abuse the Service, or engage in activity that threatens other
            users or our infrastructure. You may delete your account at any time by
            contacting us. Upon deletion:
          </P>
          <UL>
            <LI>
              Your profile and workout data will be permanently deleted within 30 days
            </LI>
            <LI>Third-party service connections will be revoked</LI>
            <LI>This action cannot be undone</LI>
          </UL>
        </Section>

        <Section title="10. Indemnification">
          <P>
            You agree to indemnify, defend, and hold harmless The Daily Athlete, its
            operator, and affiliates from any claims, damages, losses, liabilities,
            costs, or expenses (including reasonable attorney&apos;s fees) arising
            from:
          </P>
          <UL>
            <LI>Your use of the Service or violation of these Terms</LI>
            <LI>
              Content you create, upload, or make publicly available through the
              Service
            </LI>
            <LI>Your violation of any rights of a third party</LI>
            <LI>
              Misuse of your account credentials or unauthorized sharing of your
              account
            </LI>
          </UL>
        </Section>

        <Section title="11. Limitation of Liability">
          <P>
            To the maximum extent permitted by applicable law (including the Consumer
            Protection Act, 2019 and the Indian Contract Act, 1872), The Daily
            Athlete and its operator shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages arising from your use of the
            Service, including but not limited to:
          </P>
          <UL>
            <LI>Loss of data, workouts, or training history</LI>
            <LI>Inability to access the Service or third-party integrations</LI>
            <LI>
              Injuries resulting from following workout suggestions or AI-generated
              content
            </LI>
            <LI>Inaccuracies in synced data from third-party services</LI>
            <LI>
              Unauthorized access to your account due to credential compromise
            </LI>
          </UL>
          <P>
            In no event shall our total liability exceed the amount paid by you to us
            (if any) in the 12 months preceding the claim.
          </P>
        </Section>

        <Section title="12. Disclaimer of Warranties">
          <P>
            The Service is provided &quot;as is&quot; and &quot;as available&quot;
            without warranties of any kind, express or implied, including but not
            limited to warranties of merchantability, fitness for a particular
            purpose, or non-infringement. We do not warrant that the Service will be
            available, secure, or error-free.
          </P>
        </Section>

        <Section title="13. Dispute Resolution">
          <P>
            In the event of any dispute arising from or relating to these Terms or
            your use of the Service, the parties agree to the following resolution
            process:
          </P>
          <UL>
            <LI>
              <strong>Step 1 — Informal Resolution:</strong> You agree to first
              contact us at{" "}
              <ExternalA href="mailto:rsareen@gmail.com">rsareen@gmail.com</ExternalA>{" "}
              and attempt to resolve the dispute informally within 30 days.
            </LI>
            <LI>
              <strong>Step 2 — Mediation:</strong> If informal resolution fails, the
              parties agree to attempt mediation through a mutually agreed mediator
              before pursuing litigation.
            </LI>
            <LI>
              <strong>Step 3 — Arbitration:</strong> If mediation fails, the dispute
              shall be referred to and resolved by arbitration in accordance with the
              Arbitration and Conciliation Act, 1996, as amended. The arbitration
              shall be conducted by a sole arbitrator mutually appointed by both
              parties. The seat of arbitration shall be New Delhi, India. The
              language of arbitration shall be English. The arbitral award shall be
              final and binding.
            </LI>
          </UL>
          <P>
            Nothing in this section prevents either party from seeking interim or
            injunctive relief from a court of competent jurisdiction where necessary.
          </P>
        </Section>

        <Section title="14. Governing Law & Jurisdiction">
          <P>
            These Terms shall be governed by and construed in accordance with the
            laws of India, including the Information Technology Act, 2000, the Indian
            Contract Act, 1872, and the Consumer Protection Act, 2019, without
            regard to conflict of law principles. Subject to the dispute resolution
            process above, any legal proceedings shall be brought exclusively in the
            courts of New Delhi, India.
          </P>
        </Section>

        <Section title="15. Contact">
          <P>If you have questions about these Terms, contact us at:</P>
          <div className="my-6 p-6 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-paper)]">
            <p className="font-semibold text-[color:var(--color-ink)]">Rishi Sareen</p>
            <p className="text-sm text-[color:var(--color-ink-muted)] mt-1">
              The Daily Athlete
            </p>
            <p className="text-sm text-[color:var(--color-ink-muted)]">
              Email:{" "}
              <ExternalA href="mailto:rsareen@gmail.com">rsareen@gmail.com</ExternalA>
            </p>
          </div>
          <P>
            We review these Terms at least annually. Existing users will be notified
            via email of any material changes.
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
          <Link href="/sign-in" className="hover:text-[color:var(--color-ink)]">
            Coach sign-in
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

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-3 text-base font-semibold tracking-tight text-[color:var(--color-ink)]">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-6 flex flex-col gap-2">{children}</ul>;
}

function LI({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

function ExternalA({ href, children }: { href: string; children: React.ReactNode }) {
  const isMail = href.startsWith("mailto:");
  return (
    <a
      href={href}
      target={isMail ? undefined : "_blank"}
      rel={isMail ? undefined : "noopener noreferrer"}
      className="underline underline-offset-4 decoration-[color:var(--color-border-strong)] hover:decoration-[color:var(--color-ink)] hover:text-[color:var(--color-ink)] transition"
    >
      {children}
    </a>
  );
}
