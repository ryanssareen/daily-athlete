-- Validate the plans.created_from_review_id -> weekly_reviews(id) FK added
-- NOT VALID in 0019. Split into its own migration so the validation scan
-- (a SHARE UPDATE EXCLUSIVE lock on plans, ROW SHARE on weekly_reviews) does
-- not share 0019's heavier table-creation DDL locks. See:
--   docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md (Unit 1)
--   supabase/migrations/0007_plans_and_planned_workouts.sql (the original deferral)

ALTER TABLE public.plans VALIDATE CONSTRAINT plans_created_from_review_fk;
