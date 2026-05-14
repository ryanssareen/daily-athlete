---
title: Strava OAuth posture (Phase B)
type: solution
date: 2026-05-14
status: shipped
---

# Strava OAuth posture

This doc captures the Phase B security decisions for the Strava integration:
how OAuth runs across mobile + web, how PKCE + state-nonce protect the
flow, and how `strava_tokens` writes split between JWT-bound and
service-role supabase-js clients.

## Where the code lives

- Mobile UI: [apps/mobile/src/integrations/strava.tsx](../../apps/mobile/src/integrations/strava.tsx) + the pure state machine [strava-machine.ts](../../apps/mobile/src/integrations/strava-machine.ts).
- Server connect route: [apps/web/app/api/integrations/strava/connect/route.ts](../../apps/web/app/api/integrations/strava/connect/route.ts).
- Server-side code-for-token exchange: [apps/web/src/strava/oauth.ts](../../apps/web/src/strava/oauth.ts).
- Per-user API client (refresh-on-401, rate-limit headers): [apps/web/src/strava/client.ts](../../apps/web/src/strava/client.ts).
- Service-role DB helpers: [apps/web/src/db/strava-tokens.ts](../../apps/web/src/db/strava-tokens.ts).
- Token encryption (AES-256-GCM, versioned keys): [apps/web/src/security/token-crypto.ts](../../apps/web/src/security/token-crypto.ts) — companion doc [strava-token-crypto.md](strava-token-crypto.md).

## PKCE end-to-end

The mobile client uses `expo-auth-session` with `usePKCE: true` and
`responseType: ResponseType.Code`. The library generates a random
`code_verifier`, hashes it to a `code_challenge`, and includes the
challenge in the authorize URL.

After Strava redirects back to `da2://strava-oauth` with the `code`, the
mobile screen POSTs `{ code, code_verifier, redirect_uri, state,
expected_state }` to `/api/integrations/strava/connect`. The server then
calls Strava's `/oauth/token` with both `code` and `code_verifier`;
Strava verifies the SHA256 of the verifier matches the challenge it
recorded on the authorize hop.

**Why this matters on Android.** The `da2://` URL scheme is hijackable —
a hostile app on the same device can register the same scheme and
intercept the OAuth callback. PKCE end-to-end is the load-bearing
mitigation: a stolen `code` without the matching `code_verifier` cannot
be exchanged for tokens at Strava. The verifier never leaves the
device-then-server path; it is not logged, not embedded in URLs, and
single-use.

## State-nonce CSRF protection

`expo-auth-session` auto-generates a random `state` per authorize request
when one isn't supplied. The mobile client captures that as
`expected_state` (in a `useRef` mirroring the AuthRequest object), passes
it through to Strava as the OAuth state parameter, and Strava echoes it
back on the callback.

The mobile POST body carries both:
- `state`: whatever Strava returned on the callback
- `expected_state`: the value the mobile session generated before the hop

The server compares them with `timingSafeEqual`. Mismatch returns HTTP
400 `state_mismatch` **before** the code is exchanged with Strava —
otherwise an attacker who substitutes a victim's code with their own
could trick the victim's account into being linked to the attacker's
Strava identity. The pre-exchange rejection means the substituted code
is never burned.

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
   `auth.uid()` from the cookie session. This confirms which user is
   making the request. A JWT-bound write to `strava_tokens` would
   silently succeed with 0 rows affected (no permissive RLS policy).

2. **Service-role admin client** (`@/db/admin`) performs the encrypted
   upsert. Every service-role call site is annotated with
   `// service-role: explicit user filter required` and explicitly
   filters by `user_id`, matching the AGENTS.md "Secrets" contract.

Tests pin both paths: the `route.test.ts` happy-path asserts that the
persisted row's `user_id` matches the JWT-derived `auth.uid()`, and the
B1 `client.test.ts` exercises the encrypted read + decrypt path with the
same posture.

## Re-connect collision policy (HTTP 409)

The `strava_tokens.athlete_strava_id` column has a unique index. Two
users connecting the same Strava account would collide on this index.

The connect route handles the collision explicitly:

1. **Before the upsert**, look up
   `SELECT user_id FROM strava_tokens WHERE athlete_strava_id = $1`.
2. If a row exists with a **different** `user_id`, return HTTP **409**
   `strava_account_already_linked`. The original owner's row is
   untouched.
3. If no row exists, or the existing row's `user_id` matches the caller,
   proceed with the upsert (`ON CONFLICT (user_id) DO UPDATE`).

**Why reject instead of silently transferring ownership?** Silent
transfer is a data-integrity hazard for shared family Strava accounts
(two athletes share one Strava login; both connect to DA2; the second
connect would steal the first athlete's connection). It is also an
account-takeover surface: an attacker who obtains a Strava code for a
victim's account could re-link the victim's Strava data to the
attacker's DA2 user. Rejecting the collision is the conservative
choice; manual support resolution is the documented path for legitimate
re-attribution.

## Backfill enqueue is best-effort

After the encrypted token write succeeds, the route enqueues
`strava/backfill.start` to Inngest. If Inngest is unreachable (dev
server down, cloud incident, invalid event key), the route still returns
**200**: the user IS connected, and the backfill can be re-triggered
later. The soft failure is logged with event
`backfill_start_enqueue_failed` for operator alerting. The token row is
**not** rolled back — rolling back would force the user to redo OAuth
for a queue-layer outage they have no visibility into.

## Logging policy

The connect route MUST NOT log:

- `code`, `code_verifier`
- `access_token`, `refresh_token`
- full Strava response body
- the request body verbatim

It logs only:

- `user_id` (the authenticated caller)
- `athlete_strava_id` (after the Strava exchange returns it)
- the event name (`connected`, `state_mismatch`, `exchange_rejected`,
  `account_collision`, `backfill_start_enqueue_failed`, etc.)
- success/failure flag
- normalized error code

Reviewers grep the route diff for stray `console.*` calls and template
literals containing the sensitive field names listed above. The Phase B
PR adds this audit step to the Verification checklist.

## Re-auth surface (deferred to Phase C2)

When the refresh token rotates and Strava later returns 401 on the next
refresh attempt, the `StravaClient` throws `StravaReauthRequired`.
Inngest functions catch this at the top level and write
`athlete_profiles.backfill_status.state = 'needs_reauth'`. The mobile
UI's "Reconnect Strava" affordance maps to this state in
[strava-machine.ts](../../apps/mobile/src/integrations/strava-machine.ts).

Phase B's `connected` state is intentionally static (a label + "Powered
by Strava" mark + placeholder progress copy). Phase C2 wires the
`backfill_status` subscription that drives the progress indicator and
the `needs_reauth` UI surface.
