// POST /api/admin/users/[id]/moderation
//
// Single guarded mutation for the four moderation actions (disable, enable,
// delete=soft, restore). Order mirrors every other admin mutation: CSRF
// (Sec-Fetch-Site, fail-closed) -> admin session gate -> Zod-validated body ->
// dispatch to the moderation DB layer -> best-effort reason email (disable +
// delete only) -> audit. Type-to-confirm on destructive actions is a
// client-side UX guard, NOT this CSRF control.
//
// Audit metadata is NON-PII: action + reasonCode (a normalized code) + whether
// an email was sent — never the recipient address or the free-text reason.

import { NextResponse } from "next/server";

import {
  UserModerationRequestSchema,
  type ModerationAction,
  type ModerationReasonCode,
} from "@da2/shared";

import { requireAdmin } from "@/auth/admin-guard";
import { clientIp, isSameOriginRequest } from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";
import {
  disableUser,
  enableUser,
  getUserEmail,
  MODERATION_GRACE_DAYS,
  restoreUser,
  softDeleteUser,
  type ModerationResult,
} from "@/db/admin-moderation";
import { notifyModeration } from "@/email/moderation-emails";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badInput(): NextResponse {
  return NextResponse.json({ error: "invalid_input" }, { status: 400 });
}

/** Best-effort reason email; returns whether it actually sent. Never throws. */
async function sendReasonEmail(
  userId: string,
  action: "disable" | "delete",
  reasonCode: ModerationReasonCode,
  reason: string | undefined
): Promise<boolean> {
  const to = await getUserEmail(userId);
  if (!to) return false;
  const { sent } = await notifyModeration({
    to,
    action,
    reasonCode,
    reason,
    graceDays: MODERATION_GRACE_DAYS,
  });
  return sent;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) return badInput();

  let body: { action: ModerationAction; reasonCode?: ModerationReasonCode; reason?: string };
  try {
    body = UserModerationRequestSchema.parse(await request.json());
  } catch {
    return badInput();
  }
  const { action, reasonCode, reason } = body;

  let result: ModerationResult;
  try {
    if (action === "disable") {
      if (!reasonCode) return badInput();
      result = await disableUser(id, reasonCode);
    } else if (action === "delete") {
      if (!reasonCode) return badInput();
      result = await softDeleteUser(id, reasonCode);
    } else if (action === "enable") {
      result = await enableUser(id);
    } else {
      result = await restoreUser(id);
    }
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  // Punitive actions notify the user; the email is best-effort and must not
  // fail the action. reasonCode is guaranteed for these actions (schema +
  // guard above).
  let emailed = false;
  if ((action === "disable" || action === "delete") && reasonCode) {
    try {
      emailed = await sendReasonEmail(id, action, reasonCode, reason);
    } catch {
      emailed = false; // defensive: notify path is best-effort
    }
  }

  await writeAudit({
    action: `admin.users.${action}`,
    targetUserId: id,
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    metadata: { reasonCode: reasonCode ?? null, emailed },
  });

  return NextResponse.json({ ok: true, emailed });
}
