// Athlete proposal-review page (Unit 11). Server shell that resolves the
// authenticated athlete + their display timezone, then hands off to the
// <ProposalReview> client component (fetch + Realtime + accept/modify/reject).
//
// A solo athlete self-serves here; coached athletes' proposals route to the
// coach surface under (coach)/athletes/[id]/review instead (the GET list only
// returns coach-recipient rows to the linked coach). Deep-linkable via
// ?id=<reviewId> (the banner links here with the pending proposal's id).

import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import ProposalReview from "@/adaptive/ProposalReview";

export default async function AthleteReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const { id } = await searchParams;

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
