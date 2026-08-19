-- period_reviews: the weekly / monthly retrospective (deterministic facts +
-- AI narrative), one row per (athlete, kind, period). See:
--   docs/plans/2026-08-19-001-feat-period-reviews-and-email-plan.md (U1, KTD1-KTD4, KTD10)
--
-- READ THIS FIRST IF YOU CONFUSED THIS WITH weekly_reviews. There are now two
-- `*review*` entities in this schema and they are NOT the same thing:
--
--   weekly_reviews (0019)  = an adaptive PROPOSAL. It carries proposed_changes,
--                            an accept/reject/expire status lifecycle, a
--                            one-open-per-athlete partial unique index, and an
--                            apply-RPC that mutates the plan. The athlete
--                            DECIDES on it.
--   period_reviews (here)  = a RETROSPECTIVE. It reports what already happened
--                            over a closed week or month. There is nothing to
--                            accept and nothing to apply. The athlete READS it.
--
-- They share a cadence and nothing else. Reusing weekly_reviews would mean
-- permanently-'no_changes' rows and every consumer learning to ignore half the
-- columns -- the same reasoning that made workout_reports a net-new table in
-- 0028 (KTD1).
--
-- Scope notes:
-- - Only the NARRATIVE is persisted here (KTD2). The facts -- volume,
--   duration, load, compliance, sport split, prior-period comparison -- are
--   recomputed on read from completed_workouts / planned_workouts /
--   workout_matches / athlete_profiles, so they have no staleness problem and
--   this table has no columns for them.
-- - input_fingerprint is a stable hash over the period's MATERIAL inputs
--   (KTD3): the per-workout material projection of every completed workout in
--   the period, the prescribed set, and the plan goal / event date. It is
--   computed in application code
--   (apps/web/src/ai/period-reviews/fingerprint.ts) and stored verbatim; the
--   DB has no opinion on the hash algorithm, only that a fingerprint always
--   accompanies a narrative (NOT NULL).
-- - There is NO soft-delete cascade from completed_workouts to period_reviews,
--   deliberately. 0028 needed one because a workout_reports row IS about one
--   workout and must not outlive it. A period review is about a PERIOD; a
--   workout being deleted inside that period changes the review's facts, not
--   its right to exist. The fingerprint already catches it -- the deleted
--   workout drops out of the material projection, the hash moves, and the
--   stored prose renders stale on the next read. That is the correct
--   behaviour; soft-deleting the whole review would throw away a still-valid
--   retrospective because one session was removed from it.

-- ===========================================================================
-- period_reviews
-- ===========================================================================

CREATE TABLE public.period_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- GDPR teardown + ownership scoping. CASCADE mirrors
    -- workout_reports.athlete_id (0028) and weekly_reviews.athlete_id (0019).
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Closed vocabulary, mirroring the PeriodKindSchema enum in
    -- packages/shared/src/period-review.ts. This is a second statement of
    -- that list -- extend BOTH in the same PR, same rule as
    -- workout_reports.verdict_code (0028) and weekly_reviews.trigger_kind
    -- (0019).
    kind TEXT NOT NULL CHECK (kind IN ('weekly', 'monthly')),

    -- The period's IDENTITY (KTD4): an ISO week key ('2026-W33') for weekly,
    -- a year-month key ('2026-08') for monthly. Deliberately the key and not
    -- a timestamp range: the range depends on the athlete's timezone, which
    -- can change, while the key is what the athlete actually means by "last
    -- week". Format validation lives in Zod (PeriodKeySchema); the CHECK here
    -- is a coarse structural backstop against an obviously-malformed writer,
    -- not a full parser.
    period_key TEXT NOT NULL CHECK (period_key ~ '^[0-9]{4}-(W[0-9]{2}|[0-9]{2})$'),

    -- Resolved boundaries, in the athlete's local calendar, stored as DATE.
    -- These exist for RANGE QUERIES and ordering (the "recent periods"
    -- listing), not as the identity -- period_key is the identity. period_end
    -- is INCLUSIVE (the last local day of the period), matching how a human
    -- reads "the week of the 10th through the 16th".
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    CONSTRAINT period_reviews_range_ordered CHECK (period_end >= period_start),

    -- LLM-authored coach's note + forward-looking takeaway. Nullable, for the
    -- same reason workout_reports.narrative is: the facts are computed on
    -- read (KTD2), so a row can legitimately exist with a fingerprint and no
    -- prose yet -- or with a generation that was rate-limited (R15) and never
    -- written. Length caps and untrusted-LLM-string handling live in the Zod
    -- PeriodNarrationSchema, the same pattern as weekly_reviews.narrative.
    narrative TEXT,
    takeaway TEXT,

    -- Cache key (KTD3). NOT NULL: a row is only ever written together with
    -- the fingerprint of the inputs that produced it. There is no valid state
    -- where a review row exists without one.
    input_fingerprint TEXT NOT NULL,

    -- Which model produced the narrative (e.g. a Groq model id). Nullable for
    -- forward-compat with any non-generation write path; every real
    -- generation call is expected to set it.
    model TEXT,

    -- When the narrative was (re)generated. Distinct from created_at: a row
    -- is updated in place on regeneration (unique on the identity triple
    -- below), so generated_at moves forward while created_at does not.
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- One live review per (athlete, kind, period). PARTIAL on deleted_at IS NULL
-- -- unlike workout_reports' plain unique index, because the account-deletion
-- cascade below soft-deletes these rows, and a restored/re-created athlete
-- (or a future undelete flow) must be able to generate a fresh review for a
-- period that already has a tombstoned one. See
-- docs/solutions/partial-unique-with-soft-delete.md.
CREATE UNIQUE INDEX period_reviews_identity_unique
    ON public.period_reviews (athlete_id, kind, period_key)
    WHERE deleted_at IS NULL;

