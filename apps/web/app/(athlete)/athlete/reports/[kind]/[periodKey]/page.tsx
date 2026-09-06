// One period review (U7).
//
// The facts render server-side and are ALWAYS present; only the narration --
// which needs generate/regenerate state -- is delegated to a client shell. If
// that shell never hydrates, the athlete still has their numbers.

import type { Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import type { PeriodKind, PeriodNarration } from "@da2/shared";
import { PeriodKindSchema, isValidPeriodKey } from "@da2/shared";

import { assemblePeriodReview, readAthleteTimezone } from "@/ai/period-reviews/assemble";
import { isPeriodClosed } from "@/ai/period-reviews/calendar";
import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { ReviewNarration } from "@/components/period-review/review-detail";
import { ShareButton } from "@/components/share/ShareButton";
import type { ShareStat } from "@/components/share/share-canvas";
import {
  ComparisonRow,
  ComparisonToPrevious,
  formatDistance,
  formatDuration,
  periodLabel,
  SportTable,
  StatRow,
} from "@/components/period-review/review-sections";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        padding: "20px 24px",
      }}
    >
      <p className="eyebrow" style={{ marginTop: 0 }}>
        {title}
      </p>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

export default async function PeriodReviewPage({
  params,
}: {
  params: Promise<{ kind: string; periodKey: string }>;
}) {
  const { kind: rawKind, periodKey } = await params;

  const parsedKind = PeriodKindSchema.safeParse(rawKind);
  if (!parsedKind.success || !isValidPeriodKey(parsedKind.data, periodKey)) notFound();
  const kind: PeriodKind = parsedKind.data;

  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const athleteId = session.user.id;

  const timezone = await readAthleteTimezone(admin, athleteId);
  // A period still running has no review: its numbers would move under the
  // athlete while they read them.
  if (!isPeriodClosed(kind, periodKey, timezone, new Date())) notFound();

  // One assembly, reused for both the facts and the staleness check below.
  // It costs a handful of athlete-scoped queries, so doing it twice would
  // double the page's database work for no new information.
  let facts;
  let fingerprint;
  try {
    ({ facts, fingerprint } = await assemblePeriodReview({
      supabase: admin,
      athleteId,
      kind,
      periodKey,
      timezone,
    }));
  } catch {
    notFound();
  }

  // service-role: explicit user filter required
  const { data: storedRow } = await admin
    .from("period_reviews")
    .select("narrative, takeaway, input_fingerprint")
    .eq("athlete_id", athleteId)
    .eq("kind", kind)
    .eq("period_key", periodKey)
    .is("deleted_at", null)
    .maybeSingle();

  const stored = storedRow as {
    narrative: string | null;
    takeaway: string | null;
    input_fingerprint: string;
  } | null;

  const narration: PeriodNarration | null =
    stored?.narrative && stored.takeaway
      ? { note: stored.narrative, takeaway: stored.takeaway }
      : null;
  const stale = narration !== null && stored!.input_fingerprint !== fingerprint;

  const { totals, compliance } = facts;

  const shareStats: ShareStat[] = [
    { label: "Sessions", value: String(totals.sessions) },
    { label: "Time", value: formatDuration(totals.durationS) },
    { label: "Distance", value: formatDistance(totals.distanceM) },
    { label: "Load", value: String(Math.round(totals.load)) },
    { label: "Active days", value: String(totals.activeDays) },
  ];
  const accent = kind === "weekly" ? { color: "#c45a30", deep: "#a4451f" } : { color: "#2d4a3e", deep: "#1c2f27" };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 64px" }}>
      <Link
        href={"/athlete/reports" as Route}
        style={{ fontSize: 13, color: "var(--color-ink-muted)", textDecoration: "none" }}
      >
        ← All reports
      </Link>

      <header style={{ margin: "12px 0 24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, color: "var(--color-ink)" }}>
            {periodLabel(kind, facts.bounds)}
          </h1>
          <p style={{ margin: "6px 0 0", color: "var(--color-ink-muted)", fontSize: 14 }}>
            {facts.bounds.start} to {facts.bounds.end}
          </p>
        </div>
        <ShareButton
          eyebrow={kind === "weekly" ? "Weekly report" : "Monthly report"}
          title={periodLabel(kind, facts.bounds)}
          dateLine={`${facts.bounds.start} to ${facts.bounds.end}`}
          stats={shareStats}
          accentColor={accent.color}
          accentDeep={accent.deep}
          fileNamePrefix={`report-${kind}-${periodKey}`}
        />
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <StatRow
          items={[
            { label: "Sessions", value: String(totals.sessions) },
            { label: "Time", value: formatDuration(totals.durationS) },
            { label: "Distance", value: formatDistance(totals.distanceM) },
            {
              label: "Load",
              value: String(Math.round(totals.load)),
              // Naming the provenance is the honest thing: a duration-proxy
              // figure presented bare reads as a measurement.
              hint:
                totals.loadConfidence === "power"
                  ? undefined
                  : totals.loadConfidence === "none"
                    ? "no load data"
                    : "partly estimated",
            },
            { label: "Active days", value: String(totals.activeDays) },
          ]}
        />

        <Section title="Against your plan">
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
            <span style={{ color: "var(--color-ink)" }}>Prescribed sessions completed</span>
            <span style={{ color: "var(--color-ink)" }}>
              {compliance.completed} of {compliance.prescribed}
              {compliance.unplanned > 0 && (
                <span style={{ color: "var(--color-ink-muted)" }}>
                  {" "}
                  (+{compliance.unplanned} unplanned)
                </span>
              )}
            </span>
          </div>
          <ComparisonRow label="Time" metric={facts.duration} format={formatDuration} />
          <ComparisonRow label="Load" metric={facts.load} format={(n) => String(Math.round(n))} />
        </Section>

        <Section title="By sport">
          <SportTable sports={facts.sports} />
        </Section>

        <Section title={kind === "weekly" ? "Versus last week" : "Versus last month"}>
          <ComparisonToPrevious facts={facts} />
        </Section>

        <Section title="Coach's note">
          <ReviewNarration
            kind={kind}
            periodKey={periodKey}
            initialNarration={narration}
            initialStale={stale}
          />
        </Section>
      </div>
    </div>
  );
}
