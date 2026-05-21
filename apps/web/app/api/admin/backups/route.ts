// GET /api/admin/backups — list export artifacts (newest first) for the
// dashboard. Admin-gated. NOT audited: this is the backups page's polling
// sub-resource (the page view itself is audited on render); auditing each poll
// would flood the immutable log.

import { NextResponse } from "next/server";

import { requireAdmin } from "@/auth/admin-guard";
import { createAdminClient } from "@/db/admin";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin(request);
  if (!gate.ok) return gate.response;

  const admin = createAdminClient();
  // service-role: admin_backups is a service-role-only table.
  const { data, error } = await admin
    .from("admin_backups")
    .select("id, status, size_bytes, table_counts, error, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ backups: data ?? [] });
}
