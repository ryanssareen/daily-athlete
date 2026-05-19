# iOS App Store Release — Handoff Notes

> Snapshot of where the Daily Athlete iOS release work stands as of 2026-05-19.
> Read this first when resuming on a different machine. Pairs with the
> implementation plan at
> [`docs/plans/2026-05-19-001-feat-ios-app-store-release-plan.md`](../plans/2026-05-19-001-feat-ios-app-store-release-plan.md).

---

## TL;DR

The iOS release is **mostly configured but never built on a real device yet**.
Everything in App Store Connect, Apple Developer, and Supabase is in place.
The next blocker on a new machine is one Apple Development certificate in
Keychain — fix that, then `flutter run -d <iPhone>` should install the app.

Run this any time to see the current acceptance odds:

```
python3 scripts/app-store-odds.py
```

Last reading: ~40% (the gaps are all "untested on iOS", which the next steps
unblock at once).

---

## What is done

### Apple Developer Portal

- **Team:** Rishi Sareen, ID `R7HV9V7LDY`
- **App ID:** `com.da2.dailyAthlete` registered with **Sign in with Apple**
  capability enabled as primary
- **Services ID:** `com.da2.dailyAthlete.signin` (used by Sign in with Apple
  web auth)
  - Domain: `gukhwozgnunbqzllobbd.supabase.co`
  - Return URL: `https://gukhwozgnunbqzllobbd.supabase.co/auth/v1/callback`
- **Sign in with Apple Key:** Key ID `554PR43X56`, name "Daily Athlete Sign
  in with Apple". Private key `.p8` is **local-only at
  `secrets/AuthKey_554PR43X56.p8`** (gitignored, do not commit). If you're
  on a different machine you'll need to either re-download it (you can't —
  Apple shows once) or regenerate the key + JWT.

### App Store Connect

App ID `6770878604`, status `1.0 Prepare for Submission`.

- App Information saved: name "Daily Athlete", subtitle "Train smarter,
  every day.", primary category Health & Fitness, secondary Sports, content
  rights = no third-party
- Age Rating: **4+**
- App Privacy: **Published 2026-05-19**, declares 6 data types (Email,
  Name, User ID, Health, Fitness, Precise Location), all Linked to user,
  App Functionality purpose, no tracking
- Privacy Policy URL: `https://da2-one.vercel.app/privacy`
- Pricing: **Free**, 175 territories, "Available on App Release"
- **What's still missing in App Store Connect:**
  - Description, keywords, support URL, marketing URL (all drafted in
    [`docs/operational/app-store-listing-copy.md`](app-store-listing-copy.md),
    not pasted yet)
  - Screenshots (need to be captured from a real device or simulator)
  - App Review Information (demo account credentials, phone number)
  - "What's New" — leave blank for v1.0.0

### Supabase production (`the-daily-athlete`, project `gukhwozgnunbqzllobbd`)

- **Email** provider: enabled, signups allowed, "Confirm email" **OFF**
- **Google** OAuth: enabled (client ID + secret already in dashboard)
- **Apple** OAuth: enabled with JWT signed today (expires ~2026-11-15 —
  regenerate before then using
  [`scripts/apple-jwt.mjs`](../../scripts/apple-jwt.mjs))
- **URL Configuration** allowlist:
  - Site URL: `https://da2-one.vercel.app/auth/callback`
  - Redirect URLs: `https://da2-one.vercel.app/auth/callback`,
    `da2://auth/callback`

### Flutter app code

Replaced magic-link auth with email/password + Google + Apple OAuth.
Files touched (uncommitted at the time of this handoff):

- `daily-athlete/lib/features/auth/auth_notifier.dart` — added
  `signInWithPassword`, `signUpWithPassword`, `signInWithGoogle`,
  `signInWithApple`; removed `signInWithOtp`
- `daily-athlete/lib/features/auth/sign_in_screen.dart` — rewritten
  for email+password
