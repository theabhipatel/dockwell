"""Usage reports (from the daily rollup) and request log queries, shared by the workspace
pages and the admin area."""

import uuid
from collections import defaultdict
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.models import ApiKey, Project, RequestLog, UsageDaily, User, Workspace
from dockwell_api.schemas.usage import (
    GroupBy,
    RequestLogDetail,
    RequestLogOut,
    UsageGroupPoint,
    UsageGroupRow,
    UsagePoint,
    UsageReport,
    UsageTotals,
)
from dockwell_api.services.users import escape_like

MAX_RANGE_DAYS = 400
TOP_GROUPS = 6


@dataclass
class UsageFilter:
    workspace_id: uuid.UUID | None = None
    # Limits results to these projects (members without access to every project).
    project_ids: set[uuid.UUID] | None = None
    project_id: uuid.UUID | None = None
    api_key_id: uuid.UUID | None = None
    model: str | None = None
    user_id: uuid.UUID | None = None
    source: str | None = None


def date_range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = datetime.now(UTC).date()
    end = date_to or today
    start = date_from or (end - timedelta(days=29))
    if start > end:
        start, end = end, start
    if (end - start).days > MAX_RANGE_DAYS:
        start = end - timedelta(days=MAX_RANGE_DAYS)
    return start, end


def _usage_conditions(f: UsageFilter) -> list[ColumnElement[bool]]:
    cond: list[ColumnElement[bool]] = []
    if f.workspace_id is not None:
        cond.append(UsageDaily.workspace_id == f.workspace_id)
    if f.project_ids is not None:
        cond.append(UsageDaily.project_id.in_(f.project_ids))
    if f.project_id is not None:
        cond.append(UsageDaily.project_id == f.project_id)
    if f.api_key_id is not None:
        cond.append(UsageDaily.api_key_id == f.api_key_id)
    if f.model:
        cond.append(UsageDaily.model == f.model)
    if f.user_id is not None:
        cond.append(UsageDaily.user_id == f.user_id)
    if f.source:
        cond.append(UsageDaily.source == f.source)
    return cond


def _sums() -> list[Any]:
    return [
        func.coalesce(func.sum(UsageDaily.requests), 0),
        func.coalesce(func.sum(UsageDaily.errors), 0),
        func.coalesce(func.sum(UsageDaily.input_tokens), 0),
        func.coalesce(func.sum(UsageDaily.output_tokens), 0),
        func.coalesce(func.sum(UsageDaily.cost_micros), 0),
    ]


def _totals(row: Any) -> dict[str, int]:
    return {
        "requests": int(row[0]),
        "errors": int(row[1]),
        "input_tokens": int(row[2]),
        "output_tokens": int(row[3]),
        "cost_micros": int(row[4]),
    }


GROUP_COLUMNS: dict[str, Any] = {
    "model": UsageDaily.model,
    "project": UsageDaily.project_id,
    "api_key": UsageDaily.api_key_id,
    "user": UsageDaily.user_id,
    "workspace": UsageDaily.workspace_id,
    "source": UsageDaily.source,
}


async def group_labels(db: AsyncSession, group_by: str, keys: set[Any]) -> dict[str, str]:
    ids = {k for k in keys if isinstance(k, uuid.UUID)}
    labels: dict[str, str] = {}
    if group_by == "project" and ids:
        for pid, name in await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(ids))
        ):
            labels[str(pid)] = name
    elif group_by == "api_key" and ids:
        for kid, name, prefix, last in await db.execute(
            select(ApiKey.id, ApiKey.name, ApiKey.prefix, ApiKey.last_four).where(
                ApiKey.id.in_(ids)
            )
        ):
            labels[str(kid)] = f"{name} ({prefix}...{last})"
    elif group_by == "user" and ids:
        for uid, name in await db.execute(select(User.id, User.name).where(User.id.in_(ids))):
            labels[str(uid)] = name
    elif group_by == "workspace" and ids:
        for wid, name in await db.execute(
            select(Workspace.id, Workspace.name).where(Workspace.id.in_(ids))
        ):
            labels[str(wid)] = name
    return labels


