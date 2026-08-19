// useWorkoutReport (Unit U8): fetches a single workout's report via
// GET /api/workouts/:id/report, exposes a `generate` action that POSTs, and
// a sibling hook for the Insights tab's recent-workouts list.
//
// All decision logic (which narrative state to show, how to fold a POST
// outcome in, how the recent-workouts list is bounded) lives in
// ./report-view, which is plain data-in/data-out and unit-tested without
// React Native (see __tests__/useWorkoutReport.test.ts and its header
// comment for why the *hooks* themselves aren't imported by that suite).
//
// KTD2 / this unit's defining UX property: GET never calls the LLM, so the
// verdict + comparison render the instant the GET resolves. `generate()`
// dispatches `generate_start`, which — by construction in reportReducer —
// never clears `response`, so the verdict stays on screen for the entire
// lifetime of the POST. No full-screen spinner ever gates it.

import { useCallback, useEffect, useReducer, useState } from "react";

import type { CompletedWorkoutRow, Verdict, WorkoutReportResponse } from "@da2/shared";

import { api, ApiError } from "@/api/client";
import { supabase } from "@/auth/supabase";

import {
  type GenerateResponse,
  initialReportState,
  type ReportPhase,
  type ReportView,
  RECENT_WORKOUTS_LIMIT,
  reportReducer,
  selectRecentWorkoutIds,
  selectReportView,
} from "./report-view";

export interface UseWorkoutReportResult {
  phase: ReportPhase;
  /** The mapped display props, or null before the first GET resolves. */
  view: ReportView | null;
  /** True while a generate/regenerate/retry POST is in flight. */
  generating: boolean;
  /** Request (or retry) narrative generation. POSTs, then refreshes local state from the response. */
  generate: () => Promise<void>;
  /** Manual re-fetch (e.g. pull-to-refresh). */
  refetch: () => Promise<void>;
}

export function useWorkoutReport(workoutId: string): UseWorkoutReportResult {
  const [state, dispatch] = useReducer(reportReducer, initialReportState);

  const refetch = useCallback(async () => {
    dispatch({ type: "fetch_start" });
    try {
      const response = await api<WorkoutReportResponse>(`/api/workouts/${workoutId}/report`);
      dispatch({ type: "fetch_success", response });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        dispatch({ type: "fetch_not_found" });
      } else {
        dispatch({ type: "fetch_error" });
      }
    }
  }, [workoutId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const generate = useCallback(async () => {
    dispatch({ type: "generate_start" });
    try {
      const response = await api<GenerateResponse>(`/api/workouts/${workoutId}/report`, { method: "POST" });
      dispatch({ type: "generate_success", response });
    } catch {
      dispatch({ type: "generate_error" });
    }
  }, [workoutId]);

  return {
    phase: state.phase,
    view: selectReportView(state),
    generating: state.generating,
    generate,
    refetch,
  };
}

// ---------------------------------------------------------------------------
// Insights tab: recent completed workouts + their verdicts.
//
// There is no REST endpoint that lists completed_workouts (only the
// per-workout report route exists), and this unit is scoped away from
// apps/web, so the list itself is read directly from Supabase under the
// athlete's own RLS policy (completed_workouts_self_select) — the one
// deliberate exception to "use api(), don't query Supabase from a screen"
// in this unit; see this unit's report-back. Every *report* read/write
// still goes through api() exclusively.
//
// Request-storm guard: the DB query itself is LIMIT-bounded, and
// selectRecentWorkoutIds re-applies that cap independently (see
// report-view.ts) before firing one GET per id via Promise.all — so the
// number of report requests is bounded by RECENT_WORKOUTS_LIMIT no matter
// how many completed workouts the athlete has, and is exactly zero when
// they have none. The effect only re-runs when the athlete id changes.
// ---------------------------------------------------------------------------

export interface RecentWorkoutItem {
  id: string;
  sport: CompletedWorkoutRow["sport"];
  startedAt: string;
  durationS: number | null;
  /** Null if the workout's report GET failed — the row still renders, just without a verdict badge. */
  verdict: Verdict | null;
}

export type RecentWorkoutsPhase = "loading" | "ready" | "error";

export interface UseRecentWorkoutReportsResult {
  phase: RecentWorkoutsPhase;
  items: RecentWorkoutItem[];
  refetch: () => Promise<void>;
}

export function useRecentWorkoutReports(athleteId: string | null): UseRecentWorkoutReportsResult {
  const [phase, setPhase] = useState<RecentWorkoutsPhase>("loading");
  const [items, setItems] = useState<RecentWorkoutItem[]>([]);

  const refetch = useCallback(async () => {
    if (!athleteId) return;
    setPhase("loading");
    try {
      const { data, error } = await supabase
        .from("completed_workouts")
        .select("id, sport, started_at, duration_s")
        .eq("athlete_id", athleteId)
        .is("deleted_at", null)
        .order("started_at", { ascending: false })
        .limit(RECENT_WORKOUTS_LIMIT);

      if (error) throw error;

      const rows = (data ?? []) as Array<Pick<CompletedWorkoutRow, "id" | "sport" | "started_at" | "duration_s">>;
      const ids = selectRecentWorkoutIds(rows.map((r) => r.id));

      // Bounded fan-out: at most RECENT_WORKOUTS_LIMIT GETs, zero when ids is empty.
      const verdicts = await Promise.all(
        ids.map(async (id) => {
          try {
            const report = await api<WorkoutReportResponse>(`/api/workouts/${id}/report`);
            return report.delta.verdict;
          } catch {
            return null;
          }
        })
      );
      const verdictById = new Map(ids.map((id, i) => [id, verdicts[i]]));

      setItems(
        rows.map((r) => ({
          id: r.id,
          sport: r.sport,
          startedAt: r.started_at,
          durationS: r.duration_s,
          verdict: verdictById.get(r.id) ?? null,
        }))
      );
      setPhase("ready");
    } catch {
      setItems([]);
      setPhase("error");
    }
  }, [athleteId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { phase, items, refetch };
}