- `daily-athlete/lib/features/auth/sign_up_screen.dart` — new
- `daily-athlete/lib/features/auth/oauth_buttons.dart` — new
- `daily-athlete/lib/features/auth/deep_link_handler.dart` — restored
  `da2://auth/callback` branch for OAuth returns
- `daily-athlete/lib/router/routes.dart` — added `signUp`
- `daily-athlete/lib/router/router.dart` — added `/sign-up` route + redirect
- `daily-athlete/lib/main.dart` — comment update

Also fixed 4 pre-existing compile errors in the calendar feature
(these were blocking ALL builds, not just iOS):
- `daily-athlete/lib/features/calendar/month_view.dart` — duplicate
  `initState` merged
- `daily-athlete/lib/features/calendar/calendar_tab.dart` — missing
  `RoleFlag` import
- `daily-athlete/lib/features/calendar/week_view.dart` — missing
  `RoleFlag` import
- `daily-athlete/lib/features/calendar/day_view.dart` — explicit
  `DateTime` type annotation

### App icon

Replaced Flutter template icons with the finalized DA gradient design at
all 15 required sizes under
`daily-athlete/ios/Runner/Assets.xcassets/AppIcon.appiconset/`. 1024×1024
has no alpha channel (Apple requires that).

### iOS project signing config

Added to `daily-athlete/ios/Runner.xcodeproj/project.pbxproj` (all three
Runner build configurations: Debug, Release, Profile):

```
CODE_SIGN_STYLE = Automatic;
DEVELOPMENT_TEAM = R7HV9V7LDY;
```

### Web platform support

`flutter create --platforms=web .` was run on the project to enable a
local Chrome dev build for testing. The `daily-athlete/web/` directory
is untracked — commit it if you want web as a real target, otherwise
revert before pushing.

---

## What is broken / blocked

### Code signing certificate not on this machine

`security find-identity -p codesigning -v` returns "0 valid identities
found". Xcode created an "Apple Development" cert named **Jarvis** on a
prior machine, but the **private key never made it into this Mac's
Keychain**, so the cert here is unusable.

**Fix:** in Xcode → Settings → Accounts → select Apple ID → Manage
Certificates → **+** → Apple Development. This creates a fresh cert in
this Mac's Keychain. Then `flutter run -d <iPhone>` will succeed.

### iPhone build never actually ran

We got to the point of building for a connected iPhone 12 ("Ryan phone",
UDID `00008101-000A19DA0A13001E`, iOS 26.3) and the build kept failing
at the signing step. Once the cert above is fixed, the build will:

1. Compile Flutter + Pods (~5–10 min on first run, much faster after)
2. Sign with the new Apple Development cert
3. Install onto the phone
4. Auto-launch — phone may prompt to **trust the developer cert** in
   Settings → General → VPN & Device Management on first install

### iOS Simulator runtime download was slow/incomplete

