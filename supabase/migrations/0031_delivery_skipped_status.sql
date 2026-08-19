-- Add 'skipped' to the period_review_deliveries status vocabulary.
--
-- 0029 shipped three statuses -- 'claimed', 'sent', 'failed' -- and the
-- delivery worker had nothing honest to write for a period it deliberately did
-- not mail (an athlete with no completed and no prescribed sessions: an email
-- reporting zero against zero is noise). It wrote 'sent', which made the ledger
-- assert a delivery that never happened.
--
-- That matters because the ledger is ATHLETE-READABLE (period_review_deliveries
-- has a self-select policy) and is the record any future "we emailed you on the
-- 4th" surface would read. A ledger that overstates what reached a real inbox is
-- worse than one with an extra status value.
--
-- 'skipped' is terminal, exactly like 'sent' and 'failed': the unique index on
-- (athlete_id, kind, period_key) still blocks a later tick from retrying the
-- same empty period. The only thing that changes is that the row now tells the
-- truth about what the athlete received.

ALTER TABLE public.period_review_deliveries
    DROP CONSTRAINT period_review_deliveries_status_check;

ALTER TABLE public.period_review_deliveries
    ADD CONSTRAINT period_review_deliveries_status_check
    CHECK (status IN ('claimed', 'sent', 'failed', 'skipped'));
