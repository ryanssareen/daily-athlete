import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getWorkoutById } from "@/db/workouts";
import { hasStravaToken } from "@/db/strava-tokens";

import { Hero } from "./Hero";
import { MapCard, MapEmpty } from "./MapCard";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
};

// ─── Back nav ─────────────────────────────────────────────────────────────────

const VALID_FROM = new Set(["dashboard", "activities", "calendar"]);

function backHrefFor(from: string | undefined): Route {
  if (from && VALID_FROM.has(from)) {
    if (from === "dashboard") return "/athlete" as Route;
    return `/athlete/${from}` as Route;
  }
  return "/athlete/activities" as Route;
}

function backLabelFor(from: string | undefined): string {
  if (from === "dashboard") return "Dashboard";
  if (from === "calendar") return "Calendar";
  return "Activities";
}

// ─── Overflow stats panel ─────────────────────────────────────────────────────

const NAMED_KEYS = new Set([
  "average_speed", "max_speed",
  "average_heartrate", "max_heartrate",
  "average_watts", "max_watts",
  "total_elevation_gain",
  "suffer_score",
  "average_cadence",
  "name",
  "polyline",
]);

function labelFor(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AthleteWorkoutDetailPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const from = sp.from;
  const backHref = backHrefFor(from);
  const backLabel = backLabelFor(from);

  const [session, supabase] = await Promise.all([getUserWithRoles(), createClient()]);
  if (!session) redirect("/sign-in");

  const workout = await getWorkoutById(supabase, session.user.id, id);
  if (!workout) redirect(backHref);

  const stats = workout.summary_stats;
  const isStrava = workout.source === "strava";
  const sport = workout.sport.toLowerCase();
  const polyline = typeof stats.polyline === "string" ? stats.polyline : null;
  const isGPSSport = sport !== "strength" && sport !== "mobility";

  let showStravaConnect = false;
  if (!isStrava) {
    const admin = createAdminClient();
    showStravaConnect = !(await hasStravaToken(admin, session.user.id));
  }

  const overflowEntries = Object.entries(stats).filter(([k, v]) => !NAMED_KEYS.has(k) && v != null);

  return (
    <div className="wd-container">
      <Hero
        workout={workout}
        timezone={session.timezone}
        backHref={backHref}
        backLabel={backLabel}
      />

      {isGPSSport && (
        polyline
          ? <MapCard polyline={polyline} />
          : isStrava && <MapEmpty isStrava />
      )}

      {showStravaConnect && (
        <div className="wd-manual-nudge">
          Logged manually —{" "}
          <Link href={"/athlete/settings" as Route}>connect Strava</Link>{" "}
          to unlock detailed stats and the route map.
        </div>
      )}

      {overflowEntries.length > 0 && (
        <details>
          <summary className="wd-overflow-summary">
            More stats ({overflowEntries.length})
          </summary>
          <div className="wd-overflow-panel">
            {overflowEntries.map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-ink-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {labelFor(k)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--color-ink)",
                  }}
                >
                  {String(v)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <footer className="wd-foot">
        <span>Workout · {workout.id.slice(0, 8)}</span>
        {isStrava && (
          <>
            <span className="wd-meta-dot">·</span>
            <span>Synced from Strava</span>
          </>
        )}
      </footer>
    </div>
  );
}
