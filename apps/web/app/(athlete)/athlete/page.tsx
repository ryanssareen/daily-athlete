import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import {
  getPlannedInRange,
  getRecentWorkouts,
  getThisWeekStats,
  type PlannedRow,
} from "@/db/workouts";

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

function getSportColor(sport: string): string {
  const lower = sport.toLowerCase();
  if (lower.includes("run")) return "#2d6a4f";
  if (lower.includes("swim")) return "#2563eb";
  if (lower.includes("bike") || lower.includes("ride")) return "#d97706";
  if (lower.includes("strength")) return "var(--color-clay)";
  if (lower.includes("mobility")) return "#0891b2";
  return "var(--color-ink-subtle)";
}

function getGreeting(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(email: string): string {
  const local = email.split("@")[0];
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

function formatPlannedDate(dateStr: string): string {
  const todayStr = new Date().toISOString().split("T")[0];
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
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

function PanelCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <p className="eyebrow" style={{ margin: 0 }}>
          {title}
        </p>
        {action}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function AthleteDashboardPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const supabase = await createClient();
  const userId = session.user.id;

  // Date math for "next 7 days" planned window
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const in7 = new Date(now);
  in7.setUTCDate(now.getUTCDate() + 7);
  const in7Str = in7.toISOString().split("T")[0];

  const [weekStats, recentWorkouts, upcomingPlanned] = await Promise.all([
    getThisWeekStats(supabase, userId),
    getRecentWorkouts(supabase, userId, 6),
    getPlannedInRange(supabase, userId, todayStr, in7Str),
  ]);

  const greeting = getGreeting();
  const firstName = getFirstName(session.user.email ?? "Athlete");
  const hasWorkouts = recentWorkouts.length > 0;

  // Sport distribution from this week (for the right-rail breakdown)
  const sportEntries = Object.entries(weekStats.sports).sort((a, b) => b[1] - a[1]);
  const sportTotal = sportEntries.reduce((s, [, n]) => s + n, 0);

  // Filter & sort upcoming planned (skip ones already marked completed/skipped/moved)
  const upcoming: PlannedRow[] = upcomingPlanned
    .filter((p) => p.status === "planned")
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .slice(0, 5);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
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

      {/* Week stats — full width */}
      <section style={{ marginBottom: 28 }}>
        <p className="eyebrow" style={{ marginBottom: 12 }}>
          This week
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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
          <StatCard
            label="Planned"
            value={upcoming.length.toString()}
            sub="next 7 days"
          />
        </div>
      </section>

      {/* 2-column main area: recent activity (left, wider) + side rail (right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* Recent activity */}
        <PanelCard
          title="Recent activity"
          action={
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
          }
        >
          {hasWorkouts ? (
            <div>
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
                  <span
                    style={{
                      fontSize: 22,
                      lineHeight: 1,
                      width: 28,
                      textAlign: "center",
                    }}
                  >
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
                href={"/athlete/settings" as Route}
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
        </PanelCard>

        {/* Side rail: upcoming + sport breakdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Upcoming planned */}
          <PanelCard
            title="Upcoming"
            action={
              <Link
                href={"/athlete/calendar" as Route}
                style={{
                  fontSize: 13,
                  color: "var(--color-clay)",
                  fontWeight: 500,
                }}
              >
                Calendar →
              </Link>
            }
          >
            {upcoming.length > 0 ? (
              <div>
                {upcoming.map((p, i) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 20px",
                      borderBottom:
                        i < upcoming.length - 1
                          ? "1px solid var(--color-border)"
                          : "none",
                    }}
                  >
                    <span
                      style={{
                        width: 4,
                        height: 28,
                        borderRadius: 2,
                        background: getSportColor(p.sport),
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontWeight: 500,
                          fontSize: 13,
                          color: "var(--color-ink)",
                          textTransform: "capitalize",
                          margin: 0,
                        }}
                      >
                        {getSportEmoji(p.sport)} {p.sport}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-ink-muted)",
                          margin: 0,
                          letterSpacing: "0.02em",
                        }}
                      >
                        {formatPlannedDate(p.scheduled_date)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: "24px 20px",
                  textAlign: "center",
                  color: "var(--color-ink-subtle)",
                  fontSize: 13,
                }}
              >
                Nothing scheduled this week.
              </div>
            )}
          </PanelCard>

          {/* Sport breakdown */}
          <PanelCard title="Sport breakdown">
            {sportTotal > 0 ? (
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                {sportEntries.map(([sport, count]) => {
                  const pct = (count / sportTotal) * 100;
                  return (
                    <div key={sport}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          marginBottom: 4,
                          fontSize: 12,
                        }}
                      >
                        <span
                          style={{
                            color: "var(--color-ink)",
                            textTransform: "capitalize",
                            fontWeight: 500,
                          }}
                        >
                          {getSportEmoji(sport)} {sport}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: "var(--color-ink-muted)",
                          }}
                        >
                          {count}
                        </span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: 6,
                          background: "var(--color-canvas-soft)",
                          borderRadius: 999,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: getSportColor(sport),
                            transition: "width 320ms ease",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  padding: "24px 20px",
                  textAlign: "center",
                  color: "var(--color-ink-subtle)",
                  fontSize: 13,
                }}
              >
                No workouts yet this week.
              </div>
            )}
          </PanelCard>
        </div>
      </div>
    </div>
  );
}
