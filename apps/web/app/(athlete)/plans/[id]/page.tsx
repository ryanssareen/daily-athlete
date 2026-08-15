// Plan detail page (/plans/[id], plan Unit 6). Server shell that resolves
// the authenticated athlete, reads the one plan directly via the RLS-scoped
// client (plans_self_select already scopes it to their own rows), and
// renders a not-found state when the id doesn't resolve -- covers "doesn't
// exist", "not yours" (RLS-filtered to nothing), and "soft-deleted" (filtered
// out) identically, matching the API layer's 404-only convention (R6).

import Link from "next/link";
import { redirect } from "next/navigation";

import type { PlanRow } from "@da2/shared";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import { PlanActions } from "@/plan/PlanActions";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const { id } = await params;

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("plans")
    .select(
      "id, athlete_id, status, event_type, event_date, source, created_from_review_id, created_at, archived_at, deleted_at"
    )
    .eq("id", id)
    .eq("athlete_id", session.user.id)
    .is("deleted_at", null)
    .maybeSingle<PlanRow>();

  if (!plan) {
    return (
      <div style={{ width: "100%", padding: "8px 0 80px" }}>
        <div
          data-testid="state-plan-not-found"
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: "48px 32px",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 8px" }}>
            Plan not found
          </h2>
          <p style={{ fontSize: 14, color: "var(--color-ink-muted)", margin: "0 0 20px" }}>
            This plan doesn&apos;t exist or has been deleted.
          </p>
          <Link
            href="/plans"
            style={{
              display: "inline-block",
              border: "1px solid var(--color-border-strong)",
              color: "var(--color-ink)",
              padding: "10px 18px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Back to your plans
          </Link>
        </div>
      </div>
    );
  }

  // At most one active plan per athlete (plans_one_active_per_athlete), so
  // status === "active" IS "this is the current plan" -- no extra query.
  const isCurrentActivePlan = plan.status === "active";

  const { count: upcomingCount } = await supabase
    .from("planned_workouts")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan.id)
    .eq("status", "planned")
    .is("deleted_at", null);

  return (
    <div style={{ width: "100%", padding: "8px 0 80px" }}>
      <Link
        href="/plans"
        style={{ fontSize: 13, color: "var(--color-ink-muted)", textDecoration: "none" }}
      >
        ← Your plans
      </Link>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--color-ink)", margin: "12px 0 4px" }}>
        {plan.event_type || "Training plan"}
      </h1>
      <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: "0 0 24px" }}>
        {plan.status === "active" ? "Active" : "Archived"}
        {plan.event_date && ` · Event: ${formatDate(plan.event_date)}`}
        {` · Created ${formatDate(plan.created_at)}`}
      </p>
      <PlanActions
        plan={plan}
        isCurrentActivePlan={isCurrentActivePlan}
        hasUpcomingWorkouts={(upcomingCount ?? 0) > 0}
      />
    </div>
  );
}