def _label(group_by: str, key: Any, labels: dict[str, str]) -> str:
    if key is None:
        return {"api_key": "Playground", "project": "No project", "user": "Unknown"}.get(
            group_by, "None"
        )
    if group_by == "source":
        return "API" if key == "api" else "Playground"
    return labels.get(str(key), str(key) if group_by == "model" else "Deleted")


async def usage_report(
    db: AsyncSession,
    f: UsageFilter,
    date_from: date | None,
    date_to: date | None,
    group_by: GroupBy,
) -> UsageReport:
    start, end = date_range(date_from, date_to)
    cond = [*_usage_conditions(f), UsageDaily.day >= start, UsageDaily.day <= end]
    totals_row = (await db.execute(select(*_sums()).where(*cond))).one()
    series_rows = await db.execute(
        select(UsageDaily.day, *_sums())
        .where(*cond)
        .group_by(UsageDaily.day)
        .order_by(UsageDaily.day)
    )
    by_day = {r[0]: _totals(r[1:]) for r in series_rows}
    series = []
    day = start
    while day <= end:
        series.append(UsagePoint(day=day, **by_day.get(day, _totals((0, 0, 0, 0, 0)))))
        day += timedelta(days=1)

    column = GROUP_COLUMNS[group_by]
    group_rows = list(
        await db.execute(
            select(column, *_sums())
            .where(*cond)
            .group_by(column)
            .order_by(func.sum(UsageDaily.cost_micros).desc(), func.sum(UsageDaily.requests).desc())
        )
    )
    labels = await group_labels(db, group_by, {r[0] for r in group_rows})
    breakdown = [
        UsageGroupRow(
            key=str(r[0]) if r[0] is not None else "none",
            label=_label(group_by, r[0], labels),
            **_totals(r[1:]),
        )
        for r in group_rows
    ]
    top_keys = [r[0] for r in group_rows[:TOP_GROUPS]]
    group_series: list[UsageGroupPoint] = []
    if top_keys:
        key_cond = or_(*(column.is_(None) if k is None else column == k for k in top_keys))
        for r in await db.execute(
            select(UsageDaily.day, column, *_sums())
            .where(*cond, key_cond)
            .group_by(UsageDaily.day, column)
            .order_by(UsageDaily.day)
        ):
            group_series.append(
                UsageGroupPoint(
                    day=r[0], key=str(r[1]) if r[1] is not None else "none", **_totals(r[2:])
                )
            )
    return UsageReport(
        date_from=start,
        date_to=end,
        group_by=group_by,
        totals=UsageTotals(**_totals(totals_row)),
        series=series,
        breakdown=breakdown,
        group_series=group_series,
    )


async def usage_csv_rows(
    db: AsyncSession, f: UsageFilter, date_from: date | None, date_to: date | None
) -> list[list[object]]:
    start, end = date_range(date_from, date_to)
    cond = [*_usage_conditions(f), UsageDaily.day >= start, UsageDaily.day <= end]
    rows = list(
        (
            await db.execute(
                select(UsageDaily).where(*cond).order_by(UsageDaily.day, UsageDaily.model)
            )
        ).scalars()
    )
    projects = await group_labels(db, "project", {r.project_id for r in rows})
    keys = await group_labels(db, "api_key", {r.api_key_id for r in rows})
    users = await group_labels(db, "user", {r.user_id for r in rows})
    workspaces = await group_labels(db, "workspace", {r.workspace_id for r in rows})
    return [
        [
            r.day.isoformat(),
            workspaces.get(str(r.workspace_id), str(r.workspace_id)),
            projects.get(str(r.project_id), "") if r.project_id else "",
            keys.get(str(r.api_key_id), "") if r.api_key_id else "",
            users.get(str(r.user_id), "") if r.user_id else "",
            r.model,
            r.source,
            r.requests,
            r.errors,
            r.input_tokens,
            r.output_tokens,
            f"{r.cost_micros / 1_000_000:.6f}",
        ]
        for r in rows
    ]


USAGE_CSV_HEADER = [
    "day",
    "workspace",
    "project",
    "api_key",
    "member",
    "model",
    "source",
    "requests",
    "errors",
    "input_tokens",
    "output_tokens",
    "cost_usd",
]


# ---- Request logs -----------------------------------------------------------------------------


