---
title: "feat: Flutter app — core navigation, auth, and role-aware tabs"
type: feat
status: active
date: 2026-05-17
origin: docs/brainstorms/2026-05-17-flutter-app-core-navigation-requirements.md
---

# feat: Flutter app — core navigation, auth, and role-aware tabs

> **Target repo note:** Flutter source lives in `daily-athlete/`, a peer git repository
> alongside the main DA2 monorepo. All Flutter paths below are relative to `daily-athlete/`.
> Schema, API, and shared-type paths are relative to the DA2 monorepo root.

## Overview

Replace the retired Expo/React Native app (`apps/mobile/`) with a Flutter app targeting
iOS and Android. The app serves both athletes and coaches through a single 4-tab shell
with role-aware content. Auth, data, and API stay in the existing Supabase project and
Next.js backend — no separate backend. Schema plan Unit 8 (`coach_athlete_links` + coach
RLS) is in scope as a prerequisite for all coach features.

## Problem Frame

The Expo app shells were thin stubs. Flutter gives native performance and a single
codebase for both platforms without Expo managed-workflow constraints. The original
split (athlete → mobile, coach → web) is replaced by one app serving both roles with
role-aware content per tab. (see origin: `docs/brainstorms/2026-05-17-flutter-app-core-navigation-requirements.md`)

## Requirements Trace

- R1–R3: Dashboard (athlete stats, coach roster cards, athlete detail drill-down)
- R4–R9: Activities tab (feed, sport filters, activity detail, manual log, coach selector)
- R10–R16: Calendar tab (Day/Week/Month/Year views, mark complete, coach assignment)
- R17–R21: Settings tab (theme, units, Strava connect/disconnect, coach/roster info)
- R22–R25: App shell (bottom nav, role detection, Supabase auth, light/dark)
- Schema Unit 8 (coach_athlete_links): prerequisite for R2, R3, R9, R16, R20, R21

## Scope Boundaries

- Flutter web is not in scope (iOS and Android only)
- No in-app messaging between coaches and athletes
- No CTL/ATL/TSB performance manager chart
- Year view is a training load heatmap only — not an Annual Training Plan editor
- No Garmin/Wahoo integration; Strava is the only third-party sync
- Workout library (reusable coach templates) is out of scope
- The Next.js web app is not redesigned as part of this initiative
- Supabase service-role key must never be exposed to the Flutter app

## Context & Research

### Relevant Code and Patterns

- Expo Strava OAuth flow to port: `apps/mobile/src/integrations/strava.tsx`
  — calls `POST /api/integrations/strava/init` then `POST /api/integrations/strava/connect`
  — PKCE handled by expo-auth-session; Flutter must replicate with `flutter_appauth` or manual PKCE
- Expo Supabase client: `apps/mobile/src/auth/supabase.ts`
  — uses AsyncStorage; Flutter equivalent is `flutter_secure_storage`
- Bearer auth on API calls: `apps/web/src/auth/bearer.ts` (`resolveAuth()`)
  — Flutter sends `Authorization: Bearer <supabase_jwt>` on every Next.js API call
- Strava init/connect schemas: `packages/shared/src/strava-connect.ts`
  — `StravaConnectRequest` is the exact POST body; `StravaInitResponse` is the init response shape
- Realtime allowlist: `packages/shared/src/realtime-allowlist.ts`
  — `['completed_workouts', 'planned_workouts', 'plans', 'workout_matches']`
  — `athlete_profiles` and `strava_tokens` are explicitly excluded; poll, don't subscribe
- Partial unique index pattern (for `coach_athlete_links`):
  `docs/solutions/partial-unique-with-soft-delete.md`
  — pre-designed index: `UNIQUE (athlete_user_id) WHERE status = 'active' AND deleted_at IS NULL`
- Migration conventions: `docs/solutions/migration-conventions.md`
  — RLS, realtime opt-in, soft-delete, `delete_user_cascade` update all required in same migration
- `supabase-dart` `.upsert()` cannot target the partial index on `completed_workouts`
  — use INSERT + catch Postgres error code 23505 + UPDATE, or call an RPC

### Institutional Learnings

- `da2://` custom URL scheme is already established (Strava OAuth uses `da2://strava-oauth`)
- PKCE is the load-bearing security on the `da2://` scheme (custom schemes are hijackable on Android without it)
- Server-signed HMAC state nonce: Flutter cannot mint it — must come from `POST /api/integrations/strava/init`
- `strava_tokens` and `athlete_profiles` must never join `supabase_realtime`
- Every new user-data table requires: RLS enabled, self-SELECT/INSERT/UPDATE policies,
  positive + negative RLS tests, and `delete_user_cascade` updated — all in the same migration

### External References

