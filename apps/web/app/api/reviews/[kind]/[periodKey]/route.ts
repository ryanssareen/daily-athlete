// GET/POST /api/reviews/:kind/:periodKey — read and generate one period review.
//
// Mirrors apps/web/app/api/workouts/[id]/report/route.ts, including its
// non-obvious choices and the reasons for them:
//
// AUTH + CLIENT SPLIT. `resolveAuth` supports Bearer callers (mobile), and
// supabase-js validates a bearer token WITHOUT attaching it to the client -- a
// cookie-less mobile request would query Postgres as `anon`, `auth.uid()` would
// be NULL, and every RLS-scoped read would return zero rows. So: user-JWT
// client for AUTH, admin client + explicit athlete filters for DATA (which
// gatherPeriodContext applies on every read).
//
// GET NEVER CALLS THE LLM (KTD2). The facts are recomputed on every read and
// are always available; only the narration is cached, and only POST generates.
//
// A period belonging to someone else is not reachable here at all -- every
// read is scoped to the caller.

import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PeriodKind, PeriodReviewResponse } from "@da2/shared";
import { PeriodKindSchema, isValidPeriodKey } from "@da2/shared";

import { resolveAuth } from "@/auth/bearer";
import { createClient as createServerClient } from "@/auth/server";
import { config } from "@/config";
import { createAdminClient } from "@/db/admin";
import { createLlmClient, isLlmBackOff, LlmInvalidOutput } from "@/llm";

import {
  assemblePeriodReview,
  readAthleteTimezone,
  resolveModelLabel,
} from "@/ai/period-reviews/assemble";
import { persistPeriodReview } from "@/db/period-reviews";
import { InvalidPeriodKeyError, isPeriodClosed } from "@/ai/period-reviews/calendar";
import { narratePeriod, PeriodNarrationInvalidError } from "@/ai/period-reviews/narrate";

// POST makes one synchronous LLM call. The client's own timeout is 120s, so on
// the platform default (10s/15s) the function is killed long before
// narratePeriod can degrade gracefully into the retryable branch -- the caller
// would see an opaque platform error instead of facts with `narration: null`.
// Every other LLM-calling route in this repo sets 60 for the same reason.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Path parsing
// ---------------------------------------------------------------------------

type ParsedPath = { ok: true; kind: PeriodKind; periodKey: string } | { ok: false };

/** Validate the path pair BEFORE any I/O. A bad key must not cost a database
 * round trip, and `2026-08` under `weekly` is a client error rather than a
 * lookup that quietly misses. */
function parsePath(rawKind: string, rawKey: string): ParsedPath {
  const kind = PeriodKindSchema.safeParse(rawKind);
  if (!kind.success) return { ok: false };
  if (!isValidPeriodKey(kind.data, rawKey)) return { ok: false };
  return { ok: true, kind: kind.data, periodKey: rawKey };
}

// ---------------------------------------------------------------------------
// Stored row
// ---------------------------------------------------------------------------

interface StoredRow {
  narrative: string | null;
  takeaway: string | null;
  input_fingerprint: string;
  generated_at: string;
}

interface StoredNarration {
  note: string;
  takeaway: string;
  fingerprint: string;
  generatedAt: string;
}

/** A stored row that actually carries prose -- the only kind worth serving. A
 * row can legitimately exist with a fingerprint and no narrative (a generation
 * that failed), and that is not something to render. */
function toStoredNarration(row: StoredRow | null): StoredNarration | null {
  if (row === null || row.narrative === null || row.takeaway === null) return null;
  return {
    note: row.narrative,
    takeaway: row.takeaway,
    fingerprint: row.input_fingerprint,
    generatedAt: row.generated_at,
  };
}

async function readStored(
  supabase: SupabaseClient,
  athleteId: string,
  kind: PeriodKind,
  periodKey: string,
): Promise<{ ok: true; row: StoredRow | null } | { ok: false }> {
  // service-role: explicit user filter required. athlete_id is redundant with
  // the identity triple but makes this query correct IN ISOLATION rather than
  // correct only by reference to a check earlier in the handler.
  const { data, error } = await supabase
    .from("period_reviews")
    .select("narrative, takeaway, input_fingerprint, generated_at")
    .eq("athlete_id", athleteId)
    .eq("kind", kind)
    .eq("period_key", periodKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[reviews] period_reviews read failed", {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
      message: error.message,
    });
    return { ok: false };
  }
  return { ok: true, row: (data as StoredRow | null) ?? null };
}