-- The "my recent reviews" listing: newest first, per cadence. Partial on
-- deleted_at IS NULL, mirroring completed_workouts_athlete_started (0008) and
-- workout_reports_athlete_generated (0028).
CREATE INDEX period_reviews_athlete_period
    ON public.period_reviews (athlete_id, kind, period_start DESC)
    WHERE deleted_at IS NULL;

-- No ALTER PUBLICATION here. period_reviews is explicitly NOT a
-- supabase_realtime member (the athlete pulls a review, nothing pushes one),
-- so REALTIME_ALLOWLIST in packages/shared/src/realtime-allowlist.ts is
-- intentionally untouched and the CI drift test stays green.

-- ===========================================================================
-- period_review_deliveries -- the send ledger (KTD10)
-- ===========================================================================
-- R13 ("an athlete is never sent the same period's review twice") needs a
-- DURABLE guarantee, not a timing one. Inngest's own dedup key is a window;
-- an hourly scheduler that overlaps, a retried step, or an operator hitting
-- the manual trigger route all sit outside any reasonable window. So the
-- uniqueness lives here, in the database, and the delivery worker CLAIMS a
-- row before doing any work.
--
-- Deliberately NOT soft-deletable: a ledger entry is a permanent record of
-- what was (or was not) sent to a real inbox. "This athlete already received
-- their 2026-W33 review" does not stop being true, and a deleted_at column
-- would invite a partial unique index that lets the same period be sent twice
-- after a tombstone.

CREATE TABLE public.period_review_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    athlete_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('weekly', 'monthly')),
    period_key TEXT NOT NULL CHECK (period_key ~ '^[0-9]{4}-(W[0-9]{2}|[0-9]{2})$'),

    -- 'claimed' = a worker has taken this period and is generating/sending.
    -- 'sent'    = Brevo accepted the message. Terminal.
    -- 'failed'  = generation or send failed. Terminal for this period; the
    --             athlete is not retried into a later week's slot, because a
    --             stale retrospective arriving days late is worse than none.
    status TEXT NOT NULL DEFAULT 'claimed'
        CHECK (status IN ('claimed', 'sent', 'failed')),

    -- Non-PII reason slug ('llm_rate_limited', 'llm_invalid_output',
    -- 'email_unconfigured', 'http_429', ...). NEVER a recipient address, a
    -- narrative excerpt, or a provider body -- same posture as the logging
    -- contract in apps/web/src/email/brevo.ts.
    failure_reason TEXT,

    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE idempotency mechanism (KTD10). Plain unique, no partial predicate: a
-- claim in ANY status blocks a second claim for the same period. A concurrent
-- worker loses this insert and no-ops, which is exactly the desired
-- behaviour -- see the worker's unique-violation branch.
CREATE UNIQUE INDEX period_review_deliveries_identity_unique
    ON public.period_review_deliveries (athlete_id, kind, period_key);

-- Operational sweep: "what failed recently", "what is stuck in claimed".
CREATE INDEX period_review_deliveries_status_claimed
    ON public.period_review_deliveries (status, claimed_at DESC);

-- ===========================================================================
-- RLS
-- ===========================================================================

