// GET/POST /api/workouts/[id]/report — the per-workout debrief (Unit U6,
// docs/plans/2026-08-18-001-feat-workout-reports-plan.md).
//
// This route is the composition seam U3 (delta.ts), U4 (context.ts /
// fingerprint.ts), and U5 (fact-sheet.ts / narrate.ts) were deliberately
// left for: it is the first unit that needs all of them together.
//
// TWO PATHS WITH SHARPLY DIFFERENT PROPERTIES (KTD2):
//
//   GET  — gather context, compute the delta + fingerprint (pure, cheap),
//          read any stored narrative row. NEVER calls the LLM. This is what
//          makes the read path un-rate-limitable and fast — see every GET
//          test below asserting the narrate()/createLlmClient() mocks were
//          never invoked. Because the delta is the valuable part and it is
//          already in hand by the time the OPTIONAL workout_reports read
//          runs, a failure of that read degrades to 200 with
//          `narration: null` rather than discarding a good delta with a 500.
//
//   POST — same context + delta, then (only if the cache misses) narrate()
//          and upsert the result on completed_workout_id. On a retryable LLM
//          failure (LlmRateLimited/LlmTransient — isLlmBackOff) or a
//          permanent one (LlmInvalidOutput / ReportNarrationInvalidError),
//          returns 200 with narration: null rather than a 5xx — the delta is
//          perfectly good deterministic content and a 5xx would blank it
//          (F4/AE6). No row is written on either failure branch.
//
// AUTHENTICATION vs DATA ACCESS — these use DIFFERENT clients, deliberately:
//
//   auth  — `createServerClient()` (@supabase/ssr) + `resolveAuth`, which
//           accepts a cookie session (browser) OR an `Authorization: Bearer`
//           token (mobile — the `da2://` app shares no cookie jar).
//   data  — `createAdminClient()` (service role), with an EXPLICIT
//           `athlete_id = user.id` filter on every read and write.
//
// This split is load-bearing, not stylistic. `resolveAuth` calls
// `supabase.auth.getUser(bearerToken)`, which VALIDATES the token but never
// ATTACHES it to the client. A cookie-less mobile request therefore queries
// Postgres as `anon` with `auth.uid()` NULL, so every RLS-scoped read returns
// zero rows and the whole feature 404s on mobile while working fine in the
// browser. Reading under the service role with hand-rolled athlete filters is
// the established fix in this repo — see app/api/plans/route.ts, which does
// exactly this for the same reason. `gatherReportContext` (U4) already
// filters explicitly by `athlete_id` on every read (see its module header),
// so passing it the admin client loses no scoping.
//
// A workout the caller does not own reads as "not found"
// (gatherReportContext's CompletedWorkoutNotFoundError) and this route maps
// that to 404, matching apps/web/app/api/workouts/[id]/status/route.ts's
// not-found posture — report existence is not an ownership oracle (no 403
// branch here that would leak "this workout exists but isn't yours").
//
// `athlete_id` on every query below is the AUTHENTICATED caller resolved by
// resolveAuth, never a client-supplied id. See the
// `// service-role: explicit user filter required` comments.
//
// KNOWN GAP (see this unit's report-back — out of U6's scope to alter U1/U4's
// RLS/context posture): R11 says a linked coach can read a report at "the
// data layer (RLS + API)". workout_reports itself has a coach-additive SELECT
// policy (migration 0027), but this route scopes every read to
// `athlete_id = user.id`, so a coach 404s before reaching the row whose
// policy would have admitted them. R11's "API" half is not reachable by a
// coach yet; the coach-facing surface is a deferred follow-up that needs no
// migration.

import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExecutionDelta, VerdictCode, WorkoutReportResponse } from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";
import { config } from "@/config";
import { createLlmClient, isLlmBackOff, LlmInvalidOutput } from "@/llm";

import { CompletedWorkoutNotFoundError, gatherReportContext, type ReportContext } from "@/ai/reports/context";
import { computeExecutionDelta } from "@/ai/reports/delta";
import { computeFingerprint } from "@/ai/reports/fingerprint";
import { buildFactSheet } from "@/ai/reports/fact-sheet";
import { narrate, ReportNarrationInvalidError } from "@/ai/reports/narrate";
import { toDeltaInput } from "@/ai/reports/to-delta-input";

// POST makes one synchronous LLM call. The LLM client's own internal timeout
// is 120s, so on the platform default (10s hobby / 15s pro) the function is
// killed long before narrate() can fail gracefully into the F4/AE6
// `retryable` branch — the caller sees an opaque platform error instead of a
// delta with `narration: null`. Every other LLM-calling route in this repo
// sets 60 for the same reason. Applies to GET too (Next exports it per
// module), which is harmless: GET never calls the LLM and returns in ms.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Shared: auth + context/delta/fingerprint assembly (both verbs need it).
// ---------------------------------------------------------------------------

