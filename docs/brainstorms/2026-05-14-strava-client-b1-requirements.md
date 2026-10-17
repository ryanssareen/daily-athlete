---
date: 2026-05-14
topic: strava-client-b1
---

# Strava B1 — Per-User Strava API Client

## Problem Frame

Phase A (token encryption, Inngest, config validation, sport map) is shipped. Phase B's first unit is the API client every other Strava feature in this app depends on: backfill (Phase C), webhook hydration (Phase D), the connect-route's identity probe (B2), and any future Strava-driven feature.

The client must:
- Load encrypted Strava tokens from `strava_tokens` (admin-client read, decrypt via A1).
- Call the Strava API on behalf of one user.
- Detect token expiry reactively (via 401) and refresh transparently.
- Surface rate-limit state so callers can pace themselves.
- Throw a typed signal when the refresh token is dead (athlete must reconnect).
- Behave predictably when two parallel calls hit 401 at the same time.

Get this wrong and every consumer downstream inherits hidden retry traps, double-refresh storms, or silent reauth-required states.

## Requirements

**Public surface**
- R1. Factory `createStravaClient(userId: string, supabaseAdmin: SupabaseClient): StravaClient`. Admin client is required because token reads bypass RLS.
- R1a. **Authz boundary on the factory.** `userId` MUST originate from authenticated server-side context — a Supabase session-derived `auth.uid()` or an Inngest event payload enqueued by trusted server code. Callers MUST NEVER pass a `userId` sourced from request input (body, query, header) or from a webhook payload field that has not been re-validated against authenticated DB state. The module header documents this; every construction site is grep-friendly so reviewers can audit.
- R1b. **Admin-client narrowing.** The stored `supabaseAdmin` instance is used ONLY for reads/writes against `public.strava_tokens` filtered by `user_id = <the userId this client was constructed with>`. No other tables, no unfiltered queries, no cross-user access. Each query is annotated with the `// service-role: explicit user filter required` comment per AGENTS.md.
- R2. `client.fetch(path: string, init?: RequestInit): Promise<Response>` issues a request against `https://www.strava.com/api/v3${path}` with `Authorization: Bearer <access_token>` and `User-Agent: daily-athlete/<package version> (strava-integration)`, returns the raw `Response`. Caller decides parsing.
- R3. `client.rateLimits` is a public read-only field shaped `{ fifteenMin: { used: number, limit: number }, daily: { used: number, limit: number } } | null`. Populated from `X-RateLimit-Usage` + `X-RateLimit-Limit` after each call. `null` until the first response. **Semantics:** Strava rate-limit headers reflect the OAuth application's GLOBAL quota, not a per-athlete budget. Phase C pacing logic that treats this as per-user is incorrect; document the global meaning where the field is read.
- R4. `client.touchLastUsed(): Promise<void>` updates `strava_tokens.last_used_at` to `now()`. Caller-controlled (NOT auto-fired inside `fetch()`).

**Refresh + retry behavior**
- R5. On 401 from a Strava API call, `fetch()` refreshes via `POST https://www.strava.com/oauth/token` with `grant_type=refresh_token`, `client_id`, and `client_secret`. The refresh response is parsed for the new `access_token`, `refresh_token`, `expires_at` (unix seconds), and `scope`. Both tokens are re-encrypted via A1's `encrypt()` (the resulting `keyVersion` is stamped on the row from `encrypt()`'s return value — no separate `currentKeyVersion()` call). The row is UPDATEd with `access_token_enc`, `refresh_token_enc`, `expires_at`, `scope`, and `key_version`. **Persistence completes BEFORE the original request is retried.**
- R5a. **Persist-failure surface.** If the DB UPDATE fails after Strava already issued new tokens — at this point Strava has rotated and invalidated the prior refresh-token, so the row's stored refresh-token is dead — `fetch()` throws a typed `StravaTokenPersistFailed` error carrying the `user_id` and a non-bytes failure cause. The athlete is NOT marked `needs_reauth`; this is an operator-actionable failure (Supabase blip, key-version write race) requiring triage. The new tokens never appear in the error or any log; they exist only in the dying process's memory.
- R6. On non-2xx from the refresh endpoint OTHER than the R9 race-recovery path, throw a typed `StravaReauthRequired` error. The error carries ONLY the HTTP status code and, if the response body parses as JSON, Strava's `error` field (e.g., `'invalid_grant'`). It NEVER carries the refresh request body, the raw refresh response body, decrypted tokens, or `client_secret`.
- R7. The client does NOT validate or restrict the HTTP method at runtime. v1 trusts the caller to only use `fetch()` for idempotent requests; non-idempotent retries are the caller's risk. All B1/C/D callers as of this brainstorm are GET-only. Document this contract in the module header.

