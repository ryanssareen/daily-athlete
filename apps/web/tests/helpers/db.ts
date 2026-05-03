/**
 * Per-test Postgres helper.
 *
 * Each test that touches the DB calls `withTestDb(async (client) => { ... })`.
 * The helper opens a dedicated connection (no pool — avoids PgBouncer
 * transaction-mode quirks under parallelism), runs the test body, then
 * TRUNCATEs every user-data table on teardown so subsequent tests see a
 * clean slate.
 *
 * `asAuthenticated(client, userId, body)` runs `body` inside a single
 * BEGIN/COMMIT transaction with `SET LOCAL ROLE authenticated;
 * SET LOCAL request.jwt.claim.sub = <userId>;` so RLS policies are actually
 * enforced (the `authenticated` role lacks BYPASSRLS, so policies apply).
 * This is the only place SET LOCAL is used in the codebase — within an
 * explicit transaction, where the GUC scoping is correct.
 *
 * Constraints:
 * - **Not nestable.** Do not call asAuthenticated from within another
 *   asAuthenticated body, and do not issue an additional BEGIN inside the body.
 *   Postgres silently no-ops a nested BEGIN (a NOTICE is emitted but not an
 *   error), and a stray inner COMMIT would terminate the outer transaction —
 *   silently dropping the SET LOCAL ROLE so the rest of the body runs as the
 *   connection's default (typically owner/superuser, which bypasses RLS).
 *   That would produce false-green RLS tests. Use SAVEPOINT if you need
 *   nesting.
 * - **Single-DB parallelism caveat.** Vitest runs each test FILE in its own
 *   worker (forks pool, isolate=true). Within one file tests are sequential,
 *   but two files may run concurrently against the same Postgres database.
 *   The teardown TRUNCATE is global, so cross-file tests must not rely on
 *   row state surviving across describe blocks. As Wave 2 grows the suite,
 *   move to schema-per-worker or savepoint-per-test if cross-file races appear.
 */
import pg from "pg";

const TRUNCATE_SQL = `TRUNCATE TABLE
  public.strava_raw_payloads,
  public.strava_tokens,
  public.entitlements,
  public.users,
  auth.users
RESTART IDENTITY CASCADE`;

function url(): string {
  return (
    process.env.DATABASE_URL_TEST_SYNC ||
    "postgresql://postgres:postgres@localhost:54322/da2_test"
  );
}

function bootstrapSkipped(): boolean {
  return process.env.__DA2_TEST_DB_BOOTSTRAP_SKIPPED__ === "1";
}

export async function withTestDb<T>(body: (client: pg.Client) => Promise<T>): Promise<T> {
  if (bootstrapSkipped()) {
    throw new Error(
      "withTestDb cannot run because the test-DB bootstrap was skipped " +
        "(no Postgres reachable at startup). Start docker compose or set " +
        "DATABASE_URL_TEST_SYNC, then rerun.",
    );
  }
  const client = new pg.Client({ connectionString: url() });
  await client.connect();
  let bodyError: unknown;
  try {
    return await body(client);
  } catch (err) {
    bodyError = err;
    throw err;
  } finally {
    try {
      await client.query(TRUNCATE_SQL);
    } catch (err) {
      // If the body already errored, surfacing the truncate error would mask the
      // real failure. If the body succeeded and truncate failed, that's a real
      // teardown bug we want to see — log it loudly instead of silently swallowing.
      if (!bodyError) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[withTestDb] TRUNCATE on teardown failed: ${msg}`);
      }
    }
    await client.end();
  }
}

export async function asAuthenticated<T>(
  client: pg.Client,
  userId: string,
  body: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
    const result = await body();
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
