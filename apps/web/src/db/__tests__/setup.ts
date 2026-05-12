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
//   transactions cannot span SDK calls. Transaction-rollback (per-test
//   `BEGIN ... ROLLBACK`) was considered and rejected: supabase-js routes
//   every query through a separate PostgREST HTTP call, so no single DB
//   transaction can span multiple SDK calls. Track-and-cleanup is the working
//   substitute. `createTestUser()` tracks each created user id, and the
//   global afterEach hook hard-deletes them via the admin API. The
//   auth.users -> public.users FK cascade plus on-delete cascades on every
//   athlete-data table do the rest.
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

// Hostnames the test harness is willing to talk to. Anything else throws.
// Production DBs reach this list ONLY if someone deliberately adds them, so a
// stray `export NEXT_PUBLIC_SUPABASE_URL=https://<prod>.supabase.co` in a
// developer's shell cannot cause `pnpm test` to issue admin.deleteUser
// against real users.
const ALLOWED_TEST_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "host.docker.internal", // for tests run inside Docker against the host's Supabase
]);

function supabaseUrl(): string {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${url}. ` +
        `Tests only run against a local Supabase stack -- did you run \`supabase start\`?`,
    );
  }
  if (!ALLOWED_TEST_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run tests against non-local Supabase host: ${host}. ` +
        `The DB-backed test harness uses the service-role admin API to create and DELETE auth.users; ` +
        `running it against a non-local DB would mutate real data. ` +
        `Allowed hosts: ${Array.from(ALLOWED_TEST_HOSTS).join(", ")}. ` +
        `If you intentionally need to test against a remote host, edit ALLOWED_TEST_HOSTS in ` +
        `apps/web/src/db/__tests__/setup.ts -- but consider whether a separate sandbox project is safer.`,
    );
  }
  return url;
}

function anonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

function serviceRoleKey(): string {
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
  /** A supabase-js client bound to this user's JWT. Use for RLS assertions. */
  client: SupabaseClient;
};

// Module-level state. Safe ONLY because vitest.config.ts pins pool:forks +
// fileParallelism:false -- each test file runs in its own process with its
// own module instance. Switching to pool:threads would make this Set shared
// across concurrent files, causing afterEach in file A to delete users
// file B's live test is still using. Don't change the pool without
// re-architecting this.
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

  // Track immediately after createUser succeeds, before sign-in. This ensures
  // afterEach can retry the delete even if sign-in fails AND the inline
  // rollback delete below also fails.
  trackedUserIds.add(created.user.id);

  const userClient = createClient(supabaseUrl(), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !signIn.session) {
    // Roll back the auth.users row if sign-in failed.
    await admin.auth.admin.deleteUser(created.user.id).catch((err) =>
      console.warn('[test-cleanup] rollback deleteUser failed:', err?.message ?? err),
    );
    throw new Error(`createTestUser: signIn failed: ${signInErr?.message ?? "no session"}`);
  }

  return {
    id: created.user.id,
    email,
    client: userClient,
  };
}

/**
 * Globally registered afterEach: hard-delete every user created during the
 * test. The auth.users -> public.users FK cascade removes mirrored rows and
 * any athlete-data rows hanging off them.
 *
 * Cleanup failures are logged via console.warn rather than swallowed silently
 * -- a test failure plus a stale auth row is still recoverable, but silent
 * failures make debugging harder.
 */
afterEach(async () => {
  if (trackedUserIds.size === 0) return;
  const admin = serviceClient();
  const ids = Array.from(trackedUserIds);
  await Promise.all(
    ids.map((id) =>
      admin.auth.admin.deleteUser(id).catch((err) =>
        console.warn('[test-cleanup] deleteUser failed for', id, err?.message ?? err),
      ),
    ),
  );
  trackedUserIds.clear();
});