- Package versions should be verified at [pub.dev](https://pub.dev) at implementation time
  for `supabase_flutter`, `flutter_secure_storage`, `go_router`, `riverpod`, `table_calendar`
- Supabase Flutter auth deep-link guide: Supabase docs → Flutter → Auth → Deep Links

## Key Technical Decisions

- **State management: Riverpod 2.x (stable)** — idiomatic for async Supabase queries and
  realtime streams; `riverpod_generator` reduces boilerplate; integrates with `go_router`
  redirect guards via `ref.watch`. Reject v3-dev for now — not stable.

- **Navigation: go_router** — handles `da2://auth/callback` deep links natively via
  `GoRouter(redirect: ...)`, supports auth-state-driven route guards, declarative shell routes
  for bottom tabs.

- **Session storage: flutter_secure_storage via custom LocalStorage** — implement a
  `SupabaseSecureLocalStorage` class that wraps `FlutterSecureStorage` and implements the
  `LocalStorage` interface from `supabase_flutter`. Pass to `Supabase.initialize(localStorage: ...)`.
  This replaces the insecure SharedPreferences default on Android.

- **Deep-link scheme: `da2://auth/callback`** — extend the existing `da2://` scheme
  (already used for Strava at `da2://strava-oauth`). Configure in iOS `Info.plist`,
  Android `AndroidManifest.xml`, and Supabase project Redirect URLs allowlist
  (both `supabase/config.toml` `additional_redirect_urls` for local dev, and production dashboard).

- **Calendar: table_calendar (Day/Week/Month) + custom CustomPainter (Year heatmap)** —
  `table_calendar` is the most mature Flutter calendar package. Year view is a GitHub-style
  heatmap rendered as a `CustomPainter` widget over weekly buckets of training load derived
  from `completed_workouts`. No third-party dependency needed for Year view.

- **Dart model layer: `lib/models/` within `daily-athlete/`** — manually maintained, parallel
  to `packages/shared` TypeScript types. Sport enum, PlanStatus, ActivitySource, etc. must be
  kept in sync. Drift risk is acknowledged; no codegen in v1.

- **API strategy: Supabase direct for reads; Next.js routes for business-logic writes** —
  Flutter queries `planned_workouts`, `completed_workouts`, `plans`, `athlete_profiles`,
  `coach_athlete_links` directly via supabase-dart with RLS. New Next.js route handlers are
  needed only for: manual activity entry (dedup logic), mark-complete/skip/reschedule
  (workout_matches upsert), and coach write-on-behalf (needs service-role + coach verification).

- **coach_athlete_links: one active coach per athlete enforced by partial unique index** —
  follow the pre-designed pattern from `docs/solutions/partial-unique-with-soft-delete.md`.
  Status transitions (assign/remove coach) must be wrapped in a DB transaction.

- **role_flags security fix: WITH CHECK RLS policy** — the current `users_self_update` policy
  allows self-modification of `role_flags`. Tighten the WITH CHECK to require
  `role_flags = (SELECT role_flags FROM public.users WHERE id = auth.uid())`, which blocks
  any self-update of the column while allowing other fields (display_name, timezone) to change.

## Open Questions

### Resolved During Planning

- **coach_athlete_links schema**: Pre-designed in `docs/solutions/partial-unique-with-soft-delete.md`.
  Use `status TEXT CHECK (status IN ('active', 'archived'))` + `deleted_at` + partial unique index.
  One migration file (`0010`). User decision: implement Unit 8 as part of this initiative.

- **Strava OAuth for Flutter**: Port the Expo flow from `apps/mobile/src/integrations/strava.tsx`.
  Same API endpoints (`/init` + `/connect`). Use `flutter_appauth` or manual PKCE code
  generation (32–48 random bytes → 43–64 char base64url code_verifier; SHA-256 challenge).
  External browser only (`url_launcher`); no embedded webview. No new API routes needed.

- **Auth deep-link**: Custom scheme `da2://auth/callback`. Add to Supabase project Redirect URLs
  (config.toml + production dashboard). Handle in Flutter via `app_links` package listening for
  the URI and calling `supabase.auth.exchangeCodeForSession(code)`.

- **Year view scope**: Kept in v1 per user decision. Custom `CustomPainter` widget.

### Deferred to Implementation

- **Exact `supabase_flutter` LocalStorage API** — verify the `LocalStorage` interface method
  names and whether `authCallbackUrlHostname` is needed at `Supabase.initialize()`.

- **`flutter_appauth` vs manual PKCE** — determine during implementation whether
  `flutter_appauth` handles the `da2://strava-oauth` redirect scheme, or whether manual
  `crypto` package PKCE generation is simpler given the existing server-side flow.

- **Realtime stream cleanup** — exact dispose/cancel pattern for Supabase stream subscriptions
  in Riverpod `AsyncNotifier.dispose()` is implementation-time.

- **iOS Universal Links vs custom scheme for auth callback** — custom scheme (`da2://`) is
  simplest to ship. Universal Links (HTTPS) can be added later without API changes.

- **`completed_workouts` upsert RPC** — decide at implementation whether to write a Postgres
  RPC function or use INSERT + catch-23505 + UPDATE directly from Dart.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not
> implementation specification. The implementing agent should treat it as context, not
> code to reproduce.*

```
Flutter App (daily-athlete/)
│
├── Auth layer
│   ├── Supabase.initialize(localStorage: SupabaseSecureLocalStorage())
│   ├── Sign-in screen → supabase.auth.signInWithOtp(email)
│   ├── da2://auth/callback deep link → supabase.auth.exchangeCodeForSession(code)
│   └── go_router redirect guard: unauthenticated → /sign-in
│
├── Role detection (async, on session load)
│   ├── Query public.users WHERE id = auth.uid() → role_flags[0]
│   ├── 'athlete' → AthleteShell, 'coach' → CoachShell (same 4 tabs, different content)
│   └── Splash screen holds until role is known (prevents wrong-content flash)
│
├── Bottom tab shell (go_router ShellRoute)
│   ├── /dashboard  → DashboardTab (athlete stats | coach roster)
│   ├── /activities → ActivitiesTab (own feed | athlete selector + feed)
│   ├── /calendar   → CalendarTab (own calendar | athlete selector + calendar)
│   └── /settings   → SettingsTab (shared; role-conditional sections)
│
└── Data layer (Riverpod providers)
    ├── Reads (unbounded / equality-filtered): supabase.from('table').stream().eq('athlete_id', uid)
    ├── Reads (date-range filtered): supabase.from('table').select().gte().lte() + Realtime channel trigger
    │   NOTE: supabase-dart .stream() only supports .eq() filters — date ranges MUST use .select()
    ├── Reads: supabase.from('table').select() for non-realtime tables (poll on focus)
    ├── Writes needing business logic: HTTP POST to Next.js API (Bearer token)
    └── Role-gated writes: Next.js API routes (server-side coach verification)

Next.js API additions (apps/web/)
├── POST /api/activities/manual     → create completed_workout (manual source)
├── POST /api/workouts/[id]/status  → mark complete/skip/reschedule + workout_match
└── POST /api/coach/workouts        → coach assigns workout to athlete (service-role write)

Supabase schema additions
├── 0010_coach_athlete_links.sql   → coach_athlete_links table + RLS + role_flags fix
└── coach RLS policies on:
    planned_workouts (coach SELECT for linked athletes)
    completed_workouts (coach SELECT for linked athletes)
    plans (coach SELECT for linked athletes)
```

## Implementation Units

### Phase 1: Foundation

- [ ] **Unit 1: Flutter project scaffold**

**Goal:** Initialise the Flutter project in `daily-athlete/`, set up the package structure,
declare all dependencies, and establish project conventions (linting, env config).

**Requirements:** R22–R25 (app shell prerequisite), all tabs (Flutter project must exist first)

**Dependencies:** None

**Files (all paths relative to `daily-athlete/`):**
- Create: `pubspec.yaml`
- Create: `lib/main.dart`
- Create: `lib/app.dart` (MaterialApp / GoRouter root)
- Create: `lib/core/supabase_secure_storage.dart` (LocalStorage implementation)
- Create: `lib/core/env.dart` (environment config — Supabase URL, anon key, API base URL)
- Create: `analysis_options.yaml`
- Create: `ios/Runner/Info.plist` (custom URL scheme `da2://`)
- Create: `android/app/src/main/AndroidManifest.xml` (intent filter for `da2://`)
- Create: `.env.local.example` (document required env vars)

**Approach:**
- Run `flutter create --org com.da2 --project-name daily_athlete .` inside `daily-athlete/`
- Core dependencies: `supabase_flutter` (v2), `flutter_secure_storage`, `go_router`,
  `flutter_riverpod`, `riverpod_annotation`. Verify current stable versions at pub.dev.
- Dev dependencies: `riverpod_generator`, `build_runner`.
- `SupabaseSecureLocalStorage` implements the `LocalStorage` interface from `supabase_flutter`,
  wrapping `FlutterSecureStorage`. Used in `Supabase.initialize(localStorage: ...)`.
- Env config reads from `--dart-define` build args (not committed `.env` files):
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_BASE_URL`.
- iOS `Info.plist`: add `CFBundleURLSchemes` entry for `da2`.
- Android `AndroidManifest.xml`: add `<intent-filter>` with scheme `da2` on the main activity.
- Add `daily-athlete/` path to `supabase/config.toml` `additional_redirect_urls`:
  `da2://auth/callback` (for local Supabase dev).
- Add `da2://auth/callback` to production Supabase project Redirect URLs (dashboard action,
  not code — document in a checklist comment).

**Patterns to follow:**
- `apps/mobile/src/auth/supabase.ts` for the session persistence pattern
- `apps/mobile/app.json` for the `da2://` scheme precedent

**Test scenarios:**
- Test expectation: none — this unit is scaffolding with no behavioral logic to unit-test.
  Verification is build-success + deep-link scheme registration.

**Verification:**
- `flutter build ios --dart-define=...` and `flutter build apk --dart-define=...` succeed
- Opening `da2://auth/callback` on a simulator launches the app (confirmed via `xcrun simctl openurl`)

---

- [ ] **Unit 2: Schema Unit 8 — coach_athlete_links table + role_flags security fix**

**Goal:** Add the `coach_athlete_links` table with soft-delete, RLS, and the partial unique
index enforcing one active coach per athlete. Also tighten the `users_self_update` RLS policy
to prevent self-modification of `role_flags`.

**Requirements:** R2, R3, R9, R16, R20, R21 (all coach-roster features are blocked without this)

**Dependencies:** None (pure schema migration)

**Files:**
- Create: `supabase/migrations/0010_coach_athlete_links.sql`
  — table, RLS, partial index, and `delete_user_cascade` update all in one file;
  the `delete_user_cascade` function does **not** exist in migrations 0000–0009 (deferred
  from prior schema units) — **create** it in `0010` covering `coach_athlete_links`
  on both `coach_user_id` and `athlete_user_id`, then extend it for any other tables
  the function should cover when account deletion is fully implemented
- Modify: `packages/shared/src/realtime-allowlist.ts` — do NOT add `coach_athlete_links`
  (relationship changes are low-frequency; realtime not needed)
- Create: `apps/web/src/db/__tests__/coach-athlete-links.rls.test.ts`

**Approach:**

`coach_athlete_links` table shape:
- `id UUID PK`
- `coach_user_id UUID NOT NULL FK → public.users ON DELETE CASCADE`
- `athlete_user_id UUID NOT NULL FK → public.users ON DELETE CASCADE`
- `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))`
- `invited_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `accepted_at TIMESTAMPTZ nullable`
- `deleted_at TIMESTAMPTZ nullable` (soft-delete per AGENTS.md convention)
- Partial unique index: `UNIQUE (athlete_user_id) WHERE status = 'active' AND deleted_at IS NULL`
  — enforces at most one active coach per athlete at the DB level.
- Status transitions (assign new coach when one already active) must be wrapped in a single
  transaction: archive old row + insert new row in same txn to avoid 23505.

RLS policies on `coach_athlete_links`:
- Athletes self-SELECT: `USING (athlete_user_id = auth.uid())`
- Coaches self-SELECT: `USING (coach_user_id = auth.uid())`
- INSERT: `WITH CHECK (coach_user_id = auth.uid())` (coach initiates the link)
- UPDATE (status/archive): `USING (coach_user_id = auth.uid() OR athlete_user_id = auth.uid())`
- No hard DELETE — soft-delete only.

Coach read access to athlete data (planned_workouts, completed_workouts, plans, workout_matches):
- Add RLS SELECT policy on each table: `USING (EXISTS (SELECT 1 FROM coach_athlete_links WHERE coach_user_id = auth.uid() AND athlete_user_id = <table>.athlete_id AND status = 'active' AND deleted_at IS NULL))`
- Tables requiring the policy: `planned_workouts`, `completed_workouts`, `plans`, and `workout_matches`
  (the existing `workout_matches` policy checks `auth.uid() = athlete_id` directly — add the coach
  EXISTS subquery as an additional USING condition so coach compliance queries return matches)
- These policies go in migration `0010` alongside the main table.

`role_flags` security fix (same migration file or a separate `0011_lock_role_flags.sql`):
- Alter the `users_self_update` policy to add a WITH CHECK clause:
  `WITH CHECK (id = auth.uid() AND role_flags = (SELECT role_flags FROM public.users WHERE id = auth.uid()))`
- This rejects any self-UPDATE where `role_flags` differs from the stored value, while
  allowing display_name, timezone, and other columns to change freely.

**Patterns to follow:**
- `docs/solutions/partial-unique-with-soft-delete.md` — partial index design
- `docs/solutions/migration-conventions.md` — RLS, soft-delete, cascade conventions
- `supabase/migrations/0007_plans_and_planned_workouts.sql` for RLS policy syntax examples

**Test scenarios:**
- Happy path: coach queries `coach_athlete_links` and sees only their own linked athletes
- Happy path: athlete queries `coach_athlete_links` and sees only their own coach link
- Negative RLS: a third user cannot SELECT any row from `coach_athlete_links`
- Negative RLS: an athlete cannot INSERT a row (coach_user_id = auth.uid() check fails)
- Constraint: inserting a second active link for the same athlete raises 23505 on the partial index
- Coach SELECT on `planned_workouts`: coach sees linked athlete's rows, not other athletes' rows
- Coach SELECT on `completed_workouts`: same isolation check
- role_flags fix: UPDATE setting role_flags to a different value is rejected for authenticated role
- role_flags fix: UPDATE changing display_name only is still allowed

**Verification:**
- `supabase db reset` applies cleanly with no errors
- All RLS tests pass in `apps/web/src/db/__tests__/coach-athlete-links.rls.test.ts`
- `supabase db lint` reports no warnings on the new migration

---

### Phase 2: Auth & Data Layer

- [ ] **Unit 3: Dart model layer**

**Goal:** Define Dart classes mirroring the domain types in `packages/shared/`, with
`fromJson`/`toJson` for Supabase query results.

**Requirements:** All tabs depend on these models

**Dependencies:** Unit 1 (Flutter project must exist)

**Files (relative to `daily-athlete/`):**
- Create: `lib/models/sport.dart` (Sport enum: swim, bike, run, strength, mobility, other)
- Create: `lib/models/user.dart` (UserRow, RoleFlag enum)
- Create: `lib/models/planned_workout.dart` (PlannedWorkoutRow, PlannedWorkoutStatus, EditedByKind)
- Create: `lib/models/completed_workout.dart` (CompletedWorkoutRow, CompletedWorkoutSource)
- Create: `lib/models/plan.dart` (PlanRow, PlanStatus, PlanSource)
- Create: `lib/models/workout_match.dart` (WorkoutMatchRow, WorkoutMatchMethod)
- Create: `lib/models/athlete_profile.dart` (AthleteProfileRow, BackfillStatus shape)
- Create: `lib/models/coach_athlete_link.dart` (CoachAthleteLinkRow, LinkStatus enum)
- Create: `lib/models/activity_summary.dart` (view model combining planned + completed for display)
- Test: `test/models/` — one test file per model

**Approach:**
- All models are plain Dart classes (no code generation needed in v1).
- `fromJson(Map<String, dynamic>)` factory constructors; `toJson()` for write payloads.
- Enums use `String` backing values matching the DB CHECK constraints exactly.
- Sport enum values: `swim`, `bike`, `run`, `strength`, `mobility`, `other` — must stay in sync
  with `packages/shared/src/planned-workout.ts` and the DB CHECK constraints.
- `strava_activity_id` on `CompletedWorkoutRow` is `int?` (fits in int64).
- Nullable fields default to null; don't throw on missing optional JSON keys.
- `ActivitySummary` is a display-layer view model that merges a `PlannedWorkoutRow?` and
  `CompletedWorkoutRow?` for calendar and feed rendering — not a DB table.

**Patterns to follow:**
- `packages/shared/src/planned-workout.ts`, `completed-workout.ts`, etc. for field names and types

**Test scenarios:**
- Happy path: `PlannedWorkoutRow.fromJson(map)` parses all fields including nested `structure` JSONB
- Happy path: `Sport.fromString('run')` returns `Sport.run`; unknown value throws or returns `Sport.other`
- Edge case: `CompletedWorkoutRow.fromJson` with `strava_activity_id: null` — `null` not error
- Edge case: `fromJson` with extra unknown keys — must not throw (Supabase may add columns)
- Round-trip: `model.toJson()` produces a map that `fromJson()` can reconstruct identically

**Verification:**
- `flutter test test/models/` passes with no failures

---

- [ ] **Unit 4: Supabase auth + deep-link + sign-in/sign-up screens**

**Goal:** Implement the full auth flow: magic-link OTP sign-in/sign-up screens, deep-link
callback handling (`da2://auth/callback`), session persistence via `flutter_secure_storage`,
and go_router auth guard.

**Requirements:** R24 (Supabase auth), R25 (light/dark — system default is established here)

**Dependencies:** Unit 1 (project scaffold, deep-link scheme), Unit 3 (UserRow model)

**Files (relative to `daily-athlete/`):**
- Create: `lib/core/supabase_secure_storage.dart` (SupabaseSecureLocalStorage — if not done in Unit 1)
- Create: `lib/features/auth/sign_in_screen.dart`
- Create: `lib/features/auth/auth_notifier.dart` (Riverpod AsyncNotifier for auth state)
- Create: `lib/router/router.dart` (GoRouter definition with auth redirect guard)
- Modify: `lib/main.dart` (wire SupabaseSecureLocalStorage + app_links listener)
- Modify: `lib/app.dart` (theme — light/dark from system, respects Settings override later)
- Test: `test/features/auth/auth_notifier_test.dart`

**Approach:**
- `Supabase.initialize(url, anonKey, localStorage: SupabaseSecureLocalStorage())` in `main.dart`.
- Auth state stream: `supabase.auth.onAuthStateChange` — pipe into `AuthNotifier` (Riverpod).
- Deep-link handling: use `app_links` package to listen for `da2://auth/callback?code=...`
  URIs. On receipt, call `supabase.auth.exchangeCodeForSession(code)`.
- Sign-in screen: single email input → `supabase.auth.signInWithOtp(email, emailRedirectTo: 'da2://auth/callback')`.
  Show "check your email" state after submission.
- go_router `redirect` guard: if `authState` is unauthenticated, redirect any route to `/sign-in`.
  Once authenticated, redirect `/sign-in` to `/dashboard`.
- Splash/loading state: `GoRouter` stays on a `/loading` route until `AuthNotifier` resolves
  the initial session from storage. This prevents the wrong-content flash (R23/success criteria).
- Theme: `MaterialApp.themeMode = ThemeMode.system` initially. Settings tab (Unit 9) will
  override via a Riverpod `ThemeNotifier` that persists to `flutter_secure_storage`.

**Patterns to follow:**
- `apps/mobile/src/auth/supabase.ts` for session persistence pattern
- `apps/web/app/(auth)/sign-in/page.tsx` for UX reference (email-first, no password)

**Test scenarios:**
- Happy path: `AuthNotifier` starts in loading state, resolves to authenticated when session exists in storage
- Happy path: `AuthNotifier` resolves to unauthenticated when storage is empty
- Happy path: receiving `da2://auth/callback?code=abc` triggers `exchangeCodeForSession('abc')`
- Edge case: deep link arrives before Supabase is fully initialized — must queue or retry
- Edge case: `exchangeCodeForSession` returns an error — auth state remains unauthenticated, error shown
- Error path: OTP send fails (network error) — sign-in screen shows error, not loading spinner
- Route guard: unauthenticated user navigating to `/dashboard` is redirected to `/sign-in`
- Route guard: authenticated user navigating to `/sign-in` is redirected to `/dashboard`

**Verification:**
- Magic-link OTP email arrives and tapping the link opens the app and lands on `/dashboard`
- Session survives app restart (stored in flutter_secure_storage, not SharedPreferences)
- `flutter test test/features/auth/auth_notifier_test.dart` passes

---

### Phase 3: App Shell

- [ ] **Unit 5: Role detection + bottom tab navigation + route guards**

**Goal:** After authentication, query the user's `role_flags`, determine the primary role,
and render the 4-tab shell with role-appropriate content providers wired up.

**Requirements:** R22 (bottom tab nav), R23 (role detection, no in-app switcher), R25 (theme)

**Dependencies:** Unit 4 (auth must be established before role query)

**Files (relative to `daily-athlete/`):**
- Create: `lib/features/shell/app_shell.dart` (ShellRoute scaffold — BottomNavigationBar + tab bodies)
- Create: `lib/features/shell/role_notifier.dart` (Riverpod: fetches users.role_flags[0])
- Create: `lib/router/routes.dart` (named route constants)
- Modify: `lib/router/router.dart` (add ShellRoute wrapping /dashboard, /activities, /calendar, /settings)
- Test: `test/features/shell/role_notifier_test.dart`

**Approach:**
- After session resolves, `RoleNotifier` queries `public.users` WHERE `id = auth.uid()`
  and extracts `role_flags[0]`. Provides `RoleFlag` (athlete | coach) to all descendant widgets.
- While `RoleNotifier` is loading, the ShellRoute shows a centered loading indicator in the
  tab body area (tab bar is visible, content area is loading). This is preferable to holding
  the splash screen since tabs render instantly.
- The 4-tab `BottomNavigationBar` is identical for both roles; content widgets are role-aware.
- Each tab body is a separate widget tree: `DashboardTab`, `ActivitiesTab`, `CalendarTab`,
  `SettingsTab`. These receive the `RoleFlag` from the `RoleNotifier` and render accordingly.
- Go_router `ShellRoute` wraps the 4 top-level routes. Navigating between tabs via the bottom
  bar uses `context.go('/dashboard')` etc. — no stack push.

**Patterns to follow:**
- go_router `ShellRoute` + `BottomNavigationBar` pattern

**Test scenarios:**
- Happy path (athlete): `RoleNotifier` with `role_flags = ['athlete']` emits `RoleFlag.athlete`
- Happy path (coach): `RoleNotifier` with `role_flags = ['coach']` emits `RoleFlag.coach`
- Edge case: `role_flags = ['athlete', 'coach']` — emits `RoleFlag.athlete` (first element wins)
- Edge case: Supabase query fails — `RoleNotifier` emits error state; app shows retry affordance
- Route guard: navigating to `/dashboard` while role is still loading does not flash wrong content

**Verification:**
- Athlete login shows athlete dashboard content; coach login shows coach roster content
- Role is stable across tab switches and hot restart without re-querying

---

### Phase 4: Feature Tabs

- [ ] **Unit 6: Dashboard tab**

**Goal:** Athlete view: weekly training summary, next workout, streak indicator.
Coach view: roster card list with per-athlete compliance summary; tap → athlete detail.

**Requirements:** R1, R2, R3

**Dependencies:** Unit 5 (role detection), Unit 2 (coach_athlete_links for coach roster query)

**Files (relative to `daily-athlete/`):**
- Create: `lib/features/dashboard/dashboard_tab.dart`
- Create: `lib/features/dashboard/athlete_dashboard.dart`
- Create: `lib/features/dashboard/coach_dashboard.dart`
- Create: `lib/features/dashboard/athlete_roster_card.dart` (single coach roster card widget)
- Create: `lib/features/dashboard/dashboard_providers.dart` (Riverpod providers)
- Create: `lib/features/dashboard/athlete_detail_screen.dart` (drill-down from coach roster)
- Test: `test/features/dashboard/dashboard_providers_test.dart`

**Approach:**

Athlete dashboard queries:
- `public.plans` WHERE `athlete_id = auth.uid() AND status = 'active'` — current plan;
  use `.stream().eq('athlete_id', uid)` + client-side filter for active status
- `public.planned_workouts` WHERE `athlete_id = auth.uid() AND scheduled_date >= (week start)`:
  **use `.select()` with `.gte('scheduled_date', weekStart)` — NOT `.stream()`.**
  `supabase-dart` `.stream()` only supports `.eq()` equality filters; `.gte()`/`.lte()` date-range
  filters on `.stream()` are silently ignored. Use `.select()` for date-bounded queries and subscribe
  to a dedicated Realtime channel (`supabase.channel('athlete_dashboard').on(TABLE, ...)`) for
  push notifications; re-run `.select()` on each push.
- `public.completed_workouts` WHERE `athlete_id = auth.uid() AND started_at >= (week start)`:
  same `.select()` + Realtime channel pattern — not `.stream()`
- `athlete_profiles` via `.select()` (no realtime)

Athlete stats to derive client-side:
- Weekly total hours: sum of `duration_s` from completed_workouts this week
- Distance by sport: sum of `distance_m` per sport value
- Compliance: count of planned this week vs. completed (matched via `workout_matches`)
- Next upcoming workout: earliest `planned_workouts` WHERE `scheduled_date >= today` AND `status = 'planned'`
- Streak: consecutive days with at least one completed_workout going back from today

Coach dashboard queries:
- `public.coach_athlete_links` WHERE `coach_user_id = auth.uid() AND status = 'active'`
  — get athlete_user_ids
- For each linked athlete: `public.planned_workouts` (week) + `public.completed_workouts` (week)
  — batch query using `.in_('athlete_id', athleteIds)`
- Compliance per athlete: planned count vs completed count this week
- Last activity date: max `started_at` from completed_workouts per athlete

Athlete detail (R3): tapping a coach roster card navigates to `/dashboard/athlete/:id`.
This screen shows the same athlete dashboard content but queried for the tapped athlete_id.
The coach SELECT RLS policy on `planned_workouts` / `completed_workouts` (from Unit 2) allows this.

**Patterns to follow:**
- `apps/web/app/(athlete)/athlete/profile/page.tsx` for data-fetch-then-render pattern

**Test scenarios:**
- Happy path (athlete): provider emits weekly stats with correct hour sum and sport breakdown
- Happy path (coach): provider emits roster list with correct compliance ratios per athlete
- Edge case (athlete): no planned workouts this week — stats show 0s, no crash
- Edge case (coach): no linked athletes — roster shows empty state, not error
- Edge case: network error fetching plans — tab shows error state with retry button
- Integration: completing a workout in Strava triggers realtime update that refreshes compliance

**Verification:**
- Athlete sees their week's data matching what Supabase contains
- Coach sees roster cards for each linked athlete with correct names and compliance
- Tapping an athlete card navigates to that athlete's detail view

---

- [ ] **Unit 7: Activities tab + manual activity API endpoint**

**Goal:** Chronological feed of completed workouts with sport filter tabs, activity detail view,
manual log form, and (for coaches) an athlete selector at the top.

**Requirements:** R4, R5, R6, R7, R8, R9

**Dependencies:** Unit 5 (role detection), Unit 3 (CompletedWorkoutRow model)

**Files (relative to `daily-athlete/`):**
- Create: `lib/features/activities/activities_tab.dart`
- Create: `lib/features/activities/activity_feed.dart` (list + sport filter tabs)
- Create: `lib/features/activities/activity_row.dart` (single row widget)
- Create: `lib/features/activities/activity_detail_screen.dart`
- Create: `lib/features/activities/manual_log_sheet.dart` (bottom sheet form)
- Create: `lib/features/activities/activities_providers.dart`
- Create: `lib/features/shared/athlete_selector.dart` (reusable coach athlete picker widget)
- Test: `test/features/activities/activities_providers_test.dart`

Next.js API (DA2 monorepo):
- Create: `apps/web/app/api/activities/manual/route.ts`
- Test: `apps/web/src/api/__tests__/activities-manual.test.ts`

**Approach:**

Feed: query `public.completed_workouts` ordered by `started_at DESC`, filtered by sport if
a sport tab is selected. Use `.stream()` for realtime updates. Athlete sees their own feed
(RLS-enforced). Coach sees the selected athlete's feed via the coach SELECT RLS policy.

Sport filter tabs: All / Run / Ride / Swim / Strength / Other — client-side filter on the
stream result (do not re-subscribe on each filter change; filter the in-memory list).

Activity row (R6): sport icon (by `sport` value), formatted date, `name` field (from
`summary_stats.name` if Strava-synced, or user-provided for manual), key metric
(distance for run/ride/swim; `duration_s` formatted for strength), and total duration.
Note: `completed_workouts` has no top-level `name` column — Strava activity name lives
in `summary_stats` JSONB. Surface this in the Dart model as `summaryStats['name']`.

Activity detail (R7): full `summary_stats` display (avg_hr, max_hr, avg_power, calories),
map if `summary_stats.map_polyline` is non-null (render using `flutter_map` + `latlong2`
packages), coaching notes if any (deferred — no `workout_comments` table yet).

Manual log form (R8): sport type picker, date picker, duration input (hh:mm), distance
input (optional), notes text field. On submit: POST to `POST /api/activities/manual` with
Bearer token. The Next.js route creates the `completed_workouts` row using the **user JWT
client** (not service-role) — migration `0008` already has `FOR INSERT WITH CHECK (auth.uid() = athlete_id)`,
so the user's own JWT is sufficient and preserves the RLS safety net. Service-role is not
needed and would violate AGENTS.md service-role restrictions. Returns the new row.

Coach athlete selector (R9): a dropdown/sheet at top of Activities tab that lists
coach's linked athletes. Selecting one updates a `selectedAthleteId` provider; all
feed queries use that ID instead of `auth.uid()`.

`POST /api/activities/manual` route:
- Auth: `resolveAuth()` → must have valid session; use user JWT Supabase client for the insert
- Body: `{ sport, started_at, duration_s, distance_m?, notes? }`
- Validate body with Zod schema
- Insert via user JWT client: `completed_workouts` with `source = 'manual'`, `athlete_id = userId`
  (migration `0008` RLS INSERT policy `auth.uid() = athlete_id` already allows this; no service-role needed)
- No `strava_activity_id` (manual rows are excluded from the partial unique index)
- Returns the created row

**Patterns to follow:**
- `apps/web/app/api/integrations/strava/connect/route.ts` for Bearer-auth Next.js route pattern
- `packages/shared/src/strava-connect.ts` for Zod body validation pattern

**Test scenarios (feed):**
- Happy path: feed renders all completed_workouts for the authenticated user, newest first
- Edge case: empty feed — shows empty state message, not error
- Filter: selecting 'Run' sport tab filters to only run activities
- Coach: with athlete selected, feed shows that athlete's activities (not coach's own)

