import time
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from src.auth.jwt import InvalidTokenError, decode_supabase_jwt
from src.config import get_settings
from src.main import app


def _make_token(*, sub: str | None = None, exp_offset: int = 60, secret: str | None = None) -> str:
    settings = get_settings()
    return jwt.encode(
        {
            "sub": sub or str(uuid4()),
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) + exp_offset,
        },
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
