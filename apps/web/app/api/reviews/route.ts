// GET /api/reviews — list the athlete's completed periods.
//
// This exists so the Reports surface can render a list without N round trips
// (one per period) or N narration lookups. It returns a headline stat per
// period plus whether prose already exists, and never calls the LLM.
//
// The periods are ENUMERATED from the calendar rather than read from
// `period_reviews`: a period the athlete trained in but never generated a
// review for still belongs in the list, because the facts exist whether or not
// anyone has narrated them. Reading the table instead would show only the
// periods they had already opened, which is the opposite of a list's purpose.
//
// QUERY COST. The summaries come from `listPeriodSummaries`, which fetches each
// underlying table ONCE over the union of all listed periods and slices in
// memory — three queries regardless of list length. Calling
// assemblePeriodReview per period (its earlier shape) cost ~8 queries each,
// ~114 per uncached page load. See that module's header.

import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodKind, PeriodReviewListResponse } from "@da2/shared";
import { PeriodKindSchema } from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

import { readAthleteTimezone } from "@/ai/period-reviews/assemble";
import { enumerateRecentPeriods, periodBounds } from "@/ai/period-reviews/calendar";
import { listPeriodSummaries, type ListedPeriod } from "@/ai/period-reviews/list";

/**
 * How many periods of each cadence to return.
 *
 * Now that the summaries are batched these are a payload-size knob rather than
 * a query-count one, but they stay bounded: an athlete browsing further back is
 * a paging problem, not a default-payload problem.
 */
export const WEEKLY_LIST_LIMIT = 8;
export const MONTHLY_LIST_LIMIT = 6;

/** Which of these periods already have stored prose. One query for the whole
 * list rather than one per period. */
async function readNarratedKeys(
  supabase: SupabaseClient,
  athleteId: string,
): Promise<Set<string>> {
  // service-role: explicit user filter required
  const { data, error } = await supabase
    .from("period_reviews")
    .select("kind, period_key, narrative")
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .not("narrative", "is", null);

  if (error) {
    // Degrade to "none narrated". The list still renders with correct facts;
    // the only cost is that a generate affordance shows where a regenerate one
    // belonged, which is a far better failure than an error page.
    console.warn("[reviews.list] narrated-keys read failed", {
      athlete_id: athleteId,
      message: error.message,
    });
    return new Set();
  }

  return new Set(
    ((data ?? []) as Array<{ kind: string; period_key: string }>).map(
      (r) => `${r.kind}:${r.period_key}`,
    ),
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const authClient = await createServerClient();
  const { user, error: authErr } = await resolveAuth(authClient, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  // Optional `?kind=` narrows the list to one cadence (the mobile Insights tab
  // wants only recent weeks). Absent means both.
  const requested = new URL(request.url).searchParams.get("kind");
  if (requested !== null && !PeriodKindSchema.safeParse(requested).success) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  const timezone = await readAthleteTimezone(db, user.id);
  const now = new Date();
  const narrated = await readNarratedKeys(db, user.id);

  const wanted: ListedPeriod[] = [];
  if (requested === null || requested === "weekly") {
    for (const key of enumerateRecentPeriods("weekly", timezone, now, WEEKLY_LIST_LIMIT)) {
      wanted.push({ kind: "weekly", key });
    }
  }
  if (requested === null || requested === "monthly") {
    for (const key of enumerateRecentPeriods("monthly", timezone, now, MONTHLY_LIST_LIMIT)) {
      wanted.push({ kind: "monthly", key });
    }
  }

  let summaries;
  try {
    summaries = await listPeriodSummaries({
      supabase: db,
      athleteId: user.id,
      timezone,
      periods: wanted,
      narrated,
    });
  } catch (err) {
    console.error("[reviews.list] summaries failed", {
      athlete_id: user.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Newest first across both cadences. `enumerateRecentPeriods` already returns
  // each cadence newest-first; sorting on the resolved start date interleaves
  // them correctly rather than showing all weeks then all months.
  const periods = [...summaries].sort(
    (a, b) =>
      periodBounds(b.kind, b.periodKey).start.localeCompare(
        periodBounds(a.kind, a.periodKey).start,
      ) || a.kind.localeCompare(b.kind),
  );

  return NextResponse.json({ periods } satisfies PeriodReviewListResponse, { status: 200 });
}

// Re-exported for the tests and the server page, which enumerate the same set.
export type { PeriodKind };
