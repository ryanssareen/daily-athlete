---
title: iOS Deployment Target Below the Flutter Minimum Broke Pod Install and Device Builds
date: 2026-10-13
status: active
---

# iOS Deployment Target Below the Flutter Minimum

## Symptom

After upgrading to Flutter 3.47, `pod install` warned and device builds were unsupported
for the iOS app in `daily-athlete/`. The project still targeted iOS 13.0.

## Root cause

Flutter 3.47 requires iOS 15 or later. The deployment target was set in several places
that drifted apart from the toolchain: `ios/Podfile` (the `platform` line was commented out
at `13.0`), `ios/Runner.xcodeproj/project.pbxproj`, and the pod lockfile. Flutter upgrades
do not rewrite these.

## Fix

Commit a0805d7 set `platform :ios, '15.0'` in the Podfile, raised
`IPHONEOS_DEPLOYMENT_TARGET` in the Xcode project, and refreshed `Podfile.lock` and
`pubspec.lock`. It also excluded `build/`, `android/`, `ios/` and `web/` from
`analysis_options.yaml` so the analyzer ignores generated code. It was verified by building
a release IPA and installing it on a physical iPhone.

## Prevention

- After any Flutter SDK bump, read the release notes for the minimum iOS version and
  check the Podfile and Xcode project against it. A `pod install` warning about the
  deployment target is a real failure, not noise.
- Keep the Podfile `platform` line uncommented so the target is explicit.
- Verify with a release IPA on a device (or at least `flutter build ios --release`), not
  only the simulator, which tolerates more.
- The `deploy-ios.yml` workflow builds on merges to `main` that touch `daily-athlete/`,
  so a stale target also shows up there as a failed TestFlight build.
