import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { hasStravaToken } from "@/db/strava-tokens";
import { getAthleteCoach } from "@/db/roster";
import { AppearanceThemeButtons } from "@/components/appearance-theme-buttons";
import { StravaToggle } from "@/components/strava-toggle";
import { CoachDisconnect } from "@/components/coach-disconnect";
import { EmailPreferencesCard } from "@/components/email-preferences";

// ---------- Sub-components ------------------------------------------------

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <p className="eyebrow">{title}</p>
        {description && (
          <p
            style={{
              fontSize: 13,
              color: "var(--color-ink-muted)",
              margin: "4px 0 0",
            }}
          >
            {description}
          </p>
        )}
      </div>
      <div style={{ padding: "20px 24px", flex: 1 }}>{children}</div>
    </div>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function AthleteSettingsPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const userId = session.user.id;
  const email = session.user.email ?? "";

  const cookieStore = await cookies();
  const theme = cookieStore.get("da2-theme")?.value ?? "light";

  const [stravaConnected, coach, prefsRow] = await Promise.all([
    hasStravaToken(admin, userId),
    getAthleteCoach(admin, userId),
    // service-role: explicit user filter required
    admin
      .from("users")
      .select("email_weekly_review, email_monthly_review")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  // Both default false (migration 0030), so a failed read degrades to "off"
  // -- the safe direction for an opt-in: it never shows a toggle as on when
  // we could not confirm it is.
  const emailPreferences = {
    weeklyReview: prefsRow.data?.email_weekly_review === true,
    monthlyReview: prefsRow.data?.email_monthly_review === true,
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--color-ink)",
            margin: 0,
          }}
        >
          Settings
        </h1>
        <p style={{ color: "var(--color-ink-muted)", marginTop: 6, fontSize: 15 }}>
          Manage your account, integrations, and preferences.
        </p>
      </div>

      {/* 2-column grid on wide screens */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 20,
          alignItems: "stretch",
        }}
      >
        {/* Appearance */}
        <SectionCard
          title="Appearance"
          description="Choose your preferred color theme."
        >
          <AppearanceThemeButtons initialTheme={theme} fullWidth />
        </SectionCard>

        {/* Strava */}
        <SectionCard
          title="Strava"
          description="Sync your workouts automatically after every activity."
        >
          <StravaToggle initialConnected={stravaConnected} />
        </SectionCard>

        {/* Coach */}
        <SectionCard
          title="Coach"
          description="Your linked training partner."
        >
          {coach ? (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  background: "var(--color-canvas-soft)",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "var(--color-pine)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {coach.displayName.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                      color: "var(--color-ink)",
                      margin: 0,
                    }}
                  >
                    {coach.displayName}
                  </p>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--color-ink-muted)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {coach.email}
                  </p>
                </div>
              </div>
              <CoachDisconnect coachName={coach.displayName} />
            </div>
          ) : (
            <p style={{ fontSize: 14, color: "var(--color-ink-muted)", margin: 0 }}>
              No coach linked. Ask your coach to invite you &mdash; they&apos;ll send
              you a link to connect.
            </p>
          )}
        </SectionCard>

        {/* Plans */}
        <SectionCard
          title="Plans"
          description="Your active and past training plans."
        >
          <Link
            href="/plans"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              background: "var(--color-canvas-soft)",
              color: "var(--color-ink)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            View plan history
            <span aria-hidden="true">→</span>
          </Link>
        </SectionCard>

        {/* Email */}
        <SectionCard
          title="Email"
          description="Training reviews delivered to your inbox. Off unless you turn them on."
        >
          <EmailPreferencesCard initial={emailPreferences} />
        </SectionCard>

        {/* Account */}
        <SectionCard
          title="Account"
          description="Your signed-in identity and session."
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <p className="eyebrow" style={{ marginBottom: 4 }}>
                Email
              </p>
              <p
                style={{
                  fontSize: 15,
                  color: "var(--color-ink)",
                  margin: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {email}
              </p>
            </div>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                style={{
                  padding: "8px 18px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  border: "1px solid var(--color-border-strong)",
                  background: "transparent",
                  color: "var(--color-ink-muted)",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
