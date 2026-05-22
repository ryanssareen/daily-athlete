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
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
        {view === "deleted" ? (
          <button type="button" className="btn sm" onClick={() => open("restore")}>
            Restore
          </button>
        ) : (
          <>
            {user.disabled_at ? (
              <button type="button" className="btn sm" onClick={() => open("enable")}>
                Enable
              </button>
            ) : (
              <button type="button" className="btn sm" onClick={() => open("disable")}>
                Disable
              </button>
            )}
            <button
              type="button"
              className="btn sm danger"
              onClick={() => open("delete")}
            >
              Delete
            </button>
          </>
        )}
      </div>

      {action ? (
        <div role="dialog" aria-modal="true" className="modal-overlay" onClick={close}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{TITLES[action]}</h2>
            <p className="modal-body">{describe(action, user)}</p>

            {NEEDS_REASON.includes(action) ? (
              <>
                <label className="field" style={{ marginTop: 14 }}>
                  <span className="field-label">Reason (internal code)</span>
                  <select
                    className="input"
                    value={reasonCode}
                    onChange={(e) =>
                      setReasonCode(e.target.value as ModerationReasonCode)
                    }
                  >
                    {REASON_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ marginTop: 14 }}>
                  <span className="field-label">Note to the user (optional, emailed)</span>
                  <textarea
                    className="input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                </label>
              </>
            ) : null}

            {action === "delete" ? (
              <div style={{ marginTop: 14 }}>
                <label
                  htmlFor={`confirm-${user.id}`}
                  style={{
                    display: "block",
                    fontSize: 13,
                    color: "var(--color-ink-muted)",
                    marginBottom: 6,
                  }}
                >
                  Type{" "}
                  <code
                    className="mono"
                    style={{
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--color-canvas-soft)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-ink)",
                    }}
                  >
                    {confirmTarget}
                  </code>{" "}
                  to confirm
                </label>
                <input
                  id={`confirm-${user.id}`}
                  className="input"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                />
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                style={{ color: "var(--color-danger)", fontSize: 13, marginTop: 12 }}
              >
                {error}
              </p>
            ) : null}

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 18,
              }}
            >
              <button
                type="button"
                className="btn ghost"
                onClick={close}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={"btn " + (action === "delete" ? "danger" : "primary")}
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
