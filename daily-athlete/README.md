# daily_athlete

DA2 mobile app — athlete and coach training companion. Flutter app targeting
iOS and Android, sharing a Supabase project and Next.js API surface with the
web app at `apps/web/`.

## Environment

The app reads three values at compile time via `--dart-define`:

| Key | Value source |
|-----|--------------|
| `SUPABASE_URL` | `supabase status` for local; Supabase dashboard for production |
| `SUPABASE_ANON_KEY` | same as above |
| `API_BASE_URL` | `http://localhost:3000` for local; `https://da2-one.vercel.app` for production |

See [`.env.local.example`](.env.local.example) for the documented schema.
Actual values are never committed — both `.env.local` and `.env.production`
are gitignored.

## Local development

```bash
flutter run \
  --dart-define=SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d= -f2) \
  --dart-define=SUPABASE_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2) \
  --dart-define=API_BASE_URL=http://localhost:3000
```

Or store the three values in `.env.local` (gitignored) and use
`--dart-define-from-file=.env.local`.

## Production build (iOS)

1. Populate a local, gitignored `.env.production` file at the project root
   with production Supabase and API values. Source the Supabase URL and
   anon key from the production Vercel project's environment variables
   (dashboard → Settings → Environment Variables → Production).
   `.env.local.example` documents the schema.

2. Verify external service redirect allowlists once (see the
   [iOS App Store release plan](../docs/plans/2026-05-19-001-feat-ios-app-store-release-plan.md)):
   - Supabase production → Authentication → URL Configuration → Redirect URLs
     contains `da2://auth/callback`.
   - Strava Developer Console (`https://www.strava.com/settings/api`) for the
     DA2 OAuth app lists `da2://strava-oauth` as a callback domain.

3. Build the signed Release IPA:

   ```bash
   flutter clean
   (cd ios && pod install)
   flutter build ipa --release \
     --dart-define-from-file=.env.production \
     --export-method=app-store
   ```

   The output is `build/ios/ipa/daily_athlete.ipa`.

4. Upload to TestFlight via Xcode Organizer (Window → Organizer → Archives →
   Distribute App → App Store Connect → Upload), or open
   `ios/Runner.xcworkspace` and use Product → Archive.

5. Bump `version: MAJOR.MINOR.PATCH+BUILD` in `pubspec.yaml` before every
   upload — Apple rejects duplicate build numbers (`+N`).

## Project layout

- `lib/main.dart` — Supabase init + deep-link listener bootstrap
- `lib/core/` — env loading, secure storage
- `lib/router/` — go_router config with auth guard and shell route
- `lib/features/auth/` — sign-in screen, auth notifier, deep-link handler
- `lib/features/shell/` — 4-tab bottom navigation, role detection
- `lib/features/dashboard/`, `activities/`, `calendar/`, `settings/` — feature tabs
- `lib/models/` — Dart classes mirroring `packages/shared/` TypeScript types
- `ios/Runner/PrivacyInfo.xcprivacy` — iOS Privacy Manifest (App Store gate)

## Tests

```bash
flutter test
```