interface AssembledReport {
  context: ReportContext;
  delta: ExecutionDelta;
  fingerprint: string;
}

/** Discriminated result so callers don't have to catch — the one expected
 * failure mode (not visible / doesn't exist) is a value, not an exception. */
type AssembleResult =
  | { ok: true; value: AssembledReport }
  | { ok: false; status: 404 | 500 };

async function assemble(
  supabase: SupabaseClient,
  athleteId: string,
  completedWorkoutId: string
): Promise<AssembleResult> {
  let context: ReportContext;
  try {
    // service-role: explicit user filter required — gatherReportContext
    // filters every read on this athleteId (see its module header).
    context = await gatherReportContext({ supabase, athleteId, completedWorkoutId });
  } catch (err) {
    if (err instanceof CompletedWorkoutNotFoundError) {
      return { ok: false, status: 404 };
    }
    console.error("[workouts.report] gatherReportContext failed", {
      athlete_id: athleteId,
      workout_id: completedWorkoutId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 500 };
  }

  const delta = computeExecutionDelta(toDeltaInput(context));
  const fingerprint = computeFingerprint(context);
  return { ok: true, value: { context, delta, fingerprint } };
}

// ---------------------------------------------------------------------------
// Stored row (workout_reports) — the only thing this route persists (KTD2).
// ---------------------------------------------------------------------------

interface StoredReportRow {
  narrative: string | null;
  takeaway: string | null;
  verdict_code: string | null;
  input_fingerprint: string;
}

/** A stored row that actually carries prose — the only kind worth serving. */
interface StoredNarration {
  note: string;
  takeaway: string;
  verdictCode: string | null;
  fingerprint: string;
}

function toStoredNarration(row: StoredReportRow | null): StoredNarration | null {
  if (row === null || row.narrative === null || row.takeaway === null) return null;
  return {
    note: row.narrative,
    takeaway: row.takeaway,
    verdictCode: row.verdict_code,
    fingerprint: row.input_fingerprint,
  };
}

async function readStoredReport(
  supabase: SupabaseClient,
  athleteId: string,
  completedWorkoutId: string
): Promise<{ ok: true; row: StoredReportRow | null } | { ok: false }> {
  // service-role: explicit user filter required. `completed_workout_id` alone
  // would be sufficient in practice (it is unique, and assemble() already
  // proved the caller owns that workout), but the athlete_id predicate is
  // what makes this query correct in ISOLATION rather than correct only by
  // reference to a check that happens to run earlier in the same handler.
  const { data, error } = await supabase
    .from("workout_reports")
    .select("narrative, takeaway, verdict_code, input_fingerprint")
    .eq("completed_workout_id", completedWorkoutId)
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[workouts.report] workout_reports read failed", {
      athlete_id: athleteId,
      workout_id: completedWorkoutId,
      message: error.message,
    });
    return { ok: false };
  }
  return { ok: true, row: (data as StoredReportRow | null) ?? null };
}

/**
 * Project a stored narrative against the freshly-computed delta.
 *
 * `stale` — the material inputs moved since the prose was written (KTD4).
 * `verdictChanged` — STRICTLY STRONGER: the prose was written to explain a
 * DIFFERENT verdict category than the one now being displayed above it, so
 * the renderer must suppress the prose rather than badge it (a note
 * explaining "you came up short" under an "As prescribed" header is worse
 * than no note). Only computable when the stored row recorded a verdict_code;
 * older rows with a NULL code fall back to plain staleness.
 */
