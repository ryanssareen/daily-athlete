from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from src.auth.jwt import InvalidTokenError, SupabaseClaims, decode_supabase_jwt


def _bearer_token(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def current_user(token: Annotated[str, Depends(_bearer_token)]) -> SupabaseClaims:
    try:
        return decode_supabase_jwt(token)
    except InvalidTokenError as exc:
        # Don't echo the underlying JWT error — it leaks "expired" vs "bad signature"
        # which helps attackers probing for valid tokens.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


CurrentUser = Annotated[SupabaseClaims, Depends(current_user)]
