"""Workspace invitations: managing them (workspace side) and responding (invitee side)."""

import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, func, select, update
from sqlalchemy.orm import aliased

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, CurrentAuth, Meta, WsCtx
from dockwell_api.models import (
    Invitation,
    Membership,
    Notification,
    Project,
    ProjectMember,
    Role,
    User,
    Workspace,
)
from dockwell_api.permissions import Perm, PermissionDenied, can_manage_rank, check_assignable_role
from dockwell_api.schemas.common import Message
from dockwell_api.schemas.workspace import (
    AcceptedInvitation,
    InvitationCreate,
    InvitationOut,
    MyInvitation,
    ProjectRef,
)
from dockwell_api.security import ratelimit
from dockwell_api.services import audit, email, notifications
from dockwell_api.services.access import accessible_project_ids
from dockwell_api.services.workspaces import get_role

router = APIRouter(tags=["invitations"])


def _ttl() -> timedelta:
    return timedelta(days=get_settings().invitation_ttl_days)


async def _invitation_out(
    db: DB, inv: Invitation, role_name: str, inviter: str | None
) -> InvitationOut:
    projects: list[ProjectRef] = []
    if inv.project_ids:
        rows = await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(inv.project_ids))
        )
        projects = [ProjectRef(id=r.id, name=r.name) for r in rows]
    return InvitationOut(
        id=inv.id,
        email=inv.email,
        role_id=inv.role_id,
        role_name=role_name,
        projects=projects,
        invited_by_name=inviter,
        status=inv.status,
        expired=inv.expires_at <= utcnow(),
        created_at=inv.created_at,
        last_sent_at=inv.last_sent_at,
        expires_at=inv.expires_at,
    )


async def _mark_invitation_notifications_read(db: DB, invitation_id: uuid.UUID) -> None:
    await db.execute(
        update(Notification)
        .where(
            Notification.type == "invitation.received",
            Notification.data["invitation_id"].astext == str(invitation_id),
            Notification.read_at.is_(None),
        )
        .values(read_at=utcnow())
    )


# ---- Workspace side ----------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/invitations")
async def list_invitations(ctx: WsCtx, db: DB) -> list[InvitationOut]:
    ctx.require(Perm.MEMBERS_INVITE)
    inviter = aliased(User)
    rows = await db.execute(
        select(Invitation, Role.name, inviter.name)
        .join(Role, Role.id == Invitation.role_id)
        .outerjoin(inviter, inviter.id == Invitation.invited_by_id)
        .where(Invitation.workspace_id == ctx.workspace.id, Invitation.status == "pending")
        .order_by(Invitation.created_at.desc())
    )
    return [
        await _invitation_out(db, inv, role_name, inv_name) for inv, role_name, inv_name in rows
    ]


