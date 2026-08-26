import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_* vars must be referenced as this exact literal expression
// (not read off a destructured/aliased `process.env`) so Next.js's build
// can statically inline them into the client bundle — see
// https://nextjs.org/docs/app/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser.
// That's also why this guard lives here instead of routing through
// apps/web/src/config.ts: config.ts reads `process.env` dynamically, which
// is fine server-side but would not inline for a client component.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Fail loudly with a clear message instead of silently constructing a
    // client with an empty/undefined URL, which throws a confusing
    // low-level error (e.g. "Invalid URL") the first time it's used.
    throw new Error(
      "Supabase browser client cannot be created: NEXT_PUBLIC_SUPABASE_URL " +
        "and/or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set."
    );
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
