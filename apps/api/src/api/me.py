from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import CurrentUser
from src.db import get_session, set_authenticated_user_guc
from src.models import Entitlement, User
from src.schemas import EntitlementOut, UserOut, UserUpdate

router = APIRouter(prefix="/me", tags=["me"])


async def authed_session(
    claims: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AsyncIterator[AsyncSession]:
    """Yield an AsyncSession with the JWT subject pinned via set_config so any
    triggers / RLS-aware code reads the right `auth.uid()`. Routes still must
    filter explicitly by user_id (RLS is not a defense at the API tier — see
    db/session.py)."""
    await set_authenticated_user_guc(session, claims.sub)
    yield session


SessionDep = Annotated[AsyncSession, Depends(authed_session)]


@router.get("", response_model=UserOut)
async def get_me(claims: CurrentUser, session: SessionDep) -> User:
    user = await session.get(User, claims.sub)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    return user


@router.patch("", response_model=UserOut)
async def update_me(
    payload: UserUpdate, claims: CurrentUser, session: SessionDep
) -> User:
    user = await session.get(User, claims.sub)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.timezone is not None:
        user.timezone = payload.timezone
    await session.commit()
    await session.refresh(user)
    return user


@router.get("/entitlements", response_model=list[EntitlementOut])
async def list_entitlements(
    claims: CurrentUser, session: SessionDep
) -> list[Entitlement]:
    result = await session.execute(
        select(Entitlement).where(Entitlement.user_id == claims.sub)
    )
    return list(result.scalars().all())
