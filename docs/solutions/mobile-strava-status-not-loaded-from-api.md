---
title: Mobile Settings Showed "Connect Strava" for Already-Connected Athletes
date: 2026-10-20
status: active
---

# Mobile Settings Showed "Connect Strava" for Already-Connected Athletes

## Symptom

Athletes who had already linked Strava (on web or mobile) opened Settings in the Flutter
app and saw the **Connect Strava** prompt every time. Tapping **Disconnect Strava** only
flipped the local UI state; the token stayed on the server and the next launch looked the
same.

## Root cause

Two separate gaps, both fixed in #123:

1. `StravaOAuthService` (Flutter) always initialised as `notConnected` and never asked the
   server. The truth lives in `strava_tokens`, exposed by
   `GET /api/onboarding/strava-status`.
2. That route only authenticated with the SSR cookie (`supabase.auth.getUser()`). The
   mobile app authenticates with a Bearer token, so even a correct client call would 401.
3. The Disconnect button called `reset()` (local state only) instead of the disconnect
   endpoint.

## Fix

- `strava-status` now uses `resolveAuth(supabase, request)` so it accepts cookie or Bearer.
- `StravaOAuthService` fetches status on load through an injectable `ApiGetter` seam.
- Disconnect calls `disconnect()`, which hits the real endpoint, then updates state.

## Prevention

- Any screen that shows connection or account state must read it from the server on load.
  Local default state is only a loading placeholder, never the answer.
- When a mobile screen needs an existing web route, check the route's auth. Web routes
  written for cookie auth silently exclude the app. Use `resolveAuth` for anything the app
  calls, and add a Bearer test (see `strava-status/__tests__/route.test.ts`).
- A button labelled with a server-side action (Disconnect, Delete) must call the server.
  Name local-only helpers differently (`reset` vs `disconnect`) so a wrong call is visible.
- Related: [strava-oauth.md](strava-oauth.md).
