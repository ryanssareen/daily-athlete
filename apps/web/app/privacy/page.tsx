import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — DA2",
  description:
    "How DA2 collects, uses, stores, and protects your personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <SiteHeader />

      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-24 w-full">
        <p className="eyebrow mb-3">Last updated: May 19, 2026</p>
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight mb-10">
          Privacy Policy
        </h1>

        <Section title="1. Introduction">
          <P>
            DA2 (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is an AI-powered endurance training
            platform that generates personalized, race-specific training plans and adapts them
            based on your actual workout performance. This Privacy Policy explains how we collect,
            use, store, and protect your personal information when you use our website, mobile
            apps, and services at <strong>da2-one.vercel.app</strong> and The Daily Athlete iOS
            app (collectively, the &quot;Service&quot;).
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
            When you create an account we collect your email address and an optional
            display name. Sign-in is via email magic link only — we do not collect
            passwords, and we do not offer third-party social sign-in.
          </P>

          <H3>2.2 Profile Information</H3>
          <P>
            You may optionally provide additional profile data such as age range,
            experience level, height, weight, sport preferences, training goals, bio,
            and timezone.
          </P>

          <H3>2.3 Training Plan &amp; Event Information</H3>
          <P>
            When you create a training plan, we collect your event type (swim, bike, run,
            triathlon, strength, mobility), event date, training goal, current fitness level,
            available weekly training hours, and training history. This data is essential for
            generating your personalized, race-specific periodized training plan.
          </P>

          <H3>2.4 Workout &amp; Health-Related Data</H3>
          <P>
            We store all workout data you log in the app or sync from third-party services.
            This includes workout type, date, duration, distance, pace, heart rate, elevation,
            calories, laps/splits, power, and any notes or descriptions you add. We use this
            data to adapt your plan weekly — updating volume, intensity, and focus based on
            your actual performance.
          </P>
          <P>
            <strong>Note on health data:</strong> some workout data (heart rate, calories,
            body metrics) may be classified as health-related or sensitive personal data under
            certain jurisdictions. We treat all such data with the same level of protection as
            described in this policy. This data is used solely for generating your training
            plan, adapting it weekly, and providing you with training analytics and insights.
          </P>
          <P>
            <strong>Location data:</strong> when you connect Strava, the activity records we
            sync may contain GPS tracks (route polylines) for workouts you recorded outdoors.
            We display these in the app as a map on the activity detail view. We do not
            collect location data directly from your device.
          </P>

          <H3>2.5 Third-Party Service Data</H3>
          <P>
            When you connect third-party fitness services, we access and store data
            from those platforms:
          </P>
          <UL>
            <LI>
              <strong>Strava:</strong> activity summaries and detailed activity data
              (distance, duration, pace, heart rate, elevation, laps, splits, GPS
              polylines, and activity metadata). We access this data via the Strava API
              using OAuth 2.0 authorization that you explicitly grant.
            </LI>
          </UL>
          <P>
            You can disconnect Strava at any time from your Settings page, which revokes
            our access to new data from Strava.
          </P>

          <H3>2.6 Coach Collaboration Data</H3>
          <P>
            If you accept a coach invitation, the linked coach can read your training
            plan, planned and completed workouts, and athlete profile. Coaches can also
            assign workouts to you. You can remove a coach link at any time from
            Settings.
          </P>
        </Section>

        <Section title="3. How We Use Your Information">
          <P>We use your data to:</P>
          <UL>
            <LI>Generate your personalized, race-specific periodized training plan</LI>
            <LI>Adapt your plan weekly based on your actual workout performance</LI>
            <LI>Sync your Strava workouts and merge them with your plan</LI>
            <LI>Provide training analytics and performance insights</LI>
            <LI>Allow coaches you link to view, comment on, and collaborate on your plan</LI>
            <LI>Send transactional emails for authentication (magic link sign-in)</LI>
            <LI>Provide, maintain, and improve the Service</LI>
            <LI>Detect and prevent abuse, fraud, or unauthorized access</LI>
          </UL>
          <P>
            We do not collect or use your data for advertising, ad measurement, or
            cross-app/cross-website tracking. We do not sell your data.
          </P>
        </Section>

        <Section title="4. Data Storage and Security">
          <P>
            Your data is stored in our Supabase project (Postgres database, file storage,
            and authentication) and served through Vercel infrastructure. We use
            industry-standard security measures including:
          </P>
          <UL>
            <LI>Supabase authentication with email magic-link verification</LI>
            <LI>Postgres Row-Level Security policies restricting data access to the owning user (and, where applicable, their linked coach)</LI>
            <LI>HTTPS encryption for all data in transit</LI>
            <LI>OAuth 2.0 for the Strava connection (no third-party passwords stored)</LI>
            <LI>Secure on-device storage of session tokens via the platform secure enclave (iOS Keychain / Android Keystore)</LI>
            <LI>Regular automated backups by our infrastructure providers</LI>
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
              <strong>Supabase:</strong> authentication, database, file storage, and
              transactional email delivery for sign-in magic links —{" "}
              <ExternalA href="https://supabase.com/privacy">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>Vercel:</strong> hosting and deployment of the web app and Next.js
              API routes —{" "}
              <ExternalA href="https://vercel.com/legal/privacy-policy">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>Strava:</strong> workout sync (only if you choose to connect) —{" "}
              <ExternalA href="https://www.strava.com/legal/privacy">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>Inngest:</strong> background job orchestration for Strava sync
              and webhook processing —{" "}
              <ExternalA href="https://www.inngest.com/privacy">
                Privacy Policy
              </ExternalA>
            </LI>
            <LI>
              <strong>Apple App Store / TestFlight:</strong> iOS app distribution.
              Apple may collect download and crash diagnostics per its own policies —{" "}
              <ExternalA href="https://www.apple.com/legal/privacy/">
                Privacy Policy
              </ExternalA>
            </LI>
          </UL>
          <P>
            <strong>Coach Collaboration:</strong> when a coach is linked to your account,
            that coach&apos;s identifying information (email, display name) is stored and
            they can read your training plan, workouts, and related data while the link is
            active. Coaches operate under separate terms and their own privacy obligations.
          </P>
        </Section>

        <Section title="6. Data Sharing">
          <P>
            We do <strong>not</strong> sell, rent, or trade your personal data, and we
            do not use it for advertising or tracking. We may share data only in these
            limited cases:
          </P>
          <UL>
            <LI>
              <strong>Coach collaboration:</strong> when you accept a coach invitation,
              that coach has access to your training plan, workouts, athlete profile,
              and event information. Sharing is limited to coaches you explicitly link
              and ends when you remove the link.
            </LI>
            <LI>
              <strong>Service providers:</strong> we use the third-party services
              listed above to operate the platform. They process data on our behalf
              under their respective privacy policies.
            </LI>
            <LI>
              <strong>Legal requirements:</strong> we may disclose data if required by
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
              <strong>Right to Access:</strong> view all data we hold about you through
              your profile and settings pages
            </LI>
            <LI>
              <strong>Right to Export / Portability:</strong> request a full export of
              your data
            </LI>
            <LI>
              <strong>Right to Correction:</strong> update your profile information at
              any time through Settings
            </LI>
            <LI>
              <strong>Right to Erasure:</strong> request deletion of your account and
              all associated data by contacting us
            </LI>
            <LI>
              <strong>Right to Disconnect:</strong> revoke access to Strava at any time
              from Settings
            </LI>
            <LI>
              <strong>Right to Withdraw Consent:</strong> withdraw consent for data
              processing at any time (this may affect Service functionality)
            </LI>
            <LI>
              <strong>Right to Nominate:</strong> under the DPDP Act, you may nominate
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
            Automated backups containing your data are pruned on a regular schedule by
            our infrastructure providers (Supabase and Vercel). After their retention
            windows expire, backup data is permanently deleted.
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
            (Supabase, Vercel, Inngest, and Strava all operate cross-border
            infrastructure). By using the Service, you consent to the transfer of your
            data to these locations. We ensure that all third-party processors maintain
            appropriate security measures.
          </P>
          <P>
            For EU users: data transfers outside the EEA are conducted in accordance
            with GDPR requirements, relying on the third-party processors&apos; own
            compliance mechanisms (e.g., Standard Contractual Clauses).
          </P>
        </Section>

        <Section title="12. Tracking and App Privacy (Apple)">
          <P>
            The Daily Athlete iOS app does <strong>not</strong> track you across other
            companies&apos; apps or websites and does not link your data with data from
            third parties for advertising or measurement. We have not implemented
            Apple&apos;s App Tracking Transparency prompt because we do not track. The
            data we collect — email, name, training and workout data, user ID, and
            workout GPS routes from Strava — is linked to your account for the purpose
            of providing the app&apos;s core functionality and is declared as such in our
            App Store privacy disclosures.
          </P>
        </Section>

        <Section title="13. Changes to This Policy">
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

        <Section title="14. Grievance Officer & Contact">
          <P>
            In accordance with the Information Technology Act, 2000 and the DPDP Act,
            2023, the following person has been designated as the Grievance Officer for
            the purpose of this Privacy Policy:
          </P>
          <div className="my-6 p-6 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-paper)]">
            <p className="font-semibold text-[color:var(--color-ink)]">DA2 Support</p>
            <p className="text-sm text-[color:var(--color-ink-muted)] mt-1">
              Grievance Officer &amp; Data Protection Contact
            </p>
            <p className="text-sm text-[color:var(--color-ink-muted)]">
              Email:{" "}
              <ExternalA href="mailto:support@da2.coach">support@da2.coach</ExternalA>
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
