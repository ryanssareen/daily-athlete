"use client";

// Per-cadence email opt-in toggles for the settings page (U8).
//
// Optimistic with rollback: the toggle flips immediately, and reverts if the
// save fails. A settings toggle that lags a round trip feels broken; one that
// silently keeps a state the server rejected IS broken. Both cadences are
// independent, so a failed weekly save must not disturb the monthly toggle.

import { useState } from "react";

import type { EmailPreferences } from "@da2/shared";

type Cadence = keyof EmailPreferences;

export function EmailPreferencesCard({ initial }: { initial: EmailPreferences }) {
  const [prefs, setPrefs] = useState<EmailPreferences>(initial);
  const [saving, setSaving] = useState<Cadence | null>(null);
  const [failed, setFailed] = useState(false);

  async function toggle(cadence: Cadence) {
    const next = !prefs[cadence];
    const previous = prefs;

    setPrefs({ ...prefs, [cadence]: next });
    setSaving(cadence);
    setFailed(false);

    try {
      const res = await fetch("/api/profile/email-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [cadence]: next }),
      });
      if (!res.ok) throw new Error("save failed");
      // Trust the server's echo rather than the optimistic guess -- it is the
      // authority on what is actually stored.
      setPrefs((await res.json()) as EmailPreferences);
    } catch {
      setPrefs(previous);
      setFailed(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Row
        label="Weekly review"
        description="A short recap of the week just finished, the Monday after it closes."
        checked={prefs.weeklyReview}
        busy={saving === "weeklyReview"}
        onToggle={() => toggle("weeklyReview")}
      />
      <Row
        label="Monthly review"
        description="A wider look back at the month, on the 1st."
        checked={prefs.monthlyReview}
        busy={saving === "monthlyReview"}
        onToggle={() => toggle("monthlyReview")}
      />
      {failed && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-ink-muted)" }}>
          We couldn&apos;t save that just now — please try again.
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  description,
  checked,
  busy,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        cursor: busy ? "default" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={busy}
        onChange={onToggle}
        style={{ marginTop: 3 }}
      />
      <span>
        <span style={{ display: "block", fontSize: 15, color: "var(--color-ink)" }}>{label}</span>
        <span style={{ display: "block", fontSize: 13, color: "var(--color-ink-muted)" }}>
          {description}
        </span>
      </span>
    </label>
  );
}
