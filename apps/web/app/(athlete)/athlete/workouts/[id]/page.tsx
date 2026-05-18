import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { getWorkoutById } from "@/db/workouts";
import { hasStravaToken } from "@/db/strava-tokens";
import { hydrateStravaWorkout } from "@/strava/hydrate-workout";
import { StravaRateLimited, StravaReauthRequired } from "@/strava/errors";

import { Hero } from "./Hero";
import { MapCard, MapEmpty } from "./MapCard";
import { HeartRateCard, isHrZoneEntry } from "./HeartRateCard";
import { ZoneDistribution } from "./ZoneDistribution";
import { LapSplits } from "./LapSplits";
import { StatsDetail } from "./StatsDetail";

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


// ─── Lazy auto-hydration ──────────────────────────────────────────────────────

const HYDRATE_TIMEOUT_MS = 5000;
// Negative-cache window. After Strava returns rate-limit / re-auth / a
// transient error we stamp `hydrate_error_at` on summary_stats so the
// next 10 minutes of page views skip the retry storm. The explicit
// "Sync from Strava" button always bypasses this cache.
const HYDRATE_BACKOFF_MS = 10 * 60 * 1000;

/**
 * True when this workout should trigger an inline Strava enrichment call
 * on this server render. Conservative gates: Strava-sourced, GPS sport,
 * has an activity ID, hasn't been hydrated yet, AND no recent failure
 * (negative cache).
 */
function shouldHydrate(workout: Awaited<ReturnType<typeof getWorkoutById>>) {
  if (!workout) return false;
  if (workout.source !== "strava") return false;
  if (!workout.strava_activity_id) return false;
  const sport = workout.sport.toLowerCase();
  if (!["bike", "run", "swim", "ride"].includes(sport)) return false;
  if (workout.summary_stats.hydrated_at != null) return false;
  // Negative cache: skip hydration for 10 minutes after the last failure
  // to avoid a retry storm against a rate-limited Strava upstream.
  const errAt = workout.summary_stats.hydrate_error_at;
  if (typeof errAt === "string") {
    const errTime = Date.parse(errAt);
    if (Number.isFinite(errTime) && Date.now() - errTime < HYDRATE_BACKOFF_MS) {
      return false;
    }
  }
  return true;
}

/**
 * Run `hydrateStravaWorkout` with a hard timeout. On timeout or any
 * error we return `null` — the caller renders the page with whatever
 * `summary_stats` was loaded from DB. Rate-limit / re-auth errors stamp
 * a negative-cache marker on the workout row so subsequent renders
 * back off (REL-003 fix). The "Sync from Strava" button always
 * bypasses this and surfaces the error to the user.
 *
 * NB: the in-flight Strava requests are not cancelled on timeout — we
 * don't yet plumb an AbortController through the StravaClient. The
 * conditional UPDATE in `hydrateStravaWorkout` makes a late-arriving
 * winner harmless (it sees `hydrated_at IS NOT NULL` from the timeout's
 * stamp and no-ops).
 */