@router.post("/workspaces/{workspace_id}/invitations", status_code=status.HTTP_201_CREATED)
async def create_invitation(
    body: InvitationCreate, ctx: WsCtx, db: DB, meta: Meta
) -> InvitationOut:
    ctx.require(Perm.MEMBERS_INVITE)
    await ratelimit.hit(f"invite:user:{ctx.user.id}", 60, timedelta(hours=1))
    role = await get_role(db, ctx.workspace.id, body.role_id)
    check_assignable_role(
        ctx.actor, role.rank, frozenset(role.permissions), role.system_key == "owner"
    )

    project_ids = list(dict.fromkeys(body.project_ids))
    if project_ids:
        ctx.require(Perm.PROJECTS_MANAGE_MEMBERS)
        if not set(project_ids) <= await accessible_project_ids(ctx, db):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")

    already_member = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.workspace_id == ctx.workspace.id, User.email == body.email)
    )
    if already_member:
        raise HTTPException(status.HTTP_409_CONFLICT, "That person is already a member.")
    existing = await db.scalar(
        select(Invitation).where(
            Invitation.workspace_id == ctx.workspace.id,
            Invitation.email == body.email,
            Invitation.status == "pending",
        )
    )
    if existing is not None:
        if existing.expires_at > utcnow():
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "That person already has a pending invitation. Resend it instead.",
            )
        existing.status = "expired"
        await db.flush()

    now = utcnow()
    inv = Invitation(
        workspace_id=ctx.workspace.id,
        email=body.email,
        role_id=role.id,
        project_ids=project_ids,
        invited_by_id=ctx.user.id,
        status="pending",
        created_at=now,
        last_sent_at=now,
        expires_at=now + _ttl(),
    )
    db.add(inv)
    await db.flush()
    invitee = await db.scalar(select(User).where(User.email == body.email))
    if invitee is not None:
        notifications.notify(
            db,
            user_id=invitee.id,
            type="invitation.received",
            title=f"{ctx.user.name} invited you to {ctx.workspace.name}",
            body=f"Join as {role.name}.",
            link="/invitations",
            data={"invitation_id": str(inv.id)},
        )
    email.send_invitation(
        db,
        body.email,
        ctx.user.name,
        ctx.workspace.name,
        role.name,
        is_existing_user=invitee is not None,
    )
    audit.record(
        db,
        action="invitation.created",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="invitation",
        target_id=inv.id,
        target_label=body.email,
        details={"role": role.name, "projects": len(project_ids)},
    )
    await db.commit()
    return await _invitation_out(db, inv, role.name, ctx.user.name)


