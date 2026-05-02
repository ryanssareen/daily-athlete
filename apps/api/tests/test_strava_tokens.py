from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from src.models import StravaToken
from src.security import TokenCryptoError, decrypt_strava_token, encrypt_strava_token


async def test_round_trip_encrypt_decrypt(session) -> None:
    plaintext = "strava-access-token-1234567890abcdef"
    enc = await encrypt_strava_token(session, plaintext)
    assert isinstance(enc, bytes) and len(enc) > 0 and enc != plaintext.encode()
    pt = await decrypt_strava_token(session, enc)
    assert pt == plaintext


async def test_encrypt_rejects_committed_placeholder_key(session, monkeypatch) -> None:
    from src.config import get_settings
    from src.security.token_crypto import _ENV_PLACEHOLDER

    get_settings.cache_clear()
    monkeypatch.setenv("STRAVA_TOKEN_KEY", _ENV_PLACEHOLDER)
    try:
        with pytest.raises(TokenCryptoError):
            await encrypt_strava_token(session, "anything")
    finally:
        get_settings.cache_clear()


async def test_encrypt_rejects_short_key(session, monkeypatch) -> None:
    from src.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("STRAVA_TOKEN_KEY", "too-short")
    try:
        with pytest.raises(TokenCryptoError):
            await encrypt_strava_token(session, "anything")
    finally:
        get_settings.cache_clear()


async def test_strava_token_persistence(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    access_enc = await encrypt_strava_token(session, "access-1")
    refresh_enc = await encrypt_strava_token(session, "refresh-1")
    expires_at = datetime.now(timezone.utc) + timedelta(hours=6)

    await session.execute(
        text(
            "INSERT INTO public.strava_tokens "
            "(user_id, access_token_enc, refresh_token_enc, expires_at, scope, "
            "athlete_strava_id) "
            "VALUES (:u, :a, :r, :e, :s, :sid)"
        ),
        {
            "u": user_id,
            "a": access_enc,
            "r": refresh_enc,
            "e": expires_at,
            "s": "read,activity:read_all",
            "sid": 12345,
        },
    )
    await session.commit()

    row = (
        await session.execute(select(StravaToken).where(StravaToken.user_id == user_id))
    ).scalar_one()
    assert row.athlete_strava_id == 12345
    assert (await decrypt_strava_token(session, row.access_token_enc)) == "access-1"


async def test_athlete_strava_id_is_unique_across_users(session, make_auth_user) -> None:
    alice = await make_auth_user()
    bob = await make_auth_user()
    enc = await encrypt_strava_token(session, "tok")

    await session.execute(
        text(
            "INSERT INTO public.strava_tokens "
            "(user_id, access_token_enc, refresh_token_enc, expires_at, scope, "
            "athlete_strava_id) VALUES (:u, :a, :r, now()+interval '1 hour', 'r', 999)"
        ),
        {"u": alice, "a": enc, "r": enc},
    )
    await session.commit()

    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "INSERT INTO public.strava_tokens "
                "(user_id, access_token_enc, refresh_token_enc, expires_at, scope, "
                "athlete_strava_id) VALUES (:u, :a, :r, now()+interval '1 hour', 'r', 999)"
            ),
            {"u": bob, "a": enc, "r": enc},
        )
        await session.commit()
