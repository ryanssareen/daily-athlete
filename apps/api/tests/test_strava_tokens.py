import secrets
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from src.models import StravaToken
from src.security import (
    TokenCryptoError,
    decrypt_strava_token,
    encrypt_strava_token,
    reset_key_cache,
)


@pytest.fixture(autouse=True)
def _ensure_real_token_key(monkeypatch):
    """Most tests run against a real (random) Strava token key. Tests that want
    to assert config-rejection paths override the env vars themselves."""
    from src.config import get_settings

    monkeypatch.setenv("STRAVA_TOKEN_KEYS", f"1:{secrets.token_urlsafe(32)}")
    get_settings.cache_clear()
    reset_key_cache()
    yield
    get_settings.cache_clear()
    reset_key_cache()


async def test_round_trip_encrypt_decrypt() -> None:
    plaintext = "strava-access-token-1234567890abcdef"
    enc, version = encrypt_strava_token(plaintext)
    assert isinstance(enc, bytes) and len(enc) > 0 and enc != plaintext.encode()
    assert version == 1
    pt = decrypt_strava_token(enc, version)
    assert pt == plaintext


async def test_encrypt_rejects_committed_placeholder_key(monkeypatch) -> None:
    from src.config import _PLACEHOLDER_TOKEN_KEY, get_settings

    monkeypatch.delenv("STRAVA_TOKEN_KEYS", raising=False)
    monkeypatch.setenv("STRAVA_TOKEN_KEY", _PLACEHOLDER_TOKEN_KEY)
    get_settings.cache_clear()
    reset_key_cache()
    with pytest.raises(TokenCryptoError):
        encrypt_strava_token("anything")


async def test_encrypt_rejects_short_single_key(monkeypatch) -> None:
    from src.config import get_settings

    monkeypatch.delenv("STRAVA_TOKEN_KEYS", raising=False)
    monkeypatch.setenv("STRAVA_TOKEN_KEY", "too-short")
    get_settings.cache_clear()
    reset_key_cache()
    with pytest.raises(TokenCryptoError):
        encrypt_strava_token("anything")


async def test_decrypt_with_unknown_key_version_raises() -> None:
    enc, version = encrypt_strava_token("hello")
    with pytest.raises(TokenCryptoError):
        decrypt_strava_token(enc, key_version=version + 99)


async def test_multi_key_rotation(monkeypatch) -> None:
    """Old ciphertext under key v1 still decrypts after v2 is added; new
    encryptions use the highest version."""
    from src.config import get_settings

    k1 = secrets.token_urlsafe(32)
    monkeypatch.setenv("STRAVA_TOKEN_KEYS", f"1:{k1}")
    get_settings.cache_clear()
    reset_key_cache()
    enc_v1, ver_v1 = encrypt_strava_token("legacy-token")
    assert ver_v1 == 1

    # Operator rotates: adds v2, keeps v1 for legacy decryption.
    k2 = secrets.token_urlsafe(32)
    monkeypatch.setenv("STRAVA_TOKEN_KEYS", f"1:{k1},2:{k2}")
    get_settings.cache_clear()
    reset_key_cache()

    enc_v2, ver_v2 = encrypt_strava_token("new-token")
    assert ver_v2 == 2
    assert decrypt_strava_token(enc_v1, 1) == "legacy-token"
    assert decrypt_strava_token(enc_v2, 2) == "new-token"


async def test_strava_token_persistence(session, make_auth_user) -> None:
    user_id = await make_auth_user()
    access_enc, ver = encrypt_strava_token("access-1")
    refresh_enc, _ = encrypt_strava_token("refresh-1")
    expires_at = datetime.now(timezone.utc) + timedelta(hours=6)

    await session.execute(
        text(
            "INSERT INTO public.strava_tokens "
            "(user_id, access_token_enc, refresh_token_enc, key_version, "
            "expires_at, scope, athlete_strava_id) "
            "VALUES (:u, :a, :r, :v, :e, :s, :sid)"
        ),
        {
            "u": user_id,
            "a": access_enc,
            "r": refresh_enc,
            "v": ver,
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
    assert row.key_version == ver
    assert decrypt_strava_token(row.access_token_enc, row.key_version) == "access-1"


async def test_athlete_strava_id_is_unique_across_users(session, make_auth_user) -> None:
    alice = await make_auth_user()
    bob = await make_auth_user()
    enc, ver = encrypt_strava_token("tok")

    await session.execute(
        text(
            "INSERT INTO public.strava_tokens "
            "(user_id, access_token_enc, refresh_token_enc, key_version, "
            "expires_at, scope, athlete_strava_id) "
            "VALUES (:u, :a, :r, :v, now()+interval '1 hour', 'r', 999)"
        ),
        {"u": alice, "a": enc, "r": enc, "v": ver},
    )
    await session.commit()

    with pytest.raises(IntegrityError):
        await session.execute(
            text(
                "INSERT INTO public.strava_tokens "
                "(user_id, access_token_enc, refresh_token_enc, key_version, "
                "expires_at, scope, athlete_strava_id) "
                "VALUES (:u, :a, :r, :v, now()+interval '1 hour', 'r', 999)"
            ),
            {"u": bob, "a": enc, "r": enc, "v": ver},
        )
        await session.commit()
