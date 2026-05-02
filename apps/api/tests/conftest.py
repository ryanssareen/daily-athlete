"""Test fixtures.

Strategy:
- Tests run against the database at DATABASE_URL_TEST.
- Once per test session, drop the public schema, re-apply the auth-stub bootstrap, then
  apply every supabase/migrations/*.sql file in order. This gives every test run an
  identical clean schema with no dependency on Supabase running.
- Each test wraps its work in a transaction that rolls back at teardown so test data
  never leaks between cases.
- An `as_user` helper sets `request.jwt.claim.sub` so tests can exercise RLS as a
  specific user.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import UUID, uuid4

import psycopg2
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
TEST_BOOTSTRAP_SQL = Path(__file__).parent / "sql" / "test_bootstrap.sql"


def _test_db_url_async() -> str:
    return os.environ.get(
        "DATABASE_URL_TEST",
        "postgresql+asyncpg://da2:da2_dev@localhost:54322/da2_test",
    )


def _test_db_url_sync() -> str:
    return os.environ.get(
        "DATABASE_URL_TEST_SYNC",
        "postgresql://da2:da2_dev@localhost:54322/da2_test",
    )


def _apply_sql_file(conn: psycopg2.extensions.connection, path: Path) -> None:
    with conn.cursor() as cur:
        cur.execute(path.read_text())
    conn.commit()


@pytest.fixture(scope="session")
def _schema_setup() -> Iterator[None]:
    """Reset the test database schema once per session."""
    # Reach the database without auto-creating it; user must `CREATE DATABASE da2_test;`.
    conn = psycopg2.connect(_test_db_url_sync())
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS public CASCADE;")
            cur.execute("DROP SCHEMA IF EXISTS auth CASCADE;")
            cur.execute("CREATE SCHEMA public;")
            cur.execute("GRANT ALL ON SCHEMA public TO public;")
        conn.autocommit = False

        _apply_sql_file(conn, TEST_BOOTSTRAP_SQL)
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            _apply_sql_file(conn, migration)
    finally:
        conn.close()
    yield


@pytest_asyncio.fixture
async def session(_schema_setup: None) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(_test_db_url_async(), poolclass=NullPool)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as s:
        try:
            yield s
        finally:
            await s.rollback()
            # Truncate everything so tests are independent even when they commit.
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "TRUNCATE TABLE "
                        "public.strava_raw_payloads, "
                        "public.strava_tokens, "
                        "public.entitlements, "
                        "public.users, "
                        "auth.users "
                        "RESTART IDENTITY CASCADE"
                    )
                )
    await engine.dispose()


@pytest_asyncio.fixture
async def make_auth_user(session: AsyncSession):
    """Insert a row into auth.users (which mirrors into public.users via trigger)."""

    async def _make(email: str | None = None, role_flags: list[str] | None = None) -> UUID:
        user_id = uuid4()
        await session.execute(
            text("INSERT INTO auth.users (id, email) VALUES (:id, :email)"),
            {"id": user_id, "email": email or f"{user_id}@example.test"},
        )
        if role_flags is not None:
            await session.execute(
                text("UPDATE public.users SET role_flags = :rf WHERE id = :id"),
                {"rf": role_flags, "id": user_id},
            )
        await session.commit()
        return user_id

    return _make


@pytest_asyncio.fixture
async def as_user(session: AsyncSession):
    """Run a block of work as a specific authenticated user (sets the GUCs read by
    auth.uid() and auth.role() so RLS policies evaluate correctly).
    """

    async def _set(user_id: UUID, role: str = "authenticated") -> None:
        # is_local=false so the GUC persists across statements within the session
        # (autocommit otherwise discards transaction-local settings between executes).
        await session.execute(
            text("SELECT set_config('request.jwt.claim.sub', :sub, false)"),
            {"sub": str(user_id)},
        )
        await session.execute(
            text("SELECT set_config('request.jwt.claim.role', :role, false)"),
            {"role": role},
        )

    return _set
