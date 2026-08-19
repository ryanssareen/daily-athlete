-- Per-cadence email delivery preferences for period reviews. See:
--   docs/plans/2026-08-19-001-feat-period-reviews-and-email-plan.md (U1, KTD7)
--
-- WHY COLUMNS ON users AND NOT A NEW TABLE. There are exactly two booleans,
-- they are read on every scheduler tick alongside users.timezone (which the
-- selection sweep already reads), and there is no history requirement -- the
-- product never asks "when did they unsubscribe". A notification_preferences
-- table would add a join to the hottest query in the delivery path and an
-- absent-row case to every reader, to store two bits. If a third channel
-- (push) or a per-preference audit trail ever lands, THAT is the migration
-- that earns the separate table.
--
-- WHY DEFAULT FALSE (KTD7). Opt-in, resolved at plan time. This is the first
-- bulk outbound email the product sends; defaulting existing athletes into it
-- would mail people who never asked, which is both a deliverability-reputation
-- risk and the wrong posture. Every athlete -- existing rows and future
-- signups alike -- starts off and turns it on in settings.
--
-- The two cadences are INDEPENDENT columns, not one enum or one boolean: an
-- athlete who finds a weekly email noisy but wants the monthly retrospective
-- is a real and expected case, and a single flag cannot express it.

ALTER TABLE public.users
    ADD COLUMN email_weekly_review BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN email_monthly_review BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index on the scheduler's actual predicate. The hourly delivery
-- sweep asks "who is opted in to this cadence" every hour forever, and the
-- opted-in set is expected to stay a minority of the table for some time --
-- exactly the shape a partial index serves. Two separate indexes rather than
-- one composite: the scheduler queries one cadence at a time.
CREATE INDEX users_email_weekly_review_opted_in
    ON public.users (id)
    WHERE email_weekly_review AND deleted_at IS NULL;

CREATE INDEX users_email_monthly_review_opted_in
    ON public.users (id)
    WHERE email_monthly_review AND deleted_at IS NULL;

-- No new RLS policy needed. public.users already carries users_self_select
-- and users_self_update (0001), so an athlete can read and change their own
-- preferences under their own JWT. Note that the API route still writes via
-- the admin client with an explicit id filter -- see the Bearer/SSR caveat in
-- AGENTS.md and apps/web/app/api/profile/timezone/route.ts, where an
-- RLS-scoped write silently affects zero rows for a mobile caller.
--
-- The unsubscribe path (KTD7) does NOT rely on either policy: it runs
-- service-role after verifying a signed capability token, because by
-- definition there is no session on that request.
