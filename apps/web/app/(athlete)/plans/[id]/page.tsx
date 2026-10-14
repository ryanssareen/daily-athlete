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
import { formatDate } from "@/plan/format";
import { PlanOverview } from "@/plan/PlanOverview";
import { todayIn, type PlanWorkoutInput } from "@/plan/plan-summary";

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

  const { data: planWorkouts } = await supabase
    .from("planned_workouts")
    .select("id, scheduled_date, sport, status, structure")
    .eq("plan_id", plan.id)
    .is("deleted_at", null)
    .order("scheduled_date")
    .returns<PlanWorkoutInput[]>();
  const upcomingCount = (planWorkouts ?? []).filter((w) => w.status === "planned").length;

  return (
    <div style={{ width: "100%", padding: "8px 0 80px" }}>
      <Link
        href="/plans"
        style={{ fontSize: 13, color: "var(--color-ink-muted)", textDecoration: "none" }}
      >
        ← Your plans
      </Link>
      <div style={{ margin: "12px 0 16px" }}>
        <PlanOverview plan={plan} workouts={planWorkouts ?? []} today={todayIn(session.timezone)} />
        <p style={{ fontSize: 12, color: "var(--color-ink-subtle)", margin: 0 }}>
          {plan.status === "active" ? "Active" : "Archived"}
          {` · Created ${formatDate(plan.created_at)}`}
          {plan.source === "coach_assigned" && " · Assigned by your coach"}
        </p>
      </div>
      <PlanActions
        plan={plan}
        isCurrentActivePlan={isCurrentActivePlan}
        hasUpcomingWorkouts={upcomingCount > 0}
      />
    </div>
  );
}
