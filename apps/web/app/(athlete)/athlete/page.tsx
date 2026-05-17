import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { getRecentWorkouts, getThisWeekStats } from "@/db/workouts";

// ---------- Helpers -------------------------------------------------------

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function formatDistance(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

function formatDurationStat(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

const sportEmoji: Record<string, string> = {
  swim: "🏊",
  bike: "🚴",
  ride: "🚴",
  run: "🏃",
  strength: "💪",
  mobility: "🧘",
};

function getSportEmoji(sport: string): string {
  const lower = sport.toLowerCase();
  for (const [key, emoji] of Object.entries(sportEmoji)) {
    if (lower.includes(key)) return emoji;
  }
  return "⚡";
}

function getGreeting(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(email: string): string {
  const local = email.split("@")[0];
  // Try to extract a name from common patterns like "john.doe" or "johndoe"
  const parts = local.split(/[._]/);
  const first = parts[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------- Sub-components ------------------------------------------------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <p className="eyebrow">{label}</p>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 32,
          fontWeight: 600,
          color: "var(--color-ink)",
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          marginTop: 4,
        }}
      >
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", marginTop: 2 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function AthleteDashboardPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const supabase = await createClient();
  const userId = session.user.id;

  const [weekStats, recentWorkouts] = await Promise.all([
    getThisWeekStats(supabase, userId),
    getRecentWorkouts(supabase, userId, 5),
  ]);

  const greeting = getGreeting();
  const firstName = getFirstName(session.user.email ?? "Athlete");

  const hasWorkouts = recentWorkouts.length > 0;

  return (
    <div style={{ maxWidth: 800 }}>
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
          {greeting}, {firstName}.
        </h1>
        <p style={{ color: "var(--color-ink-muted)", marginTop: 6, fontSize: 15 }}>
          Here&apos;s your training this week.
        </p>
      </div>

      {/* Week stats */}
      <section style={{ marginBottom: 40 }}>
        <p className="eyebrow" style={{ marginBottom: 14 }}>
          This week
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          <StatCard
            label="Workouts"
            value={weekStats.count.toString()}
            sub="sessions completed"
          />
          <StatCard
            label="Time"
            value={formatDurationStat(weekStats.totalDurationS)}
            sub="hours : minutes"
          />
          <StatCard
            label="Distance"
            value={weekStats.totalDistanceM > 0 ? formatDistance(weekStats.totalDistanceM) : "—"}
            sub="total this week"
          />
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <p className="eyebrow">Recent activity</p>
          <Link
            href={"/athlete/activities" as Route}
            style={{
              fontSize: 13,
              color: "var(--color-clay)",
              fontWeight: 500,
            }}
          >
            View all →
          </Link>
        </div>

        {hasWorkouts ? (
          <div
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {recentWorkouts.map((w, i) => (
              <div
                key={w.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 20px",
                  borderBottom:
                    i < recentWorkouts.length - 1
                      ? "1px solid var(--color-border)"
                      : "none",
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1, width: 28, textAlign: "center" }}>
                  {getSportEmoji(w.sport)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                      color: "var(--color-ink)",
                      textTransform: "capitalize",
                      margin: 0,
                    }}
                  >
                    {w.sport}
                  </p>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--color-ink-muted)",
                      margin: 0,
                    }}
                  >
                    {formatDate(w.started_at)}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  {w.duration_s != null && (
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        color: "var(--color-ink)",
                        margin: 0,
                      }}
                    >
                      {formatDuration(w.duration_s)}
                    </p>
                  )}
                  {w.distance_m != null && w.distance_m > 0 && (
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--color-ink-muted)",
                        margin: 0,
                      }}
                    >
                      {formatDistance(w.distance_m)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              padding: "40px 32px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 15,
                color: "var(--color-ink-muted)",
                marginBottom: 16,
              }}
            >
              Connect Strava or log a workout to see your activity here.
            </p>
            <Link
              href={"/athlete/activities" as Route}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 18px",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 500,
                background: "var(--color-ink)",
                color: "var(--color-canvas)",
              }}
            >
              Get started
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
