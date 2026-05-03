---
title: Pivot Preflight Verification (May 2026)
date: 2026-05-03
status: pending
plan: docs/plans/2026-05-03-001-refactor-stack-pivot-typescript-vercel-plan.md
---

# Pivot Preflight Verification (May 2026)

This document records the four external-dependency facts that the stack pivot
plan rests on. Each item must be marked **OK** before Unit 1 begins. Items
marked **NOT OK** halt the pivot and trigger a plan revision.

The plan author cannot run these probes from inside a Claude Code session —
they require browser interaction with Supabase + Vercel dashboards and a freshly
created throwaway project. The user runs each probe and updates the **Result**
field below. Each probe takes 5–15 minutes; total time ~45 minutes.

## How to use this doc

1. Create one throwaway Supabase project (free tier) named `da2-preflight`.
2. Create one throwaway Vercel Hobby project linked to a small `next-app` test repo.
3. Walk each probe below. Fill in the **Result** field with `OK`, `NOT OK`, or `OK WITH CAVEAT`, plus 1–3 lines of evidence.
4. When all four are resolved, set `status: complete` in the frontmatter and commit.
5. If any item is `NOT OK`, open the plan, decide on the reshape, document it, and only then start Unit 1.

After verification completes, both throwaway projects can be deleted.

---

## Probe 1 — `pg_cron` availability on Supabase free tier

**What we're verifying:** that `CREATE EXTENSION pg_cron;` succeeds on a free-tier Supabase Postgres, and that scheduling a job via `cron.schedule(...)` works.

**Why it matters:** the plan moves the Strava raw-payload retention sweep onto `pg_cron` so the two Vercel Hobby cron slots (we use only 1 in v1) aren't blown. If `pg_cron` is unavailable on free tier, Unit 4 must reshape to fold retention into the single Vercel keepalive endpoint — not a disaster, but a different design.

**Best-known answer (Apr 2025):** `pg_cron` was available on Supabase free tier as of early 2025. Supabase exposes it under the Database → Extensions UI and via `CREATE EXTENSION pg_cron;` in the SQL editor. Confirm this still holds in May 2026.

**How to verify:**

1. Open the throwaway Supabase project's SQL editor.
2. Run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```
   Expected: one row returned, no error.
3. Schedule a no-op job:
   ```sql
   SELECT cron.schedule('preflight-noop', '*/5 * * * *', $$ SELECT 1 $$);
   SELECT * FROM cron.job WHERE jobname = 'preflight-noop';
   ```
   Expected: row returned with the schedule.
4. Clean up:
   ```sql
   SELECT cron.unschedule('preflight-noop');
   ```

**Decision matrix:**

| Outcome | Action |
|---|---|
| `CREATE EXTENSION` succeeds AND `cron.schedule` works | Mark **OK**. Plan unchanged. |
| Extension blocked on free tier | Mark **NOT OK**. Reshape Unit 4: fold retention into the keepalive endpoint (one Vercel cron handles both: `select 1` for keepalive + `DELETE ... WHERE arrived_at < now() - interval '30 days'` for retention). The cron-budget rule in AGENTS.md becomes "1 of 2 slots used; second slot reserved for Wave 3 weekly review." |
| `CREATE EXTENSION` works but `cron.schedule` fails | Mark **NOT OK**. Same reshape as above. |

**Result:** _pending_

---

## Probe 2 — Supabase JWT signing scheme on a 2026 free-tier project

**What we're verifying:** whether new Supabase projects in 2026 issue HS256 (legacy, single shared secret in `SUPABASE_JWT_SECRET`) or asymmetric (ES256 / RS256, with a JWKS endpoint at `<project>.supabase.co/auth/v1/.well-known/jwks.json`).

**Why it matters:** Unit 1's `auth.ts` is shaped differently for each. HS256 uses `jose.jwtVerify(token, secret)` against a single string. Asymmetric uses `createRemoteJWKSet(new URL(jwks_url))` and refreshes keys automatically. The plan currently assumes HS256; if Supabase migrated by 2026, Unit 1 needs to swap.

**Best-known answer (mid 2025):** Supabase started rolling out asymmetric "JWT signing keys" GA in 2025. New projects created in 2025+ commonly default to ECC (P-256). Existing HS256 projects can continue or migrate. May 2026 status: confirm whether new free-tier projects default to ECC.

**How to verify:**

1. In the throwaway Supabase project, sign up a test user (any email).
2. Sign in via the SQL editor's auth helper or the JS playground; capture the `access_token`.
3. Decode the JWT header at https://jwt.io (paste the token, look at the orange "header" panel).
   - `alg: "HS256"` → legacy. Project uses a single shared secret. `SUPABASE_JWT_SECRET` env var works.
   - `alg: "ES256"` or `"RS256"` → asymmetric. There's no shared secret to copy; you fetch the public key from JWKS.
4. If asymmetric, hit `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` in a browser. Expected: a JWKS document with one or more keys.
5. Note the project's API settings page — there should be a "JWT signing keys" section. Note which scheme is current.

**Decision matrix:**

| Outcome | Action |
|---|---|
| HS256 with shared secret | Mark **OK**. Plan unchanged. Use `SUPABASE_JWT_SECRET` env var as designed. |
| Asymmetric (ES256 / RS256) with JWKS | Mark **OK WITH CAVEAT**. Update Unit 1: `auth.ts` uses `createRemoteJWKSet(new URL(JWKS_URL))` instead of a single secret. Replace `SUPABASE_JWT_SECRET` env var with `SUPABASE_JWT_JWKS_URL`. Test scenarios remain the same; verifier internals change. Add a 2-line note to AGENTS.md "RLS posture" section. |
| Both schemes available, project chose HS256 by default | Same as HS256. Note that asymmetric is opt-in; don't switch unless there's a reason. |

**Result:** _pending_

---

## Probe 3 — `maxDuration: 300` actually permitted on Vercel Hobby Fluid Compute

**What we're verifying:** that a Next.js route handler with `export const maxDuration = 300` runs to completion under sustained load on Vercel Hobby in May 2026.

**Why it matters:** the resumable AI pipeline contract (R6, Unit 7) sizes per-stage budget against this ceiling. If Hobby is actually 60s or 90s, the per-stage budget shrinks and Wave 3 must split stages further. Better to know now.

**Best-known answer (late 2025):** Vercel Fluid Compute launched with 300s on Pro and was rolled out to Hobby with 800s in mid-2025 announcements. Confirm in May 2026.

**How to verify:**

1. In the throwaway Hobby project's `app/api/longrun/route.ts`:
   ```ts
   export const maxDuration = 300;
   export async function GET() {
     await new Promise(r => setTimeout(r, 120_000)); // 2 minutes
     return Response.json({ ok: true });
   }
   ```
2. Deploy. `curl https://<deploy-url>/api/longrun` and time the response.
3. Increase the sleep to `240_000` (4 minutes), redeploy, retry.
4. Increase to the configured `maxDuration` minus 10s, redeploy, retry.

