import "server-only";

// Moderation reason emails — the user-facing appeal channel. Sent best-effort
// on disable + soft-delete; reply-to is the operator (the support contact), so
// an affected user appeals simply by replying.
//
// PII boundary: the operator's free-text `reason` is rendered into the email
// body ONLY. It is never persisted (the row stores a normalized reasonCode) and
// never written to the immutable admin_audit_log.

import type { ModerationReasonCode } from "@da2/shared";

import { sendTransactionalEmail, type SendEmailResult } from "./brevo";

export type ModerationEmailAction = "disable" | "delete";

const DEFAULT_GRACE_DAYS = 30;

// Non-PII, user-readable phrasing per reason code.
const REASON_SENTENCES: Record<ModerationReasonCode, string> = {
  spam: "sending spam or unsolicited messages",
  abuse: "abusive behaviour toward other people",
  tos_violation: "a violation of our Terms of Service",
  fraud: "suspected fraudulent activity",
  user_request: "a request associated with your account",
  other: "a policy concern",
};

export interface NotifyModerationParams {
  to: string;
  action: ModerationEmailAction;
  reasonCode: ModerationReasonCode;
  /** Operator free-text. Rendered in the body only; never persisted/audited. */
  reason?: string;
  /** Grace window for delete; defaults to 30 (route passes MODERATION_GRACE_DAYS). */
  graceDays?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmail(params: NotifyModerationParams): {
  subject: string;
  html: string;
} {
  const cause = REASON_SENTENCES[params.reasonCode];
  const note = params.reason?.trim()
    ? `<p>Additional details from our team: ${escapeHtml(params.reason.trim())}</p>`
    : "";
  const appeal =
    "<p>If you believe this is a mistake, just reply to this email to appeal.</p>";

  if (params.action === "disable") {
    return {
      subject: "Your account at The Daily Athlete has been disabled",
      html:
        `<p>Hi,</p>` +
        `<p>Your account at The Daily Athlete has been disabled because of ${cause}. ` +
        `You won't be able to sign in while it's disabled.</p>` +
        note +
        appeal +
        `<p>— The Daily Athlete team</p>`,
    };
  }

  const graceDays = params.graceDays ?? DEFAULT_GRACE_DAYS;
  return {
    subject: "Your account at The Daily Athlete is scheduled for deletion",
    html:
      `<p>Hi,</p>` +
      `<p>Your account at The Daily Athlete has been scheduled for deletion because of ${cause}. ` +
      `You won't be able to sign in. Your data will be kept for ${graceDays} days, ` +
      `during which the account can still be restored.</p>` +
      note +
      appeal +
      `<p>— The Daily Athlete team</p>`,
  };
}

/**
 * Send the reason email for a disable/delete. Best-effort: returns the
 * underlying { sent, reason } and never throws (sendTransactionalEmail swallows
 * all failures). Returns sent:false when email is unconfigured.
 */
export async function notifyModeration(
  params: NotifyModerationParams
): Promise<SendEmailResult> {
  const { subject, html } = buildEmail(params);
  return sendTransactionalEmail({ to: params.to, subject, html });
}
