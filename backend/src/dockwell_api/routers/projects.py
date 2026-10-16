"""Projects, project access and API keys."""

import uuid
from collections import Counter
from datetime import UTC

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, select

from dockwell_api.db import utcnow
from dockwell_api.deps import DB, Meta, WorkspaceContext, WsCtx
from dockwell_api.models import (
    AIModel,
    ApiKey,
    Membership,
    Project,
    ProjectMember,
    Role,
    User,
)
from dockwell_api.money import current_period
from dockwell_api.permissions import Perm, PermissionDenied
from dockwell_api.schemas.common import Message, avatar_url
from dockwell_api.schemas.project import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyOut,
    ApiKeyUpdate,
    KeyStatus,
    ProjectCreate,
    ProjectMemberOut,
    ProjectMembersUpdate,
    ProjectOut,
    ProjectUpdate,
)
from dockwell_api.security import api_keys
from dockwell_api.services import audit, notifications
from dockwell_api.services.access import accessible_project_ids, get_project
from dockwell_api.services.users import user_refs

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["projects"])

MAX_KEYS_PER_PROJECT = 200


def _project_out(
    ctx: WorkspaceContext, p: Project, key_count: int, member_count: int
) -> ProjectOut:
    return ProjectOut(
        id=p.id,
        name=p.name,
        description=p.description,
        archived_at=p.archived_at,
        created_at=p.created_at,
        rpm_limit=p.rpm_limit,
        tpm_limit=p.tpm_limit,
        monthly_spend_limit_micros=p.monthly_spend_limit_micros,
        period_spend_micros=p.period_spend_micros if p.period == current_period() else 0,
        key_count=key_count,
        member_count=member_count,
        is_default=ctx.workspace.default_project_id == p.id,
        can_manage=ctx.actor.has(Perm.PROJECTS_MANAGE),
    )


async def _counts(
    db: DB, project_ids: list[uuid.UUID]
) -> tuple[Counter[uuid.UUID], Counter[uuid.UUID]]:
    keys: Counter[uuid.UUID] = Counter()
    members: Counter[uuid.UUID] = Counter()
    if not project_ids:
        return keys, members
    for pid, n in await db.execute(
        select(ApiKey.project_id, func.count())
        .where(ApiKey.project_id.in_(project_ids), ApiKey.revoked_at.is_(None))
        .group_by(ApiKey.project_id)
    ):
        keys[pid] = n
    for pid, n in await db.execute(
        select(ProjectMember.project_id, func.count())
        .where(ProjectMember.project_id.in_(project_ids))
        .group_by(ProjectMember.project_id)
    ):
        members[pid] = n
    return keys, members


@router.get("/projects")
async def list_projects(
    ctx: WsCtx, db: DB, include_archived: bool = Query(default=False)
) -> list[ProjectOut]:
    ids = await accessible_project_ids(ctx, db)
    stmt = select(Project).where(Project.id.in_(ids)).order_by(func.lower(Project.name))
    if not include_archived:
        stmt = stmt.where(Project.archived_at.is_(None))
    projects = list((await db.execute(stmt)).scalars())
    keys, members = await _counts(db, [p.id for p in projects])
    return [_project_out(ctx, p, keys[p.id], members[p.id]) for p in projects]


@router.post("/projects", status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, ctx: WsCtx, db: DB, meta: Meta) -> ProjectOut:
    ctx.require(Perm.PROJECTS_CREATE)
    count = await db.scalar(
        select(func.count()).select_from(Project).where(Project.workspace_id == ctx.workspace.id)
    )
    if (count or 0) >= 200:
        raise HTTPException(status.HTTP_409_CONFLICT, "A workspace can have at most 200 projects.")
    project = Project(
        workspace_id=ctx.workspace.id,
        name=body.name,
        description=body.description,
        created_by_id=ctx.user.id,
    )
    db.add(project)
    await db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=ctx.user.id, added_by_id=ctx.user.id))
    audit.record(
        db,
        action="project.created",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        project_id=project.id,
        target_type="project",
        target_id=project.id,
        target_label=project.name,
    )
    await db.commit()
    return _project_out(ctx, project, 0, 1)


