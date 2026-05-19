---
title: "feat: Flutter iOS App Store release — TestFlight beta to public launch"
type: feat
status: active
date: 2026-05-19
---

# feat: Flutter iOS App Store release — TestFlight beta to public launch

## Overview

The Flutter app at `daily-athlete/` is feature-complete per the completed plan
`docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md` — auth, role-aware
shell, all 4 tabs (Dashboard, Activities, Calendar, Settings), Strava OAuth, and
the supporting Next.js routes are all in place. This plan covers everything from
that finished codebase to a public App Store listing: production environment
configuration, Apple Developer / App Store Connect setup, iOS Privacy Manifest
and App Privacy disclosures, a TestFlight beta cycle, and final public submission.

The Next.js web app at `apps/web/` continues to exist side-by-side — this release
adds an iOS app as a second distribution channel; it does not replace the web.

## Problem Frame

The Flutter app has not been signed, archived, or distributed. To reach users
from the App Store we must:

1. Wire production environment values (Supabase production project, production
   API base URL) into the Flutter build without hard-coding them.
2. Satisfy iOS-specific release requirements that have no counterpart in web
   distribution: Privacy Manifest (`PrivacyInfo.xcprivacy`), App Privacy
   disclosures in App Store Connect, code signing, App Review.
3. Stage rollout through TestFlight internal testing to catch device-only bugs
   (deep links, real Strava OAuth on production, push from production Supabase)
   before exposing the public.
4. Submit, get approved, and publish.

The user holds an Apple Developer Account ("ADA credentials"). No Google Play
Console account is in scope — Android distribution is deferred to a follow-up
plan.

## Requirements Trace

Requirements derived from the user's request plus clarifications captured in the
planning conversation (no `ce:brainstorm` document — direct request: convert
web app into a side-by-side mobile app distributable from the App Store, using
Flutter, ADA credentials in hand).

- R1. The Flutter app builds for iOS Release configuration using **production**
  Supabase URL/anon key and **production** Next.js API base URL, supplied via
  `--dart-define` (no committed secrets).
- R2. iOS bundle identifier, display name, version, and build number are set
  consistently across `Info.plist` and the Xcode project.
- R3. The finalized app icon replaces any Flutter template icon in the iOS
  asset catalog. Launch screen renders without referencing missing assets.
- R4. An iOS Privacy Manifest (`PrivacyInfo.xcprivacy`) is present at the
  Runner target root, declaring tracking domains (none), tracking status
  (NO), collected data types, and Required Reasons API entries that apply to
  Flutter + listed dependencies.
- R5. App Privacy disclosures in App Store Connect match the manifest and the
  hosted privacy policy at `https://da2-one.vercel.app/privacy`.
- R6. The Supabase **production** project's Allowed Redirect URLs include
  `da2://auth/callback`; production Strava Developer Console redirect URI list
  includes `da2://strava-oauth`. Without these, auth and Strava OAuth fail on
  TestFlight/Production builds while working in dev.
- R7. App ID `com.da2.dailyAthlete` is registered in the Apple Developer portal
  with the capabilities the app actually uses (Associated Domains only if iOS
  Universal Links are added later — currently not required).
- R8. A Distribution certificate + App Store provisioning profile exists for
  the App ID; Xcode automatic signing succeeds for Release archive builds.
- R9. The app record exists in App Store Connect with: name "Daily Athlete",
  bundle ID `com.da2.dailyAthlete`, primary language, category, age rating
  questionnaire completed, and a hosted privacy policy URL.
- R10. A signed Release archive is uploaded to TestFlight and passes Apple's
  automated review for beta distribution.
- R11. Internal testers (≤100 Apple IDs the user controls or invites) can
  install via TestFlight and complete the core flows on real devices:
  sign-in via magic link, view activities, connect Strava, mark a planned
  workout complete.
- R12. App Store Connect listing has: subtitle, description (≤4000 chars),
  promotional text, keywords, support URL, marketing URL (optional), and
  screenshots at the iPhone size(s) Apple currently requires for new
  submissions (verify at submission time — Apple updates this list).
- R13. The app is submitted to App Review with a working demo account and
  passes review.
- R14. After approval, public release uses **Phased Release for automatic
  updates** so issues caught post-launch can be paused before reaching
  100% of users.

## Scope Boundaries

- **iOS only.** No Google Play Store work in this plan.
- **No new app features.** No tabs, screens, or API endpoints are added or
  changed. If a release-blocking bug is found during TestFlight, that fix is
  a separate, narrowly-scoped change — not part of this plan's units.
- **No CI/CD for app distribution.** Manual `flutter build ipa` + Xcode upload
  is acceptable for v1. Fastlane, Xcode Cloud, or GitHub Actions for iOS are
  deferred to a follow-up plan once the manual cycle is proven.
- **No HealthKit, push notifications, or Sign in with Apple.** The app uses
  email magic-link auth only (no third-party OAuth providers), so Sign in
  with Apple is not Apple-mandated. HealthKit and push notifications are
  out of scope; if added later they will require additional capabilities,
  usage descriptions, and privacy disclosures.
- **No new Supabase project.** Use the existing production Supabase project
  that the web app already uses. Do not create a separate mobile-only project.
- **No iPad-specific UI work.** App will install on iPad if the App Store
  listing allows iPad, but UI optimizations for iPad are not in scope. Decide
  at submission whether to allow iPad install — recommendation: iPhone-only
  for v1 to avoid review feedback on iPad layout.
- **No marketing site / launch announcement.** Outside engineering scope.

## Context & Research

### Relevant Code and Patterns

- Flutter app entry & env loading: `daily-athlete/lib/main.dart`,
  `daily-athlete/lib/core/env.dart` — reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `API_BASE_URL` from `--dart-define` at compile time. No `.env` file at
  runtime; values are baked into the binary.
- Env documentation: `daily-athlete/.env.local.example` already documents the
  three required `--dart-define` keys with production URL examples.
- iOS configuration:
  - `daily-athlete/ios/Runner/Info.plist` — has `CFBundleDisplayName = "Daily Athlete"`,
    URL scheme `da2` registered, portrait + landscape orientations declared.
  - `daily-athlete/ios/Runner.xcodeproj/project.pbxproj` —
    `PRODUCT_BUNDLE_IDENTIFIER = com.da2.dailyAthlete` (Runner) and
    `com.da2.dailyAthlete.RunnerTests` (test target).
  - `daily-athlete/ios/Runner/Assets.xcassets/AppIcon.appiconset/` — has all
    required icon sizes (1024 down through 20x20), but the 1024 icon is
    ~10KB suggesting these may still be the Flutter template defaults.
    Replace with the finalized design.
- Android configuration: `daily-athlete/android/app/src/main/AndroidManifest.xml`
  — `applicationName="Daily Athlete"`, `da2://` intent filter. Out of scope
  for this plan but listed for completeness.
- Strava brand compliance: `daily-athlete/lib/features/settings/strava_connect_section.dart`
  already renders the required "Powered by Strava" mark when the connection
  state is `Connected to Strava`. No additional Strava branding work needed.
- Hosted privacy policy: `apps/web/app/privacy/page.tsx` renders at
  `https://da2-one.vercel.app/privacy` (production Vercel deployment).
  **Caveat:** the current policy mentions Firebase, which the app does not use.
  Review and align with the actual data flow (Supabase + Strava + Vercel)
  before submitting App Privacy disclosures — mismatch is grounds for App
  Review rejection.
