# DA2 API

FastAPI backend on Python 3.13 + SQLAlchemy 2.x async + Pydantic v2.

## Setup

```bash
# Install
uv sync

# Local DB (run from repo root)
docker compose up -d postgres redis

# Apply migrations to dev DB (in order — file names are alphanumeric).
for f in ../../supabase/migrations/*.sql; do psql "$DATABASE_URL_SYNC" -f "$f"; done

# Or use Supabase CLI for the full local stack:
# supabase start
```

## Run

```bash
uv run uvicorn src.main:app --reload --port 8000
```

## Test

```bash
# Tests need a separate test DB. Bootstrap once:
psql "$DATABASE_URL_SYNC" -c "CREATE DATABASE da2_test;"
uv run pytest
```

The test fixture in `tests/conftest.py` applies an auth-stub bootstrap (so plain Postgres
can simulate Supabase's `auth` schema) plus all production migrations, then wraps each
test in a transaction that rolls back.

## Schema drift check

```bash
uv run python scripts/check_schema_drift.py
```

This verifies that SQLAlchemy metadata matches the latest applied migration and that
every user-scoped table is referenced in the account-deletion cascade (once Unit 10
ships).

## Layout

```
src/
  main.py        FastAPI app
  config.py      Pydantic settings
  db/            Async engine + session
  auth/          JWT verifier + dependencies
  models/        SQLAlchemy ORM
  schemas/       Pydantic models (request/response)
  security/      Token encryption helpers
  api/           Route modules
  observability/ Sentry + Langfuse hooks
scripts/
  check_schema_drift.py
tests/
  conftest.py    Async DB fixture, RLS-as-user helper
  sql/           Test-only auth stub
```
