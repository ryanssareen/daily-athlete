"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SPORTS = ["run", "swim", "bike", "strength", "mobility", "other"] as const;
type Sport = (typeof SPORTS)[number];

const inputStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-canvas-soft)",
  color: "var(--color-ink)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box" as const,
};

export default function LogWorkoutDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sport, setSport] = useState<Sport>("run");
  const [date, setDate] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  function handleOpen() {
    setDate(new Date().toISOString().split("T")[0]);
    setErrorMsg("");
    setDurationMin("");
    setOpen(true);
  }

  function handleClose() {
    if (submitting) return;
    setOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const mins = parseInt(durationMin, 10);
    if (!Number.isFinite(mins) || mins < 1) {
      setErrorMsg("Enter a valid duration");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/activities/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport,
          started_at: `${date}T00:00:00+00:00`,
          duration_s: mins * 60,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg((body as { message?: string }).message ?? "Could not log workout");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setErrorMsg("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 16px",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          border: "none",
          background: "var(--color-ink)",
          color: "var(--color-canvas)",
        }}
      >
        + Log workout
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={handleClose}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 40,
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="log-workout-title"
            style={{
              position: "fixed",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
              pointerEvents: "none",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-border)",
                borderRadius: 16,
                padding: "28px 32px",
                width: "100%",
                maxWidth: 420,
                pointerEvents: "auto",
              }}
            >
              <h2
                id="log-workout-title"
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  margin: "0 0 20px",
                  letterSpacing: "-0.01em",
                  color: "var(--color-ink)",
                }}
              >
                Log workout
              </h2>
              <form
                onSubmit={handleSubmit}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="eyebrow">Sport</span>
                  <select
                    value={sport}
                    onChange={(e) => setSport(e.target.value as Sport)}
                    required
                    style={inputStyle}
                  >
                    {SPORTS.map((s) => (
                      <option key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="eyebrow">Date</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="eyebrow">Duration (minutes)</span>
                  <input
                    type="number"
                    min="1"
                    value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    placeholder="e.g. 45"
                    required
                    style={inputStyle}
                  />
                </label>

                {errorMsg && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--color-danger)",
                      background:
                        "color-mix(in oklab, var(--color-danger) 10%, transparent)",
                      border:
                        "1px solid color-mix(in oklab, var(--color-danger) 25%, transparent)",
                      borderRadius: 8,
                      padding: "6px 12px",
                    }}
                  >
                    {errorMsg}
                  </span>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={submitting}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-canvas-soft)",
                      color: "var(--color-ink-muted)",
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      flex: 2,
                      padding: "9px 0",
                      borderRadius: 8,
                      border: "none",
                      background: submitting
                        ? "var(--color-canvas-soft)"
                        : "var(--color-ink)",
                      color: submitting
                        ? "var(--color-ink-muted)"
                        : "var(--color-canvas)",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {submitting ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
