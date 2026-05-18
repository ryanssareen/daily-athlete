"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";

// ─── Types ────────────────────────────────────────────────────────────────────

type Sport = "run" | "swim" | "bike" | "strength" | "mobility" | "other";
type DistanceUnit = "km" | "mi" | "m";

const SPORTS: { value: Sport; label: string; emoji: string; accent: string }[] = [
  { value: "run",      label: "Run",       emoji: "🏃", accent: "#c45a30" },
  { value: "swim",     label: "Swim",      emoji: "🏊", accent: "#1a6891" },
  { value: "bike",     label: "Bike",      emoji: "🚴", accent: "#2d6b44" },
  { value: "strength", label: "Strength",  emoji: "💪", accent: "#4a3a80" },
  { value: "mobility", label: "Mobility",  emoji: "🧘", accent: "#6b4c22" },
  { value: "other",    label: "Other",     emoji: "⚡", accent: "#555" },
];

const DISTANCE_UNITS: { value: DistanceUnit; label: string }[] = [
  { value: "km", label: "Kilometers" },
  { value: "mi", label: "Miles" },
  { value: "m",  label: "Meters" },
];

function toMeters(value: number, unit: DistanceUnit): number {
  if (unit === "km") return value * 1000;
  if (unit === "mi") return value * 1609.344;
  return value;
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "var(--color-paper)",
  border: "1px solid var(--color-border)",
  borderRadius: 16,
  padding: "24px 28px",
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--color-ink-muted)",
  marginBottom: 8,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--color-border)",
  background: "var(--color-canvas-soft)",
  color: "var(--color-ink)",
  fontSize: 15,
  boxSizing: "border-box",
  outline: "none",
};

// ─── Arrow icon ───────────────────────────────────────────────────────────────

function ArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewWorkoutPage() {
  const router = useRouter();

  const [sport, setSport]               = useState<Sport>("run");
  const [name, setName]                 = useState("");
  const [date, setDate]                 = useState(todayLocal);
  const [durationMin, setDurationMin]   = useState("");
  const [distanceVal, setDistanceVal]   = useState("");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("km");
  const [notes, setNotes]               = useState("");
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState("");

  const selectedSport = SPORTS.find((s) => s.value === sport)!;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const mins = parseInt(durationMin, 10);
    if (!Number.isFinite(mins) || mins < 1) {
      setError("Enter a valid duration");
      return;
    }
    if (!date) {
      setError("Enter a date");
      return;
    }

    const distNum = distanceVal ? parseFloat(distanceVal) : null;
    if (distanceVal && (!Number.isFinite(distNum) || (distNum as number) <= 0)) {
      setError("Enter a valid distance");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const body: Record<string, unknown> = {
        sport,
        started_at: `${date}T00:00:00+00:00`,
        duration_s: mins * 60,
      };
      if (name.trim()) body.name = name.trim();
      if (distNum) body.distance_m = toMeters(distNum, distanceUnit);
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch("/api/activities/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message ?? "Could not save workout");
        return;
      }

      const created = await res.json() as { id: string };
      router.push(`/athlete/workouts/${created.id}?from=activities` as Route);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 0 48px" }}>

      {/* Back nav */}
      <div style={{ marginBottom: 28 }}>
        <Link
          href="/athlete/activities"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--color-ink-muted)",
            textDecoration: "none",
          }}
        >
          <ArrowLeft />
          Activities
        </Link>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 4px" }}>
          Log Workout
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-ink-muted)", margin: 0 }}>
          Record a completed training session
        </p>
      </div>

      <form onSubmit={handleSubmit}>

        {/* ── Card 1: Workout ── */}
        <div style={cardStyle}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-ink-muted)", margin: "0 0 20px" }}>
            Workout
          </p>

          {/* Sport picker */}
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Sport *</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {SPORTS.map((s) => {
                const active = sport === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSport(s.value)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: `1.5px solid ${active ? s.accent : "var(--color-border)"}`,
                      background: active
                        ? `color-mix(in oklab, ${s.accent} 12%, var(--color-canvas-soft))`
                        : "var(--color-canvas-soft)",
                      color: active ? s.accent : "var(--color-ink-muted)",
                      fontSize: 13,
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      transition: "all 0.12s",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1 }}>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Name
              <span style={{ fontSize: 10, fontWeight: 400, letterSpacing: 0, textTransform: "none", color: "var(--color-ink-subtle)", marginLeft: 6 }}>optional</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${selectedSport.emoji} ${selectedSport.label}`}
              maxLength={100}
              style={inputStyle}
            />
          </div>

          {/* Date */}
          <div>
            <label style={labelStyle}>Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              style={inputStyle}
            />
          </div>
        </div>

        {/* ── Card 2: Metrics ── */}
        <div style={cardStyle}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-ink-muted)", margin: "0 0 20px" }}>
            Metrics
          </p>

          {/* Duration */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Duration *</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="number"
                min="1"
                max="1440"
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                placeholder="45"
                required
                style={{ ...inputStyle, width: 120 }}
              />
              <span style={{ fontSize: 14, color: "var(--color-ink-muted)", whiteSpace: "nowrap" }}>minutes</span>
            </div>
          </div>

          {/* Distance */}
          <div>
            <label style={labelStyle}>
              Distance
              <span style={{ fontSize: 10, fontWeight: 400, letterSpacing: 0, textTransform: "none", color: "var(--color-ink-subtle)", marginLeft: 6 }}>optional</span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={distanceVal}
                onChange={(e) => setDistanceVal(e.target.value)}
                placeholder="10"
                style={{ ...inputStyle, flex: 1 }}
              />
              <select
                value={distanceUnit}
                onChange={(e) => setDistanceUnit(e.target.value as DistanceUnit)}
                style={{
                  ...inputStyle,
                  width: "auto",
                  paddingRight: 32,
                  cursor: "pointer",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 10px center",
                }}
              >
                {DISTANCE_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Card 3: Notes ── */}
        <div style={cardStyle}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-ink-muted)", margin: "0 0 4px" }}>
            Notes
            <span style={{ fontSize: 10, fontWeight: 400, letterSpacing: 0, textTransform: "none", color: "var(--color-ink-subtle)", marginLeft: 6 }}>optional</span>
          </p>
          <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: "0 0 16px" }}>
            How did it feel? Any goals, cues, or context.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Felt strong in the first half, faded a bit at the end…"
            maxLength={2000}
            rows={4}
            style={{
              ...inputStyle,
              resize: "vertical",
              lineHeight: 1.6,
              fontFamily: "inherit",
            }}
          />
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 4 }}>
            {notes.length} / 2000
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            fontSize: 13,
            color: "var(--color-danger)",
            background: "color-mix(in oklab, var(--color-danger) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--color-danger) 25%, transparent)",
            borderRadius: 10,
            padding: "10px 16px",
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "13px 0",
            borderRadius: 12,
            border: "none",
            background: submitting ? "var(--color-canvas-soft)" : selectedSport.accent,
            color: submitting ? "var(--color-ink-muted)" : "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: submitting ? "not-allowed" : "pointer",
            letterSpacing: "0.01em",
            transition: "background 0.15s",
          }}
        >
          {submitting ? "Saving…" : `Log ${selectedSport.label}`}
        </button>

      </form>
    </div>
  );
}
