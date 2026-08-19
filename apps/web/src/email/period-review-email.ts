import "server-only";

// The period-review digest email (U9, KTD5).
//
// A DIGEST PLUS A LINK, not a rendered copy of the review. Two reasons:
// the template stays stable as the on-screen review evolves, and the email
// stays small enough that mail clients do not clip it (Gmail truncates around
// 102KB and hides the rest behind "View entire message" -- which would swallow
// the unsubscribe link at the bottom).
//
// LAYOUT: tables and inline styles, because that is what survives real mail
// clients -- Outlook's Word rendering engine ignores most of modern CSS, and
// several clients strip <style> blocks entirely. The structure here follows the
// shape proven out in the WORKOUT-SITE reference templates
// (src/lib/email/wrapTemplate.ts, summaryTemplate.ts): a header, per-metric
// rows with period-over-period comparison, a highlight, and one call to
// action. Their CODE is not imported -- different repo, different data shape,
// and this repo's moderation-emails.ts already sets the local idiom.
//
// EVERY INTERPOLATED VALUE IS ESCAPED. That matters more here than in the
// moderation email: the narration is LLM output and the plan goal is
// athlete-authored, so both are untrusted strings reaching an HTML body.
//
// The builder is PURE and returns {subject, html}. Keeping the send out of it
// is what makes the content assertable without a network fixture.

import type { PeriodFactSheet } from "@/ai/period-reviews/fact-sheet";
import type { PeriodKind, PeriodNarration } from "@da2/shared";

import { config } from "@/config";

import { sendTransactionalEmail, type SendEmailResult } from "./brevo";
import { createUnsubscribeToken } from "./unsubscribe-token";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Same helper and same reasoning as moderation-emails.ts. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Em dash for unknown -- the same rule the web UI follows. An email is a worse
 * place to lie about a number than a screen is, because the athlete cannot
 * click through to see the caveat. */
function formatDistance(metres: number | null): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  return `${(metres / 1000).toFixed(1)} km`;
}

