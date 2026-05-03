"""Database engine + session factory.

Architecture note (RLS):
- The FastAPI app connects to Postgres with credentials that own (or have
  BYPASSRLS on) the relevant tables. RLS is therefore NOT a defense at the API
  tier — every query that returns user-scoped rows MUST filter by the
  authenticated user explicitly.
- RLS exists to protect direct-from-client paths (Supabase SDK with the anon
  key, Realtime subscriptions). The FastAPI server is trusted; the browser
  client is not.
- Per-request, the API still calls `set_authenticated_user_guc()` so that any
  server-side code path that does happen to hit RLS-bound tables (e.g., a
  Postgres trigger that reads `auth.uid()`) sees the right user. This keeps
  application behavior consistent with what the Supabase client would observe.
- See AGENTS.md "Database & migrations" for the rule that every user-scoped
  query has an explicit `WHERE user_id = ...` clause.
"""
from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    echo=False,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def set_authenticated_user_guc(session: AsyncSession, user_id: UUID) -> None:
    """Pin auth.uid() to the authenticated user for the lifetime of this session.

    Uses session-scoped (`is_local=false`) GUCs so the value persists across
    autocommit-style executes within the same SQLAlchemy session.
    """
    await session.execute(
        text("SELECT set_config('request.jwt.claim.sub', :sub, false)"),
        {"sub": str(user_id)},
    )
    await session.execute(
        text("SELECT set_config('request.jwt.claim.role', 'authenticated', false)")
    )


async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session
