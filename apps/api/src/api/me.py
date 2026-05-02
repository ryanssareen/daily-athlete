from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import CurrentUser
from src.db import get_session
from src.models import Entitlement, User
from src.schemas import EntitlementOut, UserOut, UserUpdate

router = APIRouter(prefix="/me", tags=["me"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


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