**Test scenarios (manual log API):**
- Happy path: valid body → 201 with new completed_workout row
- Error: missing required field `sport` → 400 with validation error
- Error: missing Bearer token → 401
- Error: `duration_s` is 0 or negative → 400

**Test scenarios (activity detail):**
- Happy path: activity with `map_polyline` renders a map widget
- Edge case: activity with no `map_polyline` — map section is hidden, no crash

**Verification:**
- Manual activity appears in feed immediately after POST, without requiring Strava sync
- Sport filter correctly hides/shows activities per selected sport
- Coach sees selected athlete's activities, not their own

---

- [ ] **Unit 8: Calendar tab**

**Goal:** 4 switchable calendar views (Day, Week, Month, Year) showing planned and
completed workouts color-coded by sport. Athlete can mark workouts complete/skip/reschedule.
Coach has athlete selector and can assign workouts by tapping an empty day.

**Requirements:** R10, R11, R12, R13, R14, R15, R16

**Dependencies:** Unit 5 (role detection), Unit 3 (models), Unit 2 (coach RLS for assignment)

**Files (relative to `daily-athlete/`):**
- Create: `lib/features/calendar/calendar_tab.dart` (view switcher + athlete selector for coach)
- Create: `lib/features/calendar/day_view.dart`
- Create: `lib/features/calendar/week_view.dart` (default)
- Create: `lib/features/calendar/month_view.dart`
- Create: `lib/features/calendar/year_heatmap_view.dart` (CustomPainter)
- Create: `lib/features/calendar/workout_chip.dart` (sport-colored workout pill widget)
- Create: `lib/features/calendar/calendar_providers.dart`
- Create: `lib/features/calendar/assign_workout_sheet.dart` (coach: form to assign a workout)
- Test: `test/features/calendar/calendar_providers_test.dart`
- Test: `test/features/calendar/year_heatmap_view_test.dart`

