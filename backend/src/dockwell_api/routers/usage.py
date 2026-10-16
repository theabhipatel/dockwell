"""Workspace dashboard, usage charts, CSV export and request logs."""

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import exists, func, select

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, WorkspaceContext, WsCtx
from dockwell_api.models import ApiKey, AuditLog, LedgerEntry, RequestLog, UsageDaily
from dockwell_api.money import current_period
from dockwell_api.permissions import Perm
from dockwell_api.routers.activity import activity_rows
from dockwell_api.schemas.usage import (
    Checklist,
    DashboardOut,
    GroupBy,
    LogPage,
    RequestLogDetail,
    TopModel,
    UsagePoint,
    UsageReport,
)
from dockwell_api.services import catalog
from dockwell_api.services import usage as usage_service
from dockwell_api.services.access import accessible_project_ids
from dockwell_api.services.export import csv_stream

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["usage"])


async def _scope(ctx: WorkspaceContext, db: DB) -> set[uuid.UUID] | None:
    """Members without access to every project only see usage of their projects."""
    if ctx.actor.has(Perm.PROJECTS_ACCESS_ALL):
        return None
    return await accessible_project_ids(ctx, db)


def _filter(
    ctx: WorkspaceContext,
    scope: set[uuid.UUID] | None,
    project_id: uuid.UUID | None,
    api_key_id: uuid.UUID | None,
    model: str | None,
    user_id: uuid.UUID | None,
    source: str | None,
) -> usage_service.UsageFilter:
    return usage_service.UsageFilter(
        workspace_id=ctx.workspace.id,
        project_ids=scope,
        project_id=project_id,
        api_key_id=api_key_id,
        model=model,
        user_id=user_id,
        source=source,
    )


@router.get("/usage")
async def usage(
    ctx: WsCtx,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
    group_by: GroupBy = "model",
    project_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    model: Annotated[str | None, Query(max_length=200)] = None,
    user_id: uuid.UUID | None = None,
    source: Annotated[str | None, Query(pattern="^(api|playground)$")] = None,
) -> UsageReport:
    ctx.require(Perm.USAGE_VIEW)
    if group_by == "workspace":
        group_by = "model"
    scope = await _scope(ctx, db)
    f = _filter(ctx, scope, project_id, api_key_id, model, user_id, source)
    return await usage_service.usage_report(db, f, date_from, date_to, group_by)


@router.get("/usage/export.csv", include_in_schema=False)
async def usage_export(
    ctx: WsCtx,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
    project_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    model: Annotated[str | None, Query(max_length=200)] = None,
    user_id: uuid.UUID | None = None,
    source: Annotated[str | None, Query(pattern="^(api|playground)$")] = None,
) -> StreamingResponse:
    ctx.require(Perm.USAGE_VIEW)
    scope = await _scope(ctx, db)
    f = _filter(ctx, scope, project_id, api_key_id, model, user_id, source)
    rows = await usage_service.usage_csv_rows(db, f, date_from, date_to)
    return csv_stream(
        usage_service.USAGE_CSV_HEADER,
        rows,
        f"usage-{ctx.workspace.slug}-{utcnow().date().isoformat()}.csv",
    )


