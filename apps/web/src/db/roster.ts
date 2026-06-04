import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkoutRow } from "./workouts";

export interface AthleteEntry {
  linkId: string;
  athleteId: string;
  displayName: string;
  email: string;
  lastActivityAt: string | null; // ISO from completed_workouts
  weekCount: number; // completed workouts in last 7 days
}

export interface CoachEntry {
  linkId: string;
  coachId: string;
  displayName: string;
  email: string;
}

/**
 * Returns all active linked athletes for a coach, with last activity stats.
 * Uses admin client (service-role) to join across users table.
 */
export async function getCoachRoster(
  admin: SupabaseClient,
  coachId: string
): Promise<AthleteEntry[]> {
  // service-role: explicit user filter required (filtered by coach_user_id)
  const { data: links, error: linksError } = await admin
    .from("coach_athlete_links")
    .select("id, athlete_user_id")
    .eq("coach_user_id", coachId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (linksError) {
    throw new Error(`getCoachRoster links query failed: ${linksError.message}`);
  }
  if (!links || links.length === 0) return [];

  const athleteIds = links.map((l: { id: string; athlete_user_id: string }) => l.athlete_user_id);

  // Fetch user profiles for all athletes
  // service-role: explicit user filter required (filtered by id in athleteIds)
  const { data: users, error: usersError } = await admin
    .from("users")
    .select("id, email, display_name")
    .in("id", athleteIds);

  if (usersError) {
    throw new Error(`getCoachRoster users query failed: ${usersError.message}`);
  }
  const userMap = new Map<string, { email: string; display_name: string | null }>(
    (users ?? []).map((u: { id: string; email: string; display_name: string | null }) => [
      u.id,
      { email: u.email, display_name: u.display_name },
    ])
  );

  // Compute last 7 days cutoff
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const cutoff = sevenDaysAgo.toISOString();

  // Fetch activity data for all athletes in one query
  // service-role: explicit user filter required (filtered by athlete_id in athleteIds)
  const { data: activities, error: actError } = await admin
    .from("completed_workouts")
    .select("athlete_id, started_at")
    .in("athlete_id", athleteIds)
    .is("deleted_at", null)
    .is("superseded_by_id", null)
    .order("started_at", { ascending: false });

  if (actError) {
    throw new Error(`getCoachRoster activities query failed: ${actError.message}`);
  }

  // Build per-athlete stats
  type ActivityRow = { athlete_id: string; started_at: string };
  const activityList = (activities ?? []) as ActivityRow[];
  const lastActivityMap = new Map<string, string>();
  const weekCountMap = new Map<string, number>();

  for (const row of activityList) {
    if (!lastActivityMap.has(row.athlete_id)) {
      lastActivityMap.set(row.athlete_id, row.started_at);
    }
    if (row.started_at >= cutoff) {
      weekCountMap.set(row.athlete_id, (weekCountMap.get(row.athlete_id) ?? 0) + 1);
    }
  }

  const entries: AthleteEntry[] = links.map(
    (link: { id: string; athlete_user_id: string }) => {
      const profile = userMap.get(link.athlete_user_id);
      return {
        linkId: link.id,
        athleteId: link.athlete_user_id,
        displayName: profile?.display_name ?? profile?.email ?? link.athlete_user_id,
        email: profile?.email ?? "",
        lastActivityAt: lastActivityMap.get(link.athlete_user_id) ?? null,
        weekCount: weekCountMap.get(link.athlete_user_id) ?? 0,
      };
    }
  );

  // Sort by last activity descending (nulls last)
  entries.sort((a, b) => {
    if (a.lastActivityAt === null && b.lastActivityAt === null) return 0;
    if (a.lastActivityAt === null) return 1;
    if (b.lastActivityAt === null) return -1;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });

  return entries;
}

/**
 * Returns recent completed workouts for a specific athlete (for coach view).
 * Uses admin client (service-role).
 */
export async function getAthleteWorkouts(
  admin: SupabaseClient,
  athleteId: string,
  limit = 30
): Promise<WorkoutRow[]> {
  // service-role: explicit user filter required (filtered by athlete_id)
  const { data, error } = await admin
    .from("completed_workouts")
    .select("id, started_at, sport, duration_s, distance_m, source")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .is("superseded_by_id", null)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`getAthleteWorkouts failed: ${error.message}`);
  }
  return (data ?? []) as WorkoutRow[];
}

/**
 * Returns the coach linked to an athlete (if any).
 *
 * Uses the service-role admin client. The coach-profile lookup (second query)
 * reads another user's public.users row, which the RLS-scoped client cannot
 * do: public.users has only a self-SELECT policy (auth.uid() = id, migration
 * 0001), so an athlete can never read their coach's row. With the RLS client
 * the second query returned zero rows and the function reported "no coach"
 * even when an active link existed. Every query here is explicitly filtered by
 * athlete_user_id, matching the service-role convention used by getCoachRoster
 * and the /join/coach paths, so no cross-athlete leakage is possible. Callers
 * MUST pass the authenticated athlete's own id.
 */
export async function getAthleteCoach(
  admin: SupabaseClient,
  athleteId: string
): Promise<CoachEntry | null> {
  // service-role: explicit user filter required (filtered by athlete_user_id)
  const { data: link, error: linkError } = await admin
    .from("coach_athlete_links")
    .select("id, coach_user_id")
    .eq("athlete_user_id", athleteId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (linkError) {
    throw new Error(`getAthleteCoach link query failed: ${linkError.message}`);
  }
  if (!link) return null;

  // service-role: explicit user filter required (filtered by coach_user_id)
  const { data: coach, error: coachError } = await admin
    .from("users")
    .select("id, email, display_name")
    .eq("id", link.coach_user_id)
    .maybeSingle();

  if (coachError) {
    throw new Error(`getAthleteCoach users query failed: ${coachError.message}`);
  }
  if (!coach) return null;

  return {
    linkId: link.id,
    coachId: link.coach_user_id,
    displayName: coach.display_name ?? coach.email ?? link.coach_user_id,
    email: coach.email ?? "",
  };
}

/**
 * Archives (soft-deletes) the athlete's current active coach link, letting the
 * athlete leave their coach. Sets status='archived', deleted_at=now() — the
 * same soft-delete shape the coach-side archive uses, so the row drops out of
 * the partial unique index and the athlete can immediately join a new coach.
 *
 * Service-role client with an explicit athlete_user_id filter (same rationale
 * as getAthleteCoach): the filter is the authorization boundary, so callers
 * MUST pass the authenticated athlete's own id. Idempotent — returns null when
 * there is no active link, so a double-disconnect is a no-op rather than an
 * error.
 */
export async function archiveAthleteCoachLink(
  admin: SupabaseClient,
  athleteId: string
): Promise<{ linkId: string; coachId: string } | null> {
  // service-role: explicit user filter required (filtered by athlete_user_id)
  const { data: link, error: linkError } = await admin
    .from("coach_athlete_links")
    .select("id, coach_user_id")
    .eq("athlete_user_id", athleteId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (linkError) {
    throw new Error(`archiveAthleteCoachLink link query failed: ${linkError.message}`);
  }
  if (!link) return null;

  // service-role: scoped to this athlete's own active link id (resolved above).
  const { error: updateError } = await admin
    .from("coach_athlete_links")
    .update({ status: "archived", deleted_at: new Date().toISOString() })
    .eq("id", link.id);

  if (updateError) {
    throw new Error(`archiveAthleteCoachLink update failed: ${updateError.message}`);
  }

  return { linkId: link.id, coachId: link.coach_user_id };
}