@router.get("/projects/{project_id}")
async def get_project_detail(project_id: uuid.UUID, ctx: WsCtx, db: DB) -> ProjectOut:
    project = await get_project(ctx, db, project_id)
    keys, members = await _counts(db, [project.id])
    return _project_out(ctx, project, keys[project.id], members[project.id])


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, ctx: WsCtx, db: DB, meta: Meta
) -> ProjectOut:
    ctx.require(Perm.PROJECTS_MANAGE)
    project = await get_project(ctx, db, project_id, lock=True)
    changes: dict[str, object] = {}
    for field in body.model_fields_set:
        value = getattr(body, field)
        if field in ("name", "description") and value is None:
            continue
        if getattr(project, field) != value:
            changes[field] = value
            setattr(project, field, value)
    if changes:
        audit.record(
            db,
            action="project.updated",
            actor=ctx.user,
            meta=meta,
            workspace_id=ctx.workspace.id,
            project_id=project.id,
            target_type="project",
            target_id=project.id,
            target_label=project.name,
            details={"changed": sorted(changes)},
        )
    await db.commit()
    keys, members = await _counts(db, [project.id])
    return _project_out(ctx, project, keys[project.id], members[project.id])


@router.post("/projects/{project_id}/archive")
async def archive_project(project_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    ctx.require(Perm.PROJECTS_MANAGE)
    project = await get_project(ctx, db, project_id, lock=True)
    if ctx.workspace.default_project_id == project.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Choose another default project before archiving this one."
        )
    project.archived_at = project.archived_at or utcnow()
    audit.record(
        db,
        action="project.archived",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        project_id=project.id,
        target_type="project",
        target_id=project.id,
        target_label=project.name,
    )
    await db.commit()
    return Message(message="Project archived. Its API keys stop working until it is restored.")


@router.post("/projects/{project_id}/unarchive")
async def unarchive_project(project_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    ctx.require(Perm.PROJECTS_MANAGE)
    project = await get_project(ctx, db, project_id, lock=True)
    project.archived_at = None
    audit.record(
        db,
        action="project.unarchived",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        project_id=project.id,
        target_type="project",
        target_id=project.id,
        target_label=project.name,
    )
    await db.commit()
    return Message(message="Project restored.")


@router.delete("/projects/{project_id}")
async def delete_project(project_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    ctx.require(Perm.PROJECTS_MANAGE)
    project = await get_project(ctx, db, project_id, lock=True)
    if ctx.workspace.default_project_id == project.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "The default project cannot be deleted.")
    audit.record(
        db,
        action="project.deleted",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        project_id=project.id,
        target_type="project",
        target_id=project.id,
        target_label=project.name,
    )
    await db.delete(project)
    await db.commit()
    return Message(message="Project deleted. Its API keys no longer work.")


# ---- Project access ----------------------------------------------------------------------------


@router.get("/projects/{project_id}/members")
async def project_members(project_id: uuid.UUID, ctx: WsCtx, db: DB) -> list[ProjectMemberOut]:
    project = await get_project(ctx, db, project_id)
    assigned = set(
        (
            await db.execute(
                select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
            )
        ).scalars()
    )
    rows = await db.execute(
        select(Membership, User, Role)
        .join(User, User.id == Membership.user_id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.workspace_id == ctx.workspace.id)
        .order_by(func.lower(User.name))
    )
    out: list[ProjectMemberOut] = []
    for m, user, role in rows:
        all_projects = m.is_owner or Perm.PROJECTS_ACCESS_ALL.value in (role.permissions or [])
        if user.id in assigned or all_projects:
            out.append(
                ProjectMemberOut(
                    user_id=user.id,
                    name=user.name,
                    email=user.email,
                    avatar_url=avatar_url(user),
                    role_name=role.name,
                    via="all_projects" if all_projects else "assigned",
                )
            )
    return out


@router.put("/projects/{project_id}/members")
async def set_project_members(
    project_id: uuid.UUID, body: ProjectMembersUpdate, ctx: WsCtx, db: DB, meta: Meta
) -> Message:
    ctx.require(Perm.PROJECTS_MANAGE_MEMBERS)
    project = await get_project(ctx, db, project_id)
    member_ids = set(
        (
            await db.execute(
                select(Membership.user_id).where(Membership.workspace_id == ctx.workspace.id)
            )
        ).scalars()
    )
    wanted = set(body.user_ids)
    if not wanted <= member_ids:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found.")
    current = set(
        (
            await db.execute(
                select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)
            )
        ).scalars()
    )
    for uid in wanted - current:
        db.add(ProjectMember(project_id=project.id, user_id=uid, added_by_id=ctx.user.id))
        if uid != ctx.user.id:
            notifications.notify(
                db,
                user_id=uid,
                workspace_id=ctx.workspace.id,
                type="project.access_granted",
                title=f"You can now use {project.name}",
                body=f"{ctx.user.name} gave you access in {ctx.workspace.name}.",
                link=f"/w/{ctx.workspace.id}/projects/{project.id}",
            )
    removed = current - wanted
    if removed:
        await db.execute(
            delete(ProjectMember).where(
                ProjectMember.project_id == project.id, ProjectMember.user_id.in_(removed)
            )
        )
    if wanted != current:
        audit.record(
            db,
            action="project.access_changed",
            actor=ctx.user,
            meta=meta,
            workspace_id=ctx.workspace.id,
            project_id=project.id,
            target_type="project",
            target_id=project.id,
            target_label=project.name,
            details={"added": len(wanted - current), "removed": len(removed)},
        )
    await db.commit()
    return Message(message="Project access updated.")