async def _manageable_invitation(
    ctx: WsCtx, db: DB, invitation_id: uuid.UUID
) -> tuple[Invitation, Role]:
    ctx.require(Perm.MEMBERS_INVITE)
    row = (
        await db.execute(
            select(Invitation, Role)
            .join(Role, Role.id == Invitation.role_id)
            .where(
                Invitation.id == invitation_id,
                Invitation.workspace_id == ctx.workspace.id,
                Invitation.status == "pending",
            )
            .with_for_update(of=Invitation)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found.")
    if not can_manage_rank(ctx.actor, row[1].rank):
        raise PermissionDenied("You can only manage invitations for roles ranked below yours.")
    return row


@router.post("/workspaces/{workspace_id}/invitations/{invitation_id}/resend")
async def resend_invitation(
    invitation_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta
) -> InvitationOut:
    inv, role = await _manageable_invitation(ctx, db, invitation_id)
    if utcnow() - inv.last_sent_at < timedelta(minutes=1):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Please wait a minute before resending."
        )
    now = utcnow()
    inv.last_sent_at = now
    inv.expires_at = now + _ttl()
    invitee = await db.scalar(select(User).where(User.email == inv.email))
    email.send_invitation(
        db,
        inv.email,
        ctx.user.name,
        ctx.workspace.name,
        role.name,
        is_existing_user=invitee is not None,
    )
    audit.record(
        db,
        action="invitation.resent",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="invitation",
        target_id=inv.id,
        target_label=inv.email,
    )
    await db.commit()
    return await _invitation_out(db, inv, role.name, ctx.user.name)


@router.delete("/workspaces/{workspace_id}/invitations/{invitation_id}")
async def revoke_invitation(invitation_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    inv, _ = await _manageable_invitation(ctx, db, invitation_id)
    inv.status = "revoked"
    inv.responded_at = utcnow()
    await _mark_invitation_notifications_read(db, inv.id)
    audit.record(
        db,
        action="invitation.revoked",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="invitation",
        target_id=inv.id,
        target_label=inv.email,
    )
    await db.commit()
    return Message(message="Invitation revoked.")


# ---- Invitee side ------------------------------------------------------------------------------


@router.get("/invitations")
async def my_invitations(auth: CurrentAuth, db: DB) -> list[MyInvitation]:
    inviter = aliased(User)
    rows = await db.execute(
        select(Invitation, Workspace.name, Role.name, inviter.name)
        .join(Workspace, Workspace.id == Invitation.workspace_id)
        .join(Role, Role.id == Invitation.role_id)
        .outerjoin(inviter, inviter.id == Invitation.invited_by_id)
        .where(
            Invitation.email == auth.user.email,
            Invitation.status == "pending",
            Invitation.expires_at > utcnow(),
        )
        .order_by(Invitation.created_at.desc())
    )
    return [
        MyInvitation(
            id=inv.id,
            workspace_id=inv.workspace_id,
            workspace_name=ws_name,
            role_name=role_name,
            invited_by_name=inv_name,
            created_at=inv.created_at,
            expires_at=inv.expires_at,
        )
        for inv, ws_name, role_name, inv_name in rows
    ]


async def _my_pending(auth: CurrentAuth, db: DB, invitation_id: uuid.UUID) -> Invitation:
    inv = await db.scalar(
        select(Invitation)
        .where(
            Invitation.id == invitation_id,
            Invitation.email == auth.user.email,
            Invitation.status == "pending",
        )
        .with_for_update()
    )
    if inv is None or inv.expires_at <= utcnow():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invitation is no longer available.")
    if auth.user.email_verified_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Verify your email address first.")
    return inv


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: uuid.UUID, auth: CurrentAuth, db: DB, meta: Meta
) -> AcceptedInvitation:
    inv = await _my_pending(auth, db, invitation_id)
    workspace = await db.get(Workspace, inv.workspace_id)
    assert workspace is not None
    already = await db.scalar(
        select(Membership).where(
            Membership.workspace_id == workspace.id, Membership.user_id == auth.user.id
        )
    )
    if already is None:
        db.add(
            Membership(
                workspace_id=workspace.id,
                user_id=auth.user.id,
                role_id=inv.role_id,
                joined_at=utcnow(),
            )
        )
        valid_projects = (
            (
                await db.execute(
                    select(Project.id).where(
                        and_(
                            Project.workspace_id == workspace.id,
                            Project.id.in_(inv.project_ids or []),
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        for pid in valid_projects:
            db.add(
                ProjectMember(project_id=pid, user_id=auth.user.id, added_by_id=inv.invited_by_id)
            )
    inv.status = "accepted"
    inv.responded_at = utcnow()
    await _mark_invitation_notifications_read(db, inv.id)
    await db.flush()
    audit.record(
        db,
        action="invitation.accepted",
        actor=auth.user,
        meta=meta,
        workspace_id=workspace.id,
        target_type="invitation",
        target_id=inv.id,
        target_label=inv.email,
    )
    audit.record(
        db,
        action="member.joined",
        actor=auth.user,
        meta=meta,
        workspace_id=workspace.id,
        target_type="user",
        target_id=auth.user.id,
        target_label=auth.user.email,
    )
    if inv.invited_by_id:
        notifications.notify(
            db,
            user_id=inv.invited_by_id,
            workspace_id=workspace.id,
            type="invitation.accepted",
            title=f"{auth.user.name} joined {workspace.name}",
            link=f"/w/{workspace.id}/members",
        )
    if auth.user.default_workspace_id is None:
        auth.user.default_workspace_id = workspace.id
    if auth.user.onboarded_at is None:
        auth.user.onboarded_at = utcnow()
    await db.commit()
    return AcceptedInvitation(workspace_id=workspace.id)


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: uuid.UUID, auth: CurrentAuth, db: DB, meta: Meta
) -> Message:
    inv = await _my_pending(auth, db, invitation_id)
    workspace = await db.get(Workspace, inv.workspace_id)
    assert workspace is not None
    inv.status = "declined"
    inv.responded_at = utcnow()
    await _mark_invitation_notifications_read(db, inv.id)
    audit.record(
        db,
        action="invitation.declined",
        actor=auth.user,
        meta=meta,
        workspace_id=workspace.id,
        target_type="invitation",
        target_id=inv.id,
        target_label=inv.email,
    )
    if inv.invited_by_id:
        notifications.notify(
            db,
            user_id=inv.invited_by_id,
            workspace_id=workspace.id,
            type="invitation.declined",
            title=f"{auth.user.name} declined the invitation to {workspace.name}",
        )
    await db.commit()
    return Message(message="Invitation declined.")
