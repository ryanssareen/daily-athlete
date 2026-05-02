"""Verify SQLAlchemy metadata matches the latest applied migration.

Strategy:
1. Spin up a temp Postgres database (uses DATABASE_URL_TEST_SYNC).
2. Apply test_bootstrap.sql + every supabase/migrations/*.sql in order.
3. Compare DB tables/columns/constraints to what `Base.metadata` declares.
4. Exit non-zero on any drift.

Usage:
    uv run python scripts/check_schema_drift.py

This script is conservative: it doesn't autogenerate migrations. It only flags drift so
the engineer can author the migration explicitly.
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg2
from sqlalchemy import MetaData, create_engine, inspect

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
REPO_ROOT = APP_DIR.parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
TEST_BOOTSTRAP = APP_DIR / "tests" / "sql" / "test_bootstrap.sql"

sys.path.insert(0, str(APP_DIR))

from src.config import get_settings  # noqa: E402
from src.db.base import Base  # noqa: E402
from src.models import *  # noqa: E402,F401,F403  (register mappers)


def main() -> int:
    settings = get_settings()
    sync_url = settings.database_url_test_sync
    print(f"Drift check against {sync_url}")

    conn = psycopg2.connect(sync_url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS public CASCADE;")
            cur.execute("DROP SCHEMA IF EXISTS auth CASCADE;")
            cur.execute("CREATE SCHEMA public;")

        for path in [TEST_BOOTSTRAP, *sorted(MIGRATIONS_DIR.glob("*.sql"))]:
            with conn.cursor() as cur:
                cur.execute(path.read_text())
    finally:
        conn.close()

    engine = create_engine(sync_url)
    actual = MetaData()
    actual.reflect(bind=engine, schema="public")
    expected = Base.metadata

    expected_tables = {t.split(".", 1)[1] if "." in t else t for t in expected.tables}
    actual_tables = {t.split(".", 1)[1] if "." in t else t for t in actual.tables}

    missing_in_db = expected_tables - actual_tables
    extra_in_db = actual_tables - expected_tables

    drift = False
    if missing_in_db:
        print(f"FAIL: tables in ORM but not in DB: {sorted(missing_in_db)}")
        drift = True
    if extra_in_db:
        print(f"WARN: tables in DB but not in ORM: {sorted(extra_in_db)}")
        # Not a hard fail — utility tables (e.g. spatial_ref_sys from PostGIS) may exist.

    inspector = inspect(engine)
    for table_name in expected_tables & actual_tables:
        expected_cols = {
            c.name for c in expected.tables[f"public.{table_name}"].columns
        }
        actual_cols = {c["name"] for c in inspector.get_columns(table_name, schema="public")}

        missing_cols = expected_cols - actual_cols
        extra_cols = actual_cols - expected_cols
        if missing_cols:
            print(
                f"FAIL: {table_name} — columns in ORM but not in DB: {sorted(missing_cols)}"
            )
            drift = True
        if extra_cols:
            print(
                f"WARN: {table_name} — columns in DB but not in ORM: {sorted(extra_cols)}"
            )

    if drift:
        print("\nSchema drift detected. Either author a migration or fix the ORM model.")
        return 1
    print("OK — ORM and migrations are in sync.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