Next.js API (DA2 monorepo):
- Create: `apps/web/app/api/workouts/[id]/status/route.ts`
- Test: `apps/web/src/api/__tests__/workout-status.test.ts`

**Approach:**

View switcher: segmented control / tab bar at top of CalendarTab — Day | Week | Month | Year.
Default on open: Week view.

Data: query `planned_workouts` and `completed_workouts` for the visible date range using
`.select()` with `.gte()`/`.lte()` date filters — **not** `.stream()`. `supabase-dart`
`.stream()` only supports `.eq()` equality filters; date-range filters on `.stream()` are
silently dropped, returning wrong data. Pattern: fetch with `.select()` on mount and on
date-range change; subscribe to a Realtime channel for table change events to trigger
re-fetch (do not rely on `.stream()` for live calendar updates).

Week view (R11): 7-column grid. Each cell shows sport-colored chips for that day.
Planned workouts use a lighter shade; completed workouts use the full sport color.
Sport color map: run=orange, ride=blue, swim=cyan, strength=purple, mobility=green, other=gray.

Day view (R12): scrollable list of workouts for the selected date with full target details
from `planned_workouts.structure` JSONB.

Month view (R13): use `table_calendar` in month mode. Each day cell shows sport-colored
dot badges (up to 3) indicating the mix of workouts. Tap a day to push Day view for that date.

