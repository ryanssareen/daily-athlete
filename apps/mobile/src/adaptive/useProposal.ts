// useProposal (Unit 11): fetches the athlete's AI adaptive proposals via
// GET /api/weekly-review, subscribes to `weekly_reviews` (+ `planned_workouts`)
// over Supabase Realtime, and reconnect-and-refetches when the app returns to
// the foreground (a dropped socket while backgrounded self-heals).
//
// This is the first client Realtime subscription in the repo; it mirrors the
// web helper (apps/web/src/realtime/weekly-reviews.ts) using supabase-js
// `.channel().on('postgres_changes', ...)`. The Realtime payload is treated as
// a "something changed, re-read" nudge only — the GET is the source of truth.
//
// All pure decision logic (which proposal to show, op rows, selection, outcome
// copy) lives in ./proposal-view so it is unit-tested without react-native.

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { WeeklyReviewRow } from "@da2/shared";

import { api } from "@/api/client";
import { supabase } from "@/auth/supabase";

import { selectActiveProposal } from "./proposal-view";

export type ProposalPhase = "loading" | "ready" | "error";

export interface UseProposalResult {
  phase: ProposalPhase;
  /** The single proposal to render (most recent pending, else most recent). */
  proposal: WeeklyReviewRow | null;
  /** True iff the last load failed (drives the error state). */
  loadError: boolean;
  /** Manual re-fetch (retry button / pull-to-refresh). */
  refetch: () => Promise<void>;
}

/** Shape of GET /api/weekly-review. */
interface ListResponse {
  proposals?: WeeklyReviewRow[];
}

/**
 * Watch the athlete's proposals. Pass the authenticated athlete's id so the
 * Realtime filter only wakes for their rows.
 */
export function useProposal(athleteId: string): UseProposalResult {
  const [phase, setPhase] = useState<ProposalPhase>("loading");
  const [proposal, setProposal] = useState<WeeklyReviewRow | null>(null);
  const [loadError, setLoadError] = useState(false);

  const refetch = useCallback(async () => {
    try {
      const body = await api<ListResponse>("/api/weekly-review");
      const all = (body.proposals ?? []).filter((p) => p.athlete_id === athleteId);
      setProposal(selectActiveProposal(all));
      setLoadError(false);
      setPhase("ready");
    } catch {
      // Any failure (401, network, ApiError) surfaces as the error state — the
      // modal re-enables a retry button and tells the athlete the plan is
      // unchanged.
      setLoadError(true);
      setPhase("error");
    }
  }, [athleteId]);

  // Initial fetch.
  useEffect(() => {
    setPhase("loading");
    void refetch();
  }, [refetch]);

  // Realtime: a change to weekly_reviews / planned_workouts nudges a refetch.
  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel(`weekly-reviews:${athleteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "weekly_reviews", filter: `athlete_id=eq.${athleteId}` },
        () => {
          void refetch();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "planned_workouts", filter: `athlete_id=eq.${athleteId}` },
        () => {
          void refetch();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [athleteId, refetch]);

  // Reconnect-and-refetch on foreground: while backgrounded the socket may have
  // dropped, so on the active transition we re-read (which also re-establishes
  // the channel implicitly via supabase-js auto-reconnect).
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (prev.match(/inactive|background/) && next === "active") {
        void refetch();
      }
    });
    return () => sub.remove();
  }, [refetch]);

  return { phase, proposal, loadError, refetch };
}

// Re-export the pure helpers so the modal imports a single module.
export * from "./proposal-view";
