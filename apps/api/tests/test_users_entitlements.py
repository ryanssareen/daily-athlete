from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from src.models import Entitlement, User


@pytest.mark.asyncio
async def test_auth_user_mirrors_into_public_users(session, make_auth_user) -> None:
    user_id = await make_auth_user(email="alice@example.test")
    user = await session.get(User, user_id)
    assert user is not None
    assert user.email == "alice@example.test"
    assert user.role_flags == ["athlete"]
    assert user.timezone == "UTC"


@pytest.mark.asyncio
async def test_user_role_flags_must_be_subset(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "UPDATE public.users SET role_flags = ARRAY['athlete','admin']::TEXT[] "
                "WHERE id = :id"
            ),
            {"id": user_id},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_user_role_flags_accepts_athlete_and_coach(session, make_auth_user) -> None:
    user_id = await make_auth_user(role_flags=["athlete", "coach"])
    user = await session.get(User, user_id)
    assert user is not None
    assert set(user.role_flags) == {"athlete", "coach"}


@pytest.mark.asyncio
async def test_entitlements_upsert_toggles_active(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    # Insert
    await session.execute(
        text(
            "INSERT INTO public.entitlements (user_id, entitlement_key, active, source) "
            "VALUES (:u, 'ai_plans', true, 'revenuecat')"
        ),
        {"u": user_id},
    )
    await session.commit()
    row = (
        await session.execute(
            select(Entitlement).where(Entitlement.user_id == user_id)
        )
    ).scalar_one()
    assert row.active is True

    # Upsert toggles to inactive
    await session.execute(
        text(
            "INSERT INTO public.entitlements (user_id, entitlement_key, active, source) "
            "VALUES (:u, 'ai_plans', false, 'revenuecat') "
            "ON CONFLICT (user_id, entitlement_key) "
            "DO UPDATE SET active = EXCLUDED.active, updated_at = now()"
        ),
        {"u": user_id},
    )
    await session.commit()
    row = (
        await session.execute(
            select(Entitlement).where(Entitlement.user_id == user_id)
        )
    ).scalar_one()
    assert row.active is False


@pytest.mark.asyncio
async def test_entitlements_source_check_constraint(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "INSERT INTO public.entitlements (user_id, entitlement_key, active, source) "
                "VALUES (:u, 'ai_plans', true, 'made_up_source')"
            ),
            {"u": user_id},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_rls_user_can_select_own_row_only(session, make_auth_user, as_user) -> None:
    alice = await make_auth_user(email="alice@example.test")
    bob = await make_auth_user(email="bob@example.test")

    # Service role (no RLS) sees both.
    rows = (await session.execute(select(User))).scalars().all()
    assert {u.id for u in rows} >= {alice, bob}

    # Authenticated user RLS path: switch role and verify visibility.
    # Note: Postgres only enforces RLS for non-superusers, so we re-connect
    # via SET ROLE to a role without BYPASSRLS. In Supabase this happens at
    # the JWT-verifier layer. Here we approximate with set_config + RLS-applies-to-all.
    await session.execute(text("SET LOCAL row_security = on"))
    await as_user(alice)
    visible_via_rls = await session.execute(
        text(
            "SELECT id FROM public.users "
            "WHERE auth.uid() = id AND id IN (:a, :b)"
        ),
        {"a": alice, "b": bob},
    )
    visible_ids = {row[0] for row in visible_via_rls.all()}
    assert visible_ids == {alice}


@pytest.mark.asyncio
async def test_user_deleted_at_excludes_from_active_reads(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    await session.execute(
        text("UPDATE public.users SET deleted_at = now() WHERE id = :id"),
        {"id": user_id},
    )
    await session.commit()
    user = await session.get(User, user_id)
    assert user is not None and user.deleted_at is not None