Year view (R14): custom `CustomPainter`. Layout: 52 week columns × 7 day rows (Mon–Sun),
left-to-right oldest-to-newest, matching the GitHub contribution graph convention.
Data model: before calling `paint()`, aggregate `completed_workouts` into a
`Map<DateTime, int>` (day → total `duration_s`). Bucket the max value into 5 tiers
(0 = white, 1–4 = progressively darker brand color). The `CustomPainter` receives only
the pre-aggregated map and the tier thresholds — no DB objects inside `paint()`.
Query: `completed_workouts WHERE athlete_id = uid AND started_at >= 12 months ago`,
fetched once on tab open, not via realtime stream (full-year streaming is excessive).

Mark complete / skip / reschedule (R15): long-press or tap a planned workout chip → bottom
sheet with three actions. Each calls `POST /api/workouts/[id]/status` with the new status
and optional actual data. The API route:
- Auth: `resolveAuth()` + verify `planned_workout.athlete_id = auth.uid()` OR coach write-on-behalf check
- For 'completed': insert `completed_workouts` row and insert `workout_matches` row **inside a
  single DB transaction** (Postgres function or Supabase RPC) — if the workout_matches insert
  fails, the completed_workout must also be rolled back to prevent orphaned rows
- For 'skipped' / 'moved': updates `planned_workouts.status` only (single row, no transaction needed)
- Realtime update propagates to all open subscriptions automatically