- Local Supabase redirect allowlist: `supabase/config.toml`
  → `additional_redirect_urls = ["http://localhost:3000/auth/callback", "http://localhost:3000", "exp://localhost:8081", "da2://"]`.
  Production Supabase project Redirect URLs are configured in the **Supabase
  dashboard** for the production project, not `config.toml`. This must be
  verified before TestFlight.
- AGENTS.md repo-layout section still describes `apps/mobile/` as the
  primary mobile app. The Flutter app lives at `daily-athlete/`. This
  documentation drift is noted as out-of-scope housekeeping for this plan
  but tracked under "Documentation / Operational Notes."

### Institutional Learnings

- `docs/solutions/strava-oauth.md` documents the Strava OAuth shape — confirm
  that the production Strava OAuth app's "Authorization Callback Domain" /
  redirect URI list includes `da2://strava-oauth` before TestFlight. The web
  app uses a different redirect URI (`https://da2-one.vercel.app/...`), so
  the Strava app must list **both**.
- `da2://` custom URL scheme: established by the prior Flutter plan; PKCE
  is the load-bearing security on this scheme. Don't switch to Universal
  Links without revisiting that decision.
- AGENTS.md secrets rule: production Supabase anon key and any production
  API tokens never live in the repo. They live in `--dart-define` values
  supplied at build time, sourced from secure storage (1Password, GitHub
  Actions secrets, Vercel env, etc.).

### External References

Resolve at implementation time against Apple's current developer documentation
(requirements shift):

