// Plan history page (/plans, plan Unit 6). Server shell that resolves the
// authenticated athlete, reads their plans directly via the RLS-scoped
// client (same pattern as (athlete)/plan/page.tsx), then hands off to
// <PlanHistoryList> for rendering + navigation to /plans/[id].
//
// Reads here go through RLS (plans_self_select), not the admin-client API
// routes -- Server Component page reads follow the existing (athlete)/plan
// convention; archive/delete actions (mutations) go through the API routes
// per KTD1 in the plan doc.

import { redirect } from "next/navigation";

import type { PlanRow } from "@da2/shared";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { PlanHistoryList } from "@/plan/PlanHistoryList";

export default async function PlanHistoryPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select(
      "id, athlete_id, status, event_type, event_date, source, created_from_review_id, created_at, archived_at, deleted_at"
    )
    .eq("athlete_id", session.user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <div style={{ width: "100%", padding: "8px 0 80px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 20px" }}>
        Your plans
      </h1>
      <PlanHistoryList plans={(data ?? []) as PlanRow[]} />
    </div>
  );
}
