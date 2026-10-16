"""Platform admin: overview, platform settings, service status, billing, usage, logs, system
health and the admin audit log."""

import base64
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from typing import Annotated

import aiosmtplib
import httpx
from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import ColumnElement, case, func, or_, select, text

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, AdminAuth, Meta
from dockwell_api.models import (
    AIModel,
    AuditLog,
    EmailOutbox,
    LedgerEntry,
    Payment,
    Provider,
    RequestLog,
    Reservation,
    UsageDaily,
    User,
    Workspace,
)
from dockwell_api.routers.account import read_image
from dockwell_api.routers.activity import activity_rows
from dockwell_api.routers.billing import ledger_rows, payment_out
from dockwell_api.schemas.admin import (
    AdminAuditOut,
    AdminOverview,
    AnnouncementIn,
    DailyStat,
    EngineHealth,
    GpuStat,
    HfTokenIn,
    PaymentPage,
    PlatformSettingsIn,
    PlatformSettingsOut,
    PlatformStatus,
    RefundIn,
    RevenuePoint,
    RevenueReport,
    ServiceStatus,
    SystemHealth,
    TestEmailIn,
    TestEmailOut,
    TopRow,
)
from dockwell_api.schemas.billing import LedgerPage
from dockwell_api.schemas.common import Message
from dockwell_api.schemas.usage import GroupBy, LogPage, RequestLogDetail, UsageReport
from dockwell_api.security.crypto import encrypt
from dockwell_api.services import audit, billing, engines, platform
from dockwell_api.services import usage as usage_service
from dockwell_api.services.export import csv_stream
from dockwell_api.services.users import escape_like

router = APIRouter(prefix="/admin", tags=["admin"])

VERSION = "1.0.0"


def _record(db: DB, admin: User, meta: Meta, action: str, **kwargs: object) -> None:
    audit.record(db, action=f"admin.{action}", actor=admin, meta=meta, admin=True, **kwargs)


# ---- Overview ----------------------------------------------------------------------------------