# ---- API keys ----------------------------------------------------------------------------------


def _key_status(key: ApiKey) -> KeyStatus:
    if key.revoked_at is not None:
        return "revoked"
    if key.expires_at is not None and key.expires_at <= utcnow():
        return "expired"
    return "active"


def _can_manage_key(ctx: WorkspaceContext, key: ApiKey) -> bool:
    return ctx.actor.has(Perm.KEYS_MANAGE_ALL) or (
        ctx.actor.has(Perm.KEYS_MANAGE_OWN) and key.created_by_id == ctx.user.id
    )


async def _keys_out(ctx: WorkspaceContext, db: DB, keys: list[ApiKey]) -> list[ApiKeyOut]:
    refs = await user_refs(db, (k.created_by_id for k in keys))
    names = (
        dict(
            (
                await db.execute(
                    select(Project.id, Project.name).where(
                        Project.id.in_({k.project_id for k in keys})
                    )
                )
            ).all()
        )
        if keys
        else {}
    )
    return [
        ApiKeyOut(
            id=k.id,
            project_id=k.project_id,
            project_name=names.get(k.project_id, ""),
            name=k.name,
            display=api_keys.display(k.prefix, k.last_four),
            created_by=refs.get(k.created_by_id) if k.created_by_id else None,
            created_at=k.created_at,
            last_used_at=k.last_used_at,
            expires_at=k.expires_at,
            revoked_at=k.revoked_at,
            status=_key_status(k),
            allowed_models=list(k.allowed_models or []),
            spend_limit_micros=k.spend_limit_micros,
            spent_micros=k.spent_micros,
            rpm_limit=k.rpm_limit,
            tpm_limit=k.tpm_limit,
            can_manage=_can_manage_key(ctx, k),
        )
        for k in keys
    ]


async def _check_models(db: DB, names: list[str]) -> list[str]:
    cleaned = sorted({n.strip() for n in names if n.strip()})
    if not cleaned:
        return []
    known = set(
        (
            await db.execute(select(AIModel.public_id).where(AIModel.public_id.in_(cleaned)))
        ).scalars()
    )
    unknown = [n for n in cleaned if n not in known]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown models: {', '.join(unknown)}"
        )
    return cleaned


@router.get("/api-keys")
async def list_api_keys(
    ctx: WsCtx, db: DB, project_id: uuid.UUID | None = None, include_revoked: bool = False
) -> list[ApiKeyOut]:
    ids = await accessible_project_ids(ctx, db)
    if project_id is not None:
        ids &= {project_id}
    stmt = select(ApiKey).where(ApiKey.project_id.in_(ids)).order_by(ApiKey.created_at.desc())
    if not include_revoked:
        stmt = stmt.where(ApiKey.revoked_at.is_(None))
    keys = list((await db.execute(stmt)).scalars())
    return await _keys_out(ctx, db, keys)


