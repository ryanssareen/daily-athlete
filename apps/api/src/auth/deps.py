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
    return authorization.split(" ", 1)[1].strip()


def current_user(token: Annotated[str, Depends(_bearer_token)]) -> SupabaseClaims:
    try:
        return decode_supabase_jwt(token)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


CurrentUser = Annotated[SupabaseClaims, Depends(current_user)]
