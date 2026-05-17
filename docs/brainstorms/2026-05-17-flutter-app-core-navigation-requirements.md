---
date: 2026-05-17
topic: flutter-app-core-navigation
---

# DA2 Flutter App — Core Navigation & Pages

## Problem Frame

DA2 is pivoting from an Expo/React Native athlete-only mobile app to a Flutter app
serving both athletes and coaches on mobile (iOS & Android). The original architecture
separated the roles across platforms (athlete → mobile, coach → web only). The new
architecture gives both roles a native-quality mobile experience through a single app
with role-aware content.

The Next.js web app continues to exist and serve both roles on web. The Flutter app
targets the same four pages with role-appropriate content per screen.

The existing Expo/React Native app (`apps/mobile/`) is retired and replaced by the
Flutter app. The app shells built in Expo are thin enough that no migration is needed.

## Role-Aware Content

The same 4-tab bottom navigation is used for both roles. Content differs per tab:

| Tab | Athlete sees | Coach sees |
|-----|-------------|------------|
| **Dashboard** | Personal stats (weekly load, sport breakdown), today's/next workout, recent Strava syncs | Roster overview: athlete cards with weekly compliance (workouts done/planned), recent activity, upcoming events |
| **Activities** | Own activity feed (Strava-synced + manual); filter by sport; log manually | Athlete selector → selected athlete's activity feed; same filter/log capability (on behalf of athlete) |
| **Calendar** | Personal calendar with 4 views (Day / Week / Month / Year); planned + completed workouts; assign workouts to self | Athlete selector → selected athlete's calendar; same 4 views; assign workouts to athlete |
| **Settings** | Light/dark mode; units (km/miles, m/yards, kg/lbs); connected services (Strava); coach relationship (see linked coach) | Light/dark mode; units; connected services; roster management (view athletes, remove link) |

## Requirements

**Dashboard**
- R1. Athlete dashboard shows: weekly training summary (total hours, distance by sport), current week's scheduled workouts vs. completed, next upcoming workout (sport, duration, target), and streak/consistency indicator.
- R2. Coach dashboard shows a roster card list: each card displays athlete name, weekly compliance (e.g., "4/6 workouts done"), and last activity date.
- R3. Coach can tap any athlete card to open that athlete's detail view (their dashboard summary).

**Activities**
- R4. Activities tab shows a chronological feed of completed workouts (Strava-synced and manually logged), newest first.
- R5. Feed is filterable by sport type via tabs at the top (All / Run / Ride / Swim / Strength / Other).
- R6. Each activity row shows: sport icon, date, name/title, key metric for the sport (distance for run/ride/swim; sets or duration for strength), and duration.
- R7. Tapping an activity opens a detail view with: full metrics (distance, pace/speed, avg HR, calories, TSS if available), map if GPS-tracked, and any coaching note attached.
- R8. A "+" button allows manual activity entry with fields: sport type, date, duration, distance (optional), notes.
- R9. Coach sees an athlete selector at the top of the Activities tab; selecting an athlete shows that athlete's feed with the same filtering and detail capabilities.

**Calendar**
- R10. Calendar tab offers 4 views switchable by the user: Day, Week, Month, Year.
- R11. Week view (default) shows planned and completed workouts per day, color-coded by sport. Completed workouts show actuals; planned workouts show targets.
- R12. Day view shows a detailed list of that day's workouts with full target details.
- R13. Month view shows a summary dot/badge per day indicating workout count or sport mix.
- R14. Year view shows weeks as rows with a simple heatmap of training load (days active, volume intensity).
- R15. Athletes can tap a planned workout to mark it complete, skip it, or reschedule.
- R16. Coaches have an athlete selector on the Calendar tab and can assign workouts to the selected athlete by tapping an empty day slot.

**Settings**
- R17. Settings includes a theme toggle (light / dark / system default).
- R18. Settings includes a units section: distance (km / miles), swimming distance (meters / yards), weight (kg / lbs).
- R19. Settings includes a connected services section showing Strava link status with connect/disconnect action.
- R20. Athlete settings shows a "Your coach" section displaying linked coach name (if any) or "No coach linked."
- R21. Coach settings shows a roster section listing linked athletes with option to remove a link.

**App shell and navigation**
- R22. Bottom tab navigation with 4 tabs: Dashboard, Activities, Calendar, Settings. Icons + labels for each.
- R23. Role is detected from the authenticated user's profile on app launch. No in-app role switcher; a user is treated as either an athlete or a coach (primary role from `role_flags[0]`). Note: the current schema allows `role_flags` to hold both simultaneously — planning must enforce mutual exclusivity at the application layer or via a DB constraint.
- R24. Authentication uses Supabase (same credentials as the web app). Sign-in and sign-up screens precede the tab navigation.
- R25. App supports light and dark mode (respects system default until user explicitly overrides in Settings).

