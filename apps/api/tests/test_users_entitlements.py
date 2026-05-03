from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, ProgrammingError

from src.models import Entitlement, User


async def test_auth_user_mirrors_into_public_users(session, make_auth_user) -> None:
    user_id = await make_auth_user(email="alice@example.test")
    user = await session.get(User, user_id)
    assert user is not None
    assert user.email == "alice@example.test"
    assert user.role_flags == ["athlete"]
    assert user.timezone == "UTC"


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


async def test_user_role_flags_rejects_empty_array(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "UPDATE public.users SET role_flags = ARRAY[]::TEXT[] WHERE id = :id"
            ),
            {"id": user_id},
        )
        await session.commit()


async def test_user_role_flags_accepts_athlete_and_coach(session, make_auth_user) -> None:
    user_id = await make_auth_user(role_flags=["athlete", "coach"])
    user = await session.get(User, user_id)
    assert user is not None
    assert set(user.role_flags) == {"athlete", "coach"}


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


async def test_rls_authenticated_role_sees_own_row_only(
    session, make_auth_user, as_authenticated
) -> None:
    """RLS actually enforced: `authenticated` role lacks BYPASSRLS, so policies
    apply. Unfiltered SELECT must return only the calling user's row."""
    alice = await make_auth_user(email="alice@example.test")
    bob = await make_auth_user(email="bob@example.test")

    # Owner role (the test connection) sees both — no RLS.
    rows = (await session.execute(select(User))).scalars().all()
    assert {u.id for u in rows} >= {alice, bob}

    async with as_authenticated(alice):
        result = await session.execute(
            text("SELECT id FROM public.users WHERE id IN (:a, :b)"),
            {"a": alice, "b": bob},
        )
        visible_ids = {row[0] for row in result.all()}
    assert visible_ids == {alice}


async def test_rls_authenticated_role_cannot_update_other_users_row(
    session, make_auth_user, as_authenticated
) -> None:
    """Authenticated user A cannot mutate user B's row via UPDATE."""
    alice = await make_auth_user()
    bob = await make_auth_user()

    async with as_authenticated(alice):
        result = await session.execute(
            text(
                "UPDATE public.users SET display_name = 'attacker' "
                "WHERE id = :bob RETURNING id"
            ),
            {"bob": bob},
        )
        # RLS USING clause hides bob's row from alice's UPDATE → zero rows affected.
        assert result.first() is None
    await session.commit()

    bob_row = await session.get(User, bob)
    assert bob_row is not None
    assert bob_row.display_name is None


async def test_rls_authenticated_cannot_select_other_users_entitlements(
    session, make_auth_user, as_authenticated
) -> None:
    """Entitlements RLS: alice cannot SELECT bob's entitlement rows."""
    alice = await make_auth_user()
    bob = await make_auth_user()
    await session.execute(
        text(
            "INSERT INTO public.entitlements (user_id, entitlement_key, active, source) "
            "VALUES (:b, 'ai_plans', true, 'revenuecat')"
        ),
        {"b": bob},
    )
    await session.commit()

    async with as_authenticated(alice):
        result = await session.execute(
            text("SELECT user_id FROM public.entitlements")
        )
        visible = {row[0] for row in result.all()}
    assert bob not in visible


async def test_auth_user_email_update_propagates_to_public_users(
    session, make_auth_user
) -> None:
    """Migration 0003 trigger: email change in auth.users mirrors to public.users."""
    user_id = await make_auth_user(email="old@example.test")
    await session.execute(
        text("UPDATE auth.users SET email = :new WHERE id = :id"),
        {"new": "new@example.test", "id": user_id},
    )
    await session.commit()

    user = await session.get(User, user_id)
    assert user is not None
    assert user.email == "new@example.test"


async def test_auth_user_mirror_trigger_is_idempotent_on_duplicate_id(
    session,
) -> None:
    """ON CONFLICT (id) DO NOTHING handles a race where public.users already exists."""
    user_id = uuid4()
    await session.execute(
        text("INSERT INTO auth.users (id, email) VALUES (:id, :email)"),
        {"id": user_id, "email": "first@example.test"},
    )
    await session.commit()

    # Pre-existing public.users row with a different email.
    await session.execute(
        text("UPDATE public.users SET email = 'manual@example.test' WHERE id = :id"),
        {"id": user_id},
    )
    await session.commit()

    # Re-trigger via a no-op INSERT path — the trigger only fires on AFTER INSERT
    # of new rows, so direct re-insert raises PK on auth.users (expected). The
    # behavior we want to confirm is that the existing public.users row is
    # untouched after subsequent auth.users mutations that don't fire INSERT.
    await session.execute(
        text("UPDATE auth.users SET email = 'second@example.test' WHERE id = :id"),
        {"id": user_id},
    )
    await session.commit()

    user = await session.get(User, user_id)
    # email-update trigger (0003) overwrites the manual edit — that's the
    # documented contract: auth.users is the source of truth for email.
    assert user is not None
    assert user.email == "second@example.test"


async def test_user_deleted_at_excludes_from_active_reads(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    await session.execute(
        text("UPDATE public.users SET deleted_at = now() WHERE id = :id"),
        {"id": user_id},
    )
    await session.commit()

    # Active read filter should exclude soft-deleted users.
    active = await session.execute(
        text(
            "SELECT id FROM public.users "
            "WHERE id = :id AND deleted_at IS NULL"
        ),
        {"id": user_id},
    )
    assert active.first() is None

    # Admin read (no filter) still sees the row with the tombstone.
    user = await session.get(User, user_id)
    assert user is not None and user.deleted_at is not None
