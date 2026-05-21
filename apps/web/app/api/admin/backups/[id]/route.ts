// DELETE /api/admin/backups/[id] — remove an export artifact (object + row).
// Two-step across systems with no transaction: delete the Storage object first
// (404 treated as success => idempotent), then the row. If the object delete
// genuinely fails, keep the row + surface the error; the prune job's orphan
// sweep reconciles either half. CSRF-guarded + audited.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/auth/admin-guard";
import { clientIp, isSameOriginRequest } from "@/auth/admin-session";
import { config } from "@/config";
import { createAdminClient } from "@/db/admin";
import { writeAudit } from "@/db/admin-audit";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const admin = createAdminClient();

  // service-role: admin_backups is a service-role-only table.
  const { data: row } = await admin
    .from("admin_backups")
    .select("id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const path = row.storage_path as string | null;
  if (path) {
    const { error } = await admin.storage.from(config.backups.bucket).remove([path]);
    // Treat "object not found" as success (idempotent); fail on anything else.
    if (error && !/not.?found|does not exist/i.test(error.message)) {
      return NextResponse.json({ error: "storage_error" }, { status: 502 });
    }
  }

  await admin.from("admin_backups").delete().eq("id", id);
  await writeAudit({
    action: "admin.backups.delete",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    target: id,
  });

  return NextResponse.json({ ok: true });
}