@router.get("/logs")
async def request_logs(
    ctx: WsCtx,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
    project_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    model: Annotated[str | None, Query(max_length=200)] = None,
    user_id: uuid.UUID | None = None,
    source: Annotated[str | None, Query(pattern="^(api|playground)$")] = None,
    status_filter: Annotated[
        str | None, Query(alias="status", pattern="^(success|error|cancelled)$")
    ] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    before: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> LogPage:
    ctx.require(Perm.LOGS_VIEW)
    scope = await _scope(ctx, db)
    f = usage_service.LogFilter(
        workspace_id=ctx.workspace.id,
        project_ids=scope,
        project_id=project_id,
        api_key_id=api_key_id,
        model=model,
        user_id=user_id,
        source=source,
        status=status_filter,
        q=q,
        date_from=date_from,
        date_to=date_to,
    )
    stmt = usage_service.log_query(f)
    if before is not None:
        stmt = stmt.where(RequestLog.created_at < before)
    rows = list(
        (await db.execute(stmt.order_by(RequestLog.created_at.desc()).limit(limit + 1))).scalars()
    )
    more = len(rows) > limit
    rows = rows[:limit]
    return LogPage(
        items=await usage_service.log_rows(db, rows),
        next_before=rows[-1].created_at if more and rows else None,
    )


@router.get("/logs/{log_id}")
async def request_log_detail(log_id: uuid.UUID, ctx: WsCtx, db: DB) -> RequestLogDetail:
    ctx.require(Perm.LOGS_VIEW)
    row = await db.scalar(
        select(RequestLog).where(
            RequestLog.id == log_id, RequestLog.workspace_id == ctx.workspace.id
        )
    )
    scope = await _scope(ctx, db)
    if row is None or (scope is not None and row.project_id not in scope):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")
    return await usage_service.log_detail(db, row)


# ---- Dashboard ---------------------------------------------------------------------------------


@router.get("/dashboard")
async def dashboard(ctx: WsCtx, db: DB) -> DashboardOut:
    ws = ctx.workspace
    today = datetime.now(UTC).date()
    month_start = today.replace(day=1)
    can_usage = ctx.actor.has(Perm.USAGE_VIEW)
    scope = await _scope(ctx, db)
    cond = [UsageDaily.workspace_id == ws.id]
    if scope is not None:
        cond.append(UsageDaily.project_id.in_(scope))

    def sums() -> tuple[Any, ...]:
        return (
            func.coalesce(func.sum(UsageDaily.requests), 0),
            func.coalesce(func.sum(UsageDaily.input_tokens), 0),
            func.coalesce(func.sum(UsageDaily.output_tokens), 0),
            func.coalesce(func.sum(UsageDaily.cost_micros), 0),
        )

    today_row: tuple[int, ...] = (0, 0, 0, 0)
    month_row: tuple[int, ...] = (0, 0, 0, 0)
    top: list[TopModel] = []
    daily: list[UsagePoint] = []
    if can_usage:
        today_row = tuple(
            int(v)
            for v in (await db.execute(select(*sums()).where(*cond, UsageDaily.day == today))).one()
        )
        month_row = tuple(
            int(v)
            for v in (
                await db.execute(select(*sums()).where(*cond, UsageDaily.day >= month_start))
            ).one()
        )
        for model, req, tin, tout, cost in await db.execute(
            select(UsageDaily.model, *sums())
            .where(*cond, UsageDaily.day >= month_start)
            .group_by(UsageDaily.model)
            .order_by(func.sum(UsageDaily.requests).desc())
            .limit(5)
        ):
            top.append(
                TopModel(
                    model=model, requests=int(req), tokens=int(tin + tout), cost_micros=int(cost)
                )
            )
        report = await usage_service.usage_report(
            db,
            usage_service.UsageFilter(workspace_id=ws.id, project_ids=scope),
            today - timedelta(days=13),
            today,
            "model",
        )
        daily = report.series

    feed = list(
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.workspace_id == ws.id, AuditLog.result == "success")
                .order_by(AuditLog.id.desc())
                .limit(8)
            )
        ).scalars()
    )
    models = await catalog.models_for_workspace(db, ws.id)
    has_key = await db.scalar(select(exists().where(ApiKey.workspace_id == ws.id)))
    used_playground = await db.scalar(
        select(exists().where(UsageDaily.workspace_id == ws.id, UsageDaily.source == "playground"))
    )
    added_credits = await db.scalar(
        select(
            exists().where(
                LedgerEntry.workspace_id == ws.id,
                LedgerEntry.kind.in_(("purchase", "auto_recharge")),
            )
        )
    )
    period = current_period()
    return DashboardOut(
        balance_micros=ws.balance_micros,
        available_micros=max(ws.balance_micros - ws.reserved_micros, 0),
        low_balance=ws.balance_micros < ws.low_balance_threshold_micros,
        period_spend_micros=ws.period_spend_micros if ws.period == period else 0,
        monthly_spend_limit_micros=ws.monthly_spend_limit_micros,
        can_view_usage=can_usage,
        can_manage_billing=ctx.actor.has(Perm.BILLING_MANAGE),
        requests_today=int(today_row[0]),
        tokens_today=int(today_row[1] + today_row[2]),
        cost_today_micros=int(today_row[3]),
        requests_month=int(month_row[0]),
        tokens_month=int(month_row[1] + month_row[2]),
        input_tokens_month=int(month_row[1]),
        output_tokens_month=int(month_row[2]),
        top_models=top,
        daily=daily,
        recent_activity=await activity_rows(db, feed) if ctx.actor.has(Perm.AUDIT_VIEW) else [],
        api_base_url=get_settings().api_base_url,
        example_model=models[0][0].public_id if models else None,
        checklist=Checklist(
            has_api_key=bool(has_key),
            used_playground=bool(used_playground),
            added_credits=bool(added_credits),
        ),
    )