async function hydrateWithTimeout(args: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  workoutId: string;
  stravaActivityId: number;
  durationSec: number | null;
}): Promise<Record<string, unknown> | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), HYDRATE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      hydrateStravaWorkout(args).then((r) => r.summary_stats),
      timeoutPromise,
    ]);
    return result;
  } catch (err) {
    // Don't dump raw error messages (might contain Zod-parsed PII from
    // a malformed Strava response). Log error class + path only.
    const errClass =
      err instanceof StravaRateLimited ? "rate_limited" :
      err instanceof StravaReauthRequired ? "reauth_required" :
      err instanceof Error ? err.name :
      "unknown";
    console.warn(`[workout-detail] auto-hydration failed: ${errClass}`);
    // Negative-cache: stamp the failure so we don't retry for 10 min.
    await stampHydrateError(args.admin, args.userId, args.workoutId).catch((stampErr) => {
      console.warn("[workout-detail] failed to stamp hydrate_error_at", stampErr instanceof Error ? stampErr.message : stampErr);
    });
    return null;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/** Stamp summary_stats.hydrate_error_at without clobbering other keys. */
async function stampHydrateError(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  workoutId: string
): Promise<void> {
  // service-role: explicit user filter required
  const { data } = await admin
    .from("completed_workouts")
    .select("summary_stats")
    .eq("id", workoutId)
    .eq("athlete_id", userId)
    .maybeSingle();
  if (!data) return;
  const current = (data.summary_stats as Record<string, unknown>) ?? {};
  const next = { ...current, hydrate_error_at: new Date().toISOString() };
  // service-role: explicit user filter required
  await admin
    .from("completed_workouts")
    .update({ summary_stats: next })
    .eq("id", workoutId)
    .eq("athlete_id", userId);
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

  // Lazy auto-hydration: if this is a Strava workout that hasn't been
  // enriched with laps/zones/derived metrics yet, fetch them inline
  // before rendering. Capped at 5 s so Strava outages don't block the
  // page. On any failure, render with stale data. Gated additionally
  // on the athlete actually having a Strava token (SEC-1 fix: avoid
  // log-spam from auto-trigger on disconnected accounts).
  let enrichedStats: Record<string, unknown> | null = null;
  if (shouldHydrate(workout)) {
    const admin = createAdminClient();
    const hasToken = await hasStravaToken(admin, session.user.id);
    if (hasToken) {
      enrichedStats = await hydrateWithTimeout({
        admin,
        userId: session.user.id,
        workoutId: workout.id,
        stravaActivityId: workout.strava_activity_id!,
        durationSec: workout.duration_s,
      });
    }
  }

  // Prefer the enriched stats when hydration succeeded; otherwise the
  // DB row's existing value. Build a shallow-cloned workout for the
  // renderer rather than mutating the value returned from
  // getWorkoutById (friendlier to any future caching layer).
  const stats = enrichedStats ?? workout.summary_stats;
  const renderWorkout = enrichedStats ? { ...workout, summary_stats: enrichedStats } : workout;
  const isStrava = workout.source === "strava";
  const sport = workout.sport.toLowerCase();
  const polyline = typeof stats.polyline === "string" ? stats.polyline : null;
  const isGPSSport = sport !== "strength" && sport !== "mobility";

  let showStravaConnect = false;
  if (!isStrava) {
    const admin = createAdminClient();
    showStravaConnect = !(await hasStravaToken(admin, session.user.id));
  }

  // Heart rate
  const avgHr = typeof stats.average_heartrate === "number" && Number.isFinite(stats.average_heartrate)
    ? stats.average_heartrate : null;
  const maxHr = typeof stats.max_heartrate === "number" && Number.isFinite(stats.max_heartrate)
    ? stats.max_heartrate : null;

  // Zones + laps section gating
  // HR zone is surfaced by HeartRateCard; pass only power zones to ZoneDistribution.
  const zonesValue = stats.zones;
  const allZones = Array.isArray(zonesValue) && zonesValue.length > 0 ? zonesValue : null;
  const hrZone = allZones?.find(isHrZoneEntry) ?? null;
  const powerZones = allZones?.filter((z) => !isHrZoneEntry(z)) ?? null;
  const zones = powerZones && powerZones.length > 0 ? powerZones : null;
  const lapsValue = stats.laps;
  const laps = Array.isArray(lapsValue) && lapsValue.length > 0 ? lapsValue : null;

  return (
    <div className="wd-container">
      <Hero
        workout={renderWorkout}
        timezone={session.timezone}
        backHref={backHref}
        backLabel={backLabel}
      />

      {isGPSSport && (
        polyline
          ? <MapCard polyline={polyline} />
          : isStrava && <MapEmpty isStrava />
      )}

      <HeartRateCard avgHr={avgHr} maxHr={maxHr} hrZone={hrZone} />

      {zones && <ZoneDistribution zones={zones} />}
      {laps && <LapSplits laps={laps} sport={sport} />}

      {showStravaConnect && (
        <div className="wd-manual-nudge">
          Logged manually —{" "}
          <Link href={"/athlete/settings" as Route}>connect Strava</Link>{" "}
          to unlock detailed stats and the route map.
        </div>
      )}

      <StatsDetail stats={stats} />

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
