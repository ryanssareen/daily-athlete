# App Store Listing Copy — The Daily Athlete (v0.1.0)

> Authoritative source for the text fields on the App Store Connect version
> page. Paste from here into App Store Connect at submission; keep this file
> as the diff target for future releases.

## App Name (≤30 chars)

```
The Daily Athlete
```

(13 chars; matches `CFBundleDisplayName` in `daily-athlete/ios/Runner/Info.plist`.)

## Subtitle (≤30 chars)

```
Train smarter, every day.
```

(25 chars.) Alternatives to consider at submission time:

- `AI-tuned endurance training` (27)
- `Plans that adapt to you` (23)
- `Endurance training, simplified` (30)

## Promotional Text (≤170 chars; editable without resubmission)

```
v1.0 launch — bring your Strava workouts and your plan together. Mark workouts done, see your week at a glance, and stay on track.
```

(141 chars.)

## Description (≤4000 chars)

```
The Daily Athlete is an endurance training companion for runners, cyclists, and triathletes who want a plan that stays in sync with what they actually do.

Bring your training and your life together:
- See your week at a glance with a color-coded calendar (Day, Week, Month, and Year views)
- Sync workouts automatically from Strava — no manual import
- Log workouts the app can't sync (treadmill runs, gym sessions) in seconds
- Mark planned workouts complete, skip, or move them to a different day
- Stay on top of your weekly load with sport breakdowns and streak indicators

Built for athletes and coaches:
- If you train solo, the app is your daily training journal
- If you train with a coach, accept their invite and let them assign workouts directly to your calendar — you'll see what's planned and they'll see how it went

Privacy you can trust:
- No advertising. No tracking across other apps or sites. No selling your data.
- Your workout history lives in your own account; Strava is optional and you can disconnect any time
- Sign in with an email magic link — no passwords to remember

What's included in v1.0:
- Dashboard with weekly summary and your next planned workout
- Activities feed with sport filters and detailed activity views (metrics + map)
- Calendar with four views, including a year-long training heatmap
- Settings for theme (light/dark/system) and units (km/mi, m/yd, kg/lb)
- Strava connect / disconnect with the required "Powered by Strava" branding

Coming soon:
- Coach-to-athlete in-app messaging
- Performance manager chart (CTL/ATL/TSB)
- Annual training plan editor

The Daily Athlete is built by a small team. Feedback, bug reports, and feature
requests are read directly by the people building the app — reach us at
support@da2.coach.
```

Character count check before paste: aim for ≤4000. Trim if needed.

## Keywords (≤100 chars total, comma-separated, not visible to users)

```
training,coach,endurance,running,cycling,triathlon,strava,workout,fitness,plan
```

(80 chars.) Notes:

- Do not include the app name itself ("The Daily Athlete") — Apple already
  indexes the title; repeating it wastes space.
- Avoid competitor brand names (`TrainingPeaks`, `TrainerRoad`) — App Review
  rejects on Guideline 5.2.1.
- "Strava" is the brand we integrate with and is fine to include because
  the app actually connects to it.

## Support URL (required)

```
mailto:support@da2.coach
```

Alternative: a dedicated support page on the marketing site. If we ship one,
update to:

```
https://da2-one.vercel.app/support
```

> **TODO before submission:** confirm whether `https://da2-one.vercel.app/support`
> exists. If not, either create a minimal `apps/web/app/support/page.tsx`
> pointing to the support email + a contact form, or use the `mailto:`
> URL above.

## Marketing URL (optional)

```
https://da2-one.vercel.app/
```

## Copyright

```
© 2026 Ryan Sareen
```

## Privacy Policy URL

```
https://da2-one.vercel.app/privacy
```

## Category

- **Primary:** Health & Fitness
- **Secondary:** Sports (optional; verify a sub-category is appropriate by
  comparing to similar training apps on the live App Store)

## Age Rating

Walk through every question in the App Store Connect Age Rating
questionnaire. Expected outcome for v1.0:

- Cartoon / Fantasy / Realistic Violence: None
- Sexual Content or Nudity: None
- Profanity / Crude Humor: None
- Alcohol / Tobacco / Drug Use or References: None
- Mature / Suggestive Themes: None
- Horror / Fear Themes: None
- Gambling / Contests / Prolonged Graphic Violence: None
- Medical / Treatment Information: None (the app does not provide medical advice)
- Unrestricted Web Access: No
- User-Generated Content shared externally: No

