import { NextResponse } from "next/server";

import { createClient } from "@/auth/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}