- iOS Privacy Manifest reference (Apple Developer documentation, "Describing
  data use in privacy manifests" and "Describing use of required reason API")
  — list of Required Reason API categories, accepted reason codes, and the
  manifest XML schema.
- App Store screenshot specifications (App Store Connect Help, "Screenshot
  specifications") — current required iPhone sizes for new submissions.
  As of the 2024–2025 changes, only one iPhone screenshot set (6.9" or 6.7")
  is required; older sizes are derived. Verify before screenshot capture.
- App Privacy disclosure framework (App Store Connect Help, "App Privacy
  details") — questionnaire structure for declaring data collection.
- Sign in with Apple requirement (Apple Human Interface Guidelines / App
  Review guideline 4.8) — required only if the app offers any third-party
  social login. Magic-link only does not trigger this.

### Related Solutions & Prior Plans

- Origin Flutter plan: `docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md`
  (status: completed) — established `da2://` scheme, bundle ID, and the
  `--dart-define` env strategy this plan builds on.
- Strava OAuth pattern: `docs/solutions/strava-oauth.md`.

## Key Technical Decisions

- **Manual release for v1; CI/CD deferred.** Use Xcode's "Product → Archive"
  + "Distribute App → App Store Connect → Upload" for TestFlight uploads.
  Avoid investing in fastlane/Xcode Cloud until the manual cycle is proven
  end-to-end. **Rationale:** unknown unknowns (signing, entitlements,
  Required Reasons API quirks) are easier to debug interactively in Xcode
  than through CI logs; automation can be added once the happy path works
  twice.

- **Xcode automatic signing with the user's Apple Developer team.** Manual
  certificate management adds complexity for one developer. Automatic
  signing in Xcode will create + maintain the Distribution certificate and
  App Store provisioning profile.

- **Environment values supplied via `--dart-define`, sourced from a local
  `.env.production` file (gitignored) at build time.** No production
  secrets in the repo. The `daily-athlete/.env.local.example` file already
  documents the schema. **Rationale:** AGENTS.md secrets rule + Apple's
  build process accepts compile-time defines cleanly.

- **Privacy Manifest authored manually, not generated.** Flutter's
  pub.dev plugins each ship their own `PrivacyInfo.xcprivacy` since 2024,
  which Xcode aggregates. The Runner target also needs its own manifest
  declaring the **app-level** tracking domains, tracking status, and
  collected data types. Author this by hand referencing Apple's schema;
  do not rely on `flutter_privacy_manifest` generators (immature, varied
  quality).

- **App Privacy disclosures: "Data Not Linked to You" is wrong — declare
  "Data Linked to You" for email and workout content.** The app stores
  email (Supabase auth) and workout data tied to the user's account.
  Marking this as Not Linked would be inaccurate and grounds for
  rejection. Tracking: NO (we do not track users across other companies'
  apps or websites). Diagnostic data: NO (no crash reporter in v1; if
  Sentry is added later, declare it).

- **TestFlight: internal testing only for v1.** Internal testers (Apple IDs
  invited to the team) skip external beta review and can install within
  minutes of upload. External testing (≤10k beta testers) requires Apple
  beta review per build. **Rationale:** smallest viable feedback loop for
  v1; promote to external testing only if internal coverage is insufficient.

- **Phased Release enabled at submission.** App Store Connect's "Phased
  Release for Automatic Updates" ramps to 100% over 7 days. If a critical
  bug surfaces in the first day, the rollout can be paused at <14% of
  eligible users, dramatically reducing blast radius.

- **iPhone-only listing for v1.** Even though Flutter builds a universal
  binary, App Store Connect lets the listing target iPhone only. iPad
  layouts have not been validated; opting into iPad in the listing
  invites layout-related review feedback.

- **Privacy policy URL: `https://da2-one.vercel.app/privacy`** (existing).
  Before submission, review for accuracy — current copy mentions Firebase,
  which the app does not use. A short editing pass to align with actual
  data flow (Supabase, Strava, Vercel) is part of Unit 4.

## Open Questions

### Resolved During Planning

- **Platform scope:** iOS only. (User selection.)
- **Release posture:** Internal TestFlight → Public App Store. (User selection.)
- **Apple Developer Account:** held by the user. (User-confirmed: "ada credentials".)
- **App icon:** finalized design ready. (User-confirmed; will replace
  Flutter template icons in Unit 2.)
- **Privacy policy:** hosted at `https://da2-one.vercel.app/privacy`.
  (User-confirmed; review-and-align step in Unit 4.)
- **Marketing copy + App Store screenshots:** **not yet drafted** —
  Units 11 and 12 explicitly cover this work.

### Deferred to Implementation

- **Exact Supabase production project URL and anon key.** Retrieve from
  Vercel project environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`
  in the production Vercel environment) at build time. Do not commit them.
- **Whether the production Supabase project's Allowed Redirect URLs
  currently include `da2://auth/callback`.** Verify in the Supabase
  dashboard before the first TestFlight build; add if missing. (Unit 1.)
- **Whether the production Strava OAuth app's redirect URIs include
  `da2://strava-oauth`.** Verify in the Strava Developer Console
  (`https://www.strava.com/settings/api`) before the first TestFlight
  build; add if missing. (Unit 1.)
- **Exact age rating responses for App Store Connect.** Sport/health
  app with no user-generated content sharing externally — likely 4+,
  but the questionnaire is authoritative.
- **Demo account credentials for App Review.** Decide at submission
  time: create a fresh `appreview+da2@…` account with seeded
  workouts + a connected Strava account using a test Strava user.
- **App Store category.** Likely "Health & Fitness"; verify there isn't
  a better fit (e.g., Sports) by browsing comparable apps.
- **Whether to include any sub-categories or game center / iMessage
  capabilities.** Probably no, but final at the App Store Connect step.
- **Whether to apply Apple's data-handling exemptions to App Privacy
  disclosures (e.g., "data collected only for app functionality").**
  Evaluate per data type during the App Store Connect questionnaire.

## High-Level Technical Design

> *This illustrates the intended release pipeline and is directional guidance
> for review, not implementation specification. The implementing operator
> should treat it as context, not commands to copy verbatim.*

```
Release Pipeline (one-time setup, then repeatable per version)

┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 1: Build-Time Configuration                                      │
│                                                                         │
│  daily-athlete/.env.production (gitignored, local)                      │
│       │                                                                 │
│       │  SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL                   │
│       ↓                                                                 │
│  flutter build ipa --release --dart-define-from-file=.env.production    │
│       │                                                                 │
│       │  iOS Release binary, baked with production env values           │
│       ↓                                                                 │
│  build/ios/ipa/daily_athlete.ipa                                        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 2: External Service Configuration (one-time)                     │
│                                                                         │
│  Apple Developer Portal     App Store Connect    Supabase Production    │
│  ────────────────────       ──────────────────   ────────────────────   │
│  • Register App ID          • Create app record   • Add da2://auth/     │
│    com.da2.dailyAthlete       (bundle, name,         callback to        │
│  • Distribution cert          category, age          Allowed Redirect   │
│  • App Store provisioning     rating, privacy        URLs               │
│    profile                    policy URL)                               │
│                             • App Privacy        Strava Developer Console│
│  Xcode signing              questionnaire         ──────────────────────│
│  ─────────────────          • Pricing & avail-    • Add da2://strava-   │
│  • Sign in with Apple ID    .  ability             oauth to Authorization│
│    in team                                          Callback Domain     │
│  • Automatic signing                                                    │
│    enabled                                                              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 3: TestFlight Beta                                               │
│                                                                         │
│  Xcode "Archive" → "Distribute App" → "App Store Connect" → "Upload"    │
│       │                                                                 │
│       │  Build uploaded; Apple processing (~10–30 min)                  │
│       ↓                                                                 │
│  App Store Connect → TestFlight → New Build available                   │
│       │                                                                 │
│       │  Add internal testers (≤100 Apple IDs)                          │
│       │  Internal testers receive email → install via TestFlight        │
│       ↓                                                                 │
│  Internal QA on real devices: sign-in, Strava OAuth, calendar, log      │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 4: Public App Store Submission                                   │
│                                                                         │
│  App Store Connect:                                                     │
│  • Promote a TestFlight build to "App Store"                            │
│  • Fill listing: description, keywords, screenshots, support URL        │
│  • Submit for review                                                    │
│       │                                                                 │
│       │  Apple App Review (typical: 24–48h in 2026; spikes around       │
│       │  WWDC and holidays)                                             │
│       ↓                                                                 │
│  Approved → Release with Phased Release (7-day ramp)                    │
│       │                                                                 │
│       │  Monitor crash reports / user feedback per day                  │
│       │  Pause rollout if needed                                        │
│       ↓                                                                 │
│  100% of eligible users on Day 7                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Units

### Phase 1: Production Build Configuration

- [ ] **Unit 1: Production environment values + external redirect URL verification**

**Goal:** Capture production env values for a Release build in a gitignored
local file; verify (and add if missing) `da2://auth/callback` in the
production Supabase project's Allowed Redirect URLs and `da2://strava-oauth`
in the production Strava OAuth app's Authorization Callback Domain. Without
these external configurations, magic-link sign-in and Strava OAuth fail
silently on the device while working fine in dev.

**Requirements:** R1, R6

**Dependencies:** None

**Files:**
- Create: `daily-athlete/.env.production` (LOCAL ONLY — must be gitignored;
  contains `SUPABASE_URL=…`, `SUPABASE_ANON_KEY=…`, `API_BASE_URL=…`)
- Modify: `daily-athlete/.gitignore` — ensure `.env.production` (and
  `.env.local`) are listed; add if missing
- Modify: `daily-athlete/README.md` — add a "Production build" section
  pointing to `.env.local.example` and the required `--dart-define-from-file`
  invocation

**Approach:**
- Retrieve `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the production Vercel
  project environment variables (Vercel dashboard → da2-one project →
  Settings → Environment Variables → Production). These are the values the
  web app uses; the Flutter app shares the same Supabase project.
- `API_BASE_URL = https://da2-one.vercel.app` (production Next.js).
- Verify `.env.production` is NOT staged for commit before any commit:
  the file should be gitignored.
- In the Supabase production dashboard → Authentication → URL Configuration
  → Redirect URLs: confirm `da2://auth/callback` is listed. Add if not.
  (Note: `supabase/config.toml` controls **local** Supabase only — the
  production project is configured exclusively through the dashboard.)
- In the Strava Developer Console (`https://www.strava.com/settings/api`)
  for the DA2 OAuth application: confirm the "Authorization Callback
  Domain" supports `da2://strava-oauth`. Strava's UI accepts a domain
  string; for custom schemes, register the scheme host portion as
  documented in Strava's app settings. If unclear, consult
  `docs/solutions/strava-oauth.md` for the exact configuration the web
  app uses, and add the mobile redirect alongside.

**Patterns to follow:**
- `daily-athlete/.env.local.example` — schema for the three required keys

**Test scenarios:**
- Test expectation: none — operational/checklist unit. Verification:
  - `flutter build ipa --release --dart-define-from-file=daily-athlete/.env.production`
    succeeds without missing-define errors.
  - After Supabase dashboard update: magic-link email tap on iOS
    Simulator launches the app and lands on `/dashboard`. (Tested
    end-to-end in Unit 8 with a TestFlight build.)
  - After Strava console update: tapping "Connect Strava" in a Release
    build completes the OAuth flow without a redirect_uri mismatch error.

**Verification:**
- `git ls-files | grep .env.production` returns empty (file is not tracked).
- The three `--dart-define` keys are present and non-empty in
  `.env.production` (manual visual check).
- Supabase production redirect URL list and Strava console redirect URI
  list both contain the required `da2://...` entries (verified via the
  respective dashboards).

---

- [ ] **Unit 2: App identity finalization — icon, version, display name, launch screen**

**Goal:** Replace any Flutter template icon assets with the user's
finalized design, set a version + build number scheme, confirm the
display name, and ensure the launch screen renders cleanly without
referencing missing assets.

**Requirements:** R2, R3

**Dependencies:** Unit 1 (no — Unit 2 can run in parallel)

**Files:**
- Modify: `daily-athlete/ios/Runner/Assets.xcassets/AppIcon.appiconset/`
  — replace all icon PNG files at the existing slots (1024, 76, 60, 40,
  29, 20 at @1x/@2x/@3x where applicable) with the finalized design at
  each required pixel size. `Contents.json` should already reference
  every slot — verify no slot is left empty (a missing 1024 icon is the
  most common App Store rejection reason in this area).
- Modify: `daily-athlete/pubspec.yaml` — set `version: 1.0.0+1` (semantic
  version + build number). Confirm or set this explicitly; do not leave
  the template value if it is unchanged.
- Verify: `daily-athlete/ios/Runner/Info.plist` — `CFBundleDisplayName`
  is "Daily Athlete" (already correct).
- Verify: `daily-athlete/ios/Runner/Base.lproj/LaunchScreen.storyboard`
  — opens cleanly in Xcode and references only existing image set names.

**Approach:**
- Generate all required icon sizes from the 1024×1024 master. Either use
  Xcode's "AppIcon" set to drag a 1024 into the "All" well (Xcode 14+
  auto-generates the other sizes), or use a tool like `flutter_launcher_icons`
  package. The simpler path is the Xcode native one — no new dev dependency.
- Build number convention: increment the integer after the `+` in
  `pubspec.yaml` for every TestFlight upload. iOS requires each
  uploaded build to have a higher build number than the previous; reusing
  a number is rejected.
- Version number convention: `MAJOR.MINOR.PATCH`. Stay on `1.0.0` until
  public release; increment to `1.0.1` only for hotfixes. Use `1.1.0` for
  the next feature drop after launch.

**Patterns to follow:**
- `daily-athlete/ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json`
  — existing slot mapping
- App Store Human Interface Guidelines: app icons should not contain text
  small enough to be illegible at 60pt, avoid transparency, do not use
  Apple's product photography

**Test scenarios:**
- Test expectation: none — asset replacement and config edit. Verification:
  - `flutter build ipa --release ...` produces an `.ipa` whose icon, when
    installed via TestFlight, matches the finalized design at all sizes
    (Settings list, home screen, App Switcher, Spotlight).
  - Build number monotonically increases across TestFlight uploads;
    Apple's upload step rejects duplicate build numbers.

**Verification:**
- Icon shows correctly on a real device installed via TestFlight (Unit 8
  is the first opportunity to verify).
- `Info.plist` opens in Xcode without warnings about missing storyboard
  references.

---

### Phase 2: iOS Privacy & Compliance Foundations

- [ ] **Unit 3: iOS Privacy Manifest authored at the Runner target**

**Goal:** Author `PrivacyInfo.xcprivacy` declaring (a) the app does not
track users, (b) the data types the app collects, and (c) Required Reasons
API entries for any privacy-impacting APIs used by Flutter and the runtime
dependencies. Apple has rejected submissions missing or incorrect Privacy
Manifests since May 2024; this is a hard gate.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Create: `daily-athlete/ios/Runner/PrivacyInfo.xcprivacy` — XML plist
  per Apple's Privacy Manifest schema
- Verify: `daily-athlete/ios/Runner.xcodeproj/project.pbxproj` — the new
  `PrivacyInfo.xcprivacy` is added to the Runner target's "Copy Bundle
  Resources" build phase (Xcode handles this automatically when the file
  is added via "Add Files to Runner…" with the Runner target checked,
  but verify after editing).

**Approach:**

The manifest is a plist with four top-level keys (verify the exact key
names against Apple's current documentation — schema versions evolve):

- `NSPrivacyTracking`: `false`. The app does not link user data with
  third-party data for targeted advertising or measurement.
- `NSPrivacyTrackingDomains`: empty array. No domains used for tracking.
- `NSPrivacyCollectedDataTypes`: array of dictionaries, one per data
  type collected. For DA2, declare at minimum:
  - **Email address** — linked to user, not used for tracking. Purpose:
    Account management, App functionality (Supabase magic-link auth).
  - **Other user contact info** (display name) — linked, not tracking,
    purpose: App functionality.
  - **Health & Fitness** (workout data: distance, duration, HR, calories,
    pace) — linked, not tracking, purpose: App functionality
    (core feature).
  - **Coarse Location** if `summary_stats.map_polyline` or any GPS-based
    field is rendered (it is — see `lib/features/activities/activity_detail_screen.dart`).
    Verify whether the data is collected by the app or only displayed
    from Strava-synced records; if displayed only and not stored or
    transmitted by the app independently, the declaration may still
    apply because the data lives in the app's backend.
  - **User ID** (Supabase auth uid) — linked, not tracking, purpose:
    App functionality.
- `NSPrivacyAccessedAPITypes`: array of dictionaries for each Required
  Reasons API used by the app. Audit these categories against the app's
  actual usage:
  - `NSPrivacyAccessedAPICategoryFileTimestamp` — likely used by Dart
    runtime / file I/O. Declare with the appropriate reason code
    (`C617.1` "Inside app or group container" is typical).
  - `NSPrivacyAccessedAPICategoryUserDefaults` — used by
    `flutter_secure_storage` or Flutter's plugin machinery. Declare
    reason `CA92.1` (read/write own app defaults).
  - `NSPrivacyAccessedAPICategorySystemBootTime` — verify whether any
    dependency uses it; declare `35F9.1` if so.
  - `NSPrivacyAccessedAPICategoryDiskSpace` — verify; declare `E174.1` if so.
- Cross-check: each pub.dev dependency in `daily-athlete/pubspec.yaml`
  ships its own `PrivacyInfo.xcprivacy` since 2024
  (`supabase_flutter`, `flutter_secure_storage`, `app_links`, etc.).
  The Runner target's manifest only declares **app-level** data and APIs
  — Xcode aggregates the plugin manifests automatically.

**Patterns to follow:**
- Apple Developer documentation: "Describing data use in privacy
  manifests", "Describing use of required reason API"
- Inspect existing `PrivacyInfo.xcprivacy` files in
  `daily-athlete/ios/Pods/` after `pod install` to see what plugin
  authors declared — useful reference for app-level declarations

**Test scenarios:**
- Test expectation: none — declarative XML file. Verification is
  Apple's automated review:
  - `flutter build ipa --release ...` includes the manifest in the bundle.
  - Apple's upload validator (run automatically by Xcode "Distribute App"
    or `xcrun altool`) does not raise a missing-manifest or
    missing-reason warning. Specifically: an upload with no manifest
    triggers ITMS-91056 (or successor); an upload with a manifest
    declaring an unused tracking domain triggers a different warning.
  - Apple App Review does not reject for "Guideline 5.1.2 — Legal —
    Privacy — Data Use and Sharing" related to manifest content.

**Verification:**
- The manifest validates as a well-formed plist (`plutil -lint
  daily-athlete/ios/Runner/PrivacyInfo.xcprivacy` exits 0).
- Xcode build does not emit `PrivacyManifest` warnings.
- An upload to App Store Connect completes without ITMS warnings
  about missing reason declarations.

---

- [ ] **Unit 4: Privacy policy alignment + App Privacy disclosures preparation**

**Goal:** Update the hosted privacy policy at `apps/web/app/privacy/page.tsx`
to accurately reflect the actual data stack (Supabase, Strava, Vercel — no
Firebase), and prepare the answers to App Store Connect's App Privacy
questionnaire so the disclosures match both the policy and the Privacy
Manifest from Unit 3.

**Requirements:** R5

**Dependencies:** Unit 3 (manifest claims must match the policy and the
App Privacy questionnaire — author them in sync)

**Files:**
- Modify: `apps/web/app/privacy/page.tsx` — replace any inaccurate
  third-party references (e.g., Firebase) with the actual services in
  use: Supabase (auth + database), Strava (third-party integration when
  the user connects), Vercel (hosting). Add a clear data-types section
  matching what App Privacy will declare.
- Create: `docs/operational/app-store-app-privacy-answers.md` — a
  short reference document recording the answers to App Store Connect's
  App Privacy questionnaire (data types collected, linkage, tracking,
  purposes). This is internal documentation, not user-facing — keeps
  Unit 7 reproducible if the App Store Connect record ever needs
  rebuilding.

**Approach:**
- Read the current privacy policy at `apps/web/app/privacy/page.tsx` and
  identify each third-party mention. Confirm against the actual stack:
  - **Supabase** — yes, used for auth (email) and database
  - **Strava** — yes, OAuth + activity sync (when user connects)
  - **Vercel** — yes, Next.js hosting
  - **Firebase** — NO (not used anywhere in the codebase per
    `pubspec.yaml` and `package.json` audit)
- Remove Firebase mentions; ensure each retained third party has its
  privacy policy linked.
- Add or confirm a "What data we collect" section that mirrors the
  data types declared in `PrivacyInfo.xcprivacy` and the App Privacy
  questionnaire (Unit 7). A mismatch among the three is the highest-risk
  rejection trigger in this phase.
- The internal answers doc records: for each data type, is it Linked /
  Not Linked / Not Collected? Used for Tracking? Purpose (App
  Functionality / Analytics / etc.).

**Patterns to follow:**
- `apps/web/app/privacy/page.tsx` existing structure
- Apple App Privacy Details ("Nutrition Labels") category list

**Test scenarios:**
- Test expectation: none — content edit. Verification is review-time
  (Unit 7) when the App Privacy questionnaire is filled out.

**Verification:**
- Privacy policy renders at `https://da2-one.vercel.app/privacy` after
  the next Vercel deployment.
- The data-types section of the privacy policy matches the entries in
  `daily-athlete/ios/Runner/PrivacyInfo.xcprivacy` and
  `docs/operational/app-store-app-privacy-answers.md`.

---

### Phase 3: Apple Developer Portal & App Store Connect Setup

- [ ] **Unit 5: Apple Developer App ID registration**

**Goal:** Ensure `com.da2.dailyAthlete` is registered as an explicit
App ID in the Apple Developer portal with the capabilities the app
actually uses, so Xcode automatic signing can produce a valid
Distribution provisioning profile.

**Requirements:** R7

**Dependencies:** Apple Developer Account active and paid up (held by the user)

**Files:**
- None in repo. All work is in the Apple Developer portal
  (`https://developer.apple.com/account`).

**Approach:**
- Sign into Apple Developer → Certificates, Identifiers & Profiles →
  Identifiers.
- If `com.da2.dailyAthlete` does not exist as an App ID: create it as
  an **explicit** App ID (not wildcard). Capabilities to enable:
  - **None required for v1.** The app does not use Push Notifications,
    HealthKit, Sign in with Apple, In-App Purchase, Associated Domains,
    or any other capability that requires explicit App ID configuration.
  - **Do not enable capabilities the app does not use** — extra
    entitlements complicate code signing and can cause App Review
    rejections (Guideline 2.5.1).
- The `da2://` URL scheme does NOT require any App ID capability — it
  is declared only in `Info.plist`.

**Patterns to follow:**
- Apple Developer Portal documentation

**Test scenarios:**
- Test expectation: none — portal action. Verification:
  - Xcode automatic signing in Unit 6 successfully creates a Distribution
    provisioning profile for `com.da2.dailyAthlete` without manual
    intervention.

**Verification:**
- App ID `com.da2.dailyAthlete` visible in Apple Developer → Identifiers
  list.
- No capabilities enabled beyond the defaults (Game Center / In-App
  Purchase do come default-enabled and are harmless).

---

- [ ] **Unit 6: Xcode automatic signing — Distribution certificate + provisioning profile**

**Goal:** Configure Xcode automatic signing using the user's Apple
Developer team so that a Release archive build produces a properly
signed `.ipa` ready for App Store Connect upload.

**Requirements:** R8

**Dependencies:** Unit 5 (App ID must exist)

**Files:**
- Modify (via Xcode UI; not direct text edit): the Runner target's
  "Signing & Capabilities" tab in
  `daily-athlete/ios/Runner.xcworkspace`. Open in Xcode, select the
  Runner target → Signing & Capabilities → check "Automatically manage
  signing" → select the user's Apple Developer Team from the dropdown.
- Verify: `daily-athlete/ios/Runner.xcodeproj/project.pbxproj` is
  updated (Xcode rewrites it). Do not hand-edit this file; commit the
  changes Xcode produces.

**Approach:**
- Open `daily-athlete/ios/Runner.xcworkspace` in Xcode (note: the
  workspace, not the project — Flutter's CocoaPods integration uses
  the workspace).
- Sign Xcode into the user's Apple ID (Xcode → Settings → Accounts →
  +Apple ID). Add the Apple ID that holds the developer membership.
