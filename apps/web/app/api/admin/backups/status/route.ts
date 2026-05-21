// GET /api/admin/backups/status — managed backup + PITR status (read-only).
// Admin-gated; audited. Mirrors the data the backups page renders server-side,
// exposed as an API for parity.

import { NextResponse } from "next/server";

import { getManagedBackupStatus } from "@/admin/managed-backups";
import { requireAdmin } from "@/auth/admin-guard";
import { clientIp } from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const status = await getManagedBackupStatus();
  await writeAudit({
    action: "admin.backups.status.view",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    metadata: { state: status.state },
  });
  return NextResponse.json(status);
}
