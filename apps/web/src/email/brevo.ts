import "server-only";

// Minimal Brevo transactional-email client (REST, no SDK dependency).
//
// Design contract: sendTransactionalEmail NEVER throws and NEVER blocks the
// caller's primary operation. A moderation action must succeed even if the
// reason email can't be delivered, so every failure path returns
// { sent: false, reason } instead of raising. Callers audit the boolean.
//
// Config: BREVO_API_KEY + EMAIL_SENDER (apps/web/src/config.ts). When either is
// unset the client is "unconfigured" and returns { sent: false } without a
// network call — this is the graceful-degradation mode (see validateBrevoProd).
//
// Logging is NON-PII: status codes + reason slugs only, never the recipient
// address or the email body.

import { config } from "@/config";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const SENDER_NAME = "The Daily Athlete";

export interface SendEmailParams {
  /** Recipient address. */
  to: string;
  subject: string;
  /** HTML body. */
  html: string;
  /** Optional reply-to; defaults to the configured sender. */
  replyTo?: string;
  /**
   * Optional one-click unsubscribe URL.
   *
   * Set on bulk/periodic mail (the period-review digests), never on
   * transactional mail like a moderation notice -- an account-action email is
   * not something a user can opt out of, and advertising an unsubscribe on one
   * would be misleading.
   *
   * Emitted as List-Unsubscribe + List-Unsubscribe-Post so mail clients can
   * offer their own native unsubscribe affordance. That matters for
   * deliverability as much as for the reader: providers weigh a visible,
   * working unsubscribe against spam complaints, and this is the product's
   * first bulk outbound mail.
   */
  unsubscribeUrl?: string;
}

export interface SendEmailResult {
  sent: boolean;
  /** Non-PII reason slug when not sent: "unconfigured" | "http_<status>" | "error". */
  reason?: string;
}

export async function sendTransactionalEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const apiKey = config.email.brevoApiKey;
  const sender = config.email.sender;
  if (!apiKey || !sender) {
    return { sent: false, reason: "unconfigured" };
  }

  const replyTo = params.replyTo ?? sender;
  try {
    const res = await fetch(BREVO_ENDPOINT, {
      // Bound the call. Without a timeout a hung Brevo connection holds the
      // delivery worker's step open until the platform kills it, which loses
      // the run mid-flight with the ledger row still claimed. The catch below
      // already maps an abort to { sent: false, reason: "error" }, so the
      // never-throw contract is unchanged.
      signal: AbortSignal.timeout(10_000),
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: sender, name: SENDER_NAME },
        to: [{ email: params.to }],
        replyTo: { email: replyTo },
        subject: params.subject,
        htmlContent: params.html,
        ...(params.unsubscribeUrl
          ? {
              headers: {
                "List-Unsubscribe": `<${params.unsubscribeUrl}>`,
                // Tells the client the URL accepts a POST, so its native
                // button unsubscribes in one step instead of opening a page.
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
          : {}),
      }),
    });

    if (!res.ok) {
      console.error(
        "[email] brevo send failed",
        JSON.stringify({ status: res.status })
      );
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error(
      "[email] brevo send threw",
      JSON.stringify({ message: err instanceof Error ? err.message : "unknown" })
    );
    return { sent: false, reason: "error" };
  }
}
