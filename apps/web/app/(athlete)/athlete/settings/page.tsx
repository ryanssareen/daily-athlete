import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { hasStravaToken } from "@/db/strava-tokens";
import { getAthleteCoach } from "@/db/roster";

// ---------- Sub-components ------------------------------------------------

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        overflow: "hidden",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <p className="eyebrow">{title}</p>
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
    </div>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function AthleteSettingsPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const supabase = await createClient();
  const admin = createAdminClient();
  const userId = session.user.id;
  const email = session.user.email ?? "";

  const cookieStore = await cookies();
  const theme = cookieStore.get("da2-theme")?.value ?? "light";

  const [stravaConnected, coach] = await Promise.all([
    hasStravaToken(admin, userId),
    getAthleteCoach(supabase, userId),
  ]);

  return (
    <div style={{ maxWidth: 640 }}>
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
          Manage your account and integrations.
        </p>
      </div>

      {/* Appearance */}
      <SectionCard title="Appearance">
        <p style={{ fontSize: 14, color: "var(--color-ink-muted)", marginBottom: 14 }}>
          Choose your preferred color theme.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          {(["light", "dark"] as const).map((t) => {
            const isActive = theme === t;
            return (
              <form key={t} action="/api/theme" method="post">
                <input type="hidden" name="theme" value={t} />
                <button
                  type="submit"
                  style={{
                    padding: "8px 18px",
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    border: isActive
                      ? "2px solid var(--color-clay)"
                      : "1px solid var(--color-border)",
                    background: isActive ? "var(--color-clay-soft)" : "transparent",
                    color: isActive ? "var(--color-clay-deep)" : "var(--color-ink-muted)",
                    transition: "all 120ms ease",
                  }}
                >
                  {t === "light" ? "☀️ Light" : "🌙 Dark"}
                </button>
              </form>
            );
          })}
        </div>
      </SectionCard>

      {/* Strava */}
      <SectionCard title="Strava">
        {stravaConnected ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--color-pine)",
                  display: "inline-block",
                }}
              />
              <p style={{ fontSize: 14, color: "var(--color-ink)", margin: 0, fontWeight: 500 }}>
                Connected to Strava
              </p>
            </div>
            <form action="/api/integrations/strava/disconnect" method="post">
              <button
                type="submit"
                style={{
                  padding: "7px 16px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  border: "1px solid var(--color-danger)",
                  background: "transparent",
                  color: "var(--color-danger)",
                }}
              >
                Disconnect
              </button>
            </form>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 14, color: "var(--color-ink-muted)", marginBottom: 14 }}>
              Connect Strava to sync your workouts automatically after every activity.
            </p>
            <Link
              href="/api/integrations/strava/authorize"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 18px",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 500,
                background: "#FC4C02",
                color: "#fff",
              }}
            >
              Connect Strava
            </Link>
          </div>
        )}
      </SectionCard>

      {/* Coach */}
      <SectionCard title="Coach">
        {coach ? (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
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
              <div>
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
                <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: 0 }}>
                  {coach.email}
                </p>
              </div>
            </div>
            <p
              style={{
                fontSize: 13,
                color: "var(--color-ink-subtle)",
                marginTop: 12,
              }}
            >
              To remove this coach link, contact {coach.displayName} directly.
            </p>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--color-ink-muted)" }}>
            No coach linked. Ask your coach to invite you — they&apos;ll send you a link to connect.
          </p>
        )}
      </SectionCard>

      {/* Account */}
      <SectionCard title="Account">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <p className="eyebrow" style={{ marginBottom: 2 }}>
              Email
            </p>
            <p style={{ fontSize: 15, color: "var(--color-ink)", margin: 0 }}>{email}</p>
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              style={{
                padding: "7px 16px",
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
  );
}
