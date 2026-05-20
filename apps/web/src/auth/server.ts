import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createClient(accessToken?: string) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items: CookieToSet[]) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot mutate cookies; safe to swallow.
          }
        },
      },
      // Mobile callers send a Bearer access token and no cookies. Attaching it
      // as the default Authorization header makes PostgREST run AS that user,
      // so RLS auth.uid() resolves on writes. Without it, DB calls fall back to
      // the anon key and RLS rejects inserts/updates with 42501. Browser
      // callers pass no token here and keep using the cookie session.
      ...(accessToken
        ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
        : {}),
    }
  );
}
