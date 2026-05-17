import { NextResponse } from "next/server";

import { createClient } from "@/auth/server";
import { createAdminClient } from "@/db/admin";

const INTENDED_ROLE_COOKIE = "da2_intended_role";
const CLEAR_INTENDED_ROLE_COOKIE = `${INTENDED_ROLE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;

/**
 * Handles the OAuth / magic-link redirect:
 *   ?code=...   PKCE code from Supabase Auth → exchange for a session cookie.
 *   ?next=/...  optional same-origin path to land on after sign-in (defaults to /roster).
 *   ?error=...  Supabase Auth error → bounce to /sign-in with the message.
 *
 * Also finalizes the user's role assignment when /sign-up/coach launched a
 * Google OAuth flow: Supabase populates raw_user_meta_data with the Google
 * profile (not our intended_role hint), so the trigger defaults to athlete.
 * We carry the intent across the OAuth round-trip via a short-lived cookie
 * (`da2_intended_role`) and service-role-promote here once the session is
 * established. The cookie is cleared on every callback outcome.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const rawNext = url.searchParams.get("next") ?? "/roster";
  // Only allow same-origin paths for `next` to prevent open-redirect.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/roster";

  // Read intended_role hint from cookie (set by /sign-up/coach before the
  // Google redirect). We honour only the "coach" value; anything else falls
  // through to the default athlete role assigned by the trigger.
  const cookieHeader = request.headers.get("cookie") ?? "";
  const intendedRoleMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${INTENDED_ROLE_COOKIE}=([^;]+)`)
  );
  const intendedRole = intendedRoleMatch ? decodeURIComponent(intendedRoleMatch[1]) : null;

  if (errorParam) {
    const dest = new URL("/sign-in", url.origin);
    dest.searchParams.set("error", errorParam);
    const res = NextResponse.redirect(dest);
    res.headers.append("Set-Cookie", CLEAR_INTENDED_ROLE_COOKIE);
    return res;
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (intendedRole === "coach") {
        await ensureCoachRole(supabase);
      }
      const res = NextResponse.redirect(new URL(next, url.origin));
      res.headers.append("Set-Cookie", CLEAR_INTENDED_ROLE_COOKIE);
      return res;
    }
    const dest = new URL("/sign-in", url.origin);
    dest.searchParams.set("error", error.message);
    const res = NextResponse.redirect(dest);
    res.headers.append("Set-Cookie", CLEAR_INTENDED_ROLE_COOKIE);
    return res;
  }

  return NextResponse.redirect(new URL("/sign-in", url.origin));
}

/**
 * Service-role-add the "coach" role to the currently-authenticated user.
 * No-op if they already have it. This is the post-OAuth-callback fallback
 * for /sign-up/coach's Google path; the email/password path is handled by
 * the handle_new_auth_user trigger (migration 0012) at user creation.
 *
 * We APPEND "coach" rather than replace role_flags so that an existing
 * athlete who clicks "Sign up as coach + Continue with Google" doesn't
 * lose access to their athlete data and existing /athlete/* routes.
 */
async function ensureCoachRole(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const admin = createAdminClient();
  // service-role: explicit user filter required
  const { data: row } = await admin
    .from("users")
    .select("role_flags")
    .eq("id", user.id)
    .maybeSingle();
  const current = (row?.role_flags ?? ["athlete"]) as string[];
  if (current.includes("coach")) return;

  // Treat the user as freshly signed up (and therefore coach-only) when
  // their auth account is younger than the OAuth round-trip window.
  // Anyone older than that has been using DA2 long enough that their
  // existing role_flags reflect real intent — preserve them and just add
  // "coach" so we don't accidentally strip athlete access from someone
  // who clicked "Continue with Google" on /sign-up/coach while signed
  // in. 60s is plenty for a Google OAuth round-trip; legitimate fresh
  // signups complete in seconds.
  const accountAgeMs = Date.now() - new Date(user.created_at).getTime();
  const isFreshSignup = accountAgeMs < 60_000;
  const finalRoles = isFreshSignup ? ["coach"] : [...current, "coach"];

  // service-role: explicit user filter required
  await admin
    .from("users")
    .update({ role_flags: finalRoles })
    .eq("id", user.id);
}
