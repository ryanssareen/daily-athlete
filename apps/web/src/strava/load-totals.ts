import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createStravaClient } from "@/strava/client";
import { fetchAthleteStats } from "@/strava/endpoints";
import { StravaRateLimited, StravaReauthRequired } from "@/strava/errors";
import type { StravaAthleteStats, StravaTotals } from "@/strava/schemas";

export type TotalsPeriod = "recent" | "ytd" | "all";
export type TotalsSport = "run" | "ride" | "swim";

export interface SportTotals {
  sport: TotalsSport;
  recent: StravaTotals;
  ytd: StravaTotals;
  all: StravaTotals;
}

export type StravaTotalsResult =
  | { status: "ok"; sports: SportTotals[] }
  | { status: "unavailable" }
  | { status: "rate_limited" }
  | { status: "reauth_required" }
  | { status: "error" };

const EMPTY: StravaTotals = { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 };

/** Reshape Strava's flat `<period>_<sport>_totals` keys, dropping sports with no activity. */
export function toSportTotals(stats: StravaAthleteStats): SportTotals[] {
  const sports: TotalsSport[] = ["run", "ride", "swim"];
  return sports
    .map((sport) => ({
      sport,
      recent: stats[`recent_${sport}_totals`] ?? EMPTY,
      ytd: stats[`ytd_${sport}_totals`] ?? EMPTY,
      all: stats[`all_${sport}_totals`] ?? EMPTY,
    }))
    .filter((s) => s.all.count > 0 || s.ytd.count > 0 || s.recent.count > 0);
}

/**
 * Fetch the athlete's Strava totals live. Aggregates only; nothing is stored.
 * The caller must already have authenticated `userId`.
 */
export async function loadStravaTotals(args: {
  admin: SupabaseClient;
  userId: string;
}): Promise<StravaTotalsResult> {
  try {
    // service-role: explicit user filter required
    const { data } = await args.admin
      .from("strava_tokens")
      .select("athlete_strava_id")
      .eq("user_id", args.userId)
      .maybeSingle();
    const athleteId = data?.athlete_strava_id as number | undefined;
    if (!athleteId) return { status: "unavailable" };

    const client = createStravaClient(args.userId, args.admin);
    const stats = await fetchAthleteStats(client, athleteId);
    if (!stats) return { status: "unavailable" };
    const sports = toSportTotals(stats);
    return sports.length > 0 ? { status: "ok", sports } : { status: "unavailable" };
  } catch (err) {
    if (err instanceof StravaRateLimited) return { status: "rate_limited" };
    if (err instanceof StravaReauthRequired) return { status: "reauth_required" };
    console.warn(`[strava-totals] fetch failed: ${err instanceof Error ? err.name : "unknown"}`);
    return { status: "error" };
  }
}
