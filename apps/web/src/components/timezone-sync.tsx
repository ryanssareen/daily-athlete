"use client";

import { useEffect } from "react";

/**
 * Self-heals public.users.timezone. It defaults to 'UTC' at row creation
 * (migration 0001) and nothing ever wrote the athlete's real timezone into
 * it, so every athlete's workout times and dashboard greeting rendered in
 * UTC regardless of where they live. Mounted once per session in
 * (athlete)/layout.tsx -- renders nothing, fires at most one PATCH per
 * mount, and only when the browser's detected zone actually differs from
 * what's stored (a no-op on every load once it's corrected).
 */
export function TimezoneSync({ currentTimezone }: { currentTimezone: string }) {
  useEffect(() => {
    let detected: string;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!detected || detected === currentTimezone) return;

    fetch("/api/profile/timezone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: detected }),
    }).catch(() => {
      // Best-effort: a failed sync just means we retry on the next page
      // load. Nothing in the current view depends on this succeeding.
    });
  }, [currentTimezone]);

  return null;
}