@dataclass
class LogFilter(UsageFilter):
    status: str | None = None
    q: str | None = None
    date_from: date | None = None
    date_to: date | None = None


def log_query(f: LogFilter) -> Select[RequestLog]:
    cond: list[ColumnElement[bool]] = []
    if f.workspace_id is not None:
        cond.append(RequestLog.workspace_id == f.workspace_id)
    if f.project_ids is not None:
        cond.append(RequestLog.project_id.in_(f.project_ids))
    if f.project_id is not None:
        cond.append(RequestLog.project_id == f.project_id)
    if f.api_key_id is not None:
        cond.append(RequestLog.api_key_id == f.api_key_id)
    if f.model:
        cond.append(RequestLog.model == f.model)
    if f.user_id is not None:
        cond.append(RequestLog.user_id == f.user_id)
    if f.source:
        cond.append(RequestLog.source == f.source)
    if f.status:
        cond.append(RequestLog.status == f.status)
    if f.date_from:
        cond.append(RequestLog.created_at >= datetime.combine(f.date_from, time.min, UTC))
    if f.date_to:
        cond.append(
            RequestLog.created_at < datetime.combine(f.date_to + timedelta(days=1), time.min, UTC)
        )
    if f.q:
        term = f.q.strip()
        like = f"%{escape_like(term)}%"
        options: list[ColumnElement[bool]] = [
            RequestLog.model.ilike(like, escape="\\"),
            RequestLog.error_message.ilike(like, escape="\\"),
            RequestLog.error_code.ilike(like, escape="\\"),
        ]
        with suppress(ValueError):
            options.append(RequestLog.id == uuid.UUID(term))
        cond.append(or_(*options))
    return select(RequestLog).where(*cond)


async def log_rows(
    db: AsyncSession, rows: list[RequestLog], *, with_workspace: bool = False
) -> list[RequestLogOut]:
    projects = await group_labels(db, "project", {r.project_id for r in rows})
    users = await group_labels(db, "user", {r.user_id for r in rows})
    key_names: dict[str, str] = {}
    key_ids = {r.api_key_id for r in rows if r.api_key_id}
    if key_ids:
        for kid, name in await db.execute(
            select(ApiKey.id, ApiKey.name).where(ApiKey.id.in_(key_ids))
        ):
            key_names[str(kid)] = name
    workspaces = (
        await group_labels(db, "workspace", {r.workspace_id for r in rows})
        if with_workspace
        else {}
    )
    out: list[RequestLogOut] = []
    for r in rows:
        out.append(
            RequestLogOut(
                id=r.id,
                created_at=r.created_at,
                workspace_id=r.workspace_id,
                workspace_name=workspaces.get(str(r.workspace_id)) if with_workspace else None,
                project_id=r.project_id,
                project_name=projects.get(str(r.project_id)) if r.project_id else None,
                api_key_id=r.api_key_id,
                api_key_name=(
                    key_names.get(str(r.api_key_id), "Deleted key") if r.api_key_id else None
                ),
                user_id=r.user_id,
                user_name=users.get(str(r.user_id)) if r.user_id else None,
                model=r.model,
                endpoint=r.endpoint,
                source=r.source,
                stream=r.stream,
                status=r.status,
                http_status=r.http_status,
                error_code=r.error_code,
                error_message=r.error_message,
                input_tokens=r.input_tokens,
                output_tokens=r.output_tokens,
                cached_tokens=r.cached_tokens,
                cost_micros=r.cost_micros,
                latency_ms=r.latency_ms,
                ttft_ms=r.ttft_ms,
            )
        )
    return out


async def log_detail(
    db: AsyncSession, row: RequestLog, *, with_workspace: bool = False
) -> RequestLogDetail:
    base = (await log_rows(db, [row], with_workspace=with_workspace))[0]
    return RequestLogDetail(
        **base.model_dump(),
        ip=str(row.ip) if row.ip else None,
        request_body=row.request_body,
        response_body=row.response_body,
        content_logged=row.request_body is not None,
    )


def group_count(rows: list[tuple[Any, int]]) -> dict[Any, int]:
    out: dict[Any, int] = defaultdict(int)
    for key, n in rows:
        out[key] += n
    return out
