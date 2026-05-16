import { NextResponse } from "next/server";

import { createClient } from "@/auth/server";

/**
 * Handles the OAuth / magic-link redirect:
 *   ?code=...   PKCE code from Supabase Auth → exchange for a session cookie.
 *   ?next=/...  optional same-origin path to land on after sign-in (defaults to /roster).
 *   ?error=...  Supabase Auth error → bounce to /sign-in with the message.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const rawNext = url.searchParams.get("next") ?? "/roster";
  // Only allow same-origin paths for `next` to prevent open-redirect.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/roster";

  if (errorParam) {
    const dest = new URL("/sign-in", url.origin);
    dest.searchParams.set("error", errorParam);
    return NextResponse.redirect(dest);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    const dest = new URL("/sign-in", url.origin);
    dest.searchParams.set("error", error.message);
    return NextResponse.redirect(dest);
  }

  return NextResponse.redirect(new URL("/sign-in", url.origin));
}
