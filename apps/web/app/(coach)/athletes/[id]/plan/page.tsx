// Coach proposal-review surface (Unit 11). Coached athletes' AI proposals route
// to the coach (recipient='coach'); the coach reviews the same before→after diff
// and accepts / modifies / rejects on the athlete's behalf via the very same
// /api/weekly-review endpoints (which enforce the active coach-athlete link as
// the accept-authority — this page is a thin shell).
//
// This is the one piece of coach-side AI UI in scope; coach-directed AI
// authoring stays out of v1.

import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import ProposalReview from "@/adaptive/ProposalReview";

export default async function CoachAthleteReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const { id: athleteId } = await params;
  const { id: reviewId } = await searchParams;

  return (
    <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto", padding: "0 0 80px" }}>
      <Link
        href={`/athletes/${athleteId}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "var(--color-ink-muted)",
          marginBottom: 20,
          fontWeight: 500,
        }}
      >
        ← Back to athlete
      </Link>
      <ProposalReview
        athleteId={athleteId}
        reviewId={reviewId}
        actor="coach"
        timezone={session.timezone}
      />
    </div>
  );
}
