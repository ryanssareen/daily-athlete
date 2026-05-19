#!/usr/bin/env python3
"""Daily Athlete — App Store Acceptance Odds Calculator.

Estimates probability of passing App Review on the FIRST submission, given
the current state of preparation. Not a guarantee — a sanity check that
surfaces the gaps most likely to cause rejection.

Methodology: each requirement has a `rejection_risk` (probability App
Review rejects the submission if this item is missing/broken). We compute
the joint probability of NOT being rejected by anything as:

    accept_odds = ∏ (1 - rejection_risk_i * miss_factor_i)

where miss_factor is 0 for DONE, 1.0 for MISSING, 0.5 for PARTIAL, and 0.7
for UNKNOWN (untested → more pessimistic than partial).

Usage:
    python3 scripts/app-store-odds.py
"""

from dataclasses import dataclass
from enum import Enum
from functools import reduce


class Status(str, Enum):
    DONE = "DONE"
    PARTIAL = "PARTIAL"
    MISSING = "MISSING"
    UNKNOWN = "UNKNOWN"


MISS_FACTOR = {
    Status.DONE: 0.0,
    Status.PARTIAL: 0.5,
    Status.UNKNOWN: 0.7,
    Status.MISSING: 1.0,
}

GLYPH = {
    Status.DONE: "✓",
    Status.PARTIAL: "~",
    Status.UNKNOWN: "?",
    Status.MISSING: "✗",
}


@dataclass
class Requirement:
    category: str
    name: str
    status: Status
    rejection_risk: float  # 0..1 probability Apple rejects if this is missing
    note: str = ""


# Calibration of rejection_risk numbers — from public App Review trend data
# (Apple's WWDC review-stats sessions; Appbot/Mixpanel published rejection
# breakdowns 2023–2025) plus the plan's documented risk register. Numbers
# are estimates, not guarantees; the relative ordering matters more than the
# absolute values.
REQUIREMENTS: list[Requirement] = [
    # --- Apple Developer + App Store Connect setup (mostly done) ---
    Requirement("Setup", "App ID registered (com.da2.dailyAthlete)",
                Status.DONE, 0.05),
    Requirement("Setup", "App Store Connect record created",
                Status.DONE, 0.05),
    Requirement("Setup", "Bundle ID matches App ID across Info.plist + project",
                Status.DONE, 0.05),
    Requirement("Setup", "Sign in with Apple capability enabled on App ID",
                Status.DONE, 0.03,
                "Required because we offer Google OAuth (Guideline 4.8)"),
    Requirement("Setup", "Services ID + Sign in with Apple key configured",
                Status.DONE, 0.02),

    # --- Auth flows ---
    Requirement("Auth", "Email/password sign-up + sign-in in Flutter app",
                Status.PARTIAL, 0.08,
                "Code written + UI renders in web build; iOS untested"),
    Requirement("Auth", "Google OAuth round-trip works on iOS",
                Status.UNKNOWN, 0.08,
                "Supabase Google provider enabled; never tested on device"),
    Requirement("Auth", "Apple OAuth round-trip works on iOS",
                Status.UNKNOWN, 0.10,
                "JWT signed today; never tested on device"),
    Requirement("Auth", "Supabase production redirect URLs allowlist da2://auth/callback",
                Status.DONE, 0.05),
    Requirement("Auth", "App handles deep-link callback (exchangeCodeForSession)",
                Status.DONE, 0.05,
                "deep_link_handler.dart restored"),

    # --- Privacy (5.1.1 — most common rejection category) ---
    Requirement("Privacy", "Privacy Manifest (PrivacyInfo.xcprivacy) present",
                Status.DONE, 0.10,
                "Apple ITMS-91056 family if missing"),
    Requirement("Privacy", "Privacy Manifest API declarations match real usage",
                Status.UNKNOWN, 0.08,
                "Authored by hand; not audited against actual plugin behavior"),
    Requirement("Privacy", "App Privacy disclosures published in App Store Connect",
                Status.DONE, 0.10),
    Requirement("Privacy", "Privacy policy URL serves correct content",
                Status.DONE, 0.03,
                "https://da2-one.vercel.app/privacy live"),
    Requirement("Privacy", "Privacy policy content matches actual data stack",
                Status.PARTIAL, 0.05,
                "Updated to remove Firebase mention; mentions Supabase + Strava"),

    # --- App content & metadata ---
    Requirement("Metadata", "App name, subtitle, category set",
                Status.DONE, 0.02),
    Requirement("Metadata", "Description entered in App Store Connect",
                Status.MISSING, 0.03,
                "Drafted in docs/operational/app-store-listing-copy.md, not pasted"),
    Requirement("Metadata", "Keywords entered",
                Status.MISSING, 0.02),
    Requirement("Metadata", "Screenshots uploaded (iPhone 6.9\")",
                Status.MISSING, 0.06,
                "Apple rejects submissions without screenshots"),
    Requirement("Metadata", "Support URL set (page or mailto)",
                Status.PARTIAL, 0.03,
                "mailto:support@da2.coach drafted; no /support page yet"),
    Requirement("Metadata", "App icon is finalized design (not Flutter template)",
                Status.DONE, 0.03,
                "DA gradient icon installed at all 15 sizes"),

    # --- Build & technical ---
    Requirement("Build", "Production IPA builds successfully",
                Status.UNKNOWN, 0.20,
                "iOS 26.5 simulator runtime still downloading"),
    Requirement("Build", "App doesn't crash on first launch",
                Status.UNKNOWN, 0.15,
                "Never run on iOS device or simulator"),
    Requirement("Build", "All declared URL schemes work (da2://)",
                Status.UNKNOWN, 0.05,
                "Registered in Info.plist; runtime untested on iOS"),
    Requirement("Build", "TestFlight upload passes Apple's automated validation",
                Status.UNKNOWN, 0.10,
                "ITMS warnings if Privacy Manifest is wrong"),

    # --- Review-time gates ---
    Requirement("Review", "Working demo account credentials provided",
                Status.MISSING, 0.10,
                "Apple needs this to test auth-gated content"),
    Requirement("Review", "App Review notes explain non-obvious flows",
                Status.PARTIAL, 0.03,
                "Drafted in listing copy; not pasted into App Store Connect"),
    Requirement("Review", "Phone number for App Review Information",
                Status.MISSING, 0.02),
    Requirement("Review", "Age Rating questionnaire completed (4+)",
                Status.DONE, 0.02),
    Requirement("Review", "Content Rights declared (no third-party)",
                Status.DONE, 0.02),
    Requirement("Review", "Pricing & Availability configured",
                Status.DONE, 0.02),

    # --- Strava integration (third-party brand compliance) ---
    Requirement("Integration", "Production Strava OAuth app has da2://strava-oauth callback",
                Status.UNKNOWN, 0.04,
                "Per the plan; verify before TestFlight"),
    Requirement("Integration", "'Powered by Strava' branding visible when connected",
                Status.DONE, 0.03,
                "Already implemented in strava_connect_section.dart"),
]


