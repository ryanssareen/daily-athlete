// GET /api/admin/backups/[id]/download — stream the artifact through the
// authenticated session (no signed URL leaves the session). The artifact is
// stored encrypted; we decrypt server-side (server-held key) and return the
// gzipped NDJSON so the operator just gunzips. Audited (a download is the
// moment the data leaves the system).

import { NextResponse } from "next/server";

import { decryptBackup } from "@/admin/backup-crypto";
import { requireAdmin } from "@/auth/admin-guard";
import { clientIp } from "@/auth/admin-session";
import { config } from "@/config";
import { createAdminClient } from "@/db/admin";
import { writeAudit } from "@/db/admin-audit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const admin = createAdminClient();

  // service-role: admin_backups is a service-role-only table.
  const { data: row } = await admin
    .from("admin_backups")
    .select("id, storage_path, key_version, status")
    .eq("id", id)
    .maybeSingle();
  if (!row || !row.storage_path || row.status !== "success") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const dl = await admin.storage
    .from(config.backups.bucket)
    .download(row.storage_path as string);
  if (dl.error || !dl.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let plaintextGz: Uint8Array;
  try {
    const ciphertext = new Uint8Array(await dl.data.arrayBuffer());
    plaintextGz = decryptBackup(ciphertext, row.key_version as number);
  } catch {
    return NextResponse.json({ error: "decrypt_failed" }, { status: 500 });
  }

  await writeAudit({
    action: "admin.backups.download",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    target: id,
  });

  return new NextResponse(plaintextGz, {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="backup-${id}.ndjson.gz"`,
      "Cache-Control": "no-store",
    },
  });
}
