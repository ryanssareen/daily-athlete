// First client Realtime subscription in the repo (Unit 11). Subscribes to the
// athlete's `weekly_reviews` rows (proposal lifecycle) and `planned_workouts`
// (the applied edits land here) so the proposal surface + calendar update live
// without a poll.
//
// Both tables are on the realtime allow-list (packages/shared
// realtime-allowlist.ts: weekly_reviews added 0019, planned_workouts added
// 0007). RLS self-select scopes the stream to the caller's own rows; we add an
// explicit `athlete_id=eq.<id>` server-side filter so a coach client (who can
// read multiple athletes) only wakes for the athlete it is viewing.
//
// Design: the helper is a thin, framework-agnostic wrapper over
// supabase-js `.channel().on('postgres_changes', ...)`. Callers pass an
// `onChange` callback that triggers a refetch (we do not trust the realtime
// payload as the source of truth — it is a "something changed, re-read" nudge,
// which keeps the authorization + Zod-validation on the GET path).

import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";

export interface WeeklyReviewSubscriptionOptions {
  /** The athlete whose proposals + planned workouts to watch. */
  athleteId: string;
  /**
   * Called on any insert/update to weekly_reviews or planned_workouts for the
   * athlete. Treat as a "re-read" nudge — refetch via GET, do not consume the
   * payload directly (it is unvalidated + unauthorized).
   */
  onChange: (table: "weekly_reviews" | "planned_workouts") => void;
  /** Optional: surface SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED. */
  onStatus?: (status: string) => void;
}

/**
 * Open a channel watching the athlete's proposals + planned workouts. Returns
 * an unsubscribe function the caller invokes on unmount / athlete change.
 */
export function subscribeToWeeklyReviews(
  client: SupabaseClient,
  opts: WeeklyReviewSubscriptionOptions
): () => void {
  const channel: RealtimeChannel = client
    .channel(`weekly-reviews:${opts.athleteId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "weekly_reviews",
        filter: `athlete_id=eq.${opts.athleteId}`,
      },
      (_payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        opts.onChange("weekly_reviews");
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "planned_workouts",
        filter: `athlete_id=eq.${opts.athleteId}`,
      },
      (_payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        opts.onChange("planned_workouts");
      }
    )
    .subscribe((status) => {
      opts.onStatus?.(status);
    });

  return () => {
    void client.removeChannel(channel);
  };
}
