import time
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from src.auth.jwt import InvalidTokenError, decode_supabase_jwt
from src.config import get_settings
from src.main import app


def _make_token(
    *,
    sub: str | None = None,
    exp_offset: int = 60,
    secret: str | None = None,
    aud: str = "authenticated",
    iss: str | None = None,
    extra: dict | None = None,
) -> str:
    settings = get_settings()
    payload = {
        "sub": sub or str(uuid4()),
        "aud": aud,
        "role": "authenticated",
        "exp": int(time.time()) + exp_offset,
    }
    if iss is not None:
        payload["iss"] = iss
    if extra:
        payload.update(extra)
    return jwt.encode(
        payload,
        secret or settings.supabase_jwt_secret,
        algorithm="HS256",
    )


def test_decode_valid_token_returns_claims() -> None:
    user_id = uuid4()
    token = _make_token(sub=str(user_id))
    claims = decode_supabase_jwt(token)
    assert claims.sub == user_id
    assert claims.role == "authenticated"


def test_decode_rejects_expired_token() -> None:
    token = _make_token(exp_offset=-60)
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt(token)


def test_decode_rejects_wrong_secret() -> None:
    token = _make_token(secret="wrong-secret")
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt(token)


def test_decode_rejects_non_uuid_sub() -> None:
    token = _make_token(sub="not-a-uuid")
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt(token)


def test_protected_route_without_token_returns_401() -> None:
    with TestClient(app) as client:
        response = client.get("/me")
    assert response.status_code == 401


def test_protected_route_with_invalid_token_returns_401() -> None:
    with TestClient(app) as client:
        response = client.get("/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_decode_rejects_wrong_audience() -> None:
    token = _make_token(aud="some-other-app")
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt(token)


def test_decode_rejects_token_missing_audience() -> None:
    """The verifier requires 'aud' explicitly to defend against PyJWT versions
    that would otherwise skip audience validation when the claim is absent."""
    settings = get_settings()
    token = jwt.encode(
        {"sub": str(uuid4()), "exp": int(time.time()) + 60},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt(token)


def test_decode_rejects_wrong_issuer_when_pinned(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", "https://da2.supabase.co/auth/v1")
    get_settings.cache_clear()
    try:
        token = _make_token(iss="https://attacker.example.com/auth/v1")
        with pytest.raises(InvalidTokenError):
            decode_supabase_jwt(token)
    finally:
        get_settings.cache_clear()


def test_decode_accepts_correct_issuer_when_pinned(monkeypatch) -> None:
    issuer = "https://da2.supabase.co/auth/v1"
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", issuer)
    get_settings.cache_clear()
    try:
        token = _make_token(iss=issuer)
        claims = decode_supabase_jwt(token)
        assert claims.role == "authenticated"
    finally:
        get_settings.cache_clear()
