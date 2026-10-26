---
title: TestFlight Uploads Need ITSAppUsesNonExemptEncryption Declared
date: 2026-10-18
status: active
---

# TestFlight Uploads Need `ITSAppUsesNonExemptEncryption` Declared

## Symptom

Builds uploaded to App Store Connect from `deploy-ios.yml` landed with an unanswered
export compliance question ("Missing Compliance"). Testers could not install them until
someone answered the prompt by hand in App Store Connect, on every build.

## Root cause

`ios/Runner/Info.plist` did not declare `ITSAppUsesNonExemptEncryption`. Without it Apple
asks about encryption for each uploaded build. The app uses only standard HTTPS, which is
exempt, so the answer is always "no".

## Fix

Commit a11d960 added `ITSAppUsesNonExemptEncryption` set to `false` to `Info.plist`. The
same commit moved the `da2://` `CFBundleURLTypes` entry up next to the other bundle keys;
that move changed nothing functionally.

## Prevention

- Treat a fresh iOS target's `Info.plist` checklist as part of CI setup: encryption
  declaration, usage-description strings for every permission the app requests, and URL
  schemes.
- If the app ever adds non-standard cryptography, flip this key and revisit the export
  compliance paperwork instead of leaving it `false`.
- When a TestFlight build uploads but is not testable, check App Store Connect for a
  compliance or processing state before assuming the build is broken.
- Separate from this: a failure at signing ("maximum number of development certificates")
  is an Apple account problem. Revoke unused Development certificates in the Apple
  Developer portal, then re-run the workflow. It is not fixed by a code change.
