// GET /api/admin/logs?filter=&page=&pageSize= — read the append-only admin
// audit trail (every admin operation: backups, users, auth, playground).
// Admin-gated + audited. The `filter` is a SERVER-SIDE allow-list of action
// prefixes (never raw user input into the LIKE). The audit metadata is NON-PII:
// it records the filter key + result count + page, never log row contents.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/auth/admin-guard";
import { clientIp } from "@/auth/admin-session";
import { listAuditLog, writeAudit } from "@/db/admin-audit";

// filter key -> action prefix (undefined => all actions). Allow-listed so user
// input can never reach the SQL LIKE pattern.
const FILTERS: Record<string, string | undefined> = {
  all: undefined,
  backups: "admin.backups",
  users: "admin.users",
  playground: "admin.playground",
};

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const rawFilter = url.searchParams.get("filter") ?? "all";
  const filter = rawFilter in FILTERS ? rawFilter : "all";
  const page = Number(url.searchParams.get("page") ?? "0");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "50");

  let result;
  try {
    result = await listAuditLog({ actionPrefix: FILTERS[filter], page, pageSize });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  await writeAudit({
    action: "admin.logs.view",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    metadata: { results: result.entries.length, page: result.page, filter },
  });

  return NextResponse.json(result);
}
