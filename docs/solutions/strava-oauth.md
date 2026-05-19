---
title: Strava OAuth posture (Phase B)
type: solution
date: 2026-05-14
status: shipped
---

# Strava OAuth posture

This doc captures the Phase B security decisions for the Strava integration:
how OAuth runs across mobile + web, how PKCE + a server-signed state nonce
protect the flow, and how `strava_tokens` writes split between JWT-bound
and service-role supabase-js clients.

## Where the code lives

- Mobile UI: `apps/mobile/src/integrations/strava.tsx` + the pure state machine `apps/mobile/src/integrations/strava-machine.ts`.
- Server connect route: `apps/web/app/api/integrations/strava/connect/route.ts`.
- Server init route (mints the signed state nonce): `apps/web/app/api/integrations/strava/init/route.ts`.
- Server mobile-bounce route (302 → `da2://` for the Flutter app): `apps/web/app/api/integrations/strava/mobile-bounce/route.ts`.
- Server-side state-nonce sign/verify: `apps/web/src/strava/state-nonce.ts`.
- Server-side code-for-token exchange: `apps/web/src/strava/oauth.ts`.
- Per-user API client (refresh-on-401, rate-limit headers): `apps/web/src/strava/client.ts`.
- Shared Strava endpoint constants + fetch helper: `apps/web/src/strava/constants.ts`, `apps/web/src/strava/http.ts`.
- Service-role DB helpers: `apps/web/src/db/strava-tokens.ts`.
- Bearer-token-aware auth resolution: `apps/web/src/auth/bearer.ts`.
- Token encryption (AES-256-GCM, versioned keys): `apps/web/src/security/token-crypto.ts` — companion doc `docs/solutions/strava-token-crypto.md`.

## Single OAuth app, two callback hops

Strava registers exactly **one** Authorization Callback Domain per OAuth
application. The DA2 app's domain is `da2-one.vercel.app` (the
production web host). Both web and mobile share the same Strava OAuth
app (client_id 189893) and therefore must route their OAuth responses
through that domain:

- **Web** authorize hop sends `redirect_uri = https://da2-one.vercel.app/api/integrations/strava/callback`.
  The callback route reads the PKCE verifier from an HttpOnly cookie set
  by `/authorize`, then delegates to `/connect`.
- **Mobile (Flutter)** authorize hop sends
  `redirect_uri = https://da2-one.vercel.app/api/integrations/strava/mobile-bounce`.
  The bounce route is a stateless 302 to `da2://strava-oauth?code=…&state=…`
  which `app_links` delivers to the Flutter app. The Flutter app then
  POSTs `/connect` with the same `redirect_uri` it used on the authorize
  hop — Strava verifies the two match when exchanging the code for
  tokens.

The bounce route holds no state, makes no DB writes, performs no code
exchange, and never logs `code` or `state`. It accepts only Strava's
documented success/error params (`code`, `state`, `scope`, `error`) and
forwards them verbatim; everything else is dropped to prevent injection
into the deep link.

The `da2://` deep link itself is unchanged from the original direct
design — only the redirect path changed. PKCE and the server-signed
state nonce remain the load-bearing defenses; see the next two sections.

## PKCE end-to-end

The mobile client uses `expo-auth-session` (Expo, retired) or
`crypto`-based PKCE generation (Flutter) with `responseType=code`.
A random `code_verifier` is generated on-device, hashed to a
`code_challenge`, and included in the authorize URL.

After Strava redirects to the mobile-bounce URL and the bounce 302s to
`da2://strava-oauth`, the Flutter app extracts `code` + `state` from the
deep-link URI and POSTs `{ code, code_verifier, redirect_uri, state }` to
`/api/integrations/strava/connect`. The server then calls Strava's
`/oauth/token` with both `code` and `code_verifier`; Strava verifies the
SHA256 of the verifier matches the challenge it recorded on the authorize
hop, AND that `redirect_uri` matches the value sent at authorize time
(which is why mobile passes the same bounce URL on both hops).

