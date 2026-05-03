from dataclasses import dataclass
from uuid import UUID

import jwt

from src.config import get_settings


class InvalidTokenError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class SupabaseClaims:
    sub: UUID
    email: str | None
    role: str


def decode_supabase_jwt(token: str) -> SupabaseClaims:
    settings = get_settings()
    decode_kwargs: dict = {
        "algorithms": ["HS256"],
        "audience": settings.supabase_jwt_aud,
        "options": {"require": ["sub", "exp", "aud"]},
    }
    if settings.supabase_jwt_issuer:
        decode_kwargs["issuer"] = settings.supabase_jwt_issuer
    try:
        payload = jwt.decode(token, settings.supabase_jwt_secret, **decode_kwargs)
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc

    sub = payload.get("sub")
    if not sub:
        raise InvalidTokenError("missing sub claim")

    try:
        user_id = UUID(sub)
    except (TypeError, ValueError) as exc:
        raise InvalidTokenError("sub is not a valid UUID") from exc

    return SupabaseClaims(
        sub=user_id,
        email=payload.get("email"),
        role=payload.get("role", "authenticated"),
    )
