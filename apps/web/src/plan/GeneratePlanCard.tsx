"use client";

// The "Generate my plan" entry point shown on /plan when the athlete has no
// active plan. Thin client shell over POST /api/plans (Unit 5): collects the
// GeneratePlanInput basics (weekly hours + optional event), submits, then
// polls the athlete's own ai_generation_attempts row (RLS self-select) until
// the Inngest worker lands the plan — at which point we send them to the
// calendar where the new workouts live.
//
// States: idle form → submitting → generating (poll) → done (redirect) /
// infeasible / failed / payment_required. Errors keep the form editable so
// the athlete can adjust inputs and retry (a retry is a fresh request_id
// server-side, so the negative cache never blocks it).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/auth/supabase";

const POLL_INTERVAL_MS = 4_000;
// Generation is one LLM call plus bounded validator retries; minutes-long
// hangs mean something is wrong — stop polling and tell the athlete.
const POLL_TIMEOUT_MS = 4 * 60_000;

type Phase =
  | "idle"
  | "submitting"
  | "generating"
  | "succeeded"
  | "infeasible"
  | "failed"
  | "payment_required"
  | "timeout";

export default function GeneratePlanCard({ athleteId }: { athleteId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [weeklyHours, setWeeklyHours] = useState("6");
  const [eventType, setEventType] = useState("");
  const [eventDate, setEventDate] = useState("");
  const pollAbort = useRef(false);

  useEffect(() => {
    // Re-arm on every (re)mount: StrictMode runs mount → cleanup → mount in
    // dev while PRESERVING refs, so without this the flag stays true forever
    // and the poll loop exits before its first query.
    pollAbort.current = false;
    return () => {
      pollAbort.current = true;
    };
  }, []);

  const pollAttempt = useCallback(
    async (requestId: string) => {
      const supabase = createClient();
      const startedAt = Date.now();
      while (!pollAbort.current && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const { data } = await supabase
          .from("ai_generation_attempts")
          .select("status, plan_id")
          .eq("athlete_id", athleteId)
          .eq("request_id", requestId)
          .maybeSingle();
        if (pollAbort.current) return;
        if (data?.status === "succeeded") {
          setPhase("succeeded");
          router.push("/athlete/calendar");
          router.refresh();
          return;
        }
        if (data?.status === "infeasible") {
          setPhase("infeasible");
          return;
        }
        if (data?.status === "failed") {
          setPhase("failed");
          return;
        }
      }
      if (!pollAbort.current) setPhase("timeout");
    },
    [athleteId, router]
  );

  const submit = useCallback(async () => {
    const hours = Number(weeklyHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 40) return;
    setPhase("submitting");
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_id: athleteId,
          weekly_hours: hours,
          event_type: eventType.trim() === "" ? null : eventType.trim(),
          event_date: eventDate === "" ? null : eventDate,
        }),
      });
      if (res.status === 402) {
        setPhase("payment_required");
        return;
      }
      if (res.status !== 202) {
        setPhase("failed");
        return;
      }
      const body = (await res.json()) as { request_id?: string };
      if (!body.request_id) {
        setPhase("failed");
        return;
      }
      setPhase("generating");
      void pollAttempt(body.request_id);
    } catch {
      setPhase("failed");
    }
  }, [athleteId, weeklyHours, eventType, eventDate, pollAttempt]);

  const busy = phase === "submitting" || phase === "generating";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-canvas-soft)",
    color: "var(--color-ink)",
    fontSize: 14,
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-ink-muted)",
    marginBottom: 6,
    textAlign: "left",
  };

  if (phase === "generating" || phase === "succeeded") {
    return (
      <div data-testid="generate-plan-generating" style={{ marginTop: 24 }}>
        <p style={{ fontSize: 14, color: "var(--color-ink)", margin: 0, fontWeight: 600 }}>
          Building your plan…
        </p>
        <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "6px 0 0" }}>
          The AI coach is laying out your weeks. This usually takes under a
          minute — we&apos;ll take you to your calendar when it&apos;s ready.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="generate-plan-card" style={{ marginTop: 24 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          maxWidth: 560,
          margin: "0 auto",
          textAlign: "left",
        }}
      >
        <div>
          <label htmlFor="gp-hours" style={labelStyle}>
            Weekly hours
          </label>
          <input
            id="gp-hours"
            type="number"
            min={1}
            max={40}
            value={weeklyHours}
            onChange={(e) => setWeeklyHours(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="gp-event" style={labelStyle}>
            Goal event (optional)
          </label>
          <input
            id="gp-event"
            type="text"
            placeholder="e.g. Half marathon"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            disabled={busy}
            maxLength={100}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="gp-date" style={labelStyle}>
            Event date (optional)
          </label>
          <input
            id="gp-date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </div>
      </div>

      {phase === "payment_required" && (
        <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "16px 0 0" }}>
          AI plan generation needs an active subscription (your free trial plan
          has been used).
        </p>
      )}
      {phase === "infeasible" && (
        <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "16px 0 0" }}>
          We couldn&apos;t build a safe plan from these inputs — try more weekly
          hours or a later event date.
        </p>
      )}
      {(phase === "failed" || phase === "timeout") && (
        <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "16px 0 0" }}>
          {phase === "timeout"
            ? "This is taking longer than expected. Your plan may still appear on the calendar shortly — or try again."
            : "Plan generation hit a snag. Nothing was changed — try again."}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || Number(weeklyHours) <= 0}
        style={{
          marginTop: 20,
          background: "var(--color-ink)",
          color: "var(--color-paper)",
          padding: "10px 22px",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 600,
          border: "none",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {phase === "submitting" ? "Starting…" : "Generate my plan"}
      </button>
    </div>
  );
}