ALTER TABLE public.period_reviews ENABLE ROW LEVEL SECURITY;

-- Athlete reads their own reviews.
CREATE POLICY period_reviews_self_select ON public.period_reviews
    FOR SELECT USING (auth.uid() = athlete_id);

-- Additive coach SELECT (R16): a linked, active coach reads their athlete's
-- reviews at the data layer. Same EXISTS-subquery shape as
-- workout_reports_coach_select (0028) and weekly_reviews_coach_select (0019).
-- No coach-facing UI ships with this plan -- this policy is the whole of
-- R16's implementation.
CREATE POLICY period_reviews_coach_select ON public.period_reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.coach_athlete_links cal
            WHERE cal.athlete_user_id = period_reviews.athlete_id
              AND cal.coach_user_id = auth.uid()
              AND cal.status = 'active'
              AND cal.deleted_at IS NULL
        )
    );

-- No INSERT/UPDATE/DELETE policies: both write paths (the on-demand
-- generation route and the scheduled delivery worker) use a service-role
-- client with an explicit athlete filter, per AGENTS.md. RLS need not admit
-- any client write path. Mirrors workout_reports (0028) and weekly_reviews
-- (0019).

ALTER TABLE public.period_review_deliveries ENABLE ROW LEVEL SECURITY;

-- Athlete reads their own delivery history (so a future "we emailed you on
-- the 4th" surface needs no migration). No coach policy: what landed in an
-- athlete's personal inbox is not coaching data.
CREATE POLICY period_review_deliveries_self_select ON public.period_review_deliveries
    FOR SELECT USING (auth.uid() = athlete_id);

-- No client write policies AT ALL. The ledger is the idempotency guarantee
-- (KTD10); a client able to insert, update, or delete a row here could
-- suppress a send or unlock a duplicate. Service-role only, same write
-- posture as entitlements / strava_tokens (0001, 0002).

-- ===========================================================================
-- delete_user_cascade: extend the canonical function (latest def is 0028)
-- ===========================================================================
-- period_reviews carries deleted_at -> soft-delete on cascade, following the
-- weekly_reviews / workout_reports precedent.
-- period_review_deliveries has NO deleted_at -> intentionally excluded here;
-- its athlete_id ON DELETE CASCADE removes it on hard account delete, the
-- same precedent workout_edits / ai_generation_attempts / oauth_* follow.
CREATE OR REPLACE FUNCTION public.delete_user_cascade(user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Soft-delete all coach_athlete_links where the user is the coach side.
    UPDATE public.coach_athlete_links
    SET deleted_at = now(), status = 'archived'
    WHERE coach_user_id = user_id
      AND deleted_at IS NULL;

    -- Soft-delete all coach_athlete_links where the user is the athlete side.
    UPDATE public.coach_athlete_links
    SET deleted_at = now(), status = 'archived'
    WHERE athlete_user_id = user_id
      AND deleted_at IS NULL;

    -- Soft-delete the athlete's AI proposals.
    UPDATE public.weekly_reviews
    SET deleted_at = now()
    WHERE athlete_id = user_id
      AND deleted_at IS NULL;

    -- Soft-delete the athlete's per-workout reports.
    UPDATE public.workout_reports
    SET deleted_at = now()
    WHERE athlete_id = user_id
      AND deleted_at IS NULL;

    -- Soft-delete the athlete's period (weekly/monthly) reviews.
    UPDATE public.period_reviews
    SET deleted_at = now()
    WHERE athlete_id = user_id
      AND deleted_at IS NULL;

    -- workout_edits: intentionally excluded (append-only, no deleted_at);
    -- removed by its athlete_id ON DELETE CASCADE on hard account delete.
    -- ai_generation_attempts / ai_plan_trials: same precedent -- no deleted_at,
    -- removed by their athlete/user ON DELETE CASCADE FKs on hard delete.
    -- period_review_deliveries: same precedent -- permanent send ledger, no
    -- deleted_at, removed by athlete_id ON DELETE CASCADE on hard delete.
    -- oauth_authorization_codes / oauth_access_tokens: same precedent -- user_id
    -- ON DELETE CASCADE, no deleted_at; removed on hard delete. oauth_clients
    -- has no user column (global registrations), intentionally not cascaded.
    -- admin_audit_log: intentionally excluded (see 0016).

    -- Future tables: extend here in their respective migrations.
END;
$$;
REVOKE ALL ON FUNCTION public.delete_user_cascade(UUID) FROM PUBLIC;