Coach assign workout (R16): tapping an empty day slot (in Day or Week view) opens
`AssignWorkoutSheet` with sport picker, duration, and notes. Submits to
`POST /api/coach/workouts` (Unit 10). Requires athlete to be selected via athlete selector.

**Patterns to follow:**
- `supabase-dart` `.in_()` query for batch athlete_id lookups (coach view)

**Test scenarios (providers):**
- Happy path: weekly provider returns planned + completed for current week, merged by date
- Edge case: no workouts in the selected week — returns empty map, no crash
- Edge case: planned and completed on same day same sport — both appear (not deduplicated)
- Coach: with athlete selected, calendar data is queried for that athlete_id

**Test scenarios (year heatmap):**
- Happy path: `YearHeatmapPainter` with 52 weeks of data renders without overflow or crash
- Edge case: empty data (no completed workouts) — all cells render white
- Edge case: single very-high-load day — does not exceed maximum color tier

**Test scenarios (workout status API):**
- Happy path: mark planned workout as 'completed' → creates completed_workout + workout_match → 200
- Happy path: mark as 'skipped' → updates planned_workout.status = 'skipped' → 200
- Error: workout_id not found → 404
- Error: planned_workout.athlete_id != auth.uid() and caller is not a linked coach → 403
- Error: missing Bearer token → 401

**Verification:**
- Week view shows planned (light) and completed (solid) chips per day, correct sport colors
- Tapping a planned workout and marking complete updates the view without full reload
- Year heatmap shows darker cells for days with more training volume

