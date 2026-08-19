"use client";

// The one interactive shell of the review detail page (U7).
//
// The facts are rendered by the SERVER component that wraps this; only the
// narration -- which needs generate / regenerate / retry state -- is a client
// concern. That split is deliberate: the deterministic half of the page must
// render even if this component never hydrates.
//
// STATE THIS COMPONENT MODELS, and why each exists:
//   idle       nothing stored -> offer Generate
//   stale      stored prose, inputs moved -> show it, badged, offer Regenerate
//   fresh      stored prose, inputs unchanged -> just show it
//   generating in flight
//   retryable  the LLM backed off -> offer another go (AE9)
//   failed     the model produced unusable output -> say so, no false hope
//
// `retryable` and `failed` are separate because the remedy differs: one is
// "try again in a moment", the other is "trying again is unlikely to help".
// Collapsing them into a generic error would have the athlete hammering a
// button that cannot work.

import { useState } from "react";

import type { PeriodKind, PeriodNarration } from "@da2/shared";

import { Callout, Prose } from "./review-sections";
import { generateButtonLabel, interpretGenerateResponse } from "./review-view";

type Phase = "idle" | "generating" | "retryable" | "failed" | "rate_limited" | "error";

interface Props {
  kind: PeriodKind;
  periodKey: string;
  initialNarration: PeriodNarration | null;
  initialStale: boolean;
}

export function ReviewNarration({ kind, periodKey, initialNarration, initialStale }: Props) {
  const [narration, setNarration] = useState<PeriodNarration | null>(initialNarration);
  const [stale, setStale] = useState(initialStale);
  const [phase, setPhase] = useState<Phase>("idle");

  async function generate() {
    setPhase("generating");
    try {
      const res = await fetch(`/api/reviews/${kind}/${periodKey}`, { method: "POST" });
      const body = await res.json().catch(() => null);

      // NOT `res.ok`: the route returns 200 with the facts intact when
      // narration failed, so status alone would show success for a response
      // carrying no prose. interpretGenerateResponse owns that distinction.
      const outcome = interpretGenerateResponse(res.status, body);
      if (outcome.phase === "generated") {
        setNarration(outcome.narration);
        setStale(outcome.stale);
        setPhase("idle");
        return;
      }
      setPhase(outcome.phase);
    } catch {
      setPhase("error");
    }
  }

  const busy = phase === "generating";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {narration && (
        <>
          {stale && (
            <Callout>
              This note was written before some of the numbers above changed. Regenerate it for an
              up-to-date read.
            </Callout>
          )}
          <Prose text={narration.note} />
          <div
            style={{
              borderLeft: "3px solid var(--color-clay-soft)",
              paddingLeft: 12,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "var(--color-ink-muted)",
              }}
            >
              Next period
            </p>
            <Prose text={narration.takeaway} />
          </div>
        </>
      )}

      {!narration && phase !== "generating" && (
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-ink-muted)" }}>
          The numbers above are ready. Generate a coach&apos;s note to go with them.
        </p>
      )}

      {phase === "retryable" && (
        <Callout>
          The coaching model is busy right now. Your numbers are all here — try the note again in a
          moment.
        </Callout>
      )}
      {phase === "rate_limited" && (
        <Callout>
          You&apos;ve generated a lot of reviews recently. Try again a little later.
        </Callout>
      )}
      {phase === "failed" && (
        <Callout>
          We couldn&apos;t write a note for this period. Your numbers above are unaffected.
        </Callout>
      )}
      {phase === "error" && (
        <Callout>Something went wrong reaching the server. Your numbers above are unaffected.</Callout>
      )}

      <div>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          style={{
            appearance: "none",
            border: "1px solid var(--color-border)",
            background: busy ? "var(--color-border)" : "var(--color-clay-soft)",
            color: "var(--color-clay-deep)",
            borderRadius: 10,
            padding: "9px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {generateButtonLabel({ busy, hasNarration: narration !== null, stale })}
        </button>
      </div>
    </div>
  );
}
