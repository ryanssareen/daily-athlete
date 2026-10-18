# TestFlight Build 1.0.0 (1) — Release Record

Date: 2026-10-18
App: The Daily Athlete (Flutter iOS app in `daily-athlete/`)
Bundle ID: `com.da2.dailyAthlete`
Apple team: `R7HV9V7LDY` (Rishi Sareen)
Distribution method used in Xcode Organizer: **TestFlight Internal Only**

## Summary

The first iOS build was archived, exported as an App Store IPA, and uploaded from Xcode Organizer. The upload reported success. Because the Internal Only method was chosen, this build can go to **internal testers only** (users on the Apple developer account, up to 100). It cannot be used for external groups, a public TestFlight link, or an App Store submission.

## Source of this build

This build was made from local commit `5610d45` on `main`, which was **31 commits behind `origin/main`** at upload time. It does not contain the v2 mobile redesign (new Home, Activities, Calendar, Plan and Reports tabs, iPad layouts) that landed on `origin/main` afterwards. Treat build 1.0.0 (1) as the old app. To test current code, pull `main`, set `version: 1.0.0+2`, rebuild and upload again.

## Changes made to the repo

Committed to `main` on 2026-10-18:

| File | Change | Why |
| --- | --- | --- |
| `daily-athlete/ios/Runner/Info.plist` | Added `ITSAppUsesNonExemptEncryption = false` | Skips the export-compliance prompt on every upload |
| `daily-athlete/ios/Runner/Info.plist` | Keys reordered by PlistBuddy; the three comments above `CFBundleURLTypes` restored by hand | The `da2` URL scheme is unchanged |

Not committed: the build also rewrote the iOS deployment target (13.0 to 15.0), `Podfile`, both lockfiles and `analysis_options.yaml`. `origin/main` already contains the deployment-target change (`a0805d7`) and newer lockfiles, so those edits were stashed instead of pushed.

Local only, gitignored: `daily-athlete/.env.production` with `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `API_BASE_URL`. A release build throws at launch without these `--dart-define` values.

## Build and upload

```bash
cd daily-athlete
flutter clean
(cd ios && pod install)
flutter build ipa --release --dart-define-from-file=.env.production --export-method=app-store
```

Output: `build/ios/ipa/daily_athlete.ipa` (23.7 MB) and `build/ios/archive/Runner.xcarchive` (181 MB). Uploaded through Xcode Organizer (Window, Organizer, Archives, Distribute App).

Machine setup done on the build Mac: Flutter 3.47.7 via Homebrew; CocoaPods 1.15.2 via `gem install --user-install` with pinned `ffi 1.15.5`, `zeitwerk 2.6.18`, `i18n 1.14.8`, `activesupport 6.1.7.10` and `concurrent-ruby 1.3.4`. The Homebrew CocoaPods install failed because Homebrew lock files on that Mac belong to another macOS user. System Ruby there is 2.6.10, which is why the pins were needed.

## Adding testers

Internal (this build): add each tester as a user in App Store Connect (Users and Access), create an internal group under TestFlight, enable the build for it. The tester installs the free TestFlight app, opens the invite email, and taps Install. No review is needed.

External or public link (needs a new upload):

1. Set `version: 1.0.0+2` in `pubspec.yaml`.
2. Rebuild with the command above.
3. Upload again from Organizer, this time choosing **App Store Connect**.
4. Create an external group in TestFlight. The first build goes to Beta App Review (about a day). Have ready: a "what to test" note, a contact email, a demo login, and the privacy policy URL.

Uploading never submits the app for App Store review. That only happens if you submit it yourself from the App Store tab.

## Open items

- **Build 1.0.0 (1) is stale.** It predates the v2 mobile redesign on `origin/main`. Rebuild as `1.0.0+2` from current `main` before real testing.
- **Apple sign-in token expires around 2026-11-15** (per `ios-release-handoff.md`). Regenerate with `scripts/apple-jwt.mjs` and paste into Supabase, or "Continue with Apple" will fail.
- **Redirect allowlists not verified.** Supabase must allow `da2://auth/callback` and the Strava app must list `da2://strava-oauth`.
- **`API_BASE_URL` is assumed** to be `https://da2-one.vercel.app`, taken from the May handoff notes. Confirm it still points at the right backend.
- **Launch screen is still the default Flutter placeholder** (build validation warning). Not a TestFlight blocker.
- **`testflight-beta-checklist.md` is out of date.** It describes magic-link sign-in, but the app now uses email/password plus Google and Apple.
- **Processing not yet confirmed.** Check that the build shows Ready to Test in App Store Connect, TestFlight tab.
