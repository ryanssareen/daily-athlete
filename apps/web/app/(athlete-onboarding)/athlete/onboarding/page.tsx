import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { createAdminClient } from "@/db/admin";
import { hasStravaToken } from "@/db/strava-tokens";

import { OnboardingFlow, type InitialState } from "./onboarding-flow";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const params = await searchParams;
  const stepParam = typeof params.step === "string" ? params.step : undefined;
  const stravaConnected = params.strava_connected === "1";
  const stravaError =
    typeof params.strava_error === "string" ? params.strava_error : undefined;

  const admin = createAdminClient();

  // Load any partial progress so a returning user (e.g. after the
  // Strava OAuth round-trip, or after closing the browser mid-flow)
  // resumes where they left off.
  const [{ data: userRow }, { data: profileRow }, hasToken] = await Promise.all(
    [
      admin
        .from("users")
        .select("display_name, email")
        .eq("id", session.user.id)
        .maybeSingle(),
      admin
        .from("athlete_profiles")
        .select("manual_fields, backfill_status")
        .eq("user_id", session.user.id)
        .maybeSingle(),
      hasStravaToken(admin, session.user.id),
    ]
  );

  const manualFields = (profileRow?.manual_fields ?? {}) as Record<
    string,
    unknown
  >;
  const targetEvent = (manualFields.target_event ?? null) as
    | { type?: string; date?: string }
    | null;

  const initial: InitialState = {
    email: userRow?.email ?? session.user.email ?? "",
    nickname:
      (userRow?.display_name as string | null) ??
      (typeof manualFields.nickname === "string" ? manualFields.nickname : ""),
    primarySport:
      (manualFields.primary_sport as InitialState["primarySport"]) ?? "tri",
    weeklyHours:
      typeof manualFields.weekly_hours_avail === "number"
        ? manualFields.weekly_hours_avail
        : 8,
    trainingPattern:
      typeof manualFields.training_pattern === "string"
        ? manualFields.training_pattern
        : "Even split",
    eventType: typeof targetEvent?.type === "string" ? targetEvent.type : "",
    eventDate: typeof targetEvent?.date === "string" ? targetEvent.date : null,
    stravaConnected: hasToken,
    backfillStatus:
      (profileRow?.backfill_status as InitialState["backfillStatus"]) ?? {},
    initialStep: stepParam,
    stravaJustConnected: stravaConnected,
    stravaError,
  };

  return <OnboardingFlow initial={initial} />;
}
