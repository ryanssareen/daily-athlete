# AI Adaptive Plan Engine — non-obvious decisions

Institutional learnings from building the category-B adaptive re-plan engine
(plan: `docs/plans/2026-05-25-001-feat-ai-adaptive-plans-engine-plan.md`).
Captures the decisions a future contributor would otherwise have to rediscover.

## Two layers; the deterministic layer is authoritative — at generation AND apply

The engine is a deterministic load + guardrail layer (`apps/web/src/training-load/`)
plus an LLM diff-proposer (`apps/web/src/ai/adaptive/`). The LLM proposes a set of
edit operations; `validateEditOps` drops any that breach an invariant (volume-ramp,
CTL ramp, TSB floor, taper window, past `event_date`, coach-protected rows) **before**
the athlete sees them. Crucially, the same validator re-runs **at apply time** against
*current* load (`apply.ts`, in Node, immediately before the SQL RPC) — staleness ≠
safety: unrelated workouts completing between propose and accept can shift CTL/ATL/TSB
and make a once-safe op unsafe. "No invariant-breaching op reaches an applied state"
only holds if you re-validate at apply.

## `version`, not `edited_at`, is the staleness token

`planned_workouts.edited_at` is stamped inconsistently (app-clock in the status route
vs DB `now()` in RPCs/Strava paths), is millisecond-resolution, and the Strava
`completed→planned` revert creates an ABA case on `status`. So per-op staleness uses a
monotonic `version BIGINT` (migration 0021) bumped by a `BEFORE UPDATE` trigger — but
**only when a *plannable* column changes** (`structure`/`scheduled_date`/`sport`/
`planned_load`/`deleted_at`). A status-only change (the benign Strava revert, a skip)
must NOT bump it, or it would falsely stale a pending op targeting unchanged content.
The token is monotonic, not +1-per-action (the completed path issues two UPDATEs) — the
contract only needs strictly-increasing.

## `workout_edits` is append-only by trigger, but GDPR-deletable

Unlike `admin_audit_log` (0016, a permanent compliance log scrubbed-but-kept on user
deletion), `workout_edits` holds athlete training data subject to erasure. So:
- `athlete_id` is `ON DELETE CASCADE` (the rows go on hard account-delete).
- The immutability trigger blocks **UPDATE only** (tampering), NOT DELETE — the
  account-deletion cascade must remove the rows, and app clients are blocked by the
  absence of a DELETE policy. The one permitted UPDATE is the `actor_user_id`
  `ON DELETE SET NULL` scrub (a coach actor deleted while the athlete remains).
- `delete_user_cascade` soft-deletes `weekly_reviews` (it has `deleted_at`) but
  **excludes** `workout_edits` (no `deleted_at`; relies on the FK cascade) — same shape
  as the `admin_audit_log` exclusion, opposite outcome (removed vs preserved).

## Single-open proposal: the index detects, an RPC serializes

`weekly_reviews_one_open_plan_scoped` (partial unique, `WHERE status='proposed' AND
scope='plan'`) only *detects* a concurrent collision as `23505` at commit — it does not
serialize. Because supabase-js can't span a transaction across SDK calls, the
supersede-then-insert lives in a `SECURITY DEFINER` RPC (`propose_weekly_review`, 0023)
that takes a per-athlete `pg_advisory_xact_lock`. A `23505` from a lost race is treated
as a clean no-op ("another proposal won; do not retry the LLM call"). The SQL
`trigger_priority` CASE must stay in lockstep with `precedence.ts` `triggerPriority`.

## One engine, one runner, many triggers

Every trigger (B1 cron, B2 detector, B3/B4/B7/R11 on-demand) enqueues a single generic
Inngest event `adaptive/run.requested` (`adaptive-run.ts`) with its `trigger_kind` +
`scope`. `dedup_key` controls idempotency: STABLE (e.g. the ISO-week key) for
scheduled/detected triggers so overlapping ticks can't double-run; UNIQUE (a request id)
for on-demand triggers that must always run.

## Apply RPC owns only cheap, transaction-local checks

`apply_weekly_review` (0022) does plan-context check (`event_date IS DISTINCT FROM`
snapshot — NULL-safe, so add/cancel are caught), per-op `version` compare,
completed/matched refusal, `delete`=soft-delete, `ai_review` attribution, and the
`workout_edits` append — all atomic. The expensive load re-validation stays in Node
(can't call TS from plpgsql); the RPC's `FOR UPDATE` row locks close the drift window.
Coupled triggers (everything except `workout_swap`) abort-and-supersede if any accepted
op is dropped at re-validation, rather than partial-applying a half-coordinated reshape.

## Recipient routing preserves the coach-review wedge

Proposals for athletes with an active `coach_athlete_links` row route to the **coach**
(`recipient='coach'`), who accepts on the athlete's behalf; solo athletes self-serve.
`weekly_reviews.status` is RPC-only (no client self-UPDATE policy) — a general
self-UPDATE would let an athlete forge `proposed→accepted` or tamper `proposed_changes`
(the `users.role_flags` hole from 0010).

## Gaps deferred (documented, not solved here)

- **No durable Strava-health flag**: `strava_tokens` has no `needs_reauth` column; the B2
  detector gates on `athlete_profiles.backfill_status->>state != 'needs_reauth'` as a
  proxy. A durable refresh-failure signal is a follow-up.
- **B5/B6 deferred**: the proactive load-decision triggers are not wired in v1 (firing
  unprompted on a Strava-only proxy is the highest trust risk). The engine, load module,
  and precedence accommodate them additively.
- **Real LLM**: the engine runs against a `FixtureProposer`; the Langfuse-traced client
  arrives with the plan-generation pipeline (product plan Unit 3.2).
- **TSS is computed lazily** on detail-page view today; the load series must compute TSS
  at ingest to avoid a view-biased CTL/ATL/TSB.