- In Runner target → Signing & Capabilities:
  - Toggle "Automatically manage signing" ON for both Debug and Release
    configurations.
  - Select the user's Team in the Team dropdown.
  - Confirm "Provisioning Profile" shows "Xcode Managed Profile" (not
    an error like "No provisioning profile found").
- Trigger a Release archive in Xcode: Product → Scheme → Edit Scheme →
  Run / Archive set to "Release". Then Product → Archive.
- Xcode will request access to the Keychain to create or use a
  Distribution certificate. Allow.

**Patterns to follow:**
- Apple Developer documentation: "Xcode signing and provisioning"
- This is a one-time setup; subsequent archive builds reuse the
  certificate and profile Xcode created.

**Test scenarios:**
- Test expectation: none — operator action in Xcode. Verification:
  - `Product → Archive` completes without a signing error.
  - The resulting archive shows in `Window → Organizer → Archives`
    with status "Ready to Distribute".

**Verification:**
- A Release archive is produced and visible in Xcode's Organizer.
- Apple Developer → Profiles shows an "iOS App Store" provisioning
  profile bound to `com.da2.dailyAthlete`, Xcode-managed.

---

- [ ] **Unit 7: App Store Connect app record + App Privacy + age rating**

**Goal:** Create the app record in App Store Connect with all metadata
required to upload a build to TestFlight and to eventually submit to
App Review.

