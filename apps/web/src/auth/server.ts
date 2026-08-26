import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { config } from "@/config";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = config.supabase;
  if (!url || !anonKey) {
    // Fail loudly with a clear message instead of silently constructing a
    // client with an empty/undefined URL, which throws a confusing
    // low-level error the first time it's used. In production this is
    // already unreachable because `config` throws at boot (see
    // apps/web/src/config.ts); this also covers dev/test.
    throw new Error(
      "Supabase server client cannot be created: NEXT_PUBLIC_SUPABASE_URL " +
        "and/or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set."
    );
  }
  return createServerClient(
    url,
    anonKey,
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
    }
  );
}
