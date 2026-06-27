import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { hasStravaToken } from "@/db/strava-tokens";

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

function stravaErrorMessage(code: string): string {
  switch (code) {
    case "cancelled":
      return "Strava connection cancelled.";
    case "session_expired":
      return "Your session expired before connecting. Try again.";
    case "strava_account_already_linked":
      return "This Strava account is already linked to another user.";
    case "unauthorized":
      return "You must be signed in to connect Strava.";
    case "config_error":
      return "Strava is not configured. Contact support.";
    default:
      return "Something went wrong. Try again.";
  }
}

export default async function AthleteProfilePage({ searchParams }: PageProps) {
  const session = await getUserWithRoles();
  const params = await searchParams;

  const admin = createAdminClient();
  const stravaConnected = session
    ? await hasStravaToken(admin, session.user.id)
    : false;

  const justConnected = params.strava_connected === "1";
  const stravaError = params.strava_error;

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ marginBottom: 16 }}>Profile</h1>
      <p>
        <strong>Email:</strong> {session?.user.email ?? "—"}
      </p>

      {/* Strava integration */}
      <div
        style={{
          marginTop: 32,
          padding: 20,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: "var(--ink-subtle)",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Strava
        </p>

        {justConnected || stravaConnected ? (
          <div>
            <p style={{ color: "var(--success, #16a34a)", fontWeight: 600 }}>
              Connected to Strava
            </p>
            {justConnected && (
              <p
                style={{
                  color: "var(--ink-subtle)",
                  fontSize: 14,
                  marginTop: 8,
                }}
              >
                Backfilling your recent activities in the background.
              </p>
            )}
            <p
              style={{
                color: "var(--ink-subtle)",
                fontSize: 12,
                marginTop: 4,
              }}
            >
              Powered by Strava
            </p>
          </div>
        ) : (
          <div>
            <p style={{ color: "var(--ink)", marginBottom: 12, fontSize: 14 }}>
              Connect Strava to pull your last 200 activities and keep your
              calendar in sync.
            </p>
            {stravaError && (
              <p
                style={{
                  color: "var(--danger, #dc2626)",
                  fontSize: 14,
                  marginBottom: 12,
                }}
              >
                {stravaErrorMessage(stravaError)}
              </p>
            )}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/integrations/strava/authorize"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                borderRadius: 8,
                background: "var(--brand, #fc4c02)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Connect Strava
            </a>
          </div>
        )}
      </div>

      <form action="/auth/sign-out" method="post" style={{ marginTop: 24 }}>
        <button
          type="submit"
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            background: "var(--surface)",
            color: "var(--danger)",
            border: "1px solid var(--border)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
