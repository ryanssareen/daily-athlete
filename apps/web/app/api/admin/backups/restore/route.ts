// POST /api/admin/backups/restore — DANGEROUS: re-import an uploaded export
// artifact into live Postgres (upsert, merge-forward). Accepts the gzipped
// NDJSON the download endpoint produces (or plain NDJSON). Optional `username`
// scopes the restore to one user's rows; blank restores everything.
//
// Order: CSRF (fail-closed) -> admin session -> typed confirmation -> file
// validation -> restore -> audit. Confirmation token is "RESTORE" (the UI makes
// the operator type it). Audit metadata is non-PII (counts + a code only) — the
// username and any DB error text stay out of the immutable log.

import { NextResponse } from "next/server";

import { RestoreError, restoreFromArchive } from "@/admin/backup-restore";
import { requireAdmin } from "@/auth/admin-guard";
import { clientIp, isSameOriginRequest } from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap the compressed upload — a backup artifact is small (gzipped NDJSON); this
// bounds memory and keeps the trigger from being a DoS vector.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const CONFIRM_TOKEN = "RESTORE";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  if (String(form.get("confirm") ?? "") !== CONFIRM_TOKEN) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  const usernameRaw = form.get("username");
  const username =
    typeof usernameRaw === "string" && usernameRaw.trim() ? usernameRaw.trim() : null;

  const ip = clientIp(request.headers);
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const summary = await restoreFromArchive(bytes, { username });

    await writeAudit({
      action: "admin.backups.restore",
      ip,
      sessionId: gate.sessionId,
      metadata: {
        scoped: username !== null,
        totalRows: summary.totalRows,
        skippedUnknownTables: summary.skippedUnknownTables.length,
      },
    });

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const code = err instanceof RestoreError ? err.code : "unexpected";
    await writeAudit({
      action: "admin.backups.restore.failed",
      ip,
      sessionId: gate.sessionId,
      metadata: { scoped: username !== null, code },
    });

    // The human message is returned to the operator UI but never stored: it can
    // echo the typed username (PII) or a DB error.
    const message =
      err instanceof RestoreError
        ? err.message
        : "Could not read or restore this backup file.";
    return NextResponse.json({ error: "restore_failed", code, message }, { status: 422 });
  }
}
