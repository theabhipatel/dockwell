import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

from dockwell_api.models import User


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(APIModel):
    message: str


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
WorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
Password = Annotated[str, Field(min_length=8, max_length=256)]


class EmailIn(APIModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalise(cls, v: str) -> str:
        return v.strip().lower()


class UserRef(APIModel):
    id: uuid.UUID
    name: str
    email: str
    avatar_url: str | None


def avatar_url(user: User) -> str | None:
    if user.avatar_updated_at is None:
        return None
    return f"/api/users/{user.id}/avatar?v={int(user.avatar_updated_at.timestamp())}"


def user_ref(user: User) -> UserRef:
    return UserRef(id=user.id, name=user.name, email=user.email, avatar_url=avatar_url(user))


class Page[T](APIModel):
    items: list[T]
    total: int


class PermissionInfo(APIModel):
    key: str
    group: str
    label: str
    description: str