@router.get("/overview")
async def overview(auth: AdminAuth, db: DB) -> AdminOverview:
    now = utcnow()
    today = now.date()
    since = today - timedelta(days=29)
    users_total = await db.scalar(select(func.count()).select_from(User)) or 0
    active = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.last_sign_in_at >= now - timedelta(days=30))
        )
        or 0
    )
    new_users = (
        await db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= now - timedelta(days=7))
        )
        or 0
    )
    workspaces_total = await db.scalar(select(func.count()).select_from(Workspace)) or 0
    paid = Payment.status.in_(("succeeded", "refunded", "partially_refunded"))
    revenue_total = (
        await db.scalar(
            select(func.coalesce(func.sum(Payment.amount_cents - Payment.refunded_cents), 0)).where(
                paid
            )
        )
        or 0
    )
    revenue_30 = (
        await db.scalar(
            select(func.coalesce(func.sum(Payment.amount_cents - Payment.refunded_cents), 0)).where(
                paid, Payment.completed_at >= now - timedelta(days=30)
            )
        )
        or 0
    )
    sums = dict(
        (
            await db.execute(
                select(
                    LedgerEntry.kind, func.coalesce(func.sum(LedgerEntry.amount_micros), 0)
                ).group_by(LedgerEntry.kind)
            )
        ).all()
    )
    outstanding = await db.scalar(select(func.coalesce(func.sum(Workspace.balance_micros), 0))) or 0
    window = [UsageDaily.day >= since]
    totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(UsageDaily.requests), 0),
                func.coalesce(func.sum(UsageDaily.input_tokens + UsageDaily.output_tokens), 0),
                func.coalesce(func.sum(UsageDaily.errors), 0),
                func.coalesce(func.sum(UsageDaily.latency_ms_total), 0),
            ).where(*window)
        )
    ).one()
    requests_today = (
        await db.scalar(
            select(func.coalesce(func.sum(UsageDaily.requests), 0)).where(UsageDaily.day == today)
        )
        or 0
    )

    def top_query(column: object):  # type: ignore[no-untyped-def]
        return (
            select(
                column,  # type: ignore[call-overload]
                func.sum(UsageDaily.requests),
                func.sum(UsageDaily.input_tokens + UsageDaily.output_tokens),
                func.sum(UsageDaily.cost_micros),
            )
            .where(*window)
            .group_by(column)
            .order_by(func.sum(UsageDaily.cost_micros).desc(), func.sum(UsageDaily.requests).desc())
            .limit(5)
        )

    top_models = [
        TopRow(id=m, label=m, requests=int(r), tokens=int(t), cost_micros=int(c))
        for m, r, t, c in await db.execute(top_query(UsageDaily.model))
    ]
    ws_rows = list(await db.execute(top_query(UsageDaily.workspace_id)))
    ws_names = await usage_service.group_labels(db, "workspace", {r[0] for r in ws_rows})
    top_workspaces = [
        TopRow(
            id=str(w),
            label=ws_names.get(str(w), "Deleted"),
            requests=int(r),
            tokens=int(t),
            cost_micros=int(c),
        )
        for w, r, t, c in ws_rows
    ]
    daily_usage = {
        r[0]: r
        for r in await db.execute(
            select(
                UsageDaily.day,
                func.sum(UsageDaily.requests),
                func.sum(UsageDaily.errors),
                func.sum(UsageDaily.input_tokens + UsageDaily.output_tokens),
                func.sum(UsageDaily.cost_micros),
            )
            .where(*window)
            .group_by(UsageDaily.day)
        )
    }
    day_col = func.date(func.timezone("UTC", Payment.completed_at))
    daily_revenue: dict[date, int] = dict(
        (
            await db.execute(
                select(day_col, func.sum(Payment.amount_cents))
                .where(
                    paid, Payment.completed_at >= datetime.combine(since, datetime.min.time(), UTC)
                )
                .group_by(day_col)
            )
        ).all()
    )
    daily: list[DailyStat] = []
    day = since
    while day <= today:
        u = daily_usage.get(day)
        daily.append(
            DailyStat(
                day=day,
                requests=int(u[1]) if u else 0,
                errors=int(u[2]) if u else 0,
                tokens=int(u[3]) if u else 0,
                cost_micros=int(u[4]) if u else 0,
                revenue_cents=int(daily_revenue.get(day) or 0),
            )
        )
        day += timedelta(days=1)
    requests_30 = int(totals[0])
    return AdminOverview(
        users_total=users_total,
        users_active_30d=active,
        users_new_7d=new_users,
        workspaces_total=workspaces_total,
        revenue_cents_30d=int(revenue_30),
        revenue_cents_total=int(revenue_total),
        credits_sold_micros=int(sums.get("purchase", 0)) + int(sums.get("auto_recharge", 0)),
        credits_granted_micros=int(sums.get("grant", 0)) + max(int(sums.get("adjustment", 0)), 0),
        credits_used_micros=-int(sums.get("charge", 0)),
        outstanding_balance_micros=int(outstanding),
        requests_today=int(requests_today),
        requests_30d=requests_30,
        tokens_30d=int(totals[1]),
        errors_30d=int(totals[2]),
        avg_latency_ms_30d=int(totals[3]) // requests_30 if requests_30 else 0,
        top_models=top_models,
        top_workspaces=top_workspaces,
        daily=daily,
    )


# ---- Settings ----------------------------------------------------------------------------------


async def _settings_out(db: DB) -> PlatformSettingsOut:
    config = await platform.get_config(db)
    data = config.model_dump(exclude={"hf_token_enc"})
    return PlatformSettingsOut(
        **data,
        hf_token_set=bool(config.hf_token_enc),
        has_logo=await platform.get_logo(db) is not None,
    )


