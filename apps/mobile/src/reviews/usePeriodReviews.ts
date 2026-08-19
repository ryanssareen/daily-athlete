// Hooks for mobile period reviews (U11).
//
// Thin shells over ./review-view, which holds every decision. Same split as
// src/reports/useWorkoutReport.ts and for the same reason: the decisions are
// testable without a renderer.
//
// The list request is BOUNDED and generation is never automatic. Both matter
// for cost, not neatness: each listed period costs the server a context
// assembly, and each generate costs an LLM call against a shared budget, so an
// accidental fan-out on scroll would be expensive in a way the athlete never
// asked for.

import { useCallback, useEffect, useReducer, useState } from "react";

import type { PeriodKind, PeriodReviewListResponse, PeriodReviewResponse, PeriodReviewSummary } from "@da2/shared";

import { api, ApiError } from "@/api/client";

import {
  initialReviewState,
  type ReviewPhase,
  reviewReducer,
  type ReviewView,
  selectRecentPeriods,
  selectReviewView,
} from "./review-view";

export type ListPhase = "loading" | "ready" | "unentitled" | "error";

export interface UsePeriodReviewListResult {
  phase: ListPhase;
  periods: PeriodReviewSummary[];
  refetch: () => Promise<void>;
}

/** Recent completed periods for the Insights tab. */
export function usePeriodReviewList(athleteId: string | null): UsePeriodReviewListResult {
  const [phase, setPhase] = useState<ListPhase>("loading");
  const [periods, setPeriods] = useState<PeriodReviewSummary[]>([]);

  const refetch = useCallback(async () => {
    // No athlete yet: issue nothing rather than firing an unauthenticated
    // request that will only 401.
    if (!athleteId) return;
    setPhase("loading");
    try {
      const body = await api<PeriodReviewListResponse>("/api/reviews");
      setPeriods(selectRecentPeriods(body.periods));
      setPhase("ready");
    } catch (err) {
      // 402 is its own state, not an error: the athlete needs an upgrade
      // affordance, which is a different screen from "something broke".
      if (err instanceof ApiError && err.status === 402) {
        setPhase("unentitled");
        return;
      }
      setPhase("error");
    }
  }, [athleteId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { phase, periods, refetch };
}

export interface UsePeriodReviewResult {
  phase: ReviewPhase;
  view: ReviewView | null;
  generating: boolean;
  generate: () => Promise<void>;
  refetch: () => Promise<void>;
}

/** One period review, with an explicit generate action. */
export function usePeriodReview(kind: PeriodKind, periodKey: string): UsePeriodReviewResult {
  const [state, dispatch] = useReducer(reviewReducer, initialReviewState);

  const path = `/api/reviews/${kind}/${encodeURIComponent(periodKey)}`;

  const refetch = useCallback(async () => {
    dispatch({ type: "fetch_start" });
    try {
      const response = await api<PeriodReviewResponse>(path);
      dispatch({ type: "fetch_success", response });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        dispatch({ type: "fetch_not_found" });
      } else {
        dispatch({ type: "fetch_error" });
      }
    }
  }, [path]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const generate = useCallback(async () => {
    dispatch({ type: "generate_start" });
    try {
      const response = await api<PeriodReviewResponse>(path, { method: "POST" });
      dispatch({ type: "generate_success", response });
    } catch (err) {
      // The quota refusal has its own remedy (wait), so it must not be folded
      // into the generic failure message.
      if (err instanceof ApiError && err.status === 429) {
        dispatch({ type: "generate_rate_limited" });
        return;
      }
      dispatch({ type: "generate_error" });
    }
  }, [path]);

  return {
    phase: state.phase,
    view: selectReviewView(state),
    generating: state.generating,
    generate,
    refetch,
  };
}
