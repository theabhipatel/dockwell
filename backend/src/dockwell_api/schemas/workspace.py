import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints

from dockwell_api.schemas.common import APIModel, EmailIn, WorkspaceName

RoleName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
Slug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=3,
        max_length=60,
        pattern=r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$",
    ),
]


class WorkspaceCreate(APIModel):
    name: WorkspaceName


class WorkspaceCreated(APIModel):
    id: uuid.UUID
    name: str
    slug: str
    free_credit_micros: int


class WorkspaceUpdate(APIModel):
    name: WorkspaceName | None = None
    slug: Slug | None = None
    default_project_id: uuid.UUID | None = None
    log_retention_days: int | None = Field(default=None, ge=1, le=3650)
    clear_log_retention: bool = False
    store_prompts: bool | None = None


class ConfirmName(APIModel):
    confirm_name: str = Field(max_length=200)


class WorkspaceSummary(APIModel):
    id: uuid.UUID
    name: str
    slug: str
    logo_url: str | None
    is_owner: bool
    is_default: bool
    role_name: str
    owner_name: str
    member_count: int
    suspended: bool


class RoleOut(APIModel):
    id: uuid.UUID
    name: str
    description: str
    rank: int
    system_key: str | None
    permissions: list[str]
    member_count: int
    can_edit: bool
    can_delete: bool
    can_assign: bool


class WorkspaceDetail(APIModel):
    id: uuid.UUID
    name: str
    slug: str
    logo_url: str | None
    owner_id: uuid.UUID
    created_at: datetime
    is_owner: bool
    is_default: bool
    role: RoleOut
    permissions: list[str]
    default_project_id: uuid.UUID | None
    log_retention_days: int | None
    effective_log_retention_days: int
    store_prompts: bool
    prompt_logging_allowed: bool
    suspended: bool
    suspended_reason: str | None
    api_base_url: str


class ProjectRef(APIModel):
    id: uuid.UUID
    name: str


class MemberOut(APIModel):
    user_id: uuid.UUID
    name: str
    email: str
    avatar_url: str | None
    role_id: uuid.UUID
    role_name: str
    role_rank: int
    is_owner: bool
    joined_at: datetime
    all_projects: bool
    projects: list[ProjectRef]
    can_manage: bool


class MemberRoleUpdate(APIModel):
    role_id: uuid.UUID


class MemberProjectsUpdate(APIModel):
    project_ids: list[uuid.UUID] = Field(max_length=500)


class TransferOwnership(APIModel):
    user_id: uuid.UUID
    confirm_name: str = Field(max_length=200)


class InvitationCreate(EmailIn):
    role_id: uuid.UUID
    project_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)


class InvitationOut(APIModel):
    id: uuid.UUID
    email: str
    role_id: uuid.UUID
    role_name: str
    projects: list[ProjectRef]
    invited_by_name: str | None
    status: str
    expired: bool
    created_at: datetime
    last_sent_at: datetime
    expires_at: datetime


class MyInvitation(APIModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    workspace_name: str
    role_name: str
    invited_by_name: str | None
    created_at: datetime
    expires_at: datetime


class AcceptedInvitation(APIModel):
    workspace_id: uuid.UUID


class RoleCreate(APIModel):
    name: RoleName
    description: str = Field(default="", max_length=300)
    permissions: list[str] = Field(max_length=64)
    place_below_role_id: uuid.UUID


class RoleUpdate(APIModel):
    name: RoleName | None = None
    description: str | None = Field(default=None, max_length=300)
    permissions: list[str] | None = Field(default=None, max_length=64)
    place_below_role_id: uuid.UUID | None = None


class RoleDelete(APIModel):
    replacement_role_id: uuid.UUID | None = None
