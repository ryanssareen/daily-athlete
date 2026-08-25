// Reports — the athlete's list of completed weekly and monthly periods (U7).
//
// A Server Component. It calls the same batched summary builder the API route
// does rather than fetching its own API over HTTP: a server component already
// has a cookie session, so a self-fetch would be a pointless round trip through
// the network stack (and would need absolute-URL plumbing that breaks between
// local, preview and production).
//
// Summaries are batched (three queries for the whole list, see
// @/ai/period-reviews/list). Assembling each period individually cost ~8
// queries per row on an uncached, force-dynamic page.
//
// Unlike the API route, this passes the USER-JWT client -- a server component
// always has a cookie session, so RLS runs as a real second layer underneath
// the gatherer's own athlete filters.

import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import type { PeriodReviewSummary } from "@da2/shared";

import { readAthleteTimezone } from "@/ai/period-reviews/assemble";
import { enumerateRecentPeriods } from "@/ai/period-reviews/calendar";
import { listPeriodSummaries, type ListedPeriod } from "@/ai/period-reviews/list";
import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { formatDuration, periodLabel } from "@/components/period-review/review-sections";

export const dynamic = "force-dynamic";

const WEEKLY_LIMIT = 8;
const MONTHLY_LIMIT = 6;

export default async function ReportsPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const admin = createAdminClient();
  const athleteId = session.user.id;

  const timezone = await readAthleteTimezone(admin, athleteId);
  const now = new Date();

  const wanted: ListedPeriod[] = [
    ...enumerateRecentPeriods("weekly", timezone, now, WEEKLY_LIMIT).map((key) => ({
      kind: "weekly" as const,
      key,
    })),
    ...enumerateRecentPeriods("monthly", timezone, now, MONTHLY_LIMIT).map((key) => ({
      kind: "monthly" as const,
      key,
    })),
  ];

  // Which periods already carry prose. One query, not one per period.
  // service-role: explicit user filter required
  const { data: narratedRows } = await admin
    .from("period_reviews")
    .select("kind, period_key")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .not("narrative", "is", null);
  const narrated = new Set(
    ((narratedRows ?? []) as Array<{ kind: string; period_key: string }>).map(
      (r) => `${r.kind}:${r.period_key}`,
    ),
  );

  let entries: PeriodReviewSummary[];
  try {
    entries = await listPeriodSummaries({
      supabase: admin,
      athleteId,
      timezone,
      periods: wanted,
      narrated,
    });
  } catch {
    // The whole list failing is rare (both reads are fatal by design); render
    // the empty state rather than a crashed page.
    entries = [];
  }

  entries.sort(
    (a, b) => b.bounds.start.localeCompare(a.bounds.start) || a.kind.localeCompare(b.kind),
  );

  const hasAnyTraining = entries.some((e) => e.sessions > 0);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 64px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, color: "var(--color-ink)" }}>
          Reports
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--color-ink-muted)", fontSize: 15 }}>
          How each week and month actually went against your plan.
        </p>
      </header>

      {!hasAnyTraining ? (
        <EmptyState />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {entries.map((e) => (
            <li key={`${e.kind}:${e.periodKey}`}>
              <Link
                href={`/athlete/reports/${e.kind}/${e.periodKey}` as Route}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px 20px",
                  background: "var(--color-paper)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 14,
                  textDecoration: "none",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--color-ink)" }}>
                    {periodLabel(e.kind, e.bounds)}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--color-ink-muted)" }}>
                    {e.sessions === 0
                      ? "No sessions logged"
                      : `${e.sessions} session${e.sessions === 1 ? "" : "s"} · ${formatDuration(
                          e.durationS,
                        )} · load ${Math.round(e.load)}`}
                  </p>
                </div>
                <span style={{ fontSize: 12, color: "var(--color-ink-muted)", whiteSpace: "nowrap" }}>
                  {e.hasNarration ? "Note ready" : "Not yet written"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "32px 24px",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--color-ink)" }}>
        No reports yet
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--color-ink-muted)" }}>
        Once you&apos;ve logged a week of training, your weekly and monthly reviews show up here.
      </p>
    </div>
  );
}