**Why this matters on Android.** The `da2://` URL scheme is hijackable —
a hostile app on the same device can register the same scheme and
intercept the OAuth callback. PKCE end-to-end is the load-bearing
mitigation: a stolen `code` without the matching `code_verifier` cannot
be exchanged for tokens at Strava. The verifier never leaves the
device-then-server path; it is not logged, not embedded in URLs, and
single-use.

## State-nonce CSRF protection (server-signed)

The state nonce is **HMAC-signed on the server**. The mobile client
cannot mint or forge one — only verify it indirectly by completing the
flow.

Flow:

1. Mobile POSTs `/api/integrations/strava/init` (empty body, authenticated
   by the user's Supabase JWT via Bearer header or cookie).
2. Server mints `<nonceHex>.<expiresAt>.<hmacHex>` where the HMAC is
   `HMAC-SHA256(STRAVA_OAUTH_STATE_SIGNING_KEY, userId|nonce|expiresAt)`.
   TTL is 600 seconds. The signing key is a 32-byte hex value stored only
   in the server env (`STRAVA_OAUTH_STATE_SIGNING_KEY`); the boot
   validator in `apps/web/src/config.ts` refuses to start a production
   build without it.
3. Mobile passes that signed state to Strava as the OAuth state parameter
   when calling `promptAsync()`. Strava echoes it back on the redirect.
4. Mobile forwards the echoed state to `/connect` in the POST body.
5. Server calls `verifyState(user.id, body.state)` which checks the
   HMAC against the SAME signing key + `user.id` + expiry. Mismatch
   returns HTTP 400 `state_mismatch` **before** the code is exchanged
   with Strava — otherwise an attacker who substituted a victim's code
   could trick the victim's account into being linked to the attacker's
   Strava identity. The pre-exchange rejection means the substituted
   code is never burned.

**Why we replaced the previous design.** Earlier Phase B work accepted
both `state` and `expected_state` from the same POST body and compared
them with `timingSafeEqual`. The defense was illusory: an attacker who
forged the body controlled both operands. The server now holds the
ground truth (the signing key); the mobile client cannot bypass it.

The HMAC comparison in `verifyState()` pads buffers to equal length and
ALWAYS runs `timingSafeEqual` — never an early-return on length — so the
function's runtime is independent of how a forged HMAC differs from the
expected one.

The signed state is the verifier. It is treated like a token: never
logged in any route handler, never returned in error responses.

## Bearer-token auth on mobile-facing routes

Mobile clients post `Authorization: Bearer <jwt>` (the Supabase
`access_token`) because they don't share the SSR cookie jar with
`da2://`. Calling `supabase.auth.getUser()` with no argument reads from
cookies only — a mobile request with no cookies would 401 unconditionally.

`apps/web/src/auth/bearer.ts` exposes `resolveAuth(supabase, request)`
which extracts the Bearer token (case-insensitive scheme) and forwards
it to `supabase.auth.getUser(token)`. When the header is absent, the
call falls back to the cookie-derived session, so browser callers still
work. Every Strava OAuth-flow route uses this helper.

## OAuth scopes

`activity:read,activity:read_all,profile:read_all`.

- `activity:read_all` is required to backfill **private** activities.
  Without it the backfill silently excludes them, producing an
  athlete-visible data-completeness bug.
- `profile:read_all` returns the athlete object so we can extract
  `athlete.id` and persist it as `athlete_strava_id`. No other PII is
  read or stored.

## JWT-bound vs service-role split

`strava_tokens` has no INSERT or UPDATE RLS policy — it is service-role
write only. The connect route uses **two clients** for two
responsibilities:

1. **JWT-bound `@supabase/ssr` client** (`@/auth/server`) reads
   `auth.uid()` from the cookie session or Bearer token. This confirms
   which user is making the request. A JWT-bound write to `strava_tokens`
   would silently succeed with 0 rows affected (no permissive RLS policy).

2. **Service-role admin client** (`@/db/admin`) performs the encrypted
   upsert. Every service-role call site is annotated with
   `// service-role: explicit user filter required` and explicitly
   filters by `user_id`, matching the AGENTS.md "Secrets" contract.
   `apps/web/src/db/admin.ts` carries `import 'server-only'` so an
   accidental client-component import fails at bundler time.

Tests pin both paths: the `route.test.ts` happy-path asserts that the
persisted row's `user_id` matches the JWT-derived `auth.uid()`, and the
B1 `client.test.ts` exercises the encrypted read + decrypt path with the
same posture.

## BYTEA serialisation (encrypted token writes)

`access_token_enc` and `refresh_token_enc` are BYTEA columns. supabase-js
serialises the JSON request body with `JSON.stringify`, and
`JSON.stringify(new Uint8Array([65,66]))` produces `{"0":65,"1":66}` —
not the BYTEA wire format PostgREST expects, so the upsert 422s with
"invalid input syntax for type bytea". We convert ciphertext to
`\x<hex>` strings (the standard Postgres BYTEA literal) before passing
to supabase-js. The read path's `decodeBytea()` already handles both
`\x<hex>` and base64.

## Re-connect collision policy (HTTP 409)

The `strava_tokens.athlete_strava_id` column has a unique index. Two
users connecting the same Strava account would collide on this index.

The connect route handles the collision with a two-layer defense:

1. **Pre-check (fast path)**: `findUserByAthleteStravaId` looks up
   `SELECT user_id FROM strava_tokens WHERE athlete_strava_id = $1`. If
   a row exists with a **different** `user_id`, return HTTP **409**
   `strava_account_already_linked`. The original owner's row is
   untouched.
2. **Race arbiter**: the upsert itself can hit the
   `strava_tokens_athlete_strava_id_idx` unique constraint if two
   concurrent connects slip past their pre-checks before either commits.
   `upsertStravaToken` inspects supabase-js errors for Postgres code
   `'23505'` on `athlete_strava_id` and throws a typed
   `StravaAccountCollisionError` which the route catches and surfaces as
   the same 409 response.

**Why reject instead of silently transferring ownership?** Silent
transfer is a data-integrity hazard for shared family Strava accounts
(two athletes share one Strava login; both connect to DA2; the second
connect would steal the first athlete's connection). It is also an
account-takeover surface: an attacker who obtains a Strava code for a
victim's account could re-link the victim's Strava data to the
attacker's DA2 user. Rejecting the collision is the conservative
choice; manual support resolution is the documented path for legitimate
re-attribution.

## Same-user reconnect with a different Strava account

If the same DA2 user calls `/connect` again with a DIFFERENT
`athlete_strava_id` (e.g. they previously connected athlete A and now
connect athlete B), the upsert proceeds — `ON CONFLICT (user_id) DO
UPDATE` overwrites the `athlete_strava_id`. Any backfill data keyed to
the old `athlete_strava_id` is left orphaned until Phase C decides
whether to cascade-delete, prompt the user, or refuse.

For Phase B we **log** every such reconnect as `same_user_reconnect`
with the new `athlete_strava_id` so operations can monitor the rate and
inform the Phase C policy decision.

## Refresh-collision race (one user, two concurrent 401s)

Two simultaneous `StravaClient.fetch()` calls for the same user can both
hit a 401 and both enter `refreshTokens()`. Strava rotates the
refresh_token on every use, so the loser's POST to `/oauth/token` with
its stale in-memory copy would receive 400 invalid_grant and surface as
a (false) `StravaReauthRequired`.

`refreshTokens()` defends against this by calling `ensureTokens(true)`
at the top — a forced DB re-read. The loser arrives AFTER the winner
has already persisted the new refresh_token; its forced re-read picks
up the winner's value, and its own /oauth/token POST uses a valid
refresh_token.

This eliminates the false-disconnect race in the common case where the
winner completes its UPDATE before the loser enters refresh. If both
losers and winners arrive at the SELECT simultaneously, Strava's grace
window for the just-rotated refresh_token usually accepts both, and the
last-writer-wins UPDATE plus the post-refresh `ensureTokens(true)`
re-read leaves both clients with consistent in-memory state.

## Outbound HTTP timeouts

Every outbound Strava fetch carries an `AbortSignal.timeout()`:

- `/oauth/token` (code exchange + refresh): **8 seconds** — short, low
  payload. Protects the Vercel function deadline.
- `/api/v3/*` (data fetches): **30 seconds** — backfill payloads are
  larger and Strava can be slow at peak hours. The Inngest step deadline
  absorbs the rest.

On timeout the catch block wraps `AbortError` as
`StravaError('network', ...)` which the route maps to HTTP 502
`strava_unreachable`.

## Call-401 + refresh-ok + retry-401 -> typed throw

When a Strava API call returns 401, the client refreshes and retries
once. If the retry STILL returns 401, the user has typically revoked
the integration from Strava's side mid-flight. The client throws
`StravaReauthRequired` rather than returning the opaque 401 Response so
Inngest callers can class-switch on the error type without
status-code introspection.

## Backfill enqueue is best-effort (HTTP 202)

After the encrypted token write succeeds, the route enqueues
`strava/backfill.start` to Inngest and returns **HTTP 202 Accepted**
(AGENTS.md §Background jobs mandates 202 for enqueue routes). If Inngest
is unreachable (dev server down, cloud incident, invalid event key), the
route still returns 202: the user IS connected, and the backfill can be
re-triggered later. The soft failure is logged with event
`backfill_start_enqueue_failed` for operator alerting. The token row is
**not** rolled back — rolling back would force the user to redo OAuth
for a queue-layer outage they have no visibility into.

## Logging policy

The connect + init routes MUST NOT log:

- `code`, `code_verifier`
- `access_token`, `refresh_token`
- full Strava response body
- the request body verbatim
- **the signed `state` value** (it IS the verifier; logging it defeats CSRF)

They log only:

- `user_id` (the authenticated caller)
- `athlete_strava_id` (after the Strava exchange returns it)
- the event name (`connected`, `state_mismatch`, `exchange_rejected`,
  `account_collision`, `same_user_reconnect`,
  `backfill_start_enqueue_failed`, etc.)
- success/failure flag
- normalized error code

The route tests include a logging audit that fails CI if any forbidden
substring appears in `console.info`/`console.error` arguments.

## Re-auth surface (deferred to Phase C2)

When the refresh token rotates and Strava later returns 401 on the next
refresh attempt, the `StravaClient` throws `StravaReauthRequired`.
Inngest functions catch this at the top level and write
`athlete_profiles.backfill_status.state = 'needs_reauth'`. The mobile
UI's "Reconnect Strava" affordance maps to this state in
`apps/mobile/src/integrations/strava-machine.ts` (the `set_needs_reauth`
action is reserved for that Phase C2 realtime dispatcher; no production
caller dispatches it today).

Phase B's `connected` state is intentionally static (a label + "Powered
by Strava" mark + placeholder progress copy). Phase C2 wires the
`backfill_status` subscription that drives the progress indicator and
the `needs_reauth` UI surface.

## Operational notes

### Inngest event retention vs Phase C cutover

The `/connect` route enqueues `strava/backfill.start` unconditionally on
successful connect. Phase C (the Inngest function that consumes this
event) does not yet exist. Inngest's free-tier event retention is
typically 3 days; paid tiers extend to 7 days or more. If Phase B ships
to production and Phase C ships AFTER that retention window for any
user's connect event, that user's backfill will not auto-trigger.

Mitigations available today:

- Phase C ships well within retention (target: < 3 days after Phase B
  hits production).
- If retention is exceeded, the Phase C deploy includes a one-time
  sweep that finds `strava_tokens` rows with no completed backfill and
  manually re-emits `strava/backfill.start` for each.
- A Phase C2 manual "re-trigger backfill" button on the profile screen
  is the long-term recourse.

### Same-user reconnect log signal

Operations should monitor the rate of `same_user_reconnect` events in
`/connect` logs. A non-trivial rate informs the Phase C policy decision
on what to do with orphaned `workout_matches` rows from the previous
`athlete_strava_id`.