**Requirements:** R9, plus the App Privacy disclosure portion of R5

**Dependencies:** Unit 5 (App ID), Unit 4 (App Privacy answers prepared)

**Files:**
- None in repo. All work in App Store Connect
  (`https://appstoreconnect.apple.com`).
- Reference: `docs/operational/app-store-app-privacy-answers.md` from Unit 4.

**Approach:**

App Store Connect → My Apps → "+" → New App. Fill out:

- **Platform:** iOS
- **Name:** Daily Athlete (≤30 chars displayed in App Store; matches
  `CFBundleDisplayName`)
- **Primary language:** English (U.S.) unless other primary intended
- **Bundle ID:** `com.da2.dailyAthlete` (the dropdown lists the App ID
  registered in Unit 5)
- **SKU:** a unique internal identifier, e.g., `da2-ios-001`. Not
  visible to users.
- **User Access:** Full Access (default for solo developer)

App Information section:
- **Subtitle:** ≤30 chars summary. Decide at submission. Example:
  "Train smarter with AI."
- **Privacy Policy URL:** `https://da2-one.vercel.app/privacy`
- **Category:** Primary "Health & Fitness". Secondary optional (e.g.,
  "Sports").
- **Content Rights:** Confirm the app does not contain third-party
  content unless rights are owned. The Strava integration uses the
  user's own Strava data; that is fine.

Age Rating questionnaire:
- Walk through every category. Fitness/training app with no UGC, no
  ads, no gambling, no explicit content → likely 4+. The questionnaire
  is authoritative — answer truthfully.

App Privacy section:
- Click "Get Started" → answer "Do you or your third-party partners
  collect data from this app?" → **Yes**
- For each data type from `docs/operational/app-store-app-privacy-answers.md`,
  select the type, then for each:
  - Is the data linked to the user's identity? Yes for email, fitness
    data, user ID. Wherever the app stores data under the user's
    `auth.uid()` it is "Linked to You".
  - Is the data used for tracking? **No** for all types — the app does
    not link user data with data from third parties for advertising
    or measurement.
  - Purposes: "App Functionality" for everything (no analytics,
    advertising, or product personalization sub-purposes apply).
- Save and publish the App Privacy section.

Pricing and Availability:
- **Price:** Free (or set the intended price tier).
- **Availability:** All territories or specific list. Default = all.

