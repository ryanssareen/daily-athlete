"use client";

// "Review ready" banner (Unit 11) for the athlete home + calendar. Surfaces the
// most relevant pending proposal — "Your plan was reviewed — N changes proposed"
// + the human-readable trigger label — and links to the review page. It persists
// until the proposal is terminal (no client-side dismiss-to-discard); a Realtime
// nudge re-reads so it appears/disappears live.
//
// Fetches the proposal list itself (client-side) so the server pages stay
// untouched apart from mounting this one component.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WeeklyReviewRow } from "@da2/shared";

import { createClient } from "@/auth/supabase";
import { subscribeToWeeklyReviews } from "@/realtime/weekly-reviews";
import { bannerFor, type ReviewBannerContent } from "./proposal-view";

export interface ReviewBannerProps {
  athleteId: string;
  /** Test seam: inject a list fetcher; defaults to GET /api/weekly-review. */
  fetchProposals?: () => Promise<WeeklyReviewRow[]>;
  disableRealtime?: boolean;
}

async function defaultFetch(): Promise<WeeklyReviewRow[]> {
  const res = await fetch("/api/weekly-review", { headers: { "Content-Type": "application/json" } });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { proposals?: WeeklyReviewRow[] } | null;
  return body?.proposals ?? [];
}

export default function ReviewBanner({
  athleteId,
  fetchProposals = defaultFetch,
  disableRealtime = false,
}: ReviewBannerProps) {
  const [banner, setBanner] = useState<ReviewBannerContent | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = (await fetchProposals()).filter((p) => p.athlete_id === athleteId);
      setBanner(bannerFor(all));
    } catch {
      // Banner is non-critical chrome — fail silently, leave it hidden.
      setBanner(null);
    }
  }, [fetchProposals, athleteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (disableRealtime || typeof window === "undefined") return;
    const client = createClient();
    const unsub = subscribeToWeeklyReviews(client, {
      athleteId,
      onChange: () => void refresh(),
    });
    return unsub;
  }, [athleteId, disableRealtime, refresh]);

  if (!banner) return null;

  return (
    <Link
      href={`/plan?id=${banner.reviewId}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 18px",
        marginBottom: 20,
        borderRadius: 14,
        textDecoration: "none",
        background: "color-mix(in oklab, var(--color-clay) 10%, var(--color-paper))",
        border: "1px solid color-mix(in oklab, var(--color-clay) 30%, transparent)",
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 999,
          background: "color-mix(in oklab, var(--color-clay) 22%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
        }}
      >
        ✦
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--color-ink)" }}>
          {banner.headline}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-ink-muted)" }}>
          {banner.triggerLabel}
        </p>
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-clay-deep)", flexShrink: 0 }}>
        Review →
      </span>
    </Link>
  );
}
