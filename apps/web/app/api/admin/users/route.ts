// GET /api/admin/users?q=&page=&pageSize= — read-only user directory
// (name + email), searchable + paginated. Admin-gated + audited (cross-user
// PII access). The audit metadata is NON-PII: it records result count + page +
// whether a search ran, never the search term itself (which may be an email).

import { NextResponse } from "next/server";

import { requireAdmin } from "@/auth/admin-guard";
import { clientIp } from "@/auth/admin-session";
import { writeAudit } from "@/db/admin-audit";
import { listUsers } from "@/db/admin-users";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? undefined;
  const page = Number(url.searchParams.get("page") ?? "0");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25");

  let result;
  try {
    result = await listUsers({ search, page, pageSize });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  await writeAudit({
    action: "admin.users.view",
    ip: clientIp(request.headers),
    sessionId: gate.sessionId,
    metadata: {
      results: result.users.length,
      page: result.page,
      searched: Boolean(search),
    },
  });

  return NextResponse.json(result);
}
