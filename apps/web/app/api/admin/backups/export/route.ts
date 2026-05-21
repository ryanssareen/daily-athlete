// POST /api/admin/backups/export — trigger an on-demand encrypted export.
//
// Order: CSRF (fail-closed) -> admin session -> feature gate (Inngest set) ->
// one-running-export guard -> insert pending row -> dispatch Inngest -> audit.
// The pending row is inserted BEFORE dispatch so a successful upload can never
// be an untracked orphan (the deterministic path derives from the row id).

import { NextResponse } from "next/server";

import { requireAdmin } from "@/auth/admin-guard";
import { clientIp, isSameOriginRequest } from "@/auth/admin-session";
import { config } from "@/config";
import { createAdminClient } from "@/db/admin";
import { writeAudit } from "@/db/admin-audit";
import { inngest } from "@/inngest/client";
import { ADMIN_BACKUP_EXPORT_EVENT } from "@/inngest/functions/admin-backup-export";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  // Feature gate: an export needs a configured Inngest (dispatch + signed
  // serve endpoint). Refuse rather than silently no-op.
  if (!config.inngest.eventKey || !config.inngest.signingKey) {
    return NextResponse.json({ error: "export_unavailable" }, { status: 503 });
  }

  const admin = createAdminClient();

  // One running export at a time — full dumps are expensive; don't let the
  // trigger be spammed into a cost/DoS vector.
  // service-role: admin_backups is a service-role-only table.
  const { data: active } = await admin
    .from("admin_backups")
    .select("id")
    .in("status", ["pending", "running"])
    .limit(1);
  if (active && active.length > 0) {
    return NextResponse.json({ error: "export_in_progress" }, { status: 409 });
  }

  // Insert the tracking row FIRST (status 'pending').
  // service-role: admin_backups is a service-role-only table.
  const { data: inserted, error } = await admin
    .from("admin_backups")
    .insert({ status: "pending" })
    .select("id")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  const backupId = inserted.id as string;

  try {
    await inngest.send({
      name: ADMIN_BACKUP_EXPORT_EVENT,
      data: { backupId },
    });
  } catch {
    // Dispatch failed — don't leave a stuck 'pending' row.
    await admin
      .from("admin_backups")
      .update({ status: "failed", error: "dispatch failed" })
      .eq("id", backupId);
    return NextResponse.json({ error: "dispatch_failed" }, { status: 502 });
  }

  await writeAudit({
    action: "admin.backups.export.requested",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    target: backupId,
  });

  return NextResponse.json({ status: "queued", backupId }, { status: 202 });
}
