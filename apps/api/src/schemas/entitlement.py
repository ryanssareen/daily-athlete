from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EntitlementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    entitlement_key: str
    active: bool
    expires_at: datetime | None