/** Project a stored narrative against the freshly-computed fingerprint. */
function projectStored(
  stored: StoredNarration | null,
  fingerprint: string,
): Pick<PeriodReviewResponse, "narration" | "stale" | "generatedAt"> {
  if (!stored) return { narration: null, stale: false, generatedAt: null };
  return {
    narration: { note: stored.note, takeaway: stored.takeaway },
    stale: stored.fingerprint !== fingerprint,
    generatedAt: stored.generatedAt,
  };
}

// ---------------------------------------------------------------------------
// Generation budget guard (POST only)
// ---------------------------------------------------------------------------
//
// The fingerprint short-circuit makes "POST the same period in a loop" free.
// This covers what it cannot: a caller sweeping POST across many period keys,
// each a genuine cache miss. Without it one account can drain the shared Groq
// budget and starve plan generation for everyone else. Lower than the
// per-workout route's ceiling because a period narration is a bigger call and
// an athlete has far fewer periods than workouts.

export const GENERATION_WINDOW_S = 60 * 60;
export const GENERATION_MAX_PER_WINDOW = 10;

async function isOverGenerationQuota(
  supabase: SupabaseClient,
  athleteId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - GENERATION_WINDOW_S * 1000).toISOString();
  // service-role: explicit user filter required
  const { count, error } = await supabase
    .from("period_reviews")
    .select("id", { count: "exact", head: true })
    .eq("athlete_id", athleteId)
    .is("deleted_at", null)
    .gte("generated_at", since);

  if (error) {
    // Fail OPEN. This guard protects a shared budget against abuse; it is not
    // an authorization check. Blocking a paying athlete's review because a
    // COUNT query hiccuped trades a real failure for a hypothetical one.
    console.warn("[reviews] generation quota check failed, allowing", {
      athlete_id: athleteId,
      message: error.message,
    });
    return false;
  }
  return (count ?? 0) >= GENERATION_MAX_PER_WINDOW;
}

// ---------------------------------------------------------------------------
// Shared prologue
// ---------------------------------------------------------------------------

type Prologue =
  | { ok: false; response: NextResponse }
  | { ok: true; athleteId: string; db: SupabaseClient; kind: PeriodKind; periodKey: string };

async function prologue(request: Request, rawKind: string, rawKey: string): Promise<Prologue> {
  const parsed = parsePath(rawKind, rawKey);
  if (!parsed.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_period" }, { status: 400 }),
    };
  }

  const authClient = await createServerClient();
  const { user, error: authErr } = await resolveAuth(authClient, request);
  if (authErr || !user) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const db = createAdminClient();

  return { ok: true, athleteId: user.id, db, kind: parsed.kind, periodKey: parsed.periodKey };
}

/** A period that has not closed yet has no review: its numbers would change
 * under the athlete, and any narration would describe an incomplete week. */