**Rate limits + 429**
- R8. On 429, return the response unchanged. No auto-retry, no `step.sleep()` inside the client. Caller (Phase C / D Inngest functions) decides backoff.

**Concurrency / refresh-race**
- R9. The client tolerates parallel refresh: if two `fetch()` calls both hit 401, both attempt a refresh. Strava issues a fresh refresh-token each exchange and invalidates the previous one, so the second exchange returns 400 with body `{ error: 'invalid_grant' }`. The loser detects this specific error code (not "any non-2xx" — see R6), re-reads tokens from the DB, and if a different `key_version` OR different encrypted-bytes appear (IV randomization in A1's `encrypt()` makes ciphertext change on every write, so any refresh write is detectable), retries the original request with the freshly-persisted access token. The R9 path returns success; it does not throw.
- R10. If the DB re-read still shows the same token bytes the loser started with (the winner's UPDATE has not committed yet), the loser throws a typed `StravaRefreshRaceError`. Inngest's automatic retry re-runs the function; the now-current tokens work on the next attempt.

**Token loading + redaction**
- R11. The client caches decrypted tokens on a **private** field (no public getter, never stringified). The cache is replaced after a successful refresh (R5) and re-loaded after an R9 race re-read. One instance ≈ one Inngest function invocation, so the cache lifetime is naturally short.
- R12. **Token redaction.** Decrypted `access_token` and `refresh_token` MUST NEVER appear in: thrown error messages, error properties (including `cause`), `toString()`, `util.inspect()` output, log lines, or HTTP response bodies. The class implements `Symbol.for('nodejs.util.inspect.custom')` to redact. The B1 test suite includes a scenario that triggers every error path (R5a, R6, R10) and asserts no token bytes appear in any thrown error.

**Lifetime**
- R13. Each `StravaClient` is bound to ONE `userId` and ONE logical work unit. Callers MUST NOT memoize at module level (no top-of-file `const client = createStravaClient(...)`). Construct inside the request / Inngest function handler. A unit test verifies that two sequential `createStravaClient(userIdA, ...)` and `createStravaClient(userIdB, ...)` calls do not share decrypted state.

## Success Criteria

- All test scenarios from the plan's Unit B1 entry pass (happy path, 401-refresh-retry, refresh-fail-reauth, 429 passthrough, last_used_at update, refresh-collision).
- Backfill (Phase C, when written) can call `client.fetch('/athlete/activities?per_page=200&page=1')` in a loop and never has to handle token refresh itself.
- A test that fires two parallel `client.fetch()` calls with both initial responses returning 401 ends in: one call retries successfully, one either retries successfully (R9) or throws `StravaRefreshRaceError` (R10). Neither call throws `StravaReauthRequired`. Neither outcome leaks token bytes (R12).
- A test of the persist-failure path (R5a): Strava 200 + DB UPDATE rejects → `StravaTokenPersistFailed` thrown, error contains no token bytes, error message names the user_id and the cause class.
- Two-user isolation test (R13): `createStravaClient(userA, ...)` and `createStravaClient(userB, ...)` constructed back-to-back load distinct tokens; first instance's cache cannot serve the second instance.

## Scope Boundaries

- **No proactive rate-limit throttling inside the client.** `rateLimits` is read-only state for the caller. Phase C is free to pause when `usage / limit > 0.9`, with the caveat from R3 that the quota is application-global.
- **No telemetry hook in v1.** Add later if oncall asks for it.
- **No timeout default.** Caller passes `init.signal` for AbortController-based cancellation.
- **No retry on 5xx, no retry on 429.** Only the 401 → refresh → retry-once path is built-in.
- **Method-agnostic but GET-tested.** Per R7, the client does not block non-GET methods at runtime. v1 only writes tests for GET; callers using non-GET inherit the idempotency risk.
- **No DB advisory lock for refresh.** Considered and rejected; the R9 + R10 race policy is sufficient at our volume.
- **No new schema changes in B1.** Race detection uses A1's IV-randomized ciphertext comparison; adding an `updated_at` or `version` column to `strava_tokens` is deferred (see Outstanding Questions).

## Key Decisions

- **Class-based per-user instance**, per the plan. Considered a functional API; class is fine and the plan already settled it.
- **Persistence ordering (R5).** New tokens persist BEFORE the original request is retried. This is the difference between a recoverable error (`StravaTokenPersistFailed`) and a permanent lockout when Supabase blips after Strava has already rotated. Critical.
- **Authz boundary on factory (R1a/R1b).** Service-role admin client + arbitrary `userId` is the most dangerous shape in B1. v1 enforcement is the documented module-header constraint + grep-friendly construction sites. Type-level branding (e.g., `AuthenticatedUserId`) is deferred.
- **Credentials hygiene.** `client_secret` is read only via the A3-validated config getter; never via raw `process.env`. The refresh POST body is never logged. Decrypted tokens never appear in any error or log (R12 enforces).
- **Test mocking via Vitest built-in `vi.spyOn(global, 'fetch')` plus hand-rolled `new Response(...)` fixtures.** Resolves the A2 follow-up. Smallest dependency (Vitest already in the suite), B1's surface is narrow (~7 scenarios), and we control the call shape end-to-end. For the parallel refresh-race test (R9/R10), the helper builds two distinct `StravaClient` instances for the same `userId` and uses deferred promises to control fetch-resolution order. Skip MSW / nock until a second consumer needs cross-test fixtures. Document this pattern in `docs/solutions/strava-test-mocking.md` after the B1 PR lands.
- **`touchLastUsed` is caller-controlled.** `fetch()` issues one network call (or two on refresh) and no other DB writes. Backfill / hydration call `touchLastUsed()` once per Inngest function invocation, not per API call.
- **In-memory token cache, invalidated on 401 and on refresh-race re-read.** Avoids 200 decryption ops during backfill while staying correct under cross-process refreshes. Field is private; never exposed via getter or stringification.
- **Refresh-race policy: re-read DB first; throw `StravaRefreshRaceError` only if DB matches stale state.** Lets Inngest's automatic retry close the gap. Better than always throwing — fewer artificial retries during normal parallel fetches.
- **R9 race detection uses ciphertext comparison.** A1's `encrypt()` uses a random 12-byte IV per call, so any DB write changes the ciphertext bytes even when the plaintext is identical. The R9 byte-comparison check is therefore unambiguous. Adding an explicit `updated_at` or `version` column is cleaner but deferred to avoid scope creep in B1.

## Dependencies / Assumptions

- A1 (`apps/web/src/security/token-crypto.ts`) exports `encrypt`, `decrypt`, `currentKeyVersion`. Shipped.
- A3 (`apps/web/src/config.ts`) refuses production boot if `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` are missing. Shipped.
- `strava_tokens` schema (migrations 0002 + 0003) provides `access_token_enc`, `refresh_token_enc`, `expires_at`, `key_version`, `last_used_at`, `athlete_strava_id`. Shipped.
- Inngest functions in C / D will be configured with default retry behavior, so an uncaught `StravaRefreshRaceError` triggers automatic re-run. Asserted now; enforced when those units are written.
- Strava's documented refresh-on-exchange behavior (each refresh issues new access + refresh tokens and invalidates the previous refresh token) is current as of the integration plan's research.

## Outstanding Questions

### Resolve Before Planning

*(none — see "Open Questions for Reviewer Judgment" below for items the human should weigh in on before B1 starts; none are strictly blocking, but several alter the design enough to warrant a decision.)*

### Implementation Details to Finalize During PR

- [Affects R3][Technical] `rateLimits` shape — Phase C may also want the raw `X-RateLimit-*` strings for debugging. Add a `rawHeaders` slot if/when the backfill PR needs it.
- [Affects R9, R10][Needs research] Validate the refresh-race policy against a real Strava sandbox after the B1 PR lands: if either branch flakes, escalate to a DB advisory lock or a single-flight in-process mutex per `user_id`.
- [Affects R5][Technical] Decide whether `expires_at` is also surfaced on the client (for proactive expiry skipping later) or remains purely a DB column for now. v1: DB column only.

## Open Questions for Reviewer Judgment

These were surfaced by document review; each is a real design decision the brainstorm currently makes one way, and any could be flipped by the reviewer before B1 starts.

- **B2 consumer mismatch.** This brainstorm lists "B2 connect-route identity probe" as a future consumer of `StravaClient`. The current plan B2 (line 469) calls Strava's `/oauth/token` directly without a `StravaClient` (the user has no stored tokens yet at connect time). Decision: either drop the B2 reference here, or revise B2 to use `StravaClient` for the post-exchange `/athlete` lookup. Either is fine; pick one for consistency.
- **Error-surface hierarchy.** v1 has only `StravaReauthRequired`, `StravaTokenPersistFailed`, `StravaRefreshRaceError`; everything else (5xx, 429, 4xx-non-401) is returned as raw `Response`. Adversarial reviewer recommends adding `StravaRateLimited`, `StravaServerError`, `StravaClientError` to discourage callers from writing `if (!res.ok) throw` (which would make Inngest retry blanket-uniformly across operationally distinct cases). Tradeoff: more types vs. one consistent caller pattern documented in the module header.
- **In-memory token cache.** Adversarial reviewer challenges it as premature optimization. AES-GCM decrypt on a 50-byte token is sub-microsecond; the cache's main value is avoiding the DB round-trip, not the crypto. Alternatives: drop cache entirely (per-call DB read); or short-TTL cache (e.g., 10s) with simpler invalidation. Current decision: keep the instance-lifetime cache.
- **`touchLastUsed` caller-controlled vs auto-fire-once-per-instance.** Adversarial reviewer flags caller-control as a footgun (every caller has to remember). Third option: auto-fire once on the first successful `fetch()` per instance and drop the public method. Current decision: caller-controlled.
- **Sandbox validation of Strava rotation behavior.** R9/R10 hinge on "Strava issues a new refresh-token on every exchange and invalidates the old one." Adversarial reviewer wants this validated against the Strava sandbox BEFORE shipping B1, not "if it flakes." Decision: ship and validate post-merge, OR gate B1 merge on a sandbox confirmation.
- **`updated_at` or `version` column on `strava_tokens`.** Cleaner R9 race detection than IV-randomized-ciphertext byte comparison. Costs a small migration in B1's PR. Current decision: skip in B1; revisit if R9 detection causes confusion in code review.

## Next Steps

`/ce:plan` is already in place for this work (`docs/plans/2026-05-13-003-feat-strava-integration-plan.md`, Unit B1 starting at line 418). This brainstorm tightens the product decisions and resolves the A2 follow-up; planning does not need to re-run. → Proceed directly to `/ce:work` on Unit B1.
