import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from src.models import StravaRawPayload


async def test_insert_webhook_payload(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    await session.execute(
        text(
            "INSERT INTO public.strava_raw_payloads (user_id, kind, payload) "
            "VALUES (:u, 'webhook', '{\"object_id\": 1}'::jsonb)"
        ),
        {"u": user_id},
    )
    await session.commit()
    rows = (
        await session.execute(
            select(StravaRawPayload).where(StravaRawPayload.user_id == user_id)
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].kind == "webhook"
    assert rows[0].payload == {"object_id": 1}


async def test_kind_check_constraint(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "INSERT INTO public.strava_raw_payloads (user_id, kind, payload) "
                "VALUES (:u, 'invalid_kind', '{}'::jsonb)"
            ),
            {"u": user_id},
        )
        await session.commit()


async def test_retention_query_finds_old_rows(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    # Old row
    await session.execute(
        text(
            "INSERT INTO public.strava_raw_payloads (user_id, kind, payload, arrived_at) "
            "VALUES (:u, 'hydration', '{}'::jsonb, now() - interval '45 days')"
        ),
        {"u": user_id},
    )
    # Fresh row
    await session.execute(
        text(
            "INSERT INTO public.strava_raw_payloads (user_id, kind, payload) "
            "VALUES (:u, 'hydration', '{}'::jsonb)"
        ),
        {"u": user_id},
    )
    await session.commit()

    result = await session.execute(
        text(
            "SELECT count(*) FROM public.strava_raw_payloads "
            "WHERE arrived_at < now() - interval '30 days'"
        )
    )
    assert result.scalar_one() == 1