@router.post("/api-keys", status_code=status.HTTP_201_CREATED)
async def create_api_key(body: ApiKeyCreate, ctx: WsCtx, db: DB, meta: Meta) -> ApiKeyCreated:
    ctx.require_any(Perm.KEYS_MANAGE_ALL, Perm.KEYS_MANAGE_OWN)
    project = await get_project(ctx, db, body.project_id, writable=True)
    active = await db.scalar(
        select(func.count())
        .select_from(ApiKey)
        .where(ApiKey.project_id == project.id, ApiKey.revoked_at.is_(None))
    )
    if (active or 0) >= MAX_KEYS_PER_PROJECT:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project has too many active keys.")
    expires_at = body.expires_at
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at <= utcnow():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "The expiry date must be in the future."
            )
    secret, key_hash, prefix, last_four = api_keys.generate()
    key = ApiKey(
        workspace_id=ctx.workspace.id,
        project_id=project.id,
        name=body.name,
        prefix=prefix,
        last_four=last_four,
        key_hash=key_hash,
        created_by_id=ctx.user.id,
        expires_at=expires_at,
        allowed_models=await _check_models(db, body.allowed_models),
        spend_limit_micros=body.spend_limit_micros,
        rpm_limit=body.rpm_limit,
        tpm_limit=body.tpm_limit,
    )
    db.add(key)
    await db.flush()
    audit.record(
        db,
        action="api_key.created",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        project_id=project.id,
        target_type="api_key",
        target_id=key.id,
        target_label=f"{key.name} ({api_keys.display(prefix, last_four)})",
    )
    await db.commit()
    return ApiKeyCreated(key=(await _keys_out(ctx, db, [key]))[0], secret=secret)


async def _manageable_key(ctx: WorkspaceContext, db: DB, key_id: uuid.UUID) -> ApiKey:
    key = await db.scalar(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.workspace_id == ctx.workspace.id)
    )
    if key is None or key.project_id not in await accessible_project_ids(ctx, db):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found.")
    if not _can_manage_key(ctx, key):
        raise PermissionDenied("You can only manage your own API keys.")
    return key


@router.patch("/api-keys/{key_id}")
async def update_api_key(
    key_id: uuid.UUID, body: ApiKeyUpdate, ctx: WsCtx, db: DB, meta: Meta
) -> ApiKeyOut:
    key = await _manageable_key(ctx, db, key_id)
    changed: list[str] = []
    for field in body.model_fields_set:
        value = getattr(body, field)
        if field == "name" and value is None:
            continue
        if field == "allowed_models":
            value = await _check_models(db, value or [])
        if field == "expires_at" and value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        if getattr(key, field) != value:
            setattr(key, field, value)
            changed.append(field)
    if changed:
        audit.record(
            db,
            action="api_key.updated",
            actor=ctx.user,
            meta=meta,
            workspace_id=ctx.workspace.id,
            project_id=key.project_id,
            target_type="api_key",
            target_id=key.id,
            target_label=key.name,
            details={"changed": changed},
        )
    await db.commit()
    return (await _keys_out(ctx, db, [key]))[0]


@router.post("/api-keys/{key_id}/revoke")
async def revoke_api_key(key_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta) -> ApiKeyOut:
    key = await _manageable_key(ctx, db, key_id)
    if key.revoked_at is None:
        key.revoked_at = utcnow()
        audit.record(
            db,
            action="api_key.revoked",
            actor=ctx.user,
            meta=meta,
            workspace_id=ctx.workspace.id,
            project_id=key.project_id,
            target_type="api_key",
            target_id=key.id,
            target_label=f"{key.name} ({api_keys.display(key.prefix, key.last_four)})",
        )
        await db.commit()
    return (await _keys_out(ctx, db, [key]))[0]


@router.delete("/api-keys/{key_id}")
async def delete_api_key(key_id: uuid.UUID, ctx: WsCtx, db: DB, meta: Meta) -> Message:
    key = await _manageable_key(ctx, db, key_id)
    audit.record(
        db,
        action="api_key.deleted",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        project_id=key.project_id,
        target_type="api_key",
        target_id=key.id,
        target_label=f"{key.name} ({api_keys.display(key.prefix, key.last_four)})",
    )
    await db.delete(key)
    await db.commit()
    return Message(message="API key deleted.")
