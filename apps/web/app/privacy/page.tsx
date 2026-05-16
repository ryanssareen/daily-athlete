import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — DA2",
  description:
    "How The Daily Athlete collects, uses, stores, and protects your personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-24 w-full">
        <p className="eyebrow mb-3">Last updated: March 26, 2026</p>
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-10">
          Privacy Policy
        </h1>

        <Section title="1. Introduction">
          <P>
            The Daily Athlete (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a workout
            tracking platform operated by Rishi Sareen, based in India. This Privacy
            Policy explains how we collect, use, store, and protect your personal
            information when you use our website and services at{" "}
            <strong>thedailyathlete.in</strong> (the &quot;Service&quot;).
          </P>
          <P>
            This policy is designed to comply with the Information Technology Act, 2000,
            the Information Technology (Reasonable Security Practices and Procedures and
            Sensitive Personal Data or Information) Rules, 2011, and the Digital
            Personal Data Protection Act, 2023 (&quot;DPDP Act&quot;) as applicable. For
            users in the European Union, this policy also addresses rights under the
            General Data Protection Regulation (GDPR).
          </P>
          <P>
            By using the Service, you consent to the collection and use of information
            in accordance with this policy. If you do not agree, please do not use the
            Service.
          </P>
        </Section>

        <Section title="2. Information We Collect">
          <H3>2.1 Account Information</H3>
          <P>
            When you create an account, we collect your email address, display name,
            and username. If you sign in with Google, we receive your name, email, and
            profile photo from Google.
          </P>

          <H3>2.2 Profile Information</H3>
          <P>
            You may optionally provide additional profile data such as age range,
            experience level, height, weight, sport preferences, training goals, bio,
            and profile photo.
          </P>

          <H3>2.3 Workout &amp; Health-Related Data</H3>
          <P>
            We store workout data you create manually, import via CSV/XLSX, or sync
            from third-party services. This includes workout type, date, duration,
            distance, pace, heart rate, elevation, calories, laps/splits, and any notes
            or descriptions you add.
          </P>
          <P>
            <strong>Note on health data:</strong> Some workout data (heart rate,
            calories, body metrics) may be classified as health-related or sensitive
            personal data under certain jurisdictions. We treat all such data with the
            same level of protection as described in this policy. This data is used
            solely for providing you with training analytics and insights within the
            Service.
          </P>

          <H3>2.4 Third-Party Service Data</H3>
          <P>
            When you connect third-party fitness services, we access and store data
            from those platforms:
          </P>
          <UL>
            <LI>
              <strong>Strava:</strong> Activity summaries, detailed activity data
              (distance, duration, pace, heart rate, elevation, laps, splits, photos),
              and activity metadata. We access this data via the Strava API using OAuth
              2.0 authorization that you explicitly grant.
            </LI>
          </UL>
          <P>
            You can disconnect any third-party service at any time from your Settings
            page, which revokes our access to new data from that service.
          </P>

          <H3>2.5 Usage Data</H3>
          <P>
            We collect anonymized product analytics via PostHog to understand how the
            Service is used and to improve it. This may include pages visited, features
            used, and general interaction patterns. We do not sell or share this data
            with third parties for advertising purposes.
          </P>

          <H3>2.6 Push Notification Tokens</H3>
          <P>
            If you opt in to push notifications, we store your device&apos;s push
            subscription endpoint to send you workout reminders, sync completion
            alerts, and weekly summaries. You can opt out at any time.
          </P>
        </Section>

        <Section title="3. How We Use Your Information">
          <P>We use your data to:</P>
          <UL>
            <LI>Provide, maintain, and improve the Service</LI>
            <LI>
              Display your workout history, stats, progress, and training insights
            </LI>
            <LI>
              Generate AI-powered workout suggestions, reports, and coaching insights
            </LI>
            <LI>
              Sync and merge workout data from connected third-party services (Strava)
            </LI>
            <LI>
              Send you email summaries, weekly wraps, and push notifications (with your
              consent)
            </LI>
            <LI>Detect and prevent abuse, fraud, or unauthorized access</LI>
            <LI>Generate anonymized aggregate statistics about platform usage</LI>
          </UL>
        </Section>

        <Section title="4. Data Storage and Security">
          <P>
            Your data is stored in Google Cloud Firestore (Firebase) and Vercel
            infrastructure. We use industry-standard security measures including:
          </P>
          <UL>
            <LI>Firebase Authentication with secure session management</LI>
            <LI>HTTPS encryption for all data in transit</LI>
            <LI>
              Firestore Security Rules restricting data access to authenticated users
            </LI>
            <LI>
              OAuth 2.0 for all third-party service connections (no passwords stored)
            </LI>
            <LI>Regular automated backups with integrity verification</LI>
            <LI>HttpOnly, SameSite cookies for admin session management</LI>
          </UL>
          <P>
            While we take reasonable measures to protect your data, no method of
            electronic transmission or storage is 100% secure. We cannot guarantee
            absolute security.
          </P>
        </Section>

        <Section title="5. Third-Party Services">
          <P>
            The Service integrates with the following third-party services. Each has
            its own privacy policy:
          </P>
          <UL>
            <LI>
              <strong>Firebase (Google):</strong> Authentication, database, and storage
              —{" "}
              <ExternalA href="https://firebase.google.com/support/privacy">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>Vercel:</strong> Hosting and deployment —{" "}
              <ExternalA href="https://vercel.com/legal/privacy-policy">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>Strava:</strong> Workout sync —{" "}
              <ExternalA href="https://www.strava.com/legal/privacy">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>Groq:</strong> AI-powered insights and suggestions —{" "}
              <ExternalA href="https://groq.com/privacy-policy/">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>PostHog:</strong> Product analytics —{" "}
              <ExternalA href="https://posthog.com/privacy">Privacy Policy</ExternalA>
            </LI>
            <LI>
              <strong>Brevo:</strong> Email delivery —{" "}
              <ExternalA href="https://www.brevo.com/legal/privacypolicy/">
                Privacy Policy
              </ExternalA>
            </LI>
          </UL>
          <P>
            When you use AI features (workout suggestions, reports, coaching), your
            workout data may be sent to Groq for processing. We do not send personally
            identifiable information (name, email) to AI providers — only anonymized
            workout metrics.
          </P>
        </Section>

        <Section title="6. Data Sharing">
          <P>
            We do <strong>not</strong> sell, rent, or trade your personal data. We may
            share data only in these limited cases:
          </P>
          <UL>
            <LI>
              <strong>Public profiles:</strong> If you enable your public profile, your
              display name, username, bio, workout stats, and profile photo are visible
              to anyone with your profile link.
            </LI>
            <LI>
              <strong>Service providers:</strong> We use third-party services (listed
              above) to operate the platform. They process data on our behalf under
              their respective privacy policies.
            </LI>
            <LI>
              <strong>Legal requirements:</strong> We may disclose data if required by
              law, legal process, or government request.
            </LI>
          </UL>
        </Section>

        <Section title="7. Your Rights">
          <P>
            Under the DPDP Act, IT Act, and GDPR (where applicable), you have the
            following rights as a Data Principal:
          </P>
          <UL>
            <LI>
              <strong>Right to Access:</strong> View all data we hold about you through
              your profile and settings pages
            </LI>
            <LI>
              <strong>Right to Export / Portability:</strong> Request a full export of
              your data in JSON format
            </LI>
            <LI>
              <strong>Right to Correction:</strong> Update your profile information at
              any time through Settings
            </LI>
            <LI>
              <strong>Right to Erasure:</strong> Request deletion of your account and
              all associated data by contacting us
            </LI>
            <LI>
              <strong>Right to Disconnect:</strong> Revoke access to any connected
              third-party service at any time
            </LI>
            <LI>
              <strong>Right to Withdraw Consent:</strong> Withdraw consent for data
              processing at any time (this may affect Service functionality)
            </LI>
            <LI>
              <strong>Right to Opt Out:</strong> Disable push notifications, email
              summaries, and analytics tracking
            </LI>
            <LI>
              <strong>Right to Nominate:</strong> Under the DPDP Act, you may nominate
              another person to exercise your rights in case of your death or
              incapacity
            </LI>
          </UL>
          <P>
            To exercise any of these rights, contact our Grievance Officer (see Section
            13 below) at{" "}
            <ExternalA href="mailto:rsareen@gmail.com">rsareen@gmail.com</ExternalA>.
            We will respond to requests within 30 days.
          </P>
        </Section>

        <Section title="8. Data Breach Notification">
          <P>
            In the event of a personal data breach that poses a risk to your rights and
            freedoms, we will:
          </P>
          <UL>
            <LI>
              Notify the Data Protection Board of India (once constituted under the
              DPDP Act) without unreasonable delay, and in any case within 72 hours of
              becoming aware of the breach
            </LI>
            <LI>
              Notify affected users via email and/or in-app notification as soon as
              practicable
            </LI>
            <LI>
              Provide details of the nature of the breach, the data affected, and the
              measures taken to mitigate it
            </LI>
            <LI>Document the breach and remediation steps in our internal records</LI>
          </UL>
          <P>
            For EU users, breach notifications will also comply with GDPR Article 33/34
            requirements where applicable.
          </P>
        </Section>

        <Section title="9. Data Retention">
          <P>
            We retain your data for as long as your account is active and the data is
            necessary for the purposes described in this policy. If you delete your
            account, we will delete your personal data within 30 days, except where we
            are required to retain it for legal or legitimate business purposes (e.g.,
            backup integrity, fraud prevention, legal compliance).
          </P>
          <P>
            Automated backups containing your data are pruned on a regular schedule:
            daily backups kept for 7 days, weekly for 4 weeks, monthly for 12 months.
            After these periods, backup data is permanently deleted.
          </P>
        </Section>

        <Section title="10. Children's Privacy">
          <P>
            The Service is not intended for children under 18 years of age. We do not
            knowingly collect personal information from minors. Under the DPDP Act,
            processing personal data of children requires verifiable consent from a
            parent or lawful guardian.
          </P>
          <P>
            If you are a parent or guardian and believe your child has provided us with
            personal data without your consent, please contact us immediately at{" "}
            <ExternalA href="mailto:rsareen@gmail.com">rsareen@gmail.com</ExternalA>.
            We will take steps to delete such data promptly.
          </P>
        </Section>

        <Section title="11. International Data Transfers">
          <P>
            Your data may be processed and stored in servers located outside India
            (e.g., Google Cloud for Firebase, Vercel for hosting, Groq for AI
            processing). By using the Service, you consent to the transfer of your
            data to these locations. We ensure that all third-party processors
            maintain appropriate security measures.
          </P>
          <P>
            For EU users: data transfers outside the EEA are conducted in accordance
            with GDPR requirements, relying on the third-party processors&apos; own
            compliance mechanisms (e.g., Standard Contractual Clauses).
          </P>
        </Section>

        <Section title="12. Changes to This Policy">
          <P>
            We review and update this Privacy Policy at least annually, or more
            frequently when required by changes in law, our practices, or the Service.
            We will notify you of material changes by email and by posting the updated
            policy on this page with a revised &quot;Last updated&quot; date. Continued
            use of the Service after changes constitutes acceptance of the updated
            policy.
          </P>
          <P>
            We are actively monitoring the rollout of the DPDP Rules (expected full
            enforcement by 2027) and will update this policy as new requirements are
            enacted.
          </P>
        </Section>

        <Section title="13. Grievance Officer & Contact">
          <P>
            In accordance with the Information Technology Act, 2000 and the DPDP Act,
            2023, the following person has been designated as the Grievance Officer for
            the purpose of this Privacy Policy:
          </P>
          <div className="my-6 p-6 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-paper)]">
            <p className="font-semibold text-[color:var(--color-ink)]">Rishi Sareen</p>
            <p className="text-sm text-[color:var(--color-ink-muted)] mt-1">
              Grievance Officer &amp; Data Protection Contact
            </p>
            <p className="text-sm text-[color:var(--color-ink-muted)]">
              The Daily Athlete
            </p>
            <p className="text-sm text-[color:var(--color-ink-muted)]">
              Email:{" "}
              <ExternalA href="mailto:rsareen@gmail.com">rsareen@gmail.com</ExternalA>
            </p>
          </div>
          <P>
            Grievances will be acknowledged within 24 hours and resolved within 30 days
            from the date of receipt. If you are not satisfied with our response, you
            may file a complaint with the Data Protection Board of India (once
            constituted) or the relevant supervisory authority in your jurisdiction.
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
