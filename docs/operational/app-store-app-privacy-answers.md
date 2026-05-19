# App Store Connect — App Privacy Questionnaire Answers

> Single source of truth for the App Privacy disclosures in App Store Connect.
> Must stay in sync with [`daily-athlete/ios/Runner/PrivacyInfo.xcprivacy`](../../daily-athlete/ios/Runner/PrivacyInfo.xcprivacy)
> and [`apps/web/app/privacy/page.tsx`](../../apps/web/app/privacy/page.tsx). A
> mismatch among the three is the highest-risk App Review rejection trigger
> under Guideline 5.1.1 (Data Collection and Storage).

## Top-level questions

| Question | Answer |
|----------|--------|
| Do you or your third-party partners collect data from this app? | **Yes** |
| Do you use data to track users (across other companies' apps or websites)? | **No** |

Because tracking is **No**, App Tracking Transparency prompt is not required
and must not be implemented.

## Data types collected

For each row: select the data type in App Store Connect, then answer the
sub-questions identically to this table.

| Data type | Collected | Linked to user | Used for tracking | Purpose |
|-----------|-----------|----------------|-------------------|---------|
| **Contact Info → Email Address** | Yes | Yes | No | App Functionality |
| **Contact Info → Name** | Yes (when user sets display name) | Yes | No | App Functionality |
| **Identifiers → User ID** | Yes (Supabase `auth.uid()`) | Yes | No | App Functionality |
| **Health & Fitness → Fitness** | Yes (workout type, distance, duration, pace, splits) | Yes | No | App Functionality |
| **Health & Fitness → Health** | Yes (heart rate, calories, power) | Yes | No | App Functionality |
| **Location → Precise Location** | Yes (Strava-sourced GPS polylines displayed on activity map) | Yes | No | App Functionality |

All other data type categories: **Not Collected**. Specifically:

- **Contact Info → Phone Number / Physical Address / Other Contact Info**: Not collected
- **Contact Info → Emergency Contacts**: Not collected
- **Health & Fitness → other** beyond Fitness/Health above: Not collected
- **Financial Info**: Not collected (no in-app purchase, no payment processing)
- **Location → Coarse Location**: Not collected (we have precise via Strava polylines; no separate coarse)
- **Sensitive Info**: Not collected
- **Contacts**: Not collected
- **User Content → Photos or Videos / Audio / Gameplay / Customer Support / Other**: Not collected (no photo upload, no in-app messaging, no support chat)
- **Browsing History**: Not collected
- **Search History**: Not collected
- **Identifiers → Device ID**: Not collected
- **Purchases**: Not collected
- **Usage Data → Product Interaction / Advertising / Other**: Not collected (no analytics SDK)
- **Diagnostics → Crash Data / Performance Data / Other**: Not collected by us (Apple may collect from TestFlight/App Store under its own privacy policy)
- **Surroundings Info**: Not collected
- **Body Data → Other**: Not collected

## Purpose definitions (App Store Connect uses these labels)

- **App Functionality:** "Such as to authenticate the user, enable features,
  prevent fraud, implement security measures, ensure server up-time, minimize
  app crashes, improve scalability and performance, or perform customer support."
  All declared data types use this purpose only.
- **Analytics**, **Product Personalization**, **App Functionality &
  Advertising**, **Developer's Advertising or Marketing**, **Third-Party
  Advertising**: **Not selected** — none apply.

## Linkage rationale

Every data type is stored against the user's Supabase `auth.uid()` and is
readable only by that user (via Row-Level Security policies) and any coach
the user has linked. That makes the data linked-to-user by Apple's definition.

## Tracking rationale

The app does not:

- Combine user data with third-party data for targeted advertising
- Share user data with data brokers
- Use any analytics SDK that fingerprints users
- Use IDFA or any other tracking identifier

Therefore "Used for Tracking" is **No** for every data type, and
`NSPrivacyTracking` in the Privacy Manifest is `false`.

## Mapping to PrivacyInfo.xcprivacy

| Privacy Manifest data type key | App Store Connect category |
|--------------------------------|----------------------------|
| `NSPrivacyCollectedDataTypeEmailAddress` | Contact Info → Email Address |
| `NSPrivacyCollectedDataTypeName` | Contact Info → Name |
| `NSPrivacyCollectedDataTypeUserID` | Identifiers → User ID |
| `NSPrivacyCollectedDataTypeFitness` | Health & Fitness → Fitness |
| `NSPrivacyCollectedDataTypeHealth` | Health & Fitness → Health |
| `NSPrivacyCollectedDataTypePreciseLocation` | Location → Precise Location |

## Required Reasons API declarations

The Privacy Manifest also declares Required Reasons API categories used by
Flutter and its plugins. These are not part of the App Privacy questionnaire
but must be present to pass Apple's upload validator (ITMS-91056 family
warnings).

| API category | Reason code | Why |
|--------------|-------------|-----|
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | Dart runtime / Flutter file I/O inside app container |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | `flutter_secure_storage` + Flutter plugin defaults |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | Flutter framework timing utilities |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1` | Flutter framework disk usage checks |

## Updating this document

Edit this file whenever:

- A new data type is collected (e.g., adding push tokens → declare
  `NSPrivacyCollectedDataTypeOtherDataTypes` with appropriate purpose)
- A new third-party SDK is added that changes the tracking posture
- Apple's privacy schema or category list changes (check App Store Connect
  Help → App Privacy Details before each release cycle)

Increment the build number in `daily-athlete/pubspec.yaml` after editing the
Privacy Manifest so the next TestFlight upload re-runs Apple's validators
against the updated declarations.
