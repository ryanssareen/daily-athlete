from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    # Plain str: auth.users.email is TEXT and Supabase Auth owns format validation
    # upstream. EmailStr would 500 on any historically-permitted edge case.
    email: str | None
    display_name: str | None
    role_flags: list[str]
    timezone: str
    created_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
