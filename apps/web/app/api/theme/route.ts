import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const theme = form.get("theme");
  const referer = request.headers.get("referer") ?? "/";
  const cookieStore = await cookies();
  if (theme === "dark" || theme === "light") {
    cookieStore.set("da2-theme", theme, { path: "/", maxAge: 31536000, sameSite: "lax" });
  }
  // 303, not the default 307: a 307 preserves the original POST method, so
  // the browser would re-POST to `referer` (a page route with no POST
  // handler) instead of re-rendering it — the cookie was written correctly,
  // but the page never got a fresh GET to pick it up, so only a manual
  // refresh (a real GET) showed the new theme.
  return NextResponse.redirect(new URL(referer, request.url), 303);
}
