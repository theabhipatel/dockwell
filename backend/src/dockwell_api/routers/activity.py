"""Workspace activity log (append-only, permissioned, filterable, exportable) and the
notification inbox."""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import ColumnElement, Select, and_, func, or_, select, update

from dockwell_api.db import utcnow
from dockwell_api.deps import DB, CurrentAuth, WorkspaceContext, WsCtx
from dockwell_api.models import AuditLog, Membership, Notification, Project
from dockwell_api.permissions import Perm
from dockwell_api.schemas.common import Message
from dockwell_api.schemas.project import ActivityOut, NotificationList, NotificationOut
from dockwell_api.services.export import csv_stream
from dockwell_api.services.users import escape_like

router = APIRouter(tags=["activity"])

# Account-level events (no workspace) that every workspace a member belongs to should see.
ACCOUNT_EVENT_PREFIXES = ("auth.sign_in",)


async def activity_rows(db: DB, rows: Sequence[AuditLog]) -> list[ActivityOut]:
    pids = {r.project_id for r in rows if r.project_id}
    names = (
        dict((await db.execute(select(Project.id, Project.name).where(Project.id.in_(pids)))).all())
        if pids
        else {}
    )
    return [
        ActivityOut(
            id=r.id,
            created_at=r.created_at,
            action=r.action,
            actor_id=r.actor_id,
            actor_name=r.actor_name,
            actor_email=r.actor_email,
            target_type=r.target_type,
            target_id=r.target_id,
            target_label=r.target_label,
            project_id=r.project_id,
            project_name=names.get(r.project_id) if r.project_id else None,
            result=r.result,
            ip=str(r.ip) if r.ip else None,
            user_agent=r.user_agent,
            details=r.details or {},
        )
        for r in rows
    ]


def _audit_query(
    ctx: WorkspaceContext,
    actor_id: uuid.UUID | None,
    action: str | None,
    date_from: date | None,
    date_to: date | None,
) -> Select[AuditLog]:
    member_ids = select(Membership.user_id).where(Membership.workspace_id == ctx.workspace.id)
    scope = or_(
        AuditLog.workspace_id == ctx.workspace.id,
        and_(
            AuditLog.workspace_id.is_(None),
            or_(*(AuditLog.action.startswith(p) for p in ACCOUNT_EVENT_PREFIXES)),
            AuditLog.actor_id.in_(member_ids),
        ),
    )
    conditions: list[ColumnElement[bool]] = [scope]
    if actor_id:
        conditions.append(AuditLog.actor_id == actor_id)
    if action:
        conditions.append(AuditLog.action.like(escape_like(action) + "%", escape="\\"))
    if date_from:
        conditions.append(AuditLog.created_at >= datetime.combine(date_from, time.min, UTC))
    if date_to:
        conditions.append(
            AuditLog.created_at < datetime.combine(date_to + timedelta(days=1), time.min, UTC)
        )
    return select(AuditLog).where(*conditions)


@router.get("/workspaces/{workspace_id}/audit")
async def audit_log(
    ctx: WsCtx,
    db: DB,
    actor_id: uuid.UUID | None = None,
    action: Annotated[str | None, Query(max_length=64)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    before_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ActivityOut]:
    ctx.require(Perm.AUDIT_VIEW)
    stmt = _audit_query(ctx, actor_id, action, date_from, date_to)
    if before_id is not None:
        stmt = stmt.where(AuditLog.id < before_id)
    rows = (await db.execute(stmt.order_by(AuditLog.id.desc()).limit(limit))).scalars().all()
    return await activity_rows(db, rows)


@router.get("/workspaces/{workspace_id}/audit/export.csv", include_in_schema=False)
async def export_audit(
    ctx: WsCtx,
    db: DB,
    actor_id: uuid.UUID | None = None,
    action: Annotated[str | None, Query(max_length=64)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> StreamingResponse:
    ctx.require(Perm.AUDIT_VIEW)
    stmt = _audit_query(ctx, actor_id, action, date_from, date_to)
    rows = await activity_rows(
        db, list((await db.execute(stmt.order_by(AuditLog.id.desc()).limit(100_000))).scalars())
    )
    return csv_stream(
        [
            "time_utc",
            "actor_name",
            "actor_email",
            "action",
            "result",
            "target_type",
            "target",
            "project",
            "ip",
            "user_agent",
            "details",
        ],
        [
            [
                r.created_at.astimezone(UTC).isoformat(),
                r.actor_name,
                r.actor_email,
                r.action,
                r.result,
                r.target_type,
                r.target_label or r.target_id,
                r.project_name,
                r.ip,
                r.user_agent,
                r.details or "",
            ]
            for r in rows
        ],
        f"activity-{ctx.workspace.slug}-{utcnow().date().isoformat()}.csv",
    )


# ---- Notifications -----------------------------------------------------------------------------


@router.get("/notifications")
async def list_notifications(
    auth: CurrentAuth, db: DB, limit: int = Query(default=30, ge=1, le=100)
) -> NotificationList:
    items = (
        (
            await db.execute(
                select(Notification)
                .where(Notification.user_id == auth.user.id)
                .order_by(Notification.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    unread = await db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == auth.user.id, Notification.read_at.is_(None))
    )
    return NotificationList(
        items=[NotificationOut.model_validate(n) for n in items], unread_count=unread or 0
    )


@router.post("/notifications/{notification_id}/read")
async def mark_read(notification_id: uuid.UUID, auth: CurrentAuth, db: DB) -> Message:
    result = await db.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.user_id == auth.user.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=utcnow())
    )
    await db.commit()
    if result.rowcount == 0:  # type: ignore[attr-defined]
        found = await db.get(Notification, notification_id)
        if found is None or found.user_id != auth.user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.")
    return Message(message="Marked as read.")


@router.post("/notifications/read-all")
async def mark_all_read(auth: CurrentAuth, db: DB) -> Message:
    await db.execute(
        update(Notification)
        .where(Notification.user_id == auth.user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    await db.commit()
    return Message(message="All caught up.")