Test scenarios:
- Test expectation: none — operator action in App Store Connect.

Verification:
- App record visible in App Store Connect → My Apps with status
  "Prepare for Submission" or similar (a status indicating no build is
  attached yet but metadata is captured).
- App Privacy section shows a green check / "Published".
- Age Rating displays the expected rating (e.g., 4+).

---

### Phase 4: TestFlight Beta

- [ ] **Unit 8: Production archive build + TestFlight upload**

**Goal:** Produce a code-signed Release archive of the Flutter app
using production env values, and upload it to App Store Connect for
TestFlight distribution.

**Requirements:** R10

**Dependencies:** Units 1, 2, 3, 6, 7 (env, app identity, manifest,
signing, App Store Connect record all in place)

**Files:**
- None new. Build artifacts written to
  `daily-athlete/build/ios/ipa/daily_athlete.ipa`.

**Approach:**

From `daily-athlete/`:

1. Clean any prior build artifacts: `flutter clean`.
2. Re-install Cocoapods after clean: `cd ios && pod install && cd ..`.
3. Build the IPA with production env:
   ```
   flutter build ipa --release \
     --dart-define-from-file=.env.production \
     --export-method=app-store
   ```
   This produces `build/ios/ipa/daily_athlete.ipa`.
4. Open Xcode → `Runner.xcworkspace` → Product → Archive (alternative
   route if `flutter build ipa` produces issues; both paths work).
5. In Xcode Organizer → Archives → select the latest archive →
   "Distribute App" → "App Store Connect" → "Upload". Follow the
   wizard; choose to manage signing automatically. Symbols upload =
   yes (helps Apple symbolicate any crash reports).
6. Wait for Apple to process the build (App Store Connect → TestFlight
   → Builds shows "Processing" → "Ready to Submit" or "Ready to Test").
   Processing usually takes 10–30 min; can take hours during spikes.
7. If the build is flagged for any "Compliance" warnings or "Missing
   Compliance" — answer the export compliance questions (typically:
   no encryption beyond what iOS provides → exempt).

**Patterns to follow:**
- Flutter documentation: "Build and release an iOS app"
- Xcode Organizer workflow for archive distribution

**Test scenarios:**
- Test expectation: none — build and upload step. Verification is
  Apple's automated processing:
  - The build appears in App Store Connect → TestFlight → Builds with
    a status that allows adding testers (not "Invalid Binary" or
    "Processing Failed").
  - No ITMS warnings about Privacy Manifest, missing icons, or
    invalid signing.

**Verification:**
- IPA file exists at `daily-athlete/build/ios/ipa/daily_athlete.ipa`.
- Build visible in App Store Connect TestFlight tab with a usable
  status.

---

- [ ] **Unit 9: TestFlight internal testing + beta feedback loop**

**Goal:** Add internal testers to the TestFlight build, run a focused
beta against the golden-path scenarios, and triage any device-only
bugs before promoting to public submission.

**Requirements:** R11

**Dependencies:** Unit 8 (build must be processed by Apple)

**Files:**
- Create: `docs/operational/testflight-beta-checklist.md` — the
  golden-path scenarios testers should walk through, plus space to
  capture issues found.

**Approach:**

App Store Connect → TestFlight → Internal Testing → add testers:
- Internal testers must be members of the App Store Connect team
  (added under Users and Access). They can install immediately,
  with no Apple beta review.
- Limit to ≤25 Apple IDs for v1. Promote to External Testing only if
  internal coverage is insufficient.

For the build to be available to internal testers:
- App Store Connect → TestFlight → Builds → select the processed
  build → "Test Information" → fill in "What to Test" (1–2 sentences),
  "Email" (support contact), and "App Description" (used in the
  TestFlight UI).
- Toggle the build "Available to Test" for the internal tester group.

Beta golden-path checklist (record in
`docs/operational/testflight-beta-checklist.md`):

1. **First-time install + sign-in:** Install from TestFlight email
   invite. Open app. Enter email. Receive magic-link email. Tap link
   on iOS device. App opens via `da2://auth/callback` and lands on
   `/dashboard`.
2. **Persistent session:** Force-quit the app and reopen. Lands on
   `/dashboard` without re-authentication.
3. **Connect Strava:** Settings → Connect Strava. Strava opens in
   Safari (external browser). Authorize. Browser hands off to
   `da2://strava-oauth`. App shows "Connected" with "Powered by
   Strava" mark.
4. **Activities feed:** After Strava sync completes (web cron handles
   this), Activities tab shows synced workouts.
5. **Manual log:** Activities → "+" → submit a manual workout. New
   row appears in feed immediately.
6. **Calendar mark complete:** Calendar → Week view → tap a planned
   workout → mark complete. Status updates.
7. **Settings:** Theme toggle (light/dark/system) persists across
   app restart. Units toggle (km/mi) updates feed display.
8. **Sign out:** Settings → sign out (if present) returns to sign-in.
9. **Real-device only checks:** keyboard handling, scroll performance,
   tap targets, dark mode legibility, status bar / safe-area on
   different iPhone models (Pro Max, mini if available).

Bug triage:
- Any failure on the golden path is a release blocker. File the bug
  as a new task and create a fix PR. Re-archive with a new build
  number (increment the `+N` portion in `pubspec.yaml`) and upload.
- Repeat the internal beta cycle until the golden path passes
  cleanly on at least two devices.

**Patterns to follow:**
- Standard TestFlight workflow

**Test scenarios:**
- Test expectation: none — manual QA against the golden-path checklist
  on real devices.

**Verification:**
- Every checklist item passes on at least one tester's device, ideally
  on two device models (e.g., a recent and a 2–3 year old iPhone).

---

### Phase 5: Public App Store Submission

- [ ] **Unit 10: App Store listing copy — description, keywords, support URL, marketing**

**Goal:** Draft the user-facing App Store listing text fields.

**Requirements:** R12 (text portion)

**Dependencies:** Unit 9 (beta-tested build) — listing must describe
the actually-shipping behavior

**Files:**
- Create: `docs/operational/app-store-listing-copy.md` — the authoritative
  source for all listing text fields. Paste into App Store Connect at
  submission; keep the file for revisions in future releases.

**Approach:**

Required fields and limits (verify limits against current App Store Connect
Help — Apple updates these):

- **Subtitle** (≤30 chars): a clear one-liner. Avoid generic terms.
  Example: "AI-tuned endurance training".
- **Promotional Text** (≤170 chars, editable without resubmission):
  "what's new" tagline shown above the description. Use for announcements
  like beta launches, new features.
- **Description** (≤4000 chars): plain-language explanation of what the
  app does, who it's for, and what users can do. Sections to cover:
  what is Daily Athlete; for athletes / for coaches; integrations
  (Strava); privacy stance (your data, not sold). Do not include
  pricing or promotional language ("$1.99 limited time" — banned).
- **Keywords** (≤100 chars total, comma-separated, not visible to users):
  affects App Store search. Examples: `training,coach,endurance,running,
  cycling,strava,workout,fitness`. Avoid competitor names (rejected) and
  do not repeat words already in the app name (no search-boost benefit).
- **Support URL** (required): a URL where users can reach support.
  Decide: `https://da2-one.vercel.app/support` (page exists?), or a
  contact email link, or a GitHub Discussions URL. If no support page
  exists, create a minimal one at `apps/web/app/support/page.tsx`
  pointing to a support email.
- **Marketing URL** (optional): app homepage, e.g.,
  `https://da2-one.vercel.app/`.