Expected rating: **4+**. The questionnaire is authoritative — answer
truthfully and accept whatever Apple computes.

## App Review Information

```
First name: Ryan
Last name: Sareen
Phone number: <fill in>
Email: rsareen@gmail.com
```

### Notes to App Review (private to Apple)

```
The Daily Athlete is an endurance training companion app. Sign-in options:
email + password (Supabase Auth), Continue with Google, or Continue with
Apple. The Strava integration is optional; the app's core features
(calendar, manual logging, planned workouts) work without it.

Demo account credentials are below. Magic-link emails arrive within ~60
seconds; please check spam if delayed.

The app uses a custom URL scheme (da2://) for two redirects:
  - da2://auth/callback — handled by Supabase auth (email magic link)
  - da2://strava-oauth — handled by Strava OAuth callback

Both schemes are registered in Info.plist and pre-allowlisted in our
production Supabase project and Strava OAuth application. The auth
callback scheme also returns the user to the app after Google or Apple
sign-in (handled by Supabase Auth → da2://auth/callback).

No tracking, no advertising SDKs, no analytics. The Privacy Manifest
declares only the data we store on the user's behalf (email, name,
training data, GPS routes from Strava when connected).
```

### Demo account credentials

> Fill in at submission time. Create a fresh `appreview+da2@<domain>` account,
> sign in via magic link, seed it with manual workouts (and optionally a
> connected Strava account using a separate test Strava user), then record
> the email and a backup link below.

```
Demo email: appreview+da2@<domain>
Sign-in method: Email magic link (no password)
Backup access: <one-time access link, if provided to App Review>
Seeded data:
  - <N> manual workouts spread across the past 2 weeks
  - Connected Strava (optional): test Strava user "<test username>"
```

## Version Release configuration

Select **Automatically release this version after App Review with Phased
Release**. Rationale:

- Phased Release ramps to 100% over 7 days for users with automatic updates
  enabled — caps the blast radius if a critical bug surfaces post-launch.
- New installs still get the latest version from day one; phased release
  throttles auto-update only.
- Manual release would block the user from a same-day launch if approval
  arrives outside business hours.

## What's New in This Version

For v0.1.0 (initial submission): leave blank or use a brief launch line.
Apple requires this field for updates, not for the first version.

For future releases, use a 2–4 line summary of user-visible changes:

```
- New: <feature>
- Improved: <feature or fix>
- Fixed: <bug>
```

## Screenshots

Captured to `docs/operational/app-store-screenshots/`. See that directory
for the 6.9" iPhone images and the capture procedure.

Required for v1.0 (verify at submission day):

1. Dashboard — weekly summary + next planned workout
2. Calendar — Week view with color-coded sport chips
3. Activities — feed with a real activity row
4. Activity detail — map + metrics
5. Settings — Strava connected, theme + units toggles visible

Optional but recommended: overlay short marketing captions (≤6 words each)
above the device frame to reinforce the value props.

## Pre-submission checklist

- [ ] All character limits respected (manual count or App Store Connect
      validator).
- [ ] Description reads cleanly on a phone screen (no dense paragraphs).
- [ ] Demo account works — sign-in via magic link succeeds and lands on a
      seeded dashboard.
- [ ] Demo account credentials filled in above and pasted into App Store
      Connect → App Review Information.
- [ ] Screenshots match the actual shipping UI of the TestFlight build (not
      a debug build).
- [ ] Privacy policy at `https://da2-one.vercel.app/privacy` reflects the
      current data stack (Supabase + Strava + Vercel + Inngest; no Firebase).
- [ ] App Privacy answers in App Store Connect match
      [`app-store-app-privacy-answers.md`](./app-store-app-privacy-answers.md).
- [ ] Build number bumped from the last TestFlight upload.

## After approval

- [ ] App appears on the App Store search and direct link resolves.
- [ ] Phased Release shows incrementing per-day percentages in App Store
      Connect → Analytics over the 7-day ramp.
- [ ] Monitor App Store Connect → Crashes daily during the ramp. Pause
      rollout if anomalies appear.
