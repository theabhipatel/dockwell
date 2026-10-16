"""Workspaces, settings, membership and ownership transfer."""

import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from sqlalchemy import delete, exists, func, select
from sqlalchemy.orm import aliased, undefer

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, CurrentAuth, Meta, WsCtx, load_workspace_context
from dockwell_api.models import (
    Membership,
    Project,
    ProjectMember,
    Reservation,
    Role,
    User,
    Workspace,
)
from dockwell_api.permissions import (
    Perm,
    PermissionDenied,
    can_manage_rank,
    check_assignable_role,
    check_manage_member,
)
from dockwell_api.routers.account import read_image
from dockwell_api.schemas.common import Message, avatar_url
from dockwell_api.schemas.workspace import (
    ConfirmName,
    MemberOut,
    MemberProjectsUpdate,
    MemberRoleUpdate,
    ProjectRef,
    TransferOwnership,
    WorkspaceCreate,
    WorkspaceCreated,
    WorkspaceDetail,
    WorkspaceSummary,
    WorkspaceUpdate,
)
from dockwell_api.services import audit, notifications, platform
from dockwell_api.services.access import accessible_project_ids
from dockwell_api.services.workspaces import (
    create_workspace,
    get_role,
    get_system_role,
    role_member_counts,
    role_out,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

MAX_LOGO_BYTES = 512_000


def logo_url(ws: Workspace) -> str | None:
    if ws.logo_updated_at is None:
        return None
    return f"/api/workspaces/{ws.id}/logo?v={int(ws.logo_updated_at.timestamp())}"


@router.get("")
async def list_workspaces(auth: CurrentAuth, db: DB) -> list[WorkspaceSummary]:
    owner = aliased(User)
    counts = (
        select(Membership.workspace_id, func.count().label("n"))
        .group_by(Membership.workspace_id)
        .subquery()
    )
    rows = await db.execute(
        select(Workspace, Membership.is_owner, Role.name, owner.name, counts.c.n)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .join(Role, Role.id == Membership.role_id)
        .join(owner, owner.id == Workspace.owner_id)
        .join(counts, counts.c.workspace_id == Workspace.id)
        .where(Membership.user_id == auth.user.id)
        .order_by(func.lower(Workspace.name))
    )
    return [
        WorkspaceSummary(
            id=ws.id,
            name=ws.name,
            slug=ws.slug,
            logo_url=logo_url(ws),
            is_owner=is_owner,
            role_name=role_name,
            owner_name=owner_name,
            member_count=n,
            is_default=ws.id == auth.user.default_workspace_id,
            suspended=ws.suspended_at is not None,
        )
        for ws, is_owner, role_name, owner_name, n in rows
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create(body: WorkspaceCreate, auth: CurrentAuth, db: DB, meta: Meta) -> WorkspaceCreated:
    owned = await db.scalar(
        select(func.count()).select_from(Workspace).where(Workspace.owner_id == auth.user.id)
    )
    if (owned or 0) >= 20:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can own at most 20 workspaces.")
    ws, granted = await create_workspace(db, auth.user, body.name)
    audit.record(
        db,
        action="workspace.created",
        actor=auth.user,
        meta=meta,
        workspace_id=ws.id,
        target_type="workspace",
        target_id=ws.id,
        target_label=ws.name,
    )
    if granted:
        audit.record(
            db,
            action="billing.credit_granted",
            actor=auth.user,
            meta=meta,
            workspace_id=ws.id,
            details={"amount_micros": granted, "reason": "starter_credit"},
        )
    await db.commit()
    return WorkspaceCreated(id=ws.id, name=ws.name, slug=ws.slug, free_credit_micros=granted)


@router.get("/{workspace_id}")
async def get_workspace(ctx: WsCtx, db: DB) -> WorkspaceDetail:
    counts = await role_member_counts(db, ctx.workspace.id)
    perms = sorted(p.value for p in Perm if ctx.actor.has(p))
    config = await platform.get_config(db)
    ws = ctx.workspace
    return WorkspaceDetail(
        id=ws.id,
        name=ws.name,
        slug=ws.slug,
        logo_url=logo_url(ws),
        owner_id=ws.owner_id,
        created_at=ws.created_at,
        is_owner=ctx.is_owner,
        is_default=ctx.user.default_workspace_id == ws.id,
        role=role_out(ctx.role, ctx.actor, counts.get(ctx.role.id, 0)),
        permissions=perms,
        default_project_id=ws.default_project_id,
        log_retention_days=ws.log_retention_days,
        effective_log_retention_days=min(
            ws.log_retention_days or config.log_retention_days, config.log_retention_days
        ),
        store_prompts=ws.store_prompts,
        prompt_logging_allowed=config.prompt_logging_allowed,
        suspended=ws.suspended_at is not None,
        suspended_reason=ws.suspended_reason,
        api_base_url=get_settings().api_base_url,
    )


@router.patch("/{workspace_id}")
async def update_workspace(body: WorkspaceUpdate, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    ctx.require(Perm.WORKSPACE_SETTINGS)
    ws = ctx.workspace
    changes: dict[str, object] = {}
    if body.name is not None and body.name != ws.name:
        changes["name"] = {"from": ws.name, "to": body.name}
        ws.name = body.name
    if body.slug is not None and body.slug != ws.slug:
        taken = await db.scalar(
            select(exists().where(Workspace.slug == body.slug, Workspace.id != ws.id))
        )
        if taken:
            raise HTTPException(status.HTTP_409_CONFLICT, "That slug is already taken.")
        changes["slug"] = {"from": ws.slug, "to": body.slug}
        ws.slug = body.slug
    if body.default_project_id is not None and body.default_project_id != ws.default_project_id:
        project = await db.scalar(
            select(Project).where(
                Project.id == body.default_project_id, Project.workspace_id == ws.id
            )
        )
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")
        changes["default_project"] = project.name
        ws.default_project_id = project.id
    if body.clear_log_retention:
        changes["log_retention_days"] = None
        ws.log_retention_days = None
    elif body.log_retention_days is not None and body.log_retention_days != ws.log_retention_days:
        changes["log_retention_days"] = body.log_retention_days
        ws.log_retention_days = body.log_retention_days
    if body.store_prompts is not None and body.store_prompts != ws.store_prompts:
        changes["store_prompts"] = body.store_prompts
        ws.store_prompts = body.store_prompts
    if changes:
        audit.record(
            db,
            action="workspace.settings_changed",
            actor=ctx.user,
            meta=meta,
            workspace_id=ws.id,
            target_type="workspace",
            target_id=ws.id,
            target_label=ws.name,
            details=changes,
        )
    await db.commit()
    return Message(message="Workspace updated.")


@router.put("/{workspace_id}/logo")
async def upload_logo(
    file: Annotated[UploadFile, File()], ctx: WsCtx, db: DB, meta: Meta
) -> Message:
    ctx.require(Perm.WORKSPACE_SETTINGS)
    data, content_type = await read_image(file, MAX_LOGO_BYTES)
    ctx.workspace.logo = data
    ctx.workspace.logo_content_type = content_type
    ctx.workspace.logo_updated_at = utcnow()
    audit.record(
        db,
        action="workspace.logo_changed",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
    )
    await db.commit()
    return Message(message="Logo updated.")


@router.delete("/{workspace_id}/logo")
async def delete_logo(ctx: WsCtx, db: DB, meta: Meta) -> Message:
    ctx.require(Perm.WORKSPACE_SETTINGS)
    ctx.workspace.logo = None
    ctx.workspace.logo_content_type = None
    ctx.workspace.logo_updated_at = None
    audit.record(
        db,
        action="workspace.logo_changed",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
    )
    await db.commit()
    return Message(message="Logo removed.")


@router.get("/{workspace_id}/logo", include_in_schema=False)
async def get_logo(ctx: WsCtx, db: DB) -> Response:
    ws = await db.scalar(
        select(Workspace).options(undefer(Workspace.logo)).where(Workspace.id == ctx.workspace.id)
    )
    if ws is None or ws.logo is None or ws.logo_content_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return Response(
        ws.logo,
        media_type=ws.logo_content_type,
        headers={
            "Cache-Control": "private, max-age=86400, immutable",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.post("/{workspace_id}/default")
async def make_default(ctx: WsCtx, db: DB) -> Message:
    ctx.user.default_workspace_id = ctx.workspace.id
    await db.commit()
    return Message(message="Default workspace updated.")


@router.post("/{workspace_id}/delete")
async def delete_workspace(body: ConfirmName, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    if not ctx.is_owner:
        raise PermissionDenied("Only the owner can delete the workspace.")
    if body.confirm_name.strip() != ctx.workspace.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Type the workspace name exactly.")
    in_flight = await db.scalar(
        select(exists().where(Reservation.workspace_id == ctx.workspace.id))
    )
    if in_flight:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Requests are still running. Try again in a minute."
        )
    member_ids = (
        (
            await db.execute(
                select(Membership.user_id).where(Membership.workspace_id == ctx.workspace.id)
            )
        )
        .scalars()
        .all()
    )
    audit.record(
        db,
        action="workspace.deleted",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="workspace",
        target_id=ctx.workspace.id,
        target_label=ctx.workspace.name,
        details={"balance_micros": ctx.workspace.balance_micros},
    )
    name = ctx.workspace.name
    await db.delete(ctx.workspace)
    await db.flush()
    for uid in member_ids:
        if uid != ctx.user.id:
            notifications.notify(
                db,
                user_id=uid,
                type="workspace.deleted",
                title=f"{name} was deleted",
                body=f"{ctx.user.name} deleted the workspace.",
            )
    await db.commit()
    return Message(message="Workspace deleted.")


@router.post("/{workspace_id}/transfer")
async def transfer_ownership(body: TransferOwnership, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    ctx = await load_workspace_context(db, ctx.workspace.id, ctx.user, lock=True)
    if not ctx.is_owner:
        raise PermissionDenied("Only the owner can transfer ownership.")
    if body.confirm_name.strip() != ctx.workspace.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Type the workspace name exactly.")
    if body.user_id == ctx.user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You already own this workspace.")
    target = await db.scalar(
        select(Membership).where(
            Membership.workspace_id == ctx.workspace.id, Membership.user_id == body.user_id
        )
    )
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found.")
    new_owner = await db.get(User, body.user_id)
    assert new_owner is not None
    owner_role = await get_system_role(db, ctx.workspace.id, "owner")
    admin_role = await get_system_role(db, ctx.workspace.id, "admin")

    # Order matters: the database allows exactly one owner row per workspace at any time.
    ctx.membership.is_owner = False
    ctx.membership.role_id = admin_role.id
    await db.flush()
    target.is_owner = True
    target.role_id = owner_role.id
    ctx.workspace.owner_id = new_owner.id
    await db.flush()

    audit.record(
        db,
        action="workspace.ownership_transferred",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="user",
        target_id=new_owner.id,
        target_label=new_owner.email,
    )
    notifications.notify(
        db,
        user_id=new_owner.id,
        workspace_id=ctx.workspace.id,
        type="workspace.ownership_received",
        title=f"You now own {ctx.workspace.name}",
        body=f"{ctx.user.name} transferred ownership to you.",
        link=f"/w/{ctx.workspace.id}/settings",
    )
    await db.commit()
    return Message(message=f"{new_owner.name} is now the owner. You are now an Admin.")


@router.post("/{workspace_id}/leave")
async def leave_workspace(ctx: WsCtx, db: DB, meta: Meta) -> Message:
    if ctx.is_owner:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Owners cannot leave. Transfer ownership or delete the workspace.",
        )
    await _remove_membership(
        db, ctx.workspace.id, ctx.user, actor=ctx.user, meta=meta, action="member.left"
    )
    await db.commit()
    return Message(message=f"You left {ctx.workspace.name}.")


# ---- Members -----------------------------------------------------------------------------------


@router.get("/{workspace_id}/members")
async def list_members(ctx: WsCtx, db: DB) -> list[MemberOut]:
    visible = await accessible_project_ids(ctx, db)
    rows = (
        await db.execute(
            select(Membership, User, Role)
            .join(User, User.id == Membership.user_id)
            .join(Role, Role.id == Membership.role_id)
            .where(Membership.workspace_id == ctx.workspace.id)
            .order_by(Role.rank.desc(), func.lower(User.name))
        )
    ).all()
    projects_by_user: dict[uuid.UUID, list[ProjectRef]] = defaultdict(list)
    for pm_user, pid, pname in await db.execute(
        select(ProjectMember.user_id, Project.id, Project.name)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(Project.workspace_id == ctx.workspace.id)
        .order_by(func.lower(Project.name))
    ):
        if pid in visible:
            projects_by_user[pm_user].append(ProjectRef(id=pid, name=pname))
    can_act = ctx.actor.has(Perm.MEMBERS_CHANGE_ROLE) or ctx.actor.has(Perm.MEMBERS_REMOVE)
    return [
        MemberOut(
            user_id=user.id,
            name=user.name,
            email=user.email,
            avatar_url=avatar_url(user),
            role_id=role.id,
            role_name=role.name,
            role_rank=role.rank,
            is_owner=m.is_owner,
            joined_at=m.joined_at,
            all_projects=m.is_owner or Perm.PROJECTS_ACCESS_ALL.value in role.permissions,
            projects=projects_by_user[user.id],
            can_manage=(
                can_act
                and user.id != ctx.user.id
                and not m.is_owner
                and can_manage_rank(ctx.actor, role.rank)
            ),
        )
        for m, user, role in rows
    ]


async def _load_member(
    db: DB, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[Membership, User, Role]:
    row = (
        await db.execute(
            select(Membership, User, Role)
            .join(User, User.id == Membership.user_id)
            .join(Role, Role.id == Membership.role_id)
            .where(Membership.workspace_id == workspace_id, Membership.user_id == user_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found.")
    membership, user, role = row
    return membership, user, role


@router.patch("/{workspace_id}/members/{user_id}")
async def change_member_role(
    user_id: uuid.UUID, body: MemberRoleUpdate, ctx: WsCtx, db: DB, meta: Meta
) -> Message:
    ctx = await load_workspace_context(db, ctx.workspace.id, ctx.user, lock=True)
    ctx.require(Perm.MEMBERS_CHANGE_ROLE)
    if user_id == ctx.user.id:
        raise PermissionDenied("You cannot change your own role.")
    membership, user, current_role = await _load_member(db, ctx.workspace.id, user_id)
    check_manage_member(ctx.actor, current_role.rank, membership.is_owner)
    new_role = await get_role(db, ctx.workspace.id, body.role_id)
    check_assignable_role(
        ctx.actor, new_role.rank, frozenset(new_role.permissions), new_role.system_key == "owner"
    )
    if new_role.id == current_role.id:
        return Message(message="No change.")
    membership.role_id = new_role.id
    await db.flush()
    audit.record(
        db,
        action="member.role_changed",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="user",
        target_id=user.id,
        target_label=user.email,
        details={"from": current_role.name, "to": new_role.name},
    )
    await notifications.notify_users(
        db,
        [user.id],
        category="workspace",
        type="member.role_changed",
        title=f"Your role in {ctx.workspace.name} is now {new_role.name}",
        body=f"Changed by {ctx.user.name}.",
        link=f"/w/{ctx.workspace.id}",
        workspace_id=ctx.workspace.id,
    )
    await db.commit()
    return Message(message=f"{user.name} is now {new_role.name}.")


@router.delete("/{workspace_id}/members/{user_id}")
async def remove_member(user_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    ctx = await load_workspace_context(db, ctx.workspace.id, ctx.user, lock=True)
    ctx.require(Perm.MEMBERS_REMOVE)
    if user_id == ctx.user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use Leave workspace instead.")
    membership, user, role = await _load_member(db, ctx.workspace.id, user_id)
    check_manage_member(ctx.actor, role.rank, membership.is_owner)
    await _remove_membership(
        db, ctx.workspace.id, user, actor=ctx.user, meta=meta, action="member.removed"
    )
    notifications.notify(
        db,
        user_id=user.id,
        type="member.removed",
        title=f"You were removed from {ctx.workspace.name}",
        body=f"Removed by {ctx.user.name}.",
    )
    await db.commit()
    return Message(message=f"{user.name} was removed.")


async def _remove_membership(
    db: DB, workspace_id: uuid.UUID, user: User, *, actor: User, meta: Meta, action: str
) -> None:
    project_ids = select(Project.id).where(Project.workspace_id == workspace_id)
    await db.execute(
        delete(ProjectMember).where(
            ProjectMember.user_id == user.id, ProjectMember.project_id.in_(project_ids)
        )
    )
    await db.execute(
        delete(Membership).where(
            Membership.workspace_id == workspace_id, Membership.user_id == user.id
        )
    )
    if user.default_workspace_id == workspace_id:
        user.default_workspace_id = await db.scalar(
            select(Membership.workspace_id)
            .where(Membership.user_id == user.id)
            .order_by(Membership.is_owner.desc(), Membership.joined_at)
            .limit(1)
        )
    await db.flush()
    audit.record(
        db,
        action=action,
        actor=actor,
        meta=meta,
        workspace_id=workspace_id,
        target_type="user",
        target_id=user.id,
        target_label=user.email,
    )


@router.put("/{workspace_id}/members/{user_id}/projects")
async def set_member_projects(
    user_id: uuid.UUID, body: MemberProjectsUpdate, ctx: WsCtx, db: DB, meta: Meta
) -> Message:
    """Set a member's project access, limited to projects the actor can access."""
    ctx.require(Perm.PROJECTS_MANAGE_MEMBERS)
    membership, user, role = await _load_member(db, ctx.workspace.id, user_id)
    visible = await accessible_project_ids(ctx, db)
    wanted = set(body.project_ids)
    if not wanted <= visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")
    current = set(
        (
            await db.execute(
                select(ProjectMember.project_id).where(
                    ProjectMember.user_id == user_id, ProjectMember.project_id.in_(visible)
                )
            )
        )
        .scalars()
        .all()
    )
    to_add, to_remove = wanted - current, current - wanted
    if to_remove and user_id != ctx.user.id:
        check_manage_member(ctx.actor, role.rank, membership.is_owner)
    names = dict(
        (
            await db.execute(
                select(Project.id, Project.name).where(Project.id.in_(to_add | to_remove))
            )
        ).all()
    )
    for pid in to_add:
        db.add(ProjectMember(project_id=pid, user_id=user_id, added_by_id=ctx.user.id))
        notifications.notify(
            db,
            user_id=user_id,
            workspace_id=ctx.workspace.id,
            type="project.access_granted",
            title=f"You can now use {names.get(pid, 'a project')}",
            body=f"{ctx.user.name} gave you access in {ctx.workspace.name}.",
            link=f"/w/{ctx.workspace.id}/projects/{pid}",
        )
        audit.record(
            db,
            action="project.member_added",
            actor=ctx.user,
            meta=meta,
            workspace_id=ctx.workspace.id,
            project_id=pid,
            target_type="user",
            target_id=user_id,
            target_label=user.email,
        )
    if to_remove:
        await db.execute(
            delete(ProjectMember).where(
                ProjectMember.user_id == user_id, ProjectMember.project_id.in_(to_remove)
            )
        )
        for pid in to_remove:
            audit.record(
                db,
                action="project.member_removed",
                actor=ctx.user,
                meta=meta,
                workspace_id=ctx.workspace.id,
                project_id=pid,
                target_type="user",
                target_id=user_id,
                target_label=user.email,
            )
    await db.commit()
    return Message(message="Project access updated.")
