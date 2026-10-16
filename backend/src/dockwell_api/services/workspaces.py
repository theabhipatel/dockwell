import re
import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.db import utcnow
from dockwell_api.models import Membership, Project, ProjectMember, Role, User, Workspace
from dockwell_api.permissions import (
    DEFAULT_ROLES,
    MAX_ASSIGNABLE_RANK,
    OWNER_RANK,
    Actor,
    Perm,
    can_manage_rank,
)
from dockwell_api.schemas.workspace import RoleOut
from dockwell_api.services import credits, platform

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$")


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-")
    return slug or "workspace"


async def unique_slug(db: AsyncSession, name: str) -> str:
    base = slugify(name)
    candidate = base
    for _ in range(20):
        taken = await db.scalar(select(exists().where(Workspace.slug == candidate)))
        if not taken:
            return candidate
        candidate = f"{base}-{secrets.token_hex(2)}"
    return f"{base}-{secrets.token_hex(4)}"


async def create_workspace(db: AsyncSession, owner: User, name: str) -> tuple[Workspace, int]:
    """Create a workspace with the built-in roles and a default project.

    Returns the workspace and the starter credit granted (only for the account's first one).
    """
    config = await platform.get_config(db)
    workspace = Workspace(
        name=name,
        slug=await unique_slug(db, name),
        owner_id=owner.id,
        billing_email=owner.email,
        rpm_limit=None,
        tpm_limit=None,
        monthly_spend_limit_micros=config.default_workspace_monthly_limit_micros,
    )
    db.add(workspace)
    await db.flush()
    owner_role: Role | None = None
    for default in DEFAULT_ROLES:
        role = Role(
            workspace_id=workspace.id,
            name=default.name,
            description=default.description,
            rank=default.rank,
            system_key=default.system_key,
            permissions=sorted(p.value for p in default.permissions),
        )
        db.add(role)
        if default.system_key == "owner":
            owner_role = role
    await db.flush()
    assert owner_role is not None
    db.add(
        Membership(
            workspace_id=workspace.id,
            user_id=owner.id,
            role_id=owner_role.id,
            is_owner=True,
            joined_at=utcnow(),
        )
    )
    project = Project(workspace_id=workspace.id, name="Default project", created_by_id=owner.id)
    db.add(project)
    await db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=owner.id, added_by_id=owner.id))
    workspace.default_project_id = project.id
    if owner.default_workspace_id is None:
        owner.default_workspace_id = workspace.id
    if owner.onboarded_at is None:
        owner.onboarded_at = utcnow()
    await db.flush()
    granted = await credits.grant_free_credit(db, owner, workspace)
    return workspace, granted


async def get_role(db: AsyncSession, workspace_id: uuid.UUID, role_id: uuid.UUID) -> Role:
    role = await db.scalar(
        select(Role).where(Role.id == role_id, Role.workspace_id == workspace_id)
    )
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found.")
    return role


async def get_system_role(db: AsyncSession, workspace_id: uuid.UUID, key: str) -> Role:
    role = await db.scalar(
        select(Role).where(Role.workspace_id == workspace_id, Role.system_key == key)
    )
    if role is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Workspace roles are missing.")
    return role


def role_out(role: Role, actor: Actor, member_count: int) -> RoleOut:
    is_owner_role = role.system_key == "owner"
    perms = frozenset(role.permissions or [])
    manageable = not is_owner_role and can_manage_rank(actor, role.rank)
    return RoleOut(
        id=role.id,
        name=role.name,
        description=role.description,
        rank=role.rank,
        system_key=role.system_key,
        permissions=sorted(perms),
        member_count=member_count,
        can_edit=manageable and actor.has(Perm.ROLES_MANAGE),
        can_delete=manageable and actor.has(Perm.ROLES_MANAGE) and role.system_key is None,
        can_assign=manageable and (actor.is_owner or perms <= actor.permissions),
    )


async def role_member_counts(db: AsyncSession, workspace_id: uuid.UUID) -> dict[uuid.UUID, int]:
    rows = await db.execute(
        select(Membership.role_id, func.count())
        .where(Membership.workspace_id == workspace_id)
        .group_by(Membership.role_id)
    )
    return {r[0]: r[1] for r in rows}


async def rank_below(
    db: AsyncSession, workspace_id: uuid.UUID, anchor: Role, moving: Role | None = None
) -> int:
    """Return a free rank directly below `anchor`, renumbering the ladder if there is no gap."""
    for _ in range(2):
        others = [
            r
            for r in (
                await db.execute(
                    select(Role).where(Role.workspace_id == workspace_id).order_by(Role.rank.desc())
                )
            ).scalars()
            if moving is None or r.id != moving.id
        ]
        lower = [r.rank for r in others if r.rank < anchor.rank]
        floor = max(lower) if lower else 0
        if anchor.rank - floor >= 2:
            return (anchor.rank + floor) // 2
        await _renumber(db, others)
    raise HTTPException(status.HTTP_409_CONFLICT, "Could not place the role. Try again.")


async def _renumber(db: AsyncSession, ordered_desc: list[Role]) -> None:
    """Spread non-owner ranks evenly, preserving order (the rank constraint is deferred)."""
    ladder = [r for r in ordered_desc if r.system_key != "owner"]
    step = max(MAX_ASSIGNABLE_RANK // (len(ladder) + 1), 2)
    for i, role in enumerate(ladder):
        role.rank = MAX_ASSIGNABLE_RANK - step * (i + 1) + step // 2
    for role in ordered_desc:
        if role.system_key == "owner":
            role.rank = OWNER_RANK
    await db.flush()