function formatDelta(pct: number): string {
  const rounded = Math.round(pct);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function periodNoun(kind: PeriodKind): string {
  return kind === "weekly" ? "week" : "month";
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export interface DigestLinks {
  /** Deep link into the full review on the web. */
  reviewUrl: string;
  /** Human-facing unsubscribe page (a GET that only renders). */
  unsubscribePageUrl: string;
  /** RFC 8058 one-click endpoint for the List-Unsubscribe header (a POST). */
  unsubscribePostUrl: string;
}

/**
 * Build the three links a digest needs.
 *
 * Returns null when the base URL or the signing key is missing. The caller then
 * DECLINES TO SEND: an email whose deep link goes nowhere, or whose unsubscribe
 * cannot be honoured, is worse than no email -- the first wastes the athlete's
 * click and the second is a deliverability and trust problem.
 */
export function buildDigestLinks(
  athleteId: string,
  kind: PeriodKind,
  periodKey: string,
): DigestLinks | null {
  const base = config.email.appBaseUrl;
  if (!base) return null;

  const token = createUnsubscribeToken(athleteId, kind);
  if (!token) return null;

  const origin = base.replace(/\/+$/, "");
  const encoded = encodeURIComponent(token);
  return {
    reviewUrl: `${origin}/athlete/reports/${kind}/${encodeURIComponent(periodKey)}`,
    unsubscribePageUrl: `${origin}/unsubscribe?token=${encoded}&cadence=${kind}`,
    unsubscribePostUrl: `${origin}/api/unsubscribe?token=${encoded}`,
  };
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

export function buildDigestSubject(sheet: PeriodFactSheet): string {
  const noun = periodNoun(sheet.kind);
  if (sheet.totals.sessions === 0) {
    return `Your ${noun} in training — a quiet one`;
  }
  const sessions = `${sheet.totals.sessions} session${sheet.totals.sessions === 1 ? "" : "s"}`;
  return `Your ${noun} in training — ${sessions}, ${formatDuration(sheet.totals.durationS)}`;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function statCell(label: string, value: string): string {
  return `
    <td style="padding:12px 8px;text-align:center;font-family:${FONT};">
      <div style="font-size:22px;font-weight:600;color:#111827;">${escapeHtml(value)}</div>
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9ca3af;margin-top:2px;">${escapeHtml(label)}</div>
    </td>`;
}

function comparisonRows(sheet: PeriodFactSheet): string {
  if (!sheet.comparison) {
    // A first-ever period must not render as a decline.
    return `<p style="margin:0;font-size:14px;color:#6b7280;font-family:${FONT};">
      This is your first ${escapeHtml(periodNoun(sheet.kind))} of training here, so there's nothing to compare against yet.
    </p>`;
  }
  const rows: Array<[string, number]> = [
    ["Sessions", sheet.comparison.sessionsDeltaPct],
    ["Time", sheet.comparison.durationDeltaPct],
    ["Load", sheet.comparison.loadDeltaPct],
  ];
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FONT};">
    ${rows
      .map(
        ([label, pct]) => `<tr>
          <td style="padding:6px 0;font-size:14px;color:#374151;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;font-size:14px;color:#6b7280;text-align:right;">${escapeHtml(formatDelta(pct))}</td>
        </tr>`,
      )
      .join("")}
  </table>`;
}

function complianceLine(sheet: PeriodFactSheet): string {
  const { prescribed, completed, unplanned } = sheet.compliance;
  if (prescribed === 0 && unplanned === 0) return "";
  const extra = unplanned > 0 ? ` (plus ${unplanned} unplanned)` : "";
  return `<p style="margin:0 0 16px;font-size:15px;color:#374151;font-family:${FONT};">
    You completed <strong>${completed} of ${prescribed}</strong> planned sessions${escapeHtml(extra)}.
  </p>`;
}

export interface BuildDigestArgs {
  sheet: PeriodFactSheet;
  narration: PeriodNarration;
  links: DigestLinks;
}

export function buildPeriodDigestEmail(args: BuildDigestArgs): { subject: string; html: string } {
  const { sheet, narration, links } = args;
  const noun = periodNoun(sheet.kind);

  const loadCaveat =
    sheet.totals.loadConfidence === "power" || sheet.totals.loadConfidence === "none"
      ? ""
      : `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;font-family:${FONT};">
          Load is partly estimated — some sessions had no intensity data.
        </p>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;padding:24px 12px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">

        <tr><td style="padding:24px 28px 8px;font-family:${FONT};">
          <p style="margin:0;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;">Your ${escapeHtml(noun)} in training</p>
          <h1 style="margin:6px 0 0;font-size:21px;font-weight:600;color:#111827;">${escapeHtml(sheet.bounds.start)} – ${escapeHtml(sheet.bounds.end)}</h1>
        </td></tr>

        <tr><td style="padding:12px 20px 0;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              ${statCell("Sessions", String(sheet.totals.sessions))}
              ${statCell("Time", formatDuration(sheet.totals.durationS))}
              ${statCell("Distance", formatDistance(sheet.totals.distanceM))}
              ${statCell("Load", String(Math.round(sheet.totals.load)))}
            </tr>
          </table>
          ${loadCaveat}
        </td></tr>

        <tr><td style="padding:20px 28px 0;">
          ${complianceLine(sheet)}
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;font-family:${FONT};">Versus the previous ${escapeHtml(noun)}</p>
          ${comparisonRows(sheet)}
        </td></tr>

        <tr><td style="padding:20px 28px 0;">
          <div style="background:#f9fafb;border:1px solid #f3f4f6;border-radius:10px;padding:16px 18px;">
            <p style="margin:0;font-size:15px;line-height:1.6;color:#111827;font-family:${FONT};">${escapeHtml(narration.note)}</p>
            <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#374151;font-family:${FONT};"><strong>Next ${escapeHtml(noun)}:</strong> ${escapeHtml(narration.takeaway)}</p>
          </div>
        </td></tr>

        <tr><td style="padding:24px 28px;" align="center">
          <a href="${escapeHtml(links.reviewUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-family:${FONT};font-size:15px;font-weight:500;padding:12px 24px;border-radius:10px;">See the full review</a>
        </td></tr>

        <tr><td style="padding:0 28px 24px;font-family:${FONT};">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
            You're getting this because you turned on ${escapeHtml(noun === "week" ? "weekly" : "monthly")} review emails.
            <a href="${escapeHtml(links.unsubscribePageUrl)}" style="color:#6b7280;">Unsubscribe</a>.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject: buildDigestSubject(sheet), html };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendDigestArgs {
  to: string;
  athleteId: string;
  sheet: PeriodFactSheet;
  narration: PeriodNarration;
}

/**
 * Build and send one digest.
 *
 * Returns the brevo client's never-throwing result, plus `not_configured` when
 * the links could not be built -- the caller records that as a delivery failure
 * rather than marking the period sent.
 */
export async function sendPeriodDigest(args: SendDigestArgs): Promise<SendEmailResult> {
  const links = buildDigestLinks(args.athleteId, args.sheet.kind, args.sheet.periodKey);
  if (!links) {
    // Declining is the correct behaviour, not a degradation: see
    // buildDigestLinks.
    return { sent: false, reason: "not_configured" };
  }

  const { subject, html } = buildPeriodDigestEmail({
    sheet: args.sheet,
    narration: args.narration,
    links,
  });

  return sendTransactionalEmail({
    to: args.to,
    subject,
    html,
    unsubscribeUrl: links.unsubscribePostUrl,
  });
}
