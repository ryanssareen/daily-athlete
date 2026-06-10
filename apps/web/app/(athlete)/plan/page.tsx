// Athlete proposal-review page (Unit 11). Server shell that resolves the
// authenticated athlete + their display timezone, then hands off to the
// <ProposalReview> client component (fetch + Realtime + accept/modify/reject).
//
// A solo athlete self-serves here; coached athletes' proposals route to the
// coach surface under (coach)/athletes/[id]/review instead (the GET list only
// returns coach-recipient rows to the linked coach). Deep-linkable via
// ?id=<reviewId> (the banner links here with the pending proposal's id).
//
// No-plan gate: reviews only exist for athletes with a training plan, so when
// the athlete has no active plan we render the "no plan yet" state with the
// AI generation entry point (<GeneratePlanCard> → POST /api/plans) instead of
// ProposalReview's "we'll let you know when your plan is reviewed"
// (misleading when there is nothing to review). On a query ERROR we fall
// through to ProposalReview rather than telling a planned athlete they have no
// plan.

import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createClient } from "@/auth/server";
import ProposalReview from "@/adaptive/ProposalReview";
import GeneratePlanCard from "@/plan/GeneratePlanCard";

export default async function AthleteReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const { id } = await searchParams;

  // RLS-scoped (plans_self_select); partial unique index guarantees at most
  // one active plan per athlete.
  const supabase = await createClient();
  const { data: activePlan, error: planErr } = await supabase
    .from("plans")
    .select("id")
    .eq("athlete_id", session.user.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (!planErr && !activePlan) {
    return (
      <div style={{ width: "100%", padding: "8px 0 80px" }}>
        <div
          data-testid="state-no-plan"
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: "48px 32px",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--color-ink)", margin: "0 0 8px" }}>
            No training plan yet
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-ink-muted)",
              margin: "0 auto",
              maxWidth: 440,
              lineHeight: 1.5,
            }}
          >
            Tell the AI coach how much time you have and what you&apos;re
            training for, and it will build you a week-by-week plan. Weekly
            reviews of that plan will land here.
          </p>
          <GeneratePlanCard athleteId={session.user.id} />
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              marginTop: 24,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/athlete/workouts/new"
              style={{
                border: "1px solid var(--color-border)",
                color: "var(--color-ink)",
                padding: "10px 18px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Add a workout instead
            </Link>
            <Link
              href="/athlete/calendar"
              style={{
                border: "1px solid var(--color-border)",
                color: "var(--color-ink)",
                padding: "10px 18px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              View calendar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", padding: "8px 0 80px" }}>
      <ProposalReview
        athleteId={session.user.id}
        reviewId={id}
        actor="athlete"
        timezone={session.timezone}
      />
    </div>
  );
}
