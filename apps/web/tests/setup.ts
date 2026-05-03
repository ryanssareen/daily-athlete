/**
 * Vitest global setup — runs once per test run before any test file.
 *
 * - Refuses to run against any database whose name does not end with `_test`
 *   (carries forward the Wave-1 ce:review hardening).
 * - Drops and recreates `public` and `auth` schemas.
 * - Applies tests/sql/test_bootstrap.sql (auth-schema stub, role grants).
 * - Applies every supabase/migrations/*.sql in lexicographic order.
 *
 * Per-test cleanup (TRUNCATE) lives in tests/helpers/db.ts so each test file
 * controls its own teardown shape.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import pg from "pg";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const TEST_BOOTSTRAP_SQL = path.join(__dirname, "sql", "test_bootstrap.sql");

function databaseUrl(): string {
  return (
    process.env.DATABASE_URL_TEST_SYNC ||
    "postgresql://postgres:postgres@localhost:54322/da2_test"
  );
}

function dbNameFromUrl(url: string): string {
  // Last path segment, ignoring query string.
  const noQuery = url.split("?")[0];
  return noQuery.slice(noQuery.lastIndexOf("/") + 1);
}

export default async function globalSetup(): Promise<void> {
  if (process.env.SKIP_DB_SETUP === "1") {
    return;
  }
  const url = databaseUrl();
  const dbName = dbNameFromUrl(url);
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `refusing to bootstrap database ${JSON.stringify(dbName)}: test database name must end with "_test"`,
    );
  }

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      console.warn(
        `[tests/setup] skipping schema bootstrap — no Postgres at ${url} ` +
          `(set DATABASE_URL_TEST_SYNC or start docker compose). DB-touching tests will fail clearly.`,
      );
      return;
    }
    throw err;
  }
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE;");
    await client.query("DROP SCHEMA IF EXISTS auth CASCADE;");
    await client.query("CREATE SCHEMA public;");
    await client.query("GRANT ALL ON SCHEMA public TO public;");

    const bootstrap = readFileSync(TEST_BOOTSTRAP_SQL, "utf8");
    await client.query(bootstrap);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      try {
        await client.query(sql);
      } catch (err) {
        throw new Error(`migration ${f} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}
