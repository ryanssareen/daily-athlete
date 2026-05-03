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

export async function withTestDb<T>(body: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url() });
  await client.connect();
  try {
    return await body(client);
  } finally {
    try {
      await client.query(TRUNCATE_SQL);
    } catch {
      // Truncate failures during teardown shouldn't mask the real test error.
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