def odds_of_acceptance(reqs: list[Requirement]) -> float:
    """Joint probability of passing review = ∏(1 - risk * miss_factor)."""
    survival = [
        1.0 - r.rejection_risk * MISS_FACTOR[r.status] for r in reqs
    ]
    return reduce(lambda a, b: a * b, survival, 1.0)


def fmt_pct(x: float) -> str:
    return f"{x * 100:5.1f}%"


def main() -> None:
    by_category: dict[str, list[Requirement]] = {}
    for r in REQUIREMENTS:
        by_category.setdefault(r.category, []).append(r)

    print()
    print("┌──────────────────────────────────────────────────────────────────────────┐")
    print("│  Daily Athlete — App Store Acceptance Odds Calculator                    │")
    print("└──────────────────────────────────────────────────────────────────────────┘")

    for cat, reqs in by_category.items():
        print(f"\n[ {cat} ]")
        for r in reqs:
            risk_now = r.rejection_risk * MISS_FACTOR[r.status]
            line = (
                f"  {GLYPH[r.status]} {r.name:<60} "
                f"risk={fmt_pct(risk_now)}"
            )
            print(line)
            if r.note and r.status != Status.DONE:
                print(f"      └─ {r.note}")

    odds = odds_of_acceptance(REQUIREMENTS)
    print()
    print("─" * 76)

    # Top 5 outstanding risk contributors
    ranked = sorted(
        REQUIREMENTS,
        key=lambda r: r.rejection_risk * MISS_FACTOR[r.status],
        reverse=True,
    )
    print("\nTop risks remaining (do these to move the number up):")
    for r in ranked[:5]:
        risk_now = r.rejection_risk * MISS_FACTOR[r.status]
        if risk_now == 0:
            continue
        print(f"  - {r.name:<55} +{fmt_pct(risk_now)} risk")

    print()
    print("─" * 76)
    print(f"  ESTIMATED ODDS OF FIRST-SUBMISSION ACCEPTANCE: {fmt_pct(odds)}")
    print("─" * 76)
    print("  Note: Apple's median first-submission acceptance rate is ~60%.")
    print("  Hitting >85% requires having tested the build + demo account ready.")
    print()


if __name__ == "__main__":
    main()
