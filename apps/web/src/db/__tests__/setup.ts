// Test bootstrap for DB-backed vitest suites.
//
// Architecture:
// - A long-lived service-role admin client is used for test setup/teardown
//   (creating auth.users rows, hard-deleting them after each test).
// - Each test that needs RLS-bound queries calls `createTestUser()`, which
//   returns a freshly signed-in supabase-js client bound to that user's JWT.
//   Queries through that client exercise RLS exactly as production code does.
// - We do NOT use per-test BEGIN ... ROLLBACK transaction wrapping because
//   supabase-js issues each query as a separate HTTP call to PostgREST;
//   transactions cannot span SDK calls. Instead, `createTestUser()` tracks
//   each created user id, and the global afterEach hook hard-deletes them
//   via the admin API. The auth.users -> public.users FK cascade plus
//   on-delete cascades on every athlete-data table do the rest.
//
// Environment:
// - `supabase start` must be running locally for these tests to work.
// - The CLI prints the local-dev keys via `supabase status -o env`. CI
//   wires them up via `--override-name`; local devs can do:
//
//     supabase status -o env \
//       --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
//       --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
//       --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
//       > .env.test.local
//
// - The keys printed by `supabase start` are DETERMINISTIC for local dev
//   (Supabase CLI ships fixed JWTs). They are NOT secrets in this context.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach } from "vitest";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name}. Did you run \`supabase start\` and source the local-dev keys? ` +
        `See apps/web/src/db/__tests__/setup.ts for the helper command.`,
    );
  }
  return v;
}

export function supabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function anonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function serviceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/**
 * Service-role client. Bypasses RLS. Use for test setup/teardown only --
 * never to assert RLS-bound behavior.
 */
export function serviceClient(): SupabaseClient {
  return createClient(supabaseUrl(), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type TestUser = {
  id: string;
  email: string;
  accessToken: string;
  /** A supabase-js client bound to this user's JWT. Use for RLS assertions. */
  client: SupabaseClient;
};

// Module-level registry of user ids created during the current test.
// The afterEach hook below hard-deletes them.
const trackedUserIds = new Set<string>();

/**
 * Create a real auth.users row via the admin API, sign in as that user, and
 * return a JWT-bound supabase-js client. The handle_new_auth_user trigger
 * mirrors the row into public.users automatically.
 *
 * Created users are auto-tracked and deleted after the test finishes.
 */
export async function createTestUser(opts?: {
  email?: string;
  password?: string;
}): Promise<TestUser> {
  const admin = serviceClient();
  const email = opts?.email ?? `vitest-${crypto.randomUUID()}@da2.test`;
  const password = opts?.password ?? "vitest-password-correct-horse-battery-staple";

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`createTestUser: admin.createUser failed: ${createErr?.message ?? "no user returned"}`);
  }

  const userClient = createClient(supabaseUrl(), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !signIn.session) {
    // Roll back the auth.users row if sign-in failed.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw new Error(`createTestUser: signIn failed: ${signInErr?.message ?? "no session"}`);
  }

  trackedUserIds.add(created.user.id);

  return {
    id: created.user.id,
    email,
    accessToken: signIn.session.access_token,
    client: userClient,
  };
}

/**
 * Globally registered afterEach: hard-delete every user created during the
 * test. The auth.users -> public.users FK cascade removes mirrored rows and
 * any athlete-data rows hanging off them.
 *
 * Errors during cleanup are swallowed -- a test failure plus a stale auth
 * row is still recoverable; a teardown error masking the real failure is not.
 */
afterEach(async () => {
  if (trackedUserIds.size === 0) return;
  const admin = serviceClient();
  const ids = Array.from(trackedUserIds);
  trackedUserIds.clear();
  await Promise.all(
    ids.map((id) => admin.auth.admin.deleteUser(id).catch(() => undefined)),
  );
});