Xcode 26.5 ships with the iOS 26.5 SDK but no 26.5 simulator runtime.
We started the download via Xcode → Settings → Components but it was
going slowly. **You can skip this entirely** by testing on the real
iPhone (which is what we'd been doing anyway).

### Web OAuth on `da2-one.vercel.app` errors with PKCE

When you click "Continue with Google" on the Next.js coach site, the
callback fails with:

> PKCE code verifier not found in storage. This can happen if the auth
> flow was initiated in a different browser or device, or if the storage
> was cleared.

This is a pre-existing bug in the Next.js web app (`apps/web/`),
**not** the iOS Flutter app. The browser client sets a PKCE cookie that
isn't surviving the OAuth round-trip back to `/auth/callback`. Worth a
separate ticket — does not block the iOS release.

---

## Where the secrets live

| Thing | Location | Sensitivity |
|---|---|---|
| Supabase URL + anon key | `daily-athlete/.env.production` | low (anon key ships in app binary anyway), gitignored |
| Apple Sign in private key | `secrets/AuthKey_554PR43X56.p8` | HIGH — gitignored, machine-local, don't commit |
| Supabase service role key | Vercel project env only | HIGH — never in this repo |
| Strava API credentials | Vercel project env only | HIGH — never in this repo |
| Apple Dev Account password | not stored | HIGH — interactive Xcode login |

If you're moving to a new machine, **you'll need to copy
`secrets/AuthKey_554PR43X56.p8`** out-of-band (USB drive, encrypted
storage, etc.). Apple won't let you re-download it.

`.env.production` you can recreate from the values in the Supabase
dashboard:

```
SUPABASE_URL=https://gukhwozgnunbqzllobbd.supabase.co
SUPABASE_ANON_KEY=<anon key from supabase dashboard → settings → api>
API_BASE_URL=https://da2-one.vercel.app
```

---

## Resume checklist (new machine)

In order:

1. **Clone the repo + pull this branch.** Git status should be clean
   after this handoff is committed.
2. **Install Xcode 26.5+** from the Mac App Store (~12 GB, takes time).
3. **Install Flutter** (we used `flutter 3.41.9` stable). Put on PATH.
4. **Sign Xcode into Apple ID** (Settings → Accounts → +). Confirm the
   Daily Athlete team `R7HV9V7LDY` shows up.
5. **Create local Apple Development cert** via Xcode Settings → Accounts →
   Manage Certificates → + → Apple Development.
6. **Copy the `.p8` key to `secrets/AuthKey_554PR43X56.p8`** from your
   backup. (Or regenerate by creating a new Sign in with Apple key in
   Apple Developer, downloading the .p8, updating Supabase Apple
   provider's Secret Key with a fresh JWT — see step 8 below.)
7. **Create `daily-athlete/.env.production`** with the three values
   listed in "Where the secrets live" above.
8. **(If you regenerated the Apple key in step 6):** run
   ```
   node scripts/apple-jwt.mjs R7HV9V7LDY com.da2.dailyAthlete.signin <NEW_KEY_ID> secrets/<NEW_FILE>.p8
   ```
   and paste the JWT into Supabase Dashboard → Auth → Providers →
   Apple → Secret Key. Update Client IDs if the Services ID changed.
9. **Connect the iPhone via Lightning cable.** Trust the computer
   when prompted on the phone.
10. **Verify Developer Mode is on**: iPhone Settings → Privacy & Security
    → Developer Mode → toggle ON, restart, confirm.
11. **Run the app:**
    ```
    cd daily-athlete
    flutter run -d 00008101-000A19DA0A13001E --dart-define-from-file=.env.production
    ```
    (Use your phone's UDID if it's different; `flutter devices` lists it.)
12. **Trust the developer cert on the phone** on first install:
    Settings → General → VPN & Device Management → Apple Development:
    `<your email>` → Trust.

After step 12, the app should launch. Test:

- Sign up with a new email/password — creates a row in
  `auth.users` on Supabase
- Sign out, sign back in
- Continue with Google → returns to app via `da2://auth/callback`
- Continue with Apple → returns to app via `da2://auth/callback`
- Strava connect (if production Strava OAuth app has been updated to
  include `da2://strava-oauth`)
- Calendar, Activities, Settings tabs render

---

## Next steps after the build works

In rough order of impact:

1. **TestFlight upload.** Open `daily-athlete/ios/Runner.xcworkspace` in
   Xcode → Product → Archive → Distribute App → App Store Connect. First
   archive takes ~10–20 minutes.
2. **Internal TestFlight testers.** Add team-member Apple IDs in App
   Store Connect → TestFlight.
3. **Demo account.** Sign up a fresh `appreview+da2@<domain>` user
   through the production flow, seed it with a couple weeks of manual
   workouts (and optionally a connected Strava test user). Record the
   credentials in App Store Connect → App Review Information.
4. **Screenshots.** Capture from the iPhone 17 Pro Max simulator at 6.9"
   with the demo account, save to `docs/operational/app-store-screenshots/`.
5. **Paste listing copy.** From
   [`docs/operational/app-store-listing-copy.md`](app-store-listing-copy.md)
   into App Store Connect → App Store → Version 1.0:
   - Promotional text, description, keywords, support URL (or `mailto:`),
     marketing URL, copyright, App Review notes
6. **Submit for review.** Select "Automatically release with Phased
   Release". Submit.

---

## Files to commit before pushing to GitHub

```
M  .gitignore                                  (added secrets/AuthKey_*, *.p8)
M  daily-athlete/ios/Flutter/Debug.xcconfig    (whitespace? verify)
M  daily-athlete/ios/Flutter/Release.xcconfig  (whitespace? verify)
M  daily-athlete/ios/Runner.xcodeproj/project.pbxproj   (CODE_SIGN_STYLE + DEVELOPMENT_TEAM)
M  daily-athlete/ios/Runner/Assets.xcassets/AppIcon.appiconset/*.png   (15 new icons)
M  daily-athlete/lib/features/auth/auth_notifier.dart
M  daily-athlete/lib/features/auth/deep_link_handler.dart
M  daily-athlete/lib/features/auth/sign_in_screen.dart
M  daily-athlete/lib/features/calendar/calendar_tab.dart
M  daily-athlete/lib/features/calendar/day_view.dart
M  daily-athlete/lib/features/calendar/month_view.dart
M  daily-athlete/lib/features/calendar/week_view.dart
M  daily-athlete/lib/main.dart
M  daily-athlete/lib/router/router.dart
M  daily-athlete/lib/router/routes.dart
M  docs/operational/app-store-listing-copy.md
?? daily-athlete/lib/features/auth/oauth_buttons.dart
?? daily-athlete/lib/features/auth/sign_up_screen.dart
?? docs/operational/ios-release-handoff.md         (this file)
?? scripts/apple-jwt.mjs                            (Apple JWT signer)
?? scripts/app-store-odds.py                        (odds calculator)
?? secrets/README.md                                (NOT the .p8 — that stays gitignored)
```

Optional / decide:
- `?? daily-athlete/ios/Podfile` + `Podfile.lock` — useful for reproducible
  builds, recommend committing
- `?? daily-athlete/web/` — Flutter web platform support. Commit if you
  want web as a real target; otherwise revert.

Do NOT commit:
- `secrets/AuthKey_554PR43X56.p8` — already gitignored by `secrets/AuthKey_*`
- `daily-athlete/.env.production` — already gitignored by `.env.*`
- Any `.bak` files

---

## Key IDs cheat sheet

| Name | Value |
|---|---|
| Apple Team ID | `R7HV9V7LDY` |
| App Bundle ID | `com.da2.dailyAthlete` |
| Sign in with Apple Services ID | `com.da2.dailyAthlete.signin` |
| Sign in with Apple Key ID | `554PR43X56` |
| App Store Connect App ID | `6770878604` |
| SKU | `da2-ios-001` |
| Supabase Project ID | `gukhwozgnunbqzllobbd` |
| Supabase callback URL (for Google + Apple) | `https://gukhwozgnunbqzllobbd.supabase.co/auth/v1/callback` |
| iOS deep link callback (mobile) | `da2://auth/callback` |
| Web callback (browser fallback) | `https://da2-one.vercel.app/auth/callback` |
| iPhone test device UDID | `00008101-000A19DA0A13001E` (iPhone 12 "Ryan phone") |

---

## If you need to start a completely fresh session

Paste this into the AI assistant:

> Resuming iOS release work for the Daily Athlete Flutter app at
> `/Users/ryan/Documents/da2/daily-athlete`. Read
> `docs/operational/ios-release-handoff.md` for context, then continue
> from the "Resume checklist" section.