---

- [ ] **Unit 9: Settings tab + Strava OAuth + disconnect endpoint**

**Goal:** Settings screen with theme toggle, units preferences, Strava connect/disconnect,
and role-conditional sections (athlete: linked coach info; coach: roster management).
Strava OAuth for Flutter uses the existing `/init` + `/connect` API endpoints.

**Requirements:** R17, R18, R19, R20, R21, R25

**Dependencies:** Unit 5 (role detection), Unit 4 (auth/session), Unit 2 (coach_athlete_links)

**Files (relative to `daily-athlete/`):**
- Create: `lib/features/settings/settings_tab.dart`
- Create: `lib/features/settings/settings_providers.dart` (theme, units, Strava status)
- Create: `lib/features/settings/theme_notifier.dart` (persists to flutter_secure_storage)
- Create: `lib/features/settings/units_notifier.dart` (persists to flutter_secure_storage)
- Create: `lib/features/settings/strava_connect_section.dart`
- Create: `lib/features/settings/strava_oauth_service.dart` (PKCE + /init + /connect flow)
- Test: `test/features/settings/strava_oauth_service_test.dart`
- Test: `test/features/settings/units_notifier_test.dart`

Next.js API (DA2 monorepo):
- Create: `apps/web/app/api/integrations/strava/disconnect/route.ts`
- Test: `apps/web/src/api/__tests__/strava-disconnect.test.ts`

**Approach:**

Theme (R17): `ThemeNotifier` persists the user's choice (`system` | `light` | `dark`) to
`flutter_secure_storage`. Reads on app launch; overrides `ThemeMode` in `MaterialApp`.

Units (R18): `UnitsNotifier` persists `{ distance: 'km'|'miles', swimDistance: 'm'|'yards', weight: 'kg'|'lbs' }`
to `flutter_secure_storage`. Note: no DB column for units yet — local-only storage in v1.
The "Deferred to Planning" question about a DB column remains open; local storage is the
v1 implementation. Units are applied at render time in activity and calendar widgets.

Strava OAuth (R19): `StravaOAuthService` mirrors `apps/mobile/src/integrations/strava.tsx`:
1. Call `POST /api/integrations/strava/init` (Bearer token) → receives `{ state }` (HMAC-signed nonce)
2. Generate PKCE: generate **32–48 random bytes** → base64url-encode → 43–64 character
   `code_verifier` (RFC 7636 max is 128 chars; 256 random bytes → 344-char base64url string
   that Strava rejects). SHA-256 hash of code_verifier = `code_challenge`.
3. Open Strava authorization URL in **external browser only** via `url_launcher` with
   `LaunchMode.externalApplication`. Strava Terms of Service prohibit OAuth in embedded
   webviews — do **not** use `flutter_inappwebview`. Redirect URI: `da2://strava-oauth`.
   Include `state`, `code_challenge`, `code_challenge_method = S256`.
4. Handle `da2://strava-oauth?code=...&state=...` deep link in `app_links` listener
5. Call `POST /api/integrations/strava/connect` with `{ code, code_verifier, redirect_uri, state }` (Bearer)
6. On 202: Supabase `strava_tokens` row created server-side; show "Connected" UI
7. On 409: already linked — show error

Strava disconnect (R19): `DELETE /api/integrations/strava/disconnect`
- Auth: `resolveAuth()`
- **Soft-delete** the `strava_tokens` row for `auth.uid()` (set `deleted_at = now()`; do not hard-delete — preserves audit trail per AGENTS.md soft-delete convention)
- Call Strava's deauthorize endpoint (`POST https://www.strava.com/oauth/deauthorize`) with the stored access token (server-side only — token never goes to client); if Strava API is unavailable, still soft-delete the local row and log the failure — do not block the user response
- Return 204

Athlete "Your coach" section (R20): query `coach_athlete_links WHERE athlete_user_id = auth.uid() AND status = 'active'` → join `public.users` to get coach display_name. Show "No coach linked" if empty.

Coach roster section (R21): query `coach_athlete_links WHERE coach_user_id = auth.uid() AND status = 'active'` — list linked athletes with name and "Remove" action. Remove: POST to `PATCH /api/coach/links/:id/archive` or call an RPC that soft-deletes the link row.

**Patterns to follow:**
- `apps/mobile/src/integrations/strava.tsx` for the full OAuth PKCE flow
- `apps/web/app/athlete/profile/page.tsx` for the Strava connect/disconnect UX pattern

**Test scenarios (Strava OAuth service):**
- Happy path: init → PKCE generation → deep link received → connect → 202 — service transitions to connected state
- Error: init returns non-200 — OAuth is not started, error shown
- Error: connect returns 409 (already linked) — show "already connected" message
- Error: connect returns 4xx other — show generic error, allow retry
- Edge case: deep link received without a pending PKCE state (stale link) — ignored or error shown

**Test scenarios (disconnect API):**
- Happy path: DELETE with valid auth → strava_tokens row removed + Strava deauthorize called → 204
- Error: no strava_tokens row for user → 404 (not 500)
- Error: missing Bearer token → 401

**Test scenarios (units):**
- Happy path: saving 'miles' persists to storage; reading returns 'miles' after app restart
- Edge case: storage read fails → falls back to default ('km')

**Verification:**
- Tapping "Connect Strava" in Settings opens Strava auth, completes, and shows "Connected"
- Theme toggle persists correctly across app restarts
- Coach sees their linked athletes in Settings with remove option

---

### Phase 5: Backend Additions

- [ ] **Unit 10: Coach write-on-behalf API route + Next.js coach endpoints**

**Goal:** Add the Next.js route handlers that require server-side coach verification:
coach assigns a workout to an athlete (`POST /api/coach/workouts`), and
coach removes an athlete link (`PATCH /api/coach/links/[id]/archive`).

**Requirements:** R16 (coach assigns workouts), R21 (coach removes athlete link)

**Dependencies:** Unit 2 (coach_athlete_links must exist), Unit 7/8 (API routes called by tabs)

**Files (DA2 monorepo):**
- Create: `apps/web/app/api/coach/workouts/route.ts`
- Create: `apps/web/app/api/coach/links/[id]/archive/route.ts`
- Test: `apps/web/src/api/__tests__/coach-workouts.test.ts`
- Test: `apps/web/src/api/__tests__/coach-links.test.ts`

**Approach:**

`POST /api/coach/workouts`:
- Auth: `resolveAuth()` → verify caller has `role_flags` containing `'coach'`
- Body: `{ athlete_id, scheduled_date, sport, structure?, planned_load?, rationale? }`
- Verify caller is linked to athlete: `SELECT 1 FROM coach_athlete_links WHERE coach_user_id = auth.uid() AND athlete_user_id = body.athlete_id AND status = 'active' AND deleted_at IS NULL`
- Insert into `planned_workouts` using service-role client with `edited_by_kind = 'coach'` and `edited_by_user_id = auth.uid()`
- Returns the created row

`PATCH /api/coach/links/[id]/archive`:
- Auth: `resolveAuth()`
- Verify `coach_athlete_links.coach_user_id = auth.uid()` for the given link id
- UPDATE `status = 'archived'`, `deleted_at = now()` — soft-delete
- Return 204

