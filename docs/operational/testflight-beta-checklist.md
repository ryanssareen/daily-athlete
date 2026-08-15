# TestFlight Beta Checklist — The Daily Athlete iOS

> Walk this list end-to-end on at least two device models (a recent iPhone +
> a 2–3 year-old iPhone if available) before promoting a TestFlight build to
> App Review. Any failure on the golden path is a release blocker — file a
> fix, bump the build number in `daily-athlete/pubspec.yaml`, re-archive, and
> re-run the affected sections.

## Build under test

Record once per cycle:

- **Build version + number** (e.g., `1.0.0+3`):
- **Date uploaded**:
- **Tester device(s) + iOS version**:
- **Network conditions tested** (Wi-Fi / cellular / offline):

## Pre-flight (do once per cycle, before testers)

- [ ] App Store Connect → TestFlight → Builds shows the build as **Ready
      to Test** (not "Processing", not "Invalid Binary").
- [ ] "Test Information" filled in: "What to Test", contact email, app
      description.
- [ ] Build marked **Available to Test** for the internal tester group.
- [ ] Supabase **production** project → Authentication → URL Configuration
      → Redirect URLs contains `da2://auth/callback`.
- [ ] Strava Developer Console → DA2 OAuth app → callback domain list
      includes `da2://strava-oauth`.

## Golden path — every tester

### 1. First-time install + sign-in

- [ ] Install from the TestFlight email invite. The icon on the home
      screen matches the finalized design (not the Flutter template).
- [ ] Open the app. The sign-in screen loads (no crash, no stuck
      splash).
- [ ] Enter a real email address you control.
- [ ] Tap "Send magic link". The UI confirms "check your email" without
      hanging.
- [ ] The magic-link email arrives within ~60 seconds.
- [ ] Tap the link **on the same iOS device**. iOS routes it to the
      The Daily Athlete app via `da2://auth/callback`.
- [ ] The app lands on the Dashboard tab. No "wrong content flash"
      before the role-aware content renders.

### 2. Persistent session

- [ ] Force-quit the app (swipe up from app switcher).
- [ ] Reopen the app. It lands on the Dashboard without showing the
      sign-in screen — session was restored from secure storage.

### 3. Strava OAuth

- [ ] Open Settings → Connect Strava. The button opens Safari (external
      browser) — not an embedded webview (Strava ToS blocks webviews).
- [ ] In Safari, authorize the DA2 OAuth app. The "Powered by Strava"
      branding is visible somewhere in the flow.
- [ ] Safari hands off back to the app via `da2://strava-oauth?code=…&state=…`.
- [ ] The Settings → Strava section now shows "Connected" with the
      required "Powered by Strava" badge.
- [ ] No `redirect_uri_mismatch` error in Safari or in the app.

### 4. Activities feed

- [ ] After a Strava sync completes (web cron + webhook), the Activities
      tab populates with synced workouts, newest first.
- [ ] Sport filter tabs (All / Run / Ride / Swim / Strength / Other)
      filter the feed correctly.
- [ ] Each activity row shows sport icon, date, name, key metric, and
      duration.
- [ ] Tapping an activity opens the detail view: full metrics, map (if
      GPS), and any coaching note.

### 5. Manual log

- [ ] Activities tab → "+" button → fill out the manual log form (sport,
      date, duration, optional distance, notes) → submit.
- [ ] The new activity appears at the top of the feed immediately
      (no waiting for Strava sync).
- [ ] Tapping the new row opens the detail view with the entered data.

### 6. Calendar — mark complete

- [ ] Calendar tab → default Week view shows planned + completed workouts
      color-coded by sport.
- [ ] Switch through Day / Week / Month / Year views — each renders
      without crash.
- [ ] Tap a planned workout chip → bottom sheet with mark complete /
      skip / reschedule.
- [ ] Mark complete. The chip transitions from "planned" (light) to
      "completed" (solid) without a full reload.

### 7. Settings

- [ ] Theme toggle (System / Light / Dark) — changing it updates the UI
      immediately AND persists across force-quit + reopen.
- [ ] Units toggle (km/mi, m/yd, kg/lb) — changing it updates activity
      and calendar displays AND persists.
- [ ] Athlete role: "Your coach" section shows the linked coach
      (or "No coach linked" if not linked).
- [ ] Coach role (if applicable): roster section lists linked athletes
      with a "Remove" action.

### 8. Sign out + re-auth

- [ ] If a sign-out affordance is present in Settings, tap it. The app
      returns to the sign-in screen.
- [ ] Sign back in with the same email. State is restored (workouts and
      Strava connection persist).

### 9. Real-device-only checks

- [ ] Keyboard handling: tapping a text field (manual log notes, sign-in
      email) scrolls the field into view; the keyboard doesn't obscure
      the active control.
- [ ] Scroll performance on long activity feed (>50 rows) feels smooth
      (no jank during fling).
- [ ] Tap targets are large enough — no accidental neighboring taps in
      compact views (Week view chips, sport filter tabs).
- [ ] Dark mode legibility: every screen passes a quick read-through in
      both light and dark — no white-on-white or black-on-black.
- [ ] Status bar + safe-area: home indicator and notch are respected; no
      content clipped under the dynamic island.
- [ ] No console-visible errors in the Xcode log when running attached
      (`flutter logs -d <device>` if you can attach a Release build).

## Bug triage

For any failure, record below:

| # | Section | Device + iOS | Description | Severity | Fixed in build |
|---|---------|--------------|-------------|----------|----------------|
|   |         |              |             |          |                |

**Severity guide:**

- **Blocker:** core flow fails (sign-in, sync, marking complete). Stop and fix.
- **Major:** secondary feature broken (units don't persist, year view crashes
  on rare data). Fix before App Review submission.
- **Minor:** cosmetic, polish, or edge case. File for follow-up; not a release
  blocker.

## Sign-off

Promote to App Review only when:

- [ ] Every Golden Path step passes on at least one device.
- [ ] At least two device models covered (or one device + Simulator if no
      second device is available).
- [ ] All Blocker and Major bugs are fixed and re-verified on a fresh build.
- [ ] Build number bumped for any fix re-upload (Apple rejects duplicates).