function rejectIfOpen(
  kind: PeriodKind,
  periodKey: string,
  timezone: string,
): NextResponse | null {
  if (isPeriodClosed(kind, periodKey, timezone, new Date())) return null;
  return NextResponse.json(
    { error: "period_not_closed", message: "That period has not finished yet." },
    { status: 400 },
  );
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; periodKey: string }> },
): Promise<NextResponse> {
  const { kind: rawKind, periodKey: rawKey } = await params;

  const pro = await prologue(request, rawKind, rawKey);
  if (!pro.ok) return pro.response;
  const { athleteId, db, kind, periodKey } = pro;

  const timezone = await readAthleteTimezone(db, athleteId);
  const openErr = rejectIfOpen(kind, periodKey, timezone);
  if (openErr) return openErr;

  let assembled;
  try {
    assembled = await assemblePeriodReview({ supabase: db, athleteId, kind, periodKey, timezone });
  } catch (err) {
    if (err instanceof InvalidPeriodKeyError) {
      return NextResponse.json({ error: "invalid_period" }, { status: 400 });
    }
    console.error("[reviews] assemble failed", {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  // OPTIONAL read. The facts are the deterministic half of this response and
  // are already computed; a transient failure of the narrative lookup must not
  // throw them away. Degrade to "nothing stored" -- the athlete sees their
  // numbers plus a generate affordance instead of an error page.
  const stored = await readStored(db, athleteId, kind, periodKey);
  const projected = stored.ok
    ? projectStored(toStoredNarration(stored.row), assembled.fingerprint)
    : { narration: null, stale: false, generatedAt: null };

  return NextResponse.json(
    { facts: assembled.facts, ...projected, generatable: true } satisfies PeriodReviewResponse,
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// POST — the only path here that calls the LLM
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string; periodKey: string }> },
): Promise<NextResponse> {
  const { kind: rawKind, periodKey: rawKey } = await params;

  const pro = await prologue(request, rawKind, rawKey);
  if (!pro.ok) return pro.response;
  const { athleteId, db, kind, periodKey } = pro;

  const timezone = await readAthleteTimezone(db, athleteId);
  const openErr = rejectIfOpen(kind, periodKey, timezone);
  if (openErr) return openErr;

  let assembled;
  try {
    assembled = await assemblePeriodReview({ supabase: db, athleteId, kind, periodKey, timezone });
  } catch (err) {
    if (err instanceof InvalidPeriodKeyError) {
      return NextResponse.json({ error: "invalid_period" }, { status: 400 });
    }
    console.error("[reviews] assemble failed", {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const { facts, fingerprint, factSheet } = assembled;

  // CACHE HIT SHORT-CIRCUIT. Without this, POST regenerates unconditionally:
  // every press of a Generate button, every retry of a request that already
  // succeeded, and any client loop spends an LLM call reproducing a narrative
  // that is already correct. This is also what makes the quota below
  // sufficient rather than decorative.
  const existing = await readStored(db, athleteId, kind, periodKey);
  const cached = existing.ok ? toStoredNarration(existing.row) : null;
  if (cached && cached.fingerprint === fingerprint) {
    return NextResponse.json(
      {
        facts,
        narration: { note: cached.note, takeaway: cached.takeaway },
        generatedAt: cached.generatedAt,
        stale: false,
        generatable: true,
      } satisfies PeriodReviewResponse,
      { status: 200 },
    );
  }

  if (await isOverGenerationQuota(db, athleteId)) {
    console.warn("[reviews] generation quota exceeded", { athlete_id: athleteId, kind });
    // 429 rather than 200-with-null-narration: unlike an LLM failure this is a
    // caller-side condition with a known remedy (wait), and the client must not
    // read it as "generation was attempted and produced nothing".
    return NextResponse.json(
      { error: "rate_limited", message: "Too many reviews generated recently. Try again later." },
      { status: 429, headers: { "Retry-After": String(GENERATION_WINDOW_S) } },
    );
  }

  let narration;
  try {
    narration = await narratePeriod(factSheet, createLlmClient());
  } catch (err) {
    // AE9: a retryable LLM failure and a permanent one both surface as 200
    // with the facts intact -- a 5xx would blank perfectly good deterministic
    // content. `retryable` tells the client which affordance to offer.
    //
    // CRITICAL: the failure response carries the PREVIOUSLY STORED narrative
    // when there is one. Returning a bare null here would wipe prose the
    // athlete is currently reading off their screen; a failed REgeneration is
    // a reason to keep showing the old note badged stale, never to destroy it.
    // No row is written on either branch.
    const fallback = projectStored(cached, fingerprint);

    if (isLlmBackOff(err)) {
      console.warn("[reviews] narrate: retryable LLM failure", {
        athlete_id: athleteId,
        kind,
        period_key: periodKey,
        code: err.code,
      });
      return NextResponse.json(
        { facts, ...fallback, generatable: true, retryable: true } satisfies PeriodReviewResponse,
        { status: 200 },
      );
    }
    if (err instanceof PeriodNarrationInvalidError || err instanceof LlmInvalidOutput) {
      console.warn("[reviews] narrate: permanent failure, no row written", {
        athlete_id: athleteId,
        kind,
        period_key: periodKey,
        message: err.message,
      });
      return NextResponse.json(
        { facts, ...fallback, generatable: true, retryable: false } satisfies PeriodReviewResponse,
        { status: 200 },
      );
    }
    // Genuinely unexpected (misconfiguration, a bug) -- a real 500.
    console.error("[reviews] narrate: unexpected failure", {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  const generatedAt = new Date().toISOString();

  // period_reviews has no client write policy (0029) -- service-role only.
  // athlete_id is the AUTHENTICATED caller, never client-supplied.
  //
  // NOT `.upsert({ onConflict })`: the identity index is PARTIAL
  // (`WHERE deleted_at IS NULL`), which PostgREST cannot express as an
  // ON CONFLICT target -- Postgres raises 42P10 at runtime. persistPeriodReview
  // implements the repo's documented INSERT-catch-23505-UPDATE workaround and
  // is shared with the delivery worker so the two paths cannot diverge.
  try {
    await persistPeriodReview(db, {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
      period_start: facts.bounds.start,
      period_end: facts.bounds.end,
      narrative: narration.note,
      takeaway: narration.takeaway,
      input_fingerprint: fingerprint,
      model: resolveModelLabel(),
      generated_at: generatedAt,
    });
  } catch (err) {
    console.error("[reviews] period_reviews persist failed", {
      athlete_id: athleteId,
      kind,
      period_key: periodKey,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }

  return NextResponse.json(
    {
      facts,
      narration,
      generatedAt,
      stale: false,
      generatable: true,
    } satisfies PeriodReviewResponse,
    { status: 200 },
  );
}
