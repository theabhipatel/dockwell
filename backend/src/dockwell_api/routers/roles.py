"""Roles and the permission catalogue. All hierarchy rules live in `dockwell_api.permissions`."""

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from dockwell_api.deps import DB, Meta, WsCtx, load_workspace_context
from dockwell_api.models import Invitation, Membership, Role
from dockwell_api.permissions import (
    PERMISSION_CATALOG,
    Perm,
    PermissionDenied,
    check_assignable_role,
    check_role_edit,
    check_role_rank_target,
    parse_permissions,
    require,
)
from dockwell_api.schemas.common import Message, PermissionInfo
from dockwell_api.schemas.workspace import RoleCreate, RoleDelete, RoleOut, RoleUpdate
from dockwell_api.services import audit
from dockwell_api.services.workspaces import get_role, rank_below, role_member_counts, role_out

router = APIRouter(tags=["roles"])


@router.get("/permissions")
async def permission_catalog() -> list[PermissionInfo]:
    return [
        PermissionInfo(key=p.key.value, group=p.group, label=p.label, description=p.description)
        for p in PERMISSION_CATALOG
    ]


@router.get("/workspaces/{workspace_id}/roles")
async def list_roles(ctx: WsCtx, db: DB) -> list[RoleOut]:
    counts = await role_member_counts(db, ctx.workspace.id)
    roles = (
        await db.execute(
            select(Role).where(Role.workspace_id == ctx.workspace.id).order_by(Role.rank.desc())
        )
    ).scalars()
    return [role_out(r, ctx.actor, counts.get(r.id, 0)) for r in roles]


@router.post("/workspaces/{workspace_id}/roles", status_code=status.HTTP_201_CREATED)
async def create_role(body: RoleCreate, ctx: WsCtx, db: DB, meta: Meta) -> RoleOut:
    ctx = await load_workspace_context(db, ctx.workspace.id, ctx.user, lock=True)
    require(ctx.actor, Perm.ROLES_MANAGE)
    perms = parse_permissions(body.permissions)
    # Creating a role is "granting" every permission it contains.
    check_role_edit(ctx.actor, 0, False, frozenset(), perms)
    anchor = await get_role(db, ctx.workspace.id, body.place_below_role_id)
    rank = await rank_below(db, ctx.workspace.id, anchor)
    check_role_rank_target(ctx.actor, rank)
    role = Role(
        workspace_id=ctx.workspace.id,
        name=body.name,
        description=body.description,
        rank=rank,
        system_key=None,
        permissions=sorted(perms),
    )
    db.add(role)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A role with that name already exists."
        ) from exc
    audit.record(
        db,
        action="role.created",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="role",
        target_id=role.id,
        target_label=role.name,
        details={"permissions": sorted(perms)},
    )
    await db.commit()
    return role_out(role, ctx.actor, 0)


@router.patch("/workspaces/{workspace_id}/roles/{role_id}")
async def update_role(
    role_id: uuid.UUID, body: RoleUpdate, ctx: WsCtx, db: DB, meta: Meta
) -> RoleOut:
    ctx = await load_workspace_context(db, ctx.workspace.id, ctx.user, lock=True)
    role = await get_role(db, ctx.workspace.id, role_id)
    old_perms = frozenset(role.permissions)
    new_perms = parse_permissions(body.permissions) if body.permissions is not None else old_perms
    check_role_edit(ctx.actor, role.rank, role.system_key == "owner", old_perms, new_perms)
    if role.id == ctx.role.id:
        raise PermissionDenied("You cannot edit your own role.")

    details: dict[str, object] = {}
    if body.name is not None and body.name != role.name:
        details["name"] = {"from": role.name, "to": body.name}
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if new_perms != old_perms:
        details["added"] = sorted(new_perms - old_perms)
        details["removed"] = sorted(old_perms - new_perms)
        role.permissions = sorted(new_perms)
    if body.place_below_role_id is not None and body.place_below_role_id != role.id:
        anchor = await get_role(db, ctx.workspace.id, body.place_below_role_id)
        new_rank = await rank_below(db, ctx.workspace.id, anchor, moving=role)
        check_role_rank_target(ctx.actor, new_rank)
        details["rank"] = {"from": role.rank, "to": new_rank}
        role.rank = new_rank
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A role with that name already exists."
        ) from exc
    counts = await role_member_counts(db, ctx.workspace.id)
    if details:
        audit.record(
            db,
            action="role.updated",
            actor=ctx.user,
            meta=meta,
            workspace_id=ctx.workspace.id,
            target_type="role",
            target_id=role.id,
            target_label=role.name,
            details=details,
        )
    await db.commit()
    return role_out(role, ctx.actor, counts.get(role.id, 0))


@router.post("/workspaces/{workspace_id}/roles/{role_id}/delete")
async def delete_role(
    role_id: uuid.UUID, body: RoleDelete, ctx: WsCtx, db: DB, meta: Meta
) -> Message:
    ctx = await load_workspace_context(db, ctx.workspace.id, ctx.user, lock=True)
    role = await get_role(db, ctx.workspace.id, role_id)
    check_role_edit(ctx.actor, role.rank, role.system_key == "owner", frozenset(), frozenset())
    if role.system_key is not None:
        raise PermissionDenied("Built-in roles cannot be deleted.")
    counts = await role_member_counts(db, ctx.workspace.id)
    in_use = counts.get(role.id, 0) > 0
    pending_invites = await db.scalar(
        select(Invitation.id)
        .where(Invitation.role_id == role.id, Invitation.status == "pending")
        .limit(1)
    )
    replacement: Role | None = None
    if in_use or pending_invites:
        if body.replacement_role_id is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This role is in use. Choose a replacement role for its members.",
            )
        replacement = await get_role(db, ctx.workspace.id, body.replacement_role_id)
        if replacement.id == role.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a different role.")
        check_assignable_role(
            ctx.actor,
            replacement.rank,
            frozenset(replacement.permissions),
            replacement.system_key == "owner",
        )
    if replacement is not None:
        await db.execute(
            update(Membership).where(Membership.role_id == role.id).values(role_id=replacement.id)
        )
        await db.execute(
            update(Invitation).where(Invitation.role_id == role.id).values(role_id=replacement.id)
        )
    await db.delete(role)
    await db.flush()
    audit.record(
        db,
        action="role.deleted",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        target_type="role",
        target_id=role.id,
        target_label=role.name,
        details={
            "replacement": replacement.name if replacement else None,
            "members_moved": counts.get(role.id, 0),
        },
    )
    await db.commit()
    return Message(message=f"Role {role.name} deleted.")