function projectStored(
  stored: StoredNarration | null,
  fingerprint: string,
  freshVerdict: VerdictCode
): Pick<WorkoutReportResponse, "narration" | "stale" | "verdictChanged"> {
  if (!stored) return { narration: null, stale: false };

  const stale = stored.fingerprint !== fingerprint;
  const verdictChanged = stale && stored.verdictCode !== null && stored.verdictCode !== freshVerdict;

  return {
    narration: { note: stored.note, takeaway: stored.takeaway },
    stale,
    ...(verdictChanged ? { verdictChanged: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Generation budget guard (POST only).
//
// The fingerprint short-circuit below already makes "POST the same workout in
// a loop" free — the second call and every one after it returns the cached
// row without touching the LLM. This quota covers what the short-circuit
// cannot: a caller sweeping POST across MANY workout ids, each a genuine
// cache miss. Without it a single account can drain the shared Groq budget
// and starve plan generation for every other user, since nothing else on
// this path costs the caller anything.
//
// Counted as ROWS GENERATED IN THE WINDOW, not attempts: `generated_at` moves
// forward on every regeneration (the upsert updates in place), so a row stays
// inside the window for an hour after its last generation. This under-counts
// repeated regeneration of one workout (always one row) — which is exactly
// the case the fingerprint short-circuit already makes free, so the two
// guards cover each other. Failed generations write no row and are not
// counted; a rate-limited caller is not charged for the LLM's bad day.
// ---------------------------------------------------------------------------

export const GENERATION_WINDOW_S = 60 * 60;
export const GENERATION_MAX_PER_WINDOW = 20;

async function isOverGenerationQuota(
  supabase: SupabaseClient,
  athleteId: string
): Promise<boolean> {
  const since = new Date(Date.now() - GENERATION_WINDOW_S * 1000).toISOString();
  // service-role: explicit user filter required
  const { count, error } = await supabase
    .from("workout_reports")
    .select("id", { count: "exact", head: true })
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .gte("generated_at", since);

  if (error) {
    // Fail OPEN. This guard protects a shared budget against abuse; it is not
    // an authorization check. Blocking a paying athlete's debrief because a
    // COUNT query hiccuped trades a real, visible failure for a hypothetical
    // one — and the fingerprint short-circuit still bounds the common case.
    console.warn("[workouts.report] generation quota check failed, allowing", {
      athlete_id: athleteId,
      message: error.message,
    });
    return false;
  }
  return (count ?? 0) >= GENERATION_MAX_PER_WINDOW;
}

// ---------------------------------------------------------------------------
// Model label — best-effort, informational only (workout_reports.model is
// explicitly "informational, not authoritative" per migration 0027).
// `LlmClient`/`LlmResult` (src/llm) do not surface which model id actually
// served a call, so this mirrors createLlmClient's own provider-resolution
// order rather than reading it back off the client/result. Out of U6's file
// scope to change src/llm itself.
// ---------------------------------------------------------------------------

const FALLBACK_ANTHROPIC_MODEL_LABEL = "claude-opus-4-8";
const FALLBACK_GROQ_MODEL_LABEL = "llama-3.3-70b-versatile";

function resolveModelLabel(): string {
  const { anthropicApiKey, groqApiKey, provider, model } = config.llm;
  if (model) return model;
  const resolved = provider ?? (anthropicApiKey ? "anthropic" : groqApiKey ? "groq" : undefined);
  if (resolved === "groq") return FALLBACK_GROQ_MODEL_LABEL;
  return FALLBACK_ANTHROPIC_MODEL_LABEL;
}

// ---------------------------------------------------------------------------
// GET — never calls the LLM (KTD2).
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: workoutId } = await params;

  const authClient = await createServerClient();
  const { user, error: authErr } = await resolveAuth(authClient, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  const assembled = await assemble(db, user.id, workoutId);
  if (!assembled.ok) {
    return NextResponse.json(
      { error: assembled.status === 404 ? "not_found" : "internal" },
      { status: assembled.status }
    );
  }
  const { delta, fingerprint } = assembled.value;

  // OPTIONAL read. The delta above is the deterministic, verdict-bearing
  // half of this response and it is already computed; a transient failure of
  // the narrative lookup must not throw it away. Degrade to "no narrative
  // stored" — the athlete sees their verdict and comparison, plus a
  // generate affordance, instead of an error page (KTD2).
  const stored = await readStoredReport(db, user.id, workoutId);
  const narration = stored.ok
    ? projectStored(toStoredNarration(stored.row), fingerprint, delta.verdict.code)
    : { narration: null, stale: false };

  const body: WorkoutReportResponse = {
    delta,
    ...narration,
    generatable: true,
  };

  return NextResponse.json(body, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — regenerates the narrative. The only path in this route that calls
// the LLM.
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: workoutId } = await params;

  const authClient = await createServerClient();
  const { user, error: authErr } = await resolveAuth(authClient, request);
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  const assembled = await assemble(db, user.id, workoutId);
  if (!assembled.ok) {
    return NextResponse.json(
      { error: assembled.status === 404 ? "not_found" : "internal" },
      { status: assembled.status }
    );
  }
  const { context, delta, fingerprint } = assembled.value;

  // CACHE HIT SHORT-CIRCUIT. Without this, POST regenerates unconditionally:
  // every press of a "Generate" button (or every retry of a request that
  // already succeeded, or any client loop) spends an LLM call to reproduce a
  // narrative that is already correct. A stored narrative whose fingerprint
  // still matches IS the answer — return it. This is also what makes the
  // quota below sufficient rather than merely decorative.
  //
  // A read failure here is non-fatal: fall through and regenerate. Spending
  // one avoidable LLM call beats refusing to generate at all.
  const existing = await readStoredReport(db, user.id, workoutId);
  const cached = existing.ok ? toStoredNarration(existing.row) : null;
  if (cached && cached.fingerprint === fingerprint) {
    return NextResponse.json(
      {
        delta,
        narration: { note: cached.note, takeaway: cached.takeaway },
        stale: false,
        generatable: true,
      } satisfies WorkoutReportResponse,
      { status: 200 }
    );
  }

  if (await isOverGenerationQuota(db, user.id)) {
    console.warn("[workouts.report] generation quota exceeded", {
      athlete_id: user.id,
      workout_id: workoutId,
    });
    // 429 rather than a 200-with-null-narration: unlike an LLM failure this
    // is a caller-side condition with a known remedy (wait), and the client
    // must not read it as "generation was attempted and produced nothing".
    return NextResponse.json(
      { error: "rate_limited", message: "Too many reports generated recently. Try again later." },
      { status: 429, headers: { "Retry-After": String(GENERATION_WINDOW_S) } }
    );
  }

  const factSheet = buildFactSheet(context, delta);

  let narration;
  try {
    const client = createLlmClient();
    narration = await narrate(factSheet, client);
  } catch (err) {
    // AE6 / F4: a retryable LLM failure (429 / transient) or a permanent one
    // (unparseable / schema-rejected output) both surface as 200 with the
    // delta intact — a 5xx would blank perfectly good deterministic content.
    // `retryable` distinguishes the two so the client knows whether to offer
    // a retry affordance (AE6) or not.
    //
    // CRITICAL: the failure response carries the PREVIOUSLY STORED narrative
    // when there is one. Returning a bare `narration: null` here would wipe a
    // note the athlete is currently reading off their screen — a failed
    // *re*generation is a reason to keep showing the old note (badged stale),
    // never a reason to destroy it. No row is written on either branch, so
    // what is served here is exactly what is still in the database.
    const fallback = projectStored(cached, fingerprint, delta.verdict.code);

    if (isLlmBackOff(err)) {
      console.warn("[workouts.report] narrate: retryable LLM failure", {
        athlete_id: user.id,
        workout_id: workoutId,
        code: err.code,
      });
      return NextResponse.json(
        { delta, ...fallback, generatable: true, retryable: true } satisfies WorkoutReportResponse,
        { status: 200 }
      );
    }
    if (err instanceof ReportNarrationInvalidError || err instanceof LlmInvalidOutput) {
      console.warn("[workouts.report] narrate: permanent failure, no row written", {
        athlete_id: user.id,
        workout_id: workoutId,
        message: err.message,
      });
      return NextResponse.json(
        { delta, ...fallback, generatable: true, retryable: false } satisfies WorkoutReportResponse,
        { status: 200 }
      );
    }
    // Genuinely unexpected (e.g. createLlmClient() misconfiguration, a bug) —
    // not a modeled narration failure, so this is a real 500, not F4/AE6.
    console.error("[workouts.report] narrate: unexpected failure", {
      athlete_id: user.id,
      workout_id: workoutId,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // Persist. workout_reports has no client INSERT/UPDATE policy (migration
  // 0027) — writes are service-role only. `athlete_id` is the AUTHENTICATED
  // caller resolved above, never a client-supplied value, and
  // `completed_workout_id` was only reachable via the athlete-scoped
  // `assemble()` read above (a cross-athlete workoutId already 404'd).
  // Concurrent POSTs for the same workout: upsert on the
  // `workout_reports_completed_workout_unique` index (migration 0027) lets
  // Postgres serialize the conflict — the loser's upsert becomes an UPDATE of
  // the winner's row rather than a duplicate-key error, so exactly one row
  // survives regardless of call order.
  //
  // `deleted_at: null` is written EXPLICITLY. The unique index is plain, not
  // partial on `deleted_at IS NULL`, so a soft-deleted row is the row this
  // upsert conflicts onto — and without resetting the column the fresh
  // narrative would land in a row every read filters out, making generation
  // silently produce nothing the athlete can ever see.
  // service-role: explicit user filter required
  const { error: upsertErr } = await db.from("workout_reports").upsert(
    {
      athlete_id: user.id,
      completed_workout_id: workoutId,
      narrative: narration.note,
      takeaway: narration.takeaway,
      verdict_code: delta.verdict.code,
      input_fingerprint: fingerprint,
      model: resolveModelLabel(),
      generated_at: new Date().toISOString(),
      deleted_at: null,
    },
    { onConflict: "completed_workout_id" }
  );

  if (upsertErr) {
    console.error("[workouts.report] workout_reports upsert failed", {
      athlete_id: user.id,
      workout_id: workoutId,
      message: upsertErr.message,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const body: WorkoutReportResponse = {
    delta,
    narration,
    stale: false,
    generatable: true,
  };
  return NextResponse.json(body, { status: 200 });
}
