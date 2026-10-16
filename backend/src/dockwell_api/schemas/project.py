import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import Field, StringConstraints

from dockwell_api.schemas.common import APIModel, UserRef

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
KeyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Limit = Annotated[int, Field(ge=1, le=100_000_000)]
Micros = Annotated[int, Field(ge=0, le=10**15)]


class ProjectOut(APIModel):
    id: uuid.UUID
    name: str
    description: str
    archived_at: datetime | None
    created_at: datetime
    rpm_limit: int | None
    tpm_limit: int | None
    monthly_spend_limit_micros: int | None
    period_spend_micros: int
    key_count: int
    member_count: int
    is_default: bool
    can_manage: bool


class ProjectCreate(APIModel):
    name: ProjectName
    description: str = Field(default="", max_length=1000)


class ProjectUpdate(APIModel):
    """Fields that are sent are changed; send null to clear a limit."""

    name: ProjectName | None = None
    description: str | None = Field(default=None, max_length=1000)
    rpm_limit: Limit | None = None
    tpm_limit: Limit | None = None
    monthly_spend_limit_micros: Micros | None = None


class ProjectMemberOut(APIModel):
    user_id: uuid.UUID
    name: str
    email: str
    avatar_url: str | None
    role_name: str
    via: Literal["assigned", "all_projects"]


class ProjectMembersUpdate(APIModel):
    user_ids: list[uuid.UUID] = Field(max_length=1000)


KeyStatus = Literal["active", "revoked", "expired"]


class ApiKeyOut(APIModel):
    id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    name: str
    display: str
    created_by: UserRef | None
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None
    status: KeyStatus
    allowed_models: list[str]
    spend_limit_micros: int | None
    spent_micros: int
    rpm_limit: int | None
    tpm_limit: int | None
    can_manage: bool


class ApiKeyCreate(APIModel):
    project_id: uuid.UUID
    name: KeyName
    expires_at: datetime | None = None
    allowed_models: list[str] = Field(default_factory=list, max_length=200)
    spend_limit_micros: Micros | None = None
    rpm_limit: Limit | None = None
    tpm_limit: Limit | None = None


class ApiKeyCreated(APIModel):
    key: ApiKeyOut
    # Shown exactly once; only a hash is stored.
    secret: str


class ApiKeyUpdate(APIModel):
    name: KeyName | None = None
    expires_at: datetime | None = None
    allowed_models: list[str] | None = Field(default=None, max_length=200)
    spend_limit_micros: Micros | None = None
    rpm_limit: Limit | None = None
    tpm_limit: Limit | None = None


class ActivityOut(APIModel):
    id: int
    created_at: datetime
    action: str
    actor_id: uuid.UUID | None
    actor_name: str | None
    actor_email: str | None
    target_type: str | None
    target_id: str | None
    target_label: str | None
    project_id: uuid.UUID | None
    project_name: str | None
    result: str
    ip: str | None
    user_agent: str | None
    details: dict[str, Any]


class NotificationOut(APIModel):
    id: uuid.UUID
    type: str
    title: str
    body: str
    link: str | None
    workspace_id: uuid.UUID | None
    created_at: datetime
    read_at: datetime | None


class NotificationList(APIModel):
    items: list[NotificationOut]
    unread_count: int
