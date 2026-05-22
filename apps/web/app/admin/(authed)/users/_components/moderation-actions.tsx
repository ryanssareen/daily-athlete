"use client";

// Per-row moderation actions + confirmation dialogs for the user directory.
// The destructive action (delete) uses type-to-confirm — a UX guard ONLY; the
// server enforces CSRF (Sec-Fetch-Site) + the admin session. POSTs to
// /api/admin/users/[id]/moderation; a same-origin fetch makes the browser send
// Sec-Fetch-Site: same-origin automatically.

import { useState } from "react";

import type { ModerationReasonCode } from "@da2/shared";

interface Row {
  id: string;
  display_name: string | null;
  email: string | null;
  disabled_at: string | null;
  deleted_at: string | null;
}

type Action = "disable" | "enable" | "delete" | "restore";

const REASON_OPTIONS: { value: ModerationReasonCode; label: string }[] = [
  { value: "abuse", label: "Abuse" },
  { value: "spam", label: "Spam" },
  { value: "tos_violation", label: "Terms violation" },
  { value: "fraud", label: "Fraud" },
  { value: "user_request", label: "User request" },
  { value: "other", label: "Other" },
];

const NEEDS_REASON: Action[] = ["disable", "delete"];

const TITLES: Record<Action, string> = {
  disable: "Disable account",
  enable: "Re-enable account",
  delete: "Delete account",
  restore: "Restore account",
};

const CONFIRM_LABELS: Record<Action, string> = {
  disable: "Disable",
  enable: "Re-enable",
  delete: "Delete",
  restore: "Restore",
};

function describe(action: Action, user: Row): string {
  const who = user.display_name || user.email || "This user";
  switch (action) {
    case "disable":
      return `${who} will be blocked from signing in. They'll receive an email with the reason and can appeal by replying.`;
    case "enable":
      return `${who} will be able to sign in again.`;
    case "delete":
      return `${who} will be blocked from signing in and removed from the directory. Their data is kept for 30 days and can be restored within that window. They'll receive an email.`;
    case "restore":
      return `${who} will be restored to active and able to sign in again.`;
  }
}

export function ModerationActions({
  user,
  view,
  onChanged,
}: {
  user: Row;
  view: "active" | "deleted";
  onChanged: () => void;
}): React.ReactElement {
  const [action, setAction] = useState<Action | null>(null);
  const [reasonCode, setReasonCode] = useState<ModerationReasonCode>("abuse");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: Action): void {
    setAction(next);
    setReasonCode("abuse");
    setReason("");
    setConfirmText("");
    setError(null);
  }
  function close(): void {
    if (!submitting) setAction(null);
  }

  // Type-to-confirm target: the user's email, or "DELETE" if none on file.
  const confirmTarget = user.email ?? "DELETE";
  const confirmOk = action !== "delete" || confirmText.trim() === confirmTarget;

  async function submit(): Promise<void> {
    if (!action) return;
    setSubmitting(true);
    setError(null);
    try {
      const needsReason = NEEDS_REASON.includes(action);
      const res = await fetch(`/api/admin/users/${user.id}/moderation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reasonCode: needsReason ? reasonCode : undefined,
          reason: needsReason && reason.trim() ? reason.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "failed");
      }
      setAction(null);
      onChanged();
    } catch {
      setError("Action failed — please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {view === "deleted" ? (
          <button type="button" style={btn()} onClick={() => open("restore")}>
            Restore
          </button>
        ) : (
          <>
            {user.disabled_at ? (
              <button type="button" style={btn()} onClick={() => open("enable")}>
                Enable
              </button>
            ) : (
              <button type="button" style={btn()} onClick={() => open("disable")}>
                Disable
              </button>
            )}
            <button type="button" style={btn("danger")} onClick={() => open("delete")}>
              Delete
            </button>
          </>
        )}
      </div>

      {action ? (
        <div role="dialog" aria-modal="true" style={overlay} onClick={close}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <h2 style={cardTitle}>{TITLES[action]}</h2>
            <p style={cardBody}>{describe(action, user)}</p>

            {NEEDS_REASON.includes(action) ? (
              <>
                <label style={labelStyle}>Reason (internal code)</label>
                <select
                  value={reasonCode}
                  onChange={(e) =>
                    setReasonCode(e.target.value as ModerationReasonCode)
                  }
                  style={inputStyle}
                >
                  {REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <label style={labelStyle}>Note to the user (optional, emailed)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </>
            ) : null}

            {action === "delete" ? (
              <>
                <label style={labelStyle}>
                  Type <code>{confirmTarget}</code> to confirm
                </label>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  style={inputStyle}
                  autoComplete="off"
                />
              </>
            ) : null}

            {error ? (
              <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, marginTop: 10 }}>
                {error}
              </p>
            ) : null}

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 16,
              }}
            >
              <button type="button" style={btn()} onClick={close} disabled={submitting}>
                Cancel
              </button>
              <button
                type="button"
                style={btn(action === "delete" ? "danger" : "primary")}
                onClick={submit}
                disabled={submitting || !confirmOk}
              >
                {submitting ? "Working…" : CONFIRM_LABELS[action]}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function btn(
  variant: "default" | "primary" | "danger" = "default"
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
    border: "1px solid var(--color-border-strong)",
    background: "transparent",
    color: "var(--color-ink)",
  };
  if (variant === "danger") {
    return { ...base, border: "1px solid var(--color-danger)", color: "var(--color-danger)" };
  }
  if (variant === "primary") {
    return { ...base, background: "var(--color-ink)", color: "var(--color-paper)", border: "1px solid var(--color-ink)" };
  }
  return base;
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const card: React.CSSProperties = {
  background: "var(--color-paper)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 12,
  padding: 20,
  width: "100%",
  maxWidth: 440,
  color: "var(--color-ink)",
};

const cardTitle: React.CSSProperties = { margin: "0 0 8px", fontSize: 16 };
const cardBody: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--color-ink-muted)",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--color-ink-muted)",
  margin: "12px 0 4px",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-canvas-soft)",
  color: "var(--color-ink)",
  fontSize: 14,
  boxSizing: "border-box",
};