## Success Criteria

- An athlete can open the app, see this week's workouts on Dashboard, view their Strava activity feed, check their calendar, and update their Strava connection — all without touching the web app.
- A coach can open the app, see their roster on Dashboard, tap an athlete, and view that athlete's activities and calendar.
- Role detection is instant on launch (no loading state where the wrong content flashes).
- Manual activity entry saves and appears immediately in the feed without requiring a Strava sync.

## Scope Boundaries

- No in-app messaging between coaches and athletes (v1).
- No performance manager chart (CTL/ATL/TSB) in v1 — deferred.
- Year view is a training heatmap only, not a full Annual Training Plan editor — that's a future feature.
- No Garmin or Wahoo integration in v1; Strava is the only third-party sync.
- Workout library (reusable coach templates) is out of scope for v1.
- The web app (Next.js) is not redesigned as part of this initiative; it continues independently.
- The Flutter app targets iOS and Android only — Flutter web is not in scope.

## Key Decisions

- **Flutter over Expo/React Native**: Expo app shells are thin; Flutter gives better long-term performance and a single codebase for both platforms without Expo's managed workflow constraints.
- **One app, role-aware (not two apps)**: Reduces distribution and maintenance overhead; roles are mutually exclusive (a user is an athlete or a coach, not both), so a switcher adds no value.
- **Next.js continues for web**: The existing API layer (Strava OAuth, webhooks, cron, auth callbacks) stays in Next.js. Flutter calls these same APIs. The web API does not need a full rewrite, but Flutter requires new mobile-specific endpoints for manual activity entry (R8), mark-complete/reschedule (R15), and coach-writes-on-behalf-of-athlete (R9, R16).
- **Supabase auth shared across Flutter and web**: Same project, same credentials. Flutter uses Supabase Flutter SDK with the existing Supabase project.
- **Core additions in scope, power features deferred**: Activity detail, manual log, sport filters, units, and connected services are included. CTL/ATL/TSB chart, workout library, and ATP year view are explicitly deferred.
- **Schema plan Unit 8 is in scope**: The `coach_athlete_links` table and coach-side RLS policies (previously deferred to Unit 8) will be implemented as part of this initiative. Planning will define the migration and policies.

## Dependencies / Assumptions

- Supabase Flutter SDK supports the existing RLS policies and auth setup without schema changes (unverified — deferred to planning).
- Strava OAuth for Flutter: the existing Expo app (`apps/mobile/src/integrations/strava.tsx`) already implements a working PKCE flow using the `/api/integrations/strava/init` → `/connect` endpoints. Flutter should port this pattern rather than reusing the web callback.
- The `coach_athlete_links` table does **not** currently exist. Migrations 0000–0009 all defer coach-side RLS to schema plan Unit 8, which is unchecked. R2, R3, R9, R16, R20, and R21 are all blocked until this table is created.

## Outstanding Questions

### Resolve Before Planning
- [Affects R24][Technical blocker] Supabase auth on Flutter requires a mobile deep-link callback (e.g., `da2app://auth/callback`). The existing web callback at `/auth/callback` does not serve Flutter. Planning must define the deep-link scheme, configure it in the Supabase project's redirect URL allowlist, and handle it in the Flutter app.

### Deferred to Planning
- [Affects R2, R3, R9, R16, R20, R21][Technical] Design `coach_athlete_links` schema (schema plan Unit 8): table structure, FK constraints, soft-delete, and RLS policies for coach → athlete read access and coach write-on-behalf-of-athlete.
- [Affects R19][Technical] Port Strava OAuth PKCE flow from `apps/mobile/src/integrations/strava.tsx` to Flutter using the existing `/api/integrations/strava/init` + `/connect` endpoints. No new API work expected.
- [Affects R18][Technical][Needs research] Unit preferences (km/miles, m/yards, kg/lbs) have no backing storage column in the current schema. Planning must define where these are persisted (e.g., new column on `athlete_profiles`).
- [Affects R1, R2][Technical] Which Supabase tables does the Dashboard query, and do current RLS policies allow the needed reads for both roles?
- [Affects R10–R16][Technical] Does the Flutter calendar need a third-party calendar widget, or is a custom implementation preferred given the 4-view requirement?
- [Affects R8, R15, R9, R16][Technical] New API endpoints needed for Flutter: manual activity entry, mark-complete/skip/reschedule, and coach-writes-on-behalf-of-athlete. RLS must allow coach to write to an athlete's rows (currently no coach-side policies exist).

## Next Steps
→ Resolve "Resolve Before Planning" questions above (schema Unit 8 decision, auth deep-link strategy) before planning.
→ Then `/ce:plan` for structured implementation planning.