- **Copyright** (e.g., "© 2026 Ryan Sareen" or org name).
- **App Review notes (private to Apple)**: any context Apple's reviewers
  need to test the app — e.g., "Connect to Strava is optional; reviewer
  can test all core features without it." Also document the demo
  account credentials (Unit 13 step).

**Patterns to follow:**
- App Store Connect Help: "App information" field reference
- Read 3–5 comparable training apps' listings for tone/structure

**Test scenarios:**
- Test expectation: none — content draft.

**Verification:**
- All text fields fit within Apple's character limits (manual count).
- A separate reader can read the description and understand what the
  app does in <30 seconds.

---

- [ ] **Unit 11: App Store screenshots capture**

**Goal:** Capture App Store-quality screenshots from a TestFlight
build on the device size(s) Apple currently requires for new
submissions.

**Requirements:** R12 (screenshot portion)

**Dependencies:** Unit 9 (beta-tested build with realistic data
captured at submission time)

**Files:**
- Create: `docs/operational/app-store-screenshots/` directory with
  files named by device size and screen, e.g.,
  `6_9_inch_01_dashboard.png`, `6_9_inch_02_calendar.png`. Kept in
  the repo so future releases can refresh consistently.

**Approach:**

- Confirm the **currently required** screenshot sizes via App Store
  Connect Help ("Screenshot specifications"). As of the 2024–2025
  changes, App Store Connect requires one set at 6.9" (or 6.7" as
  fallback); older sizes (5.5") are no longer required for new
  submissions. Verify the live requirement at submission day —
  Apple updates this list.
- Capture from the iOS Simulator running the 6.9" device (currently
  iPhone 16 Pro Max). Build the app in Release mode with production
  env so the visible data is the App Store version, not a debug
  build.
- Seed the demo account (Unit 13) with realistic data before
  screenshotting: a week of planned workouts, several completed
  Strava activities, a connected Strava status. Don't ship screenshots
  with empty states.
- Compose 3–5 screenshots covering the strongest screens:
  1. Dashboard with weekly summary and next workout
  2. Calendar Week view with color-coded sport chips
  3. Activities feed with a real activity row
  4. Activity detail with map + metrics
  5. Settings with Strava connected
- Optional: overlay short captions (e.g., "Plan, train, recover")
  using a screenshot tool. Apple permits text overlays as long as
  the actual UI is the dominant content.