**Decision matrix:**

| Outcome | Action |
|---|---|
| 4-minute sleep returns successfully | Mark **OK**. The 300s budget is real. Plan's "60s per stage with 5x retry headroom" sizing holds. |
| Returns 504 / killed before 240s | Mark **OK WITH CAVEAT**. Record the actual ceiling (e.g., "Hobby capped at 90s in May 2026"). Update Unit 7 design note: per-stage budget = `(actual_ceiling / 5)` for safe retry headroom. Plan still ships; the AI pipeline is sized differently. |
| Returns instantly with an error about `maxDuration` config rejected | Mark **NOT OK**. Hobby no longer accepts `maxDuration` overrides. The pivot's AI orchestration story collapses; reshape the resumable pipeline to use Supabase Edge Functions (which have their own 150s/400s ceiling) for stage execution, with Vercel only kicking off the chain. |

**Result:** _pending_

---

## Probe 4 — PostgREST propagates `request.jwt.claim.sub` from `Authorization: Bearer <jwt>`

**What we're verifying:** that initializing `supabase-js` with the anon key + a per-request `Authorization` header causes RLS-protected queries to see `auth.uid() = <jwt's sub>` automatically, with no manual `SET LOCAL` GUC manipulation.

**Why it matters:** this is the architectural correction made in document-review (the original plan's `SET LOCAL` approach was a fatal-class bug). Unit 1's `createUserScopedClient(jwt)` depends on this. If PostgREST doesn't actually do this in 2026, the entire auth-to-DB binding has to change.

**Best-known answer (well-documented):** this is the canonical Supabase pattern documented since 2022. It is the basis of every Supabase frontend example. We are extremely confident it works; the verification is a sanity check, not a real risk.

**How to verify:**

1. In the throwaway Supabase project, create a test table and RLS policy:
   ```sql
   CREATE TABLE public.preflight_rows (
       id BIGSERIAL PRIMARY KEY,
       owner UUID NOT NULL,
       data TEXT
   );
   ALTER TABLE public.preflight_rows ENABLE ROW LEVEL SECURITY;
   CREATE POLICY preflight_self_only ON public.preflight_rows
       FOR SELECT USING (auth.uid() = owner);
   ```
2. Sign up two test users (alice, bob). Note their UUIDs from `auth.users`.
3. Insert one row per user using the service role:
   ```sql
   INSERT INTO public.preflight_rows (owner, data) VALUES
       ('<alice-uuid>', 'alice secret'),
       ('<bob-uuid>',   'bob secret');
   ```
4. Sign in as alice via the JS playground, capture her `access_token`.
5. Run a small Node.js script (or `curl`) using the anon key + alice's JWT:
   ```bash
   curl "https://<project>.supabase.co/rest/v1/preflight_rows?select=*" \
        -H "apikey: <ANON_KEY>" \
        -H "Authorization: Bearer <ALICE_JWT>"
   ```
6. Repeat with bob's JWT.

**Decision matrix:**

| Outcome | Action |
|---|---|
| Alice's request returns only the alice row; bob's request returns only the bob row | Mark **OK**. Architecture confirmed. Proceed to Unit 1. |
| Both requests return both rows | Mark **NOT OK**. RLS is not being enforced via the JWT — something is wrong with the project's auth config (extremely unusual). Re-check the policy + service-role insert ordering. If reproducible across projects, the entire auth-to-DB binding needs a different design (likely `pg`-direct connections with `SET LOCAL` inside an explicit transaction). |
| Either request returns 401 | Anon key or JWT was wrong; redo step 5. Not a verification failure. |

**Result:** _pending_

---

## Verification summary (fill in once all four resolved)

| # | Probe | Result | Plan impact |
|---|---|---|---|
| 1 | `pg_cron` on Supabase free | _pending_ | _pending_ |
| 2 | JWT signing scheme | _pending_ | _pending_ |
| 3 | 300s on Hobby | _pending_ | _pending_ |
| 4 | PostgREST JWT propagation | _pending_ | _pending_ |

When complete, change frontmatter `status: pending` to `status: complete`,
record the date, and commit. Then proceed to Unit 1.