@router.get("/settings")
async def get_platform_settings(auth: AdminAuth, db: DB) -> PlatformSettingsOut:
    return await _settings_out(db)


@router.patch("/settings")
async def update_platform_settings(
    body: PlatformSettingsIn, auth: AdminAuth, db: DB, meta: Meta
) -> PlatformSettingsOut:
    nullable = {
        "default_workspace_rpm",
        "default_workspace_tpm",
        "default_workspace_monthly_limit_micros",
        "default_key_rpm",
        "default_key_tpm",
        "platform_rpm",
    }
    changes: dict[str, object] = {}
    for field in body.model_fields_set:
        value = getattr(body, field)
        if value is None and field not in nullable:
            continue
        if isinstance(value, AnnouncementIn):
            value = value.model_dump()
        if field == "blocked_email_domains" and isinstance(value, list):
            value = sorted({d.strip().lower().lstrip("@") for d in value if d.strip()})
        if field == "blocked_ips" and isinstance(value, list):
            value = sorted({ip.strip() for ip in value if ip.strip()})
        if field == "topup_presets_cents" and isinstance(value, list):
            value = sorted({int(v) for v in value if int(v) > 0})
        changes[field] = value
    if get_settings().demo_mode and changes.get("maintenance_mode"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Maintenance mode is disabled on the demo.")
    try:
        config = await platform.update_config(db, changes, auth.user.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    if config.topup_min_cents > config.topup_max_cents:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The minimum top-up exceeds the maximum."
        )
    _record(db, auth.user, meta, "settings_changed", details={"changed": sorted(changes)})
    await db.commit()
    platform.invalidate()
    return await _settings_out(db)


@router.put("/settings/hf-token")
async def set_hf_token(body: HfTokenIn, auth: AdminAuth, db: DB, meta: Meta) -> PlatformSettingsOut:
    value = encrypt(body.token.strip()) if body.token and body.token.strip() else None
    await platform.update_config(db, {"hf_token_enc": value}, auth.user.id)
    _record(db, auth.user, meta, "hf_token_changed", details={"set": value is not None})
    await db.commit()
    platform.invalidate()
    return await _settings_out(db)


@router.put("/settings/logo")
async def set_logo(
    file: Annotated[UploadFile, File()], auth: AdminAuth, db: DB, meta: Meta
) -> PlatformSettingsOut:
    data, content_type = await read_image(file, 300_000)
    await platform.set_logo(db, base64.b64encode(data).decode(), content_type, auth.user.id)
    _record(db, auth.user, meta, "logo_changed")
    await db.commit()
    return await _settings_out(db)


@router.delete("/settings/logo")
async def delete_logo(auth: AdminAuth, db: DB, meta: Meta) -> PlatformSettingsOut:
    await platform.set_logo(db, None, None, auth.user.id)
    _record(db, auth.user, meta, "logo_changed")
    await db.commit()
    return await _settings_out(db)


@router.get("/status")
async def platform_status(auth: AdminAuth, db: DB) -> PlatformStatus:
    s = get_settings()
    config = await platform.get_config(db)
    try:
        await db.execute(text("SELECT 1"))
        database = ServiceStatus(ok=True, label="Connected", detail="PostgreSQL is reachable.")
    except Exception as exc:  # pragma: no cover - the request itself needs the database
        database = ServiceStatus(ok=False, label="Error", detail=type(exc).__name__)
    failed = (
        await db.scalar(
            select(func.count()).select_from(EmailOutbox).where(EmailOutbox.status == "failed")
        )
        or 0
    )
    pending = (
        await db.scalar(
            select(func.count()).select_from(EmailOutbox).where(EmailOutbox.status == "pending")
        )
        or 0
    )
    mail = ServiceStatus(
        ok=failed == 0,
        label=f"{s.smtp_host}:{s.smtp_port}",
        detail=f"{pending} pending, {failed} failed in the outbox. "
        "Use Send test email to check delivery.",
    )
    hook = await billing.webhook_health(db)
    stripe_ok = s.stripe_configured and s.stripe_webhook_secret is not None
    stripe = ServiceStatus(
        ok=stripe_ok,
        label={"live": "Live mode", "test": "Test mode", "off": "Not configured"}[s.stripe_mode],
        detail=(
            "Webhook secret set."
            if s.stripe_webhook_secret
            else "STRIPE_WEBHOOK_SECRET is missing: credits are never added."
        )
        if s.stripe_configured
        else "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to accept payments.",
    )
    google = ServiceStatus(
        ok=s.google_configured,
        label="Configured" if s.google_configured else "Not configured",
        detail=(
            (
                "Enabled for sign-in."
                if config.google_signin_enabled
                else "Configured but turned off in settings."
            )
            if s.google_configured
            else "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
        ),
    )
    docker_ok, docker_message = await engines.docker_status()
    return PlatformStatus(
        database=database,
        email=mail,
        stripe=stripe,
        google=google,
        engine_manager=ServiceStatus(
            ok=docker_ok, label="Docker" if engines.enabled() else "Off", detail=docker_message
        ),
        stripe_mode=s.stripe_mode,
        stripe_last_event_at=hook["last_event_at"],
        stripe_last_event_type=hook["last_event_type"],
        serverless=s.serverless,
        demo_mode=s.demo_mode,
        version=VERSION,
    )


@router.post("/settings/test-email")
async def test_email(body: TestEmailIn, auth: AdminAuth, meta: Meta) -> TestEmailOut:
    """Send a test email right now (not through the outbox) and report the SMTP result."""
    s = get_settings()
    to = str(body.to) if body.to else auth.user.email
    message = EmailMessage()
    message["From"] = s.mail_from
    message["To"] = to
    message["Subject"] = f"{s.app_name} test email"
    message.set_content(f"This test email was sent from {s.app_name} by {auth.user.email}.")
    try:
        await aiosmtplib.send(
            message,
            hostname=s.smtp_host,
            port=s.smtp_port,
            username=s.smtp_username,
            password=s.smtp_password.get_secret_value() if s.smtp_password else None,
            start_tls=s.smtp_starttls,
            use_tls=s.smtp_tls,
            timeout=15,
        )
    except (aiosmtplib.SMTPException, OSError, TimeoutError) as exc:
        await audit.record_now(
            action="admin.test_email", actor=auth.user, meta=meta, admin=True, result="failure"
        )
        return TestEmailOut(
            ok=False, message=f"Sending failed: {type(exc).__name__}: {str(exc)[:200]}"
        )
    await audit.record_now(action="admin.test_email", actor=auth.user, meta=meta, admin=True)
    return TestEmailOut(ok=True, message=f"Sent to {to}.")


# ---- Billing -----------------------------------------------------------------------------------


def _payment_conditions(
    status_filter: str | None, q: str | None, workspace_id: uuid.UUID | None
) -> list[ColumnElement[bool]]:
    cond: list[ColumnElement[bool]] = []
    if status_filter == "failed":
        cond.append(Payment.status == "failed")
    elif status_filter == "refunded":
        cond.append(Payment.status.in_(("refunded", "partially_refunded")))
    elif status_filter:
        cond.append(Payment.status == status_filter)
    if workspace_id:
        cond.append(Payment.workspace_id == workspace_id)
    if q:
        like = f"%{escape_like(q.strip().lower())}%"
        cond.append(
            or_(
                func.lower(Payment.workspace_name).like(like, escape="\\"),
                Payment.stripe_payment_intent_id.like(like, escape="\\"),
            )
        )
    return cond


@router.get("/payments")
async def list_payments(
    auth: AdminAuth,
    db: DB,
    status_filter: Annotated[str | None, Query(alias="status", max_length=20)] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    workspace_id: uuid.UUID | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> PaymentPage:
    cond = _payment_conditions(status_filter, q, workspace_id)
    total = await db.scalar(select(func.count()).select_from(Payment).where(*cond))
    rows = await db.execute(
        select(Payment, User.name)
        .outerjoin(User, User.id == Payment.user_id)
        .where(*cond)
        .order_by(Payment.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return PaymentPage(items=[payment_out(p, n) for p, n in rows], total=total or 0)


@router.get("/payments/export.csv", include_in_schema=False)
async def export_payments(
    auth: AdminAuth,
    db: DB,
    status_filter: Annotated[str | None, Query(alias="status", max_length=20)] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> StreamingResponse:
    cond = _payment_conditions(status_filter, q, None)
    rows = list(
        (
            await db.execute(
                select(Payment).where(*cond).order_by(Payment.created_at.desc()).limit(100_000)
            )
        ).scalars()
    )
    return csv_stream(
        [
            "created_utc",
            "workspace",
            "kind",
            "status",
            "amount_usd",
            "refunded_usd",
            "stripe_payment_intent",
            "livemode",
        ],
        [
            [
                p.created_at.astimezone(UTC).isoformat(),
                p.workspace_name,
                p.kind,
                p.status,
                f"{p.amount_cents / 100:.2f}",
                f"{p.refunded_cents / 100:.2f}",
                p.stripe_payment_intent_id,
                p.livemode,
            ]
            for p in rows
        ],
        f"payments-{utcnow().date().isoformat()}.csv",
    )


@router.post("/payments/{payment_id}/refund")
async def refund_payment(
    payment_id: uuid.UUID, body: RefundIn, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    payment = await db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    await billing.refund(payment, body.amount_cents, body.reason)
    _record(
        db,
        auth.user,
        meta,
        "payment_refunded",
        workspace_id=payment.workspace_id,
        target_type="payment",
        target_id=payment.id,
        target_label=payment.workspace_name,
        details={
            "amount_cents": body.amount_cents or payment.amount_cents - payment.refunded_cents,
            "reason": body.reason,
        },
    )
    await db.commit()
    return Message(message="Refund issued. Credits are removed when Stripe confirms it.")


@router.get("/ledger")
async def platform_ledger(
    auth: AdminAuth,
    db: DB,
    workspace_id: uuid.UUID | None = None,
    kind: Annotated[str | None, Query(max_length=20)] = None,
    before_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> LedgerPage:
    stmt = select(LedgerEntry)
    if workspace_id:
        stmt = stmt.where(LedgerEntry.workspace_id == workspace_id)
    if kind:
        stmt = stmt.where(LedgerEntry.kind == kind)
    else:
        # Per-request charges are too many to browse platform-wide; filter by "charge" to see them.
        stmt = stmt.where(LedgerEntry.kind != "charge") if workspace_id is None else stmt
    if before_id:
        stmt = stmt.where(LedgerEntry.id < before_id)
    entries = list(
        (await db.execute(stmt.order_by(LedgerEntry.id.desc()).limit(limit + 1))).scalars()
    )
    more = len(entries) > limit
    entries = entries[:limit]
    return LedgerPage(
        items=await ledger_rows(db, entries),
        next_before_id=entries[-1].id if more and entries else None,
    )


@router.get("/revenue")
async def revenue(
    auth: AdminAuth, db: DB, days: int = Query(default=90, ge=7, le=730)
) -> RevenueReport:
    since = utcnow() - timedelta(days=days - 1)
    day_col = func.date(func.timezone("UTC", Payment.created_at))
    paid = Payment.status.in_(("succeeded", "refunded", "partially_refunded"))
    rows = {
        r[0]: r
        for r in await db.execute(
            select(
                day_col,
                func.coalesce(func.sum(case((paid, Payment.amount_cents), else_=0)), 0),
                func.coalesce(func.sum(Payment.refunded_cents), 0),
                func.count().filter(paid),
            )
            .where(Payment.created_at >= since)
            .group_by(day_col)
        )
    }
    failed = (
        await db.scalar(
            select(func.count())
            .select_from(Payment)
            .where(Payment.status == "failed", Payment.created_at >= since)
        )
        or 0
    )
    series: list[RevenuePoint] = []
    day: date = since.date()
    end = utcnow().date()
    while day <= end:
        r = rows.get(day)
        series.append(
            RevenuePoint(
                day=day,
                revenue_cents=int(r[1]) if r else 0,
                refunds_cents=int(r[2]) if r else 0,
                payments=int(r[3]) if r else 0,
            )
        )
        day += timedelta(days=1)
    return RevenueReport(
        total_cents=sum(p.revenue_cents for p in series),
        refunds_cents=sum(p.refunds_cents for p in series),
        payments=sum(p.payments for p in series),
        failed=failed,
        series=series,
    )


# ---- Usage and logs ----------------------------------------------------------------------------


@router.get("/usage")
async def platform_usage(
    auth: AdminAuth,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
    group_by: GroupBy = "model",
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    api_key_id: uuid.UUID | None = None,
    model: Annotated[str | None, Query(max_length=200)] = None,
    user_id: uuid.UUID | None = None,
    source: Annotated[str | None, Query(pattern="^(api|playground)$")] = None,
) -> UsageReport:
    f = usage_service.UsageFilter(
        workspace_id=workspace_id,
        project_id=project_id,
        api_key_id=api_key_id,
        model=model,
        user_id=user_id,
        source=source,
    )
    return await usage_service.usage_report(db, f, date_from, date_to, group_by)


@router.get("/usage/export.csv", include_in_schema=False)
async def platform_usage_export(
    auth: AdminAuth,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
    workspace_id: uuid.UUID | None = None,
    model: Annotated[str | None, Query(max_length=200)] = None,
) -> StreamingResponse:
    f = usage_service.UsageFilter(workspace_id=workspace_id, model=model)
    rows = await usage_service.usage_csv_rows(db, f, date_from, date_to)
    return csv_stream(
        usage_service.USAGE_CSV_HEADER, rows, f"platform-usage-{utcnow().date().isoformat()}.csv"
    )


@router.get("/logs")
async def platform_logs(
    auth: AdminAuth,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
    workspace_id: uuid.UUID | None = None,
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
    f = usage_service.LogFilter(
        workspace_id=workspace_id,
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
        items=await usage_service.log_rows(db, rows, with_workspace=True),
        next_before=rows[-1].created_at if more and rows else None,
    )


@router.get("/logs/{log_id}")
async def platform_log_detail(log_id: uuid.UUID, auth: AdminAuth, db: DB) -> RequestLogDetail:
    row = await db.get(RequestLog, log_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")
    return await usage_service.log_detail(db, row, with_workspace=True)


# ---- System health -----------------------------------------------------------------------------


async def _gpu_stats() -> tuple[list[GpuStat], str]:
    url = get_settings().prometheus_url
    if not url:
        return [], "Set PROMETHEUS_URL (self-hosted with the gpu profile) to see GPU metrics."
    metrics = {
        "utilization": "DCGM_FI_DEV_GPU_UTIL",
        "memory_used_mb": "DCGM_FI_DEV_FB_USED",
        "memory_free_mb": "DCGM_FI_DEV_FB_FREE",
    }
    found: dict[str, dict[str, float]] = {}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            for key, query in metrics.items():
                res = await client.get(url.rstrip("/") + "/api/v1/query", params={"query": query})
                for item in res.json().get("data", {}).get("result", []):
                    gpu = item["metric"].get("gpu", "0") + " " + item["metric"].get("modelName", "")
                    found.setdefault(gpu.strip(), {})[key] = float(item["value"][1])
    except (httpx.HTTPError, ValueError, KeyError):
        return [], "Prometheus is not reachable."
    stats = [
        GpuStat(
            gpu=name,
            utilization=v.get("utilization"),
            memory_used_mb=v.get("memory_used_mb"),
            memory_total_mb=(v["memory_used_mb"] + v["memory_free_mb"])
            if "memory_used_mb" in v and "memory_free_mb" in v
            else None,
        )
        for name, v in sorted(found.items())
    ]
    return stats, "Prometheus (NVIDIA DCGM exporter)" if stats else "No GPU metrics in Prometheus."


@router.get("/health")
async def system_health(auth: AdminAuth, db: DB) -> SystemHealth:
    started = time.monotonic()
    await db.execute(text("SELECT 1"))
    db_latency = int((time.monotonic() - started) * 1000)
    providers = list(
        (
            await db.execute(select(Provider).order_by(Provider.managed.desc(), Provider.name))
        ).scalars()
    )
    models_by_provider: dict[uuid.UUID, list[AIModel]] = {}
    for model in (await db.execute(select(AIModel))).scalars():
        models_by_provider.setdefault(model.provider_id, []).append(model)
    engines_out: list[EngineHealth] = []
    for p in providers:
        ok, message = await engines.probe_provider(p) if p.enabled else (False, "Disabled")
        metrics = await engines.engine_metrics(p) if p.kind in ("vllm", "llamacpp") and ok else {}
        models = models_by_provider.get(p.id, [])
        engines_out.append(
            EngineHealth(
                provider_id=p.id,
                provider_name=p.name,
                kind=p.kind,
                managed=p.managed,
                ok=ok,
                message=message,
                models=[m.public_id for m in models],
                model_status=models[0].status if models else None,
                running=metrics.get("running"),
                waiting=metrics.get("waiting"),
                kv_cache_usage=metrics.get("kv_cache_usage"),
                tokens_per_second=metrics.get("tokens_per_second"),
            )
        )
    since = utcnow() - timedelta(minutes=5)
    recent = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(RequestLog.status == "error"),
                func.coalesce(func.sum(RequestLog.output_tokens), 0),
                func.coalesce(func.avg(RequestLog.latency_ms), 0),
            ).where(RequestLog.created_at >= since)
        )
    ).one()
    in_flight = await db.scalar(select(func.count()).select_from(Reservation)) or 0
    pending = (
        await db.scalar(
            select(func.count()).select_from(EmailOutbox).where(EmailOutbox.status == "pending")
        )
        or 0
    )
    failed = (
        await db.scalar(
            select(func.count()).select_from(EmailOutbox).where(EmailOutbox.status == "failed")
        )
        or 0
    )
    gpus, gpu_source = await _gpu_stats()
    total = int(recent[0])
    return SystemHealth(
        engines=engines_out,
        gpus=gpus,
        gpu_source=gpu_source,
        requests_in_flight=in_flight,
        requests_5m=total,
        errors_5m=int(recent[1]),
        error_rate_5m=(int(recent[1]) / total) if total else 0.0,
        tokens_per_second_5m=int(recent[2]) / 300,
        avg_latency_ms_5m=int(recent[3]),
        database_ok=True,
        database_latency_ms=db_latency,
        email_pending=pending,
        email_failed=failed,
    )


# ---- Admin audit log ---------------------------------------------------------------------------


@router.get("/audit")
async def admin_audit(
    auth: AdminAuth,
    db: DB,
    action: Annotated[str | None, Query(max_length=64)] = None,
    actor_id: uuid.UUID | None = None,
    before_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[AdminAuditOut]:
    stmt = select(AuditLog).where(AuditLog.admin.is_(True))
    if action:
        stmt = stmt.where(AuditLog.action.like(escape_like(action) + "%", escape="\\"))
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if before_id:
        stmt = stmt.where(AuditLog.id < before_id)
    rows = list((await db.execute(stmt.order_by(AuditLog.id.desc()).limit(limit))).scalars())
    base = await activity_rows(db, rows)
    return [
        AdminAuditOut(**b.model_dump(), workspace_id=r.workspace_id)
        for b, r in zip(base, rows, strict=True)
    ]