- Each image must be the exact pixel size Apple requires (e.g.,
  1320×2868 for 6.9" iPhone). Simulator screenshots match
  automatically if captured from the correct device.

**Patterns to follow:**
- App Store Connect Help: screenshot pixel size table (verify at
  submission time)

**Test scenarios:**
- Test expectation: none — visual capture. Verification:
  - App Store Connect's upload validator accepts the images at the
    advertised sizes without resizing or rejection warnings.

**Verification:**
- All required screenshots present in
  `docs/operational/app-store-screenshots/` at the correct pixel
  dimensions.
- Each screenshot shows non-empty, representative UI.

---

- [ ] **Unit 12: App Review submission, demo account, phased release configuration**

**Goal:** Submit a TestFlight-validated build to App Review with
listing copy, screenshots, and a working demo account. Configure
phased release for the rollout.

**Requirements:** R13, R14

**Dependencies:** Units 9, 10, 11 (build, copy, screenshots all ready)

**Files:**
- None in repo (all in App Store Connect). Reference the artifacts
  from Units 10 and 11.
- Update: `docs/operational/app-store-listing-copy.md` with the demo
  account credentials Apple will use.

**Approach:**

1. **Prepare a demo account.** Create a fresh user via the production
   sign-up flow with a dedicated email like `appreview+da2@…`. Sign
   in via magic link and run through the golden-path checklist to
   seed the account with realistic data (manual workouts, optionally
   a connected Strava using a separate test Strava account). Record
   credentials in App Store Connect → App Review Information.

2. **Attach the build.** App Store Connect → Apps → Daily Athlete →
   "+ Version or Platform" → select iOS → enter the version (1.0.0).
   In the "Build" section, attach the TestFlight build from Unit 9.

3. **Fill the version page:**
   - Paste the description, promotional text, keywords, subtitle from
     Unit 10.
   - Upload screenshots from Unit 11.
   - Set version "What's New" — for v1.0.0 this is the launch
     description (or leave blank for first version; field is required
     on updates only).
   - Confirm Privacy Policy URL.
   - Confirm Support URL.
   - App Review Information section: contact name, phone, email, the
     demo account credentials, and any notes Apple's reviewers need.

4. **Version Release configuration:**
   - "Manually release this version" vs "Automatically release this
     version" vs "Automatically release this version after App
     Review with Phased Release".
   - Select **Phased Release for Automatic Updates** (or
     "Automatically with Phased Release" — exact label varies). This
     ramps to 100% over 7 days for users with automatic updates on.
     New installs from Day 1 still get the latest; the phased
     mechanism throttles auto-updates only.

5. **Submit for review.** Click "Submit for Review". App Store Connect
   walks through encryption / IDFA / content rights confirmations
   one last time. Submit.

6. **Monitor review.** Expect 24–48h turnaround in 2026 baseline;
   slower around WWDC and US holidays. Watch the email and App Store
   Connect status: "Waiting for Review" → "In Review" → "Pending
   Developer Release" or "Ready for Sale".

7. **On rejection:** read the rejection carefully. Most common for
   v1 fitness apps:
   - **Guideline 5.1.1 — Data Collection and Storage** — usually a
     mismatch between Privacy Manifest, App Privacy, and privacy
     policy. Fix the inconsistency, increment build number, re-upload.
   - **Guideline 2.1 — App Completeness** — broken core flow on
     reviewer's device. Reproduce, fix, resubmit.
   - **Guideline 4.0 — Design** — usually layout issues on devices
     not tested. Test on more sizes, fix, resubmit.
   - Use the Resolution Center to reply within App Store Connect.
     Address each point; do not argue speculatively.

8. **On approval:** the app moves to "Pending Developer Release" if
   manual release was selected, or rolls out automatically if phased
   release was selected. Monitor Crashes / TestFlight crash reports
   (no Sentry in v1) and user feedback. Pause phased rollout if
   anomalies appear.

**Patterns to follow:**
- App Store Connect Help: "Submitting your app for review"
- Apple App Review Guidelines (latest published)

**Test scenarios:**
- Test expectation: none — review process is Apple-side. Internal
  preparation verifications:
  - Demo account credentials work — sign-in via magic link succeeds
    and lands on a dashboard with seeded data.
  - All listing fields validated by App Store Connect at submission
    (no red error indicators on the version page).

**Verification:**
- Submission accepted by App Store Connect (status "Waiting for
  Review").
- After approval: app appears on the App Store search and direct link
  resolves to a live product page.
- Phased Release shows incrementing per-day percentages in App Store
  Connect → Analytics over the 7 days post-release.

---

## System-Wide Impact

- **External services that must be configured correctly for the
  Release build to work** (none of these are in the repo; failure to
  configure them silently breaks production while leaving dev intact):
  - Supabase **production** project Redirect URLs must include
    `da2://auth/callback` (dashboard, not `config.toml`).
  - Strava **production** OAuth app Authorization Callback Domain
    must include `da2://strava-oauth`.
  - Apple Developer portal must have the App ID
    `com.da2.dailyAthlete` registered.
  - App Store Connect must have the app record created with the
    matching bundle ID.
  - Vercel production project must have `SUPABASE_URL`,
    `SUPABASE_ANON_KEY` env vars populated (used by both web and the
    Flutter build at `--dart-define` time).

- **Documentation drift to be addressed (out of scope for this plan,
  flagged for follow-up):**
  - `AGENTS.md` still describes `apps/mobile/` as the primary mobile
    app. The Flutter app lives at `daily-athlete/`. Update once the
    Expo app is fully retired.
  - The privacy policy at `apps/web/app/privacy/page.tsx` references
    Firebase, which the app does not use. Unit 4 addresses this.

- **Secrets surface area:** `daily-athlete/.env.production` (local
  only, gitignored) holds production Supabase URL + anon key. The
  anon key is **not** secret in the cryptographic sense (it is shipped
  in the app binary anyway), but treating it as low-sensitivity
  prevents accidental commits and keeps the discipline consistent
  with AGENTS.md's secrets rules.

- **Unchanged invariants:** the existing web app, Next.js API routes,
  Supabase schema, RLS policies, Strava webhook, and backfill cron
  are not modified by this plan. The Flutter app's behavior is also
  not modified — only its build configuration, signing, and
  distribution.

- **API surface parity:** no new API routes added. The Flutter app
  calls the same `/api/integrations/strava/init`,
  `/api/integrations/strava/connect`, `/api/integrations/strava/disconnect`,
  `/api/activities/manual`, `/api/workouts/[id]/status`,
  `/api/coach/workouts`, `/api/coach/links/[id]/archive` endpoints
  that were built in the previous Flutter plan.

- **Future capability cost:** if push notifications, HealthKit, or
  Sign in with Apple are added in a future release, each will require
  (a) App ID capability update in Apple Developer portal, (b)
  matching entitlements file in Xcode, (c) usage description in
  `Info.plist`, (d) Privacy Manifest update, and (e) potentially App
  Privacy disclosure changes. None of these are needed for v1.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Privacy Manifest declarations do not match actual API usage; Apple rejects upload via ITMS warning | Med | Med | Audit Privacy Manifest in Unit 3 against dependency manifests in `Pods/`; iterate based on the specific ITMS warning Apple returns |
| App Privacy disclosures in App Store Connect mismatch the Privacy Manifest or privacy policy text; App Review rejects on Guideline 5.1.1 | Med | High (1–2 cycle delay) | Author all three artifacts in sync (Unit 3 + Unit 4 + Unit 7) using `docs/operational/app-store-app-privacy-answers.md` as the single source of truth |
| Production Supabase project's Allowed Redirect URLs missing `da2://auth/callback`; magic-link sign-in fails on the device while working on Simulator pointed at local Supabase | Med | High (testers can't sign in) | Verify Supabase production redirect URLs in Unit 1 before the first archive upload; smoke-test sign-in on TestFlight in Unit 9 |
| Production Strava OAuth app missing `da2://strava-oauth` redirect; Strava Connect fails post-authorization | Med | Med (Strava is a key feature but app remains usable without it) | Verify Strava console in Unit 1; smoke-test Strava connect on TestFlight in Unit 9 |
| Build number reuse across uploads triggers Apple "ITMS-90062 Invalid Build" rejection | High (easy mistake) | Low (resubmit with bumped number) | Document the convention in Unit 2; ensure `pubspec.yaml` `version: 1.0.0+N` is bumped on every archive |
| Distribution certificate expires mid-release-cycle (1 year lifespan) | Low | Med | Xcode automatic signing handles renewal; track expiry in Apple Developer → Certificates and renew before expiry |
| App Review rejects on Guideline 2.1 (App Completeness) because demo account is missing data or Strava connection is broken | Med | Med (1 cycle delay) | Seed demo account thoroughly in Unit 12; test sign-in and 2+ golden-path flows with the demo credentials before submitting |
| Apple introduces a new Required Reasons API category after submission preparation but before approval | Low | Med | Watch Apple Developer release notes; monitor ITMS warnings on every upload |
| App Store screenshot pixel dimensions change between plan and submission day | Low | Low | Verify the live requirement at submission day (Unit 11); the simulator can recapture in minutes |
| Phased Release surfaces a critical bug after Day 1 | Med | Med | Phased Release allows pausing at any percentage. Monitor App Store Connect crashes daily during the 7-day ramp; if anomalous, pause and ship a 1.0.1 hotfix |
| Privacy policy at `https://da2-one.vercel.app/privacy` references Firebase, contradicting the Privacy Manifest's truthful claim of "no Firebase" — App Review may flag inconsistency | High (existing copy is incorrect) | Med | Unit 4 explicitly addresses this — update copy and redeploy before Unit 7 (App Privacy disclosures) |

## Documentation / Operational Notes

- **Operational documents created by this plan** (kept in
  `docs/operational/` for cross-release reuse):
  - `docs/operational/app-store-app-privacy-answers.md` — Unit 4
  - `docs/operational/testflight-beta-checklist.md` — Unit 9
  - `docs/operational/app-store-listing-copy.md` — Unit 10
  - `docs/operational/app-store-screenshots/` — Unit 11

- **External dashboards involved** (no code-change records but
  important to know):
  - Apple Developer Portal (`https://developer.apple.com/account`) —
    Units 5, 6
  - App Store Connect (`https://appstoreconnect.apple.com`) — Units 7,
    8, 9, 12
  - Supabase production dashboard — Unit 1 (redirect URL config)
  - Strava Developer Console
    (`https://www.strava.com/settings/api`) — Unit 1
  - Vercel project settings (env vars) — Unit 1 (sourcing values)

- **Versioning convention going forward:**
  - `version: MAJOR.MINOR.PATCH+BUILD` in `daily-athlete/pubspec.yaml`
  - MAJOR.MINOR.PATCH is the user-visible App Store version
  - BUILD must increment every TestFlight or App Store upload; never
    reuse
  - Tag the repo at each public release: `v1.0.0`, `v1.0.1`, etc.

- **What to write in App Review notes (Apple-only field, Unit 12):**
  - Demo account email + password
  - Note that Strava Connect is optional and not required to use the
    app (so reviewer can validate without third-party setup)
  - Note that magic-link emails arrive within a minute; if delayed,
    check spam

- **AGENTS.md update follow-up (not in this plan's scope):** revise
  the repo layout section to reflect `daily-athlete/` as the mobile
  app, and mark `apps/mobile/` (Expo) as retired or removed.

## Sources & References

- Origin Flutter plan:
  [docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md](docs/plans/2026-05-17-001-feat-flutter-core-navigation-plan.md)
- Origin Flutter requirements:
  [docs/brainstorms/2026-05-17-flutter-app-core-navigation-requirements.md](docs/brainstorms/2026-05-17-flutter-app-core-navigation-requirements.md)
- Strava OAuth pattern: [docs/solutions/strava-oauth.md](docs/solutions/strava-oauth.md)
- Repo conventions: [AGENTS.md](AGENTS.md)
- Privacy policy (to be aligned): [apps/web/app/privacy/page.tsx](apps/web/app/privacy/page.tsx)
- iOS Info.plist: [daily-athlete/ios/Runner/Info.plist](daily-athlete/ios/Runner/Info.plist)
- Flutter env example: [daily-athlete/.env.local.example](daily-athlete/.env.local.example)
- Apple Developer documentation — Privacy Manifests
  ("Describing data use in privacy manifests", "Describing use of
  required reason API") — resolve current schema at implementation time
- Apple App Review Guidelines — current published version
- App Store Connect Help — screenshot specifications, App Privacy,
  TestFlight management
