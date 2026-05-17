import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { getRecentWorkouts, type WorkoutRow } from "@/db/workouts";

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

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function getMonthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function groupByMonth(workouts: WorkoutRow[]): { label: string; workouts: WorkoutRow[] }[] {
  const groups: { label: string; workouts: WorkoutRow[] }[] = [];
  const seen = new Map<string, number>();

  for (const w of workouts) {
    const label = getMonthLabel(w.started_at);
    if (seen.has(label)) {
      groups[seen.get(label)!].workouts.push(w);
    } else {
      seen.set(label, groups.length);
      groups.push({ label, workouts: [w] });
    }
  }

  return groups;
}

// ---------- Page ----------------------------------------------------------

export default async function AthleteActivitiesPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const supabase = await createClient();
  const workouts = await getRecentWorkouts(supabase, session.user.id, 50);
  const groups = groupByMonth(workouts);

  return (
    <div style={{ maxWidth: 760 }}>
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
          Activities
        </h1>
        <p style={{ color: "var(--color-ink-muted)", marginTop: 6, fontSize: 15 }}>
          Your recent training sessions.
        </p>
      </div>

      {workouts.length === 0 ? (
        /* Empty state */
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: "56px 40px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 32,
              marginBottom: 12,
              lineHeight: 1,
            }}
          >
            ⚡
          </p>
          <p
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--color-ink)",
              marginBottom: 8,
            }}
          >
            No activities yet
          </p>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-ink-muted)",
              marginBottom: 24,
            }}
          >
            Connect Strava to sync your workouts automatically.
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
            Connect Strava
          </Link>
        </div>
      ) : (
        /* Activity list grouped by month */
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {groups.map((group) => (
            <div key={group.label}>
              <p
                className="eyebrow"
                style={{ marginBottom: 12 }}
              >
                {group.label}
              </p>
              <div
                style={{
                  background: "var(--color-paper)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                {group.workouts.map((w, i) => (
                  <div
                    key={w.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 20px",
                      borderBottom:
                        i < group.workouts.length - 1
                          ? "1px solid var(--color-border)"
                          : "none",
                    }}
                  >
                    {/* Sport emoji */}
                    <span
                      style={{
                        fontSize: 20,
                        lineHeight: 1,
                        width: 28,
                        textAlign: "center",
                        flexShrink: 0,
                      }}
                    >
                      {getSportEmoji(w.sport)}
                    </span>

                    {/* Sport + date */}
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
                        {formatDateFull(w.started_at)}
                      </p>
                    </div>

                    {/* Duration + distance */}
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
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

                    {/* Source badge */}
                    <span
                      style={{
                        flexShrink: 0,
                        padding: "3px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                        fontFamily: "var(--font-mono)",
                        background:
                          w.source === "strava"
                            ? "color-mix(in oklab, var(--color-clay) 15%, transparent)"
                            : "var(--color-canvas-soft)",
                        color:
                          w.source === "strava"
                            ? "var(--color-clay-deep)"
                            : "var(--color-ink-muted)",
                        border:
                          w.source === "strava"
                            ? "1px solid color-mix(in oklab, var(--color-clay) 30%, transparent)"
                            : "1px solid var(--color-border)",
                        textTransform: "capitalize",
                      }}
                    >
                      {w.source}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