Both routes use the service-role Supabase client for the write (athlete's own RLS INSERT policy
doesn't allow coach writes). Coach identity is verified before any service-role write.

**Patterns to follow:**
- `apps/web/app/api/integrations/strava/connect/route.ts` for service-role + Bearer auth pattern
- `apps/web/src/auth/bearer.ts` `resolveAuth()` for auth extraction

**Test scenarios (coach workouts):**
- Happy path: coach linked to athlete → workout created, returns 201
- Error: caller is not a coach (role_flags = ['athlete']) → 403
- Error: caller is a coach but NOT linked to the target athlete → 403
- Error: invalid `sport` value → 400 (Zod validation)
- Error: missing Bearer token → 401

**Test scenarios (archive link):**
- Happy path: coach archives their own link → 204, row is soft-deleted
- Error: link belongs to a different coach → 403
- Error: link id not found → 404
- Error: missing Bearer token → 401

**Verification:**
- Coach can assign a workout from the Calendar tab; it appears immediately in the athlete's calendar
- Coach can remove an athlete from Settings; athlete's "Your coach" section shows "No coach linked"

---

## System-Wide Impact

- **Realtime subscriptions**: The realtime allowlist tables are `completed_workouts`,
  `planned_workouts`, `plans`, `workout_matches`. `athlete_profiles` and `strava_tokens` must
  NOT be subscribed — poll instead. `coach_athlete_links` is not on the realtime allowlist; fetch on focus.
  **Query strategy distinction**: unbounded feeds (e.g., Activities tab) may use
  `.stream().eq('athlete_id', uid)`; date-range queries (Dashboard week summary, Calendar views)
  must use `.select().gte().lte()` and trigger re-fetch via a separate Realtime channel listener —
  `supabase-dart` `.stream()` silently drops `.gte()`/`.lte()` filters.

- **RLS blast radius**: Unit 2 adds coach SELECT policies on `planned_workouts`,
  `completed_workouts`, and `plans`. Every existing RLS test for these tables must continue
  to pass — negative cases (user A cannot see user B's rows) must still hold even after the
  coach policy is added. Coach policy is additive; it uses EXISTS subquery, not `OR athlete_id = auth.uid()`.

- **Deep-link routing**: `da2://auth/callback` and `da2://strava-oauth` arrive on the same
  `app_links` stream. The single listener in `main.dart` must dispatch by URI path:
  path == `/auth/callback` → `supabase.auth.exchangeCodeForSession(code)`;
  path == `/strava-oauth` → hand `code` and `state` to `StravaOAuthService`. Never use an
  unconditional handler that assumes all incoming deep links are the same type.

- **`delete_user_cascade` function**: Does not exist in migrations 0000–0009 (deferred from prior
  schema units). Migration `0010` must **create** it, covering `coach_athlete_links` soft-delete for
  both `coach_user_id` and `athlete_user_id` sides. If a future account-deletion plan adds more tables,
  that plan's migration will extend the function. AGENTS.md enforces that every new user-data table
  updates this function in the same migration.

- **`packages/shared` type drift**: Dart models in `daily-athlete/lib/models/` must be manually
  kept in sync with TypeScript types in `packages/shared/src/`. The `Sport` enum is the highest
  drift risk — if a new sport is added to the DB CHECK constraint, it must be added to both the
  TypeScript enum and the Dart enum in the same PR.

- **`role_flags` RLS fix**: tightening the UPDATE WITH CHECK on `public.users` is a breaking
  change if any existing code relies on self-updating `role_flags` via the Supabase client.
  Verify the web app never calls `supabase.from('users').update({ role_flags: [...] })` from
  the client side before merging.

- **API surface parity**: the new Next.js routes (`/api/activities/manual`, `/api/workouts/[id]/status`,
  `/api/coach/workouts`, `/api/coach/links/[id]/archive`, `/api/integrations/strava/disconnect`)
  use the same `resolveAuth()` Bearer pattern as `/api/integrations/strava/connect`. Future
  web-app features that need the same operations should call these same routes.

- **Unchanged invariants**: the Strava webhook flow, backfill cron, and existing web auth
  (`/auth/callback`) are not modified by this plan.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `supabase_flutter` `LocalStorage` interface changes between v2 patch releases | Pin to a specific minor version in `pubspec.yaml`; review changelog on any update |
| `da2://` deep-link conflicts with Expo's existing registration on a device that has both installed | Expo app is retired — no conflict in production; test on a clean device/simulator |
| Coach SELECT RLS policies degrade athlete query performance (EXISTS subquery on every row) | Add index on `coach_athlete_links (coach_user_id, athlete_user_id)` in migration `0010`; monitor query times in Supabase dashboard |
| Dart model drift from `packages/shared` TypeScript types | Document the parallel in a comment at the top of each Dart model file referencing the TS counterpart |
| `flutter_secure_storage` Android Full Backup issue (keys backed up to Google account, causing session cross-device leakage) | In `android/app/src/main/AndroidManifest.xml`, set `android:fullBackupContent="@xml/backup_rules"` and create `res/xml/backup_rules.xml` excluding the SharedPreferences file used by `flutter_secure_storage` (typically `FlutterSecureStorage`) from backup |
| Year view `CustomPainter` performance on 12 months of data | Aggregate daily sums before passing to painter; avoid per-row computation inside `paint()` |
| Strava deauthorize call in disconnect endpoint fails (Strava API down) | Delete the local `strava_tokens` row regardless; log the deauthorize failure; do not block the user response |

## Documentation / Operational Notes

- Production Supabase dashboard action required (not in code): add `https://da2-one.vercel.app/auth/callback` and `da2://auth/callback` to project Redirect URLs.
- Flutter build requires `--dart-define` flags for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_BASE_URL` — document in `daily-athlete/.env.local.example`.
- `daily-athlete/` is a separate git repo from the DA2 monorepo. PRs for Flutter code go to that repo; PRs for schema/API changes go to the DA2 monorepo. Unit 2 and Unit 10 are DA2 monorepo PRs.
- The `Sport` enum is a shared contract between the DB CHECK constraint, `packages/shared` TypeScript, and `daily-athlete` Dart — any addition requires a coordinated multi-repo PR.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-17-flutter-app-core-navigation-requirements.md](docs/brainstorms/2026-05-17-flutter-app-core-navigation-requirements.md)
- Strava mobile OAuth pattern: [docs/solutions/strava-oauth.md](docs/solutions/strava-oauth.md)
- Partial unique index pattern: [docs/solutions/partial-unique-with-soft-delete.md](docs/solutions/partial-unique-with-soft-delete.md)
- Migration conventions: [docs/solutions/migration-conventions.md](docs/solutions/migration-conventions.md)
- Expo Strava OAuth (source to port): `apps/mobile/src/integrations/strava.tsx`
- Bearer auth helper: `apps/web/src/auth/bearer.ts`
- Shared types to mirror in Dart: `packages/shared/src/`
- Realtime allowlist: `packages/shared/src/realtime-allowlist.ts`
