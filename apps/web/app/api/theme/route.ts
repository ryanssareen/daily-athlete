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
  return NextResponse.redirect(new URL(referer, request.url));
}
