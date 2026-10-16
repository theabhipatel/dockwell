"""Workspace billing (credits, Stripe Checkout, auto recharge, limits, details, ledger) and the
Stripe webhook endpoint."""

from collections.abc import Sequence
from datetime import UTC

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, Meta, WsCtx
from dockwell_api.logs import get_logger
from dockwell_api.models import LedgerEntry, Payment, User
from dockwell_api.money import current_period
from dockwell_api.permissions import Perm
from dockwell_api.schemas.billing import (
    BillingAddress,
    BillingDetails,
    BillingOverview,
    BillingSettingsIn,
    CheckoutIn,
    CheckoutOut,
    LedgerOut,
    LedgerPage,
    PaymentOut,
    SavedCard,
)
from dockwell_api.schemas.common import Message
from dockwell_api.services import audit, billing, platform
from dockwell_api.services.export import csv_stream

router = APIRouter(prefix="/workspaces/{workspace_id}/billing", tags=["billing"])
webhook_router = APIRouter(tags=["billing"])
log = get_logger("billing")


async def _overview(ctx: WsCtx, db: DB) -> BillingOverview:
    ws = ctx.workspace
    config = await platform.get_config(db)
    period = current_period()
    address = ws.billing_address or {}
    return BillingOverview(
        balance_micros=ws.balance_micros,
        reserved_micros=ws.reserved_micros,
        available_micros=max(ws.balance_micros - ws.reserved_micros, 0),
        period=period,
        period_spend_micros=ws.period_spend_micros if ws.period == period else 0,
        monthly_spend_limit_micros=ws.monthly_spend_limit_micros,
        spend_alert_micros=ws.spend_alert_micros,
        low_balance_threshold_micros=ws.low_balance_threshold_micros,
        auto_recharge_enabled=ws.auto_recharge_enabled,
        auto_recharge_threshold_micros=ws.auto_recharge_threshold_micros,
        auto_recharge_amount_cents=ws.auto_recharge_amount_cents,
        auto_recharge_allowed=config.auto_recharge_allowed,
        card=(
            SavedCard(brand=ws.card_brand, last4=ws.card_last4, exp=ws.card_exp)
            if ws.stripe_payment_method_id
            else None
        ),
        details=BillingDetails(
            name=ws.billing_name,
            email=ws.billing_email,
            address=BillingAddress.model_validate(address),
            tax_id_type=ws.tax_id_type,
            tax_id=ws.tax_id,
        ),
        stripe_mode=get_settings().stripe_mode,
        topup_presets_cents=config.topup_presets_cents,
        topup_min_cents=config.topup_min_cents,
        topup_max_cents=config.topup_max_cents,
        can_manage=ctx.actor.has(Perm.BILLING_MANAGE),
    )


@router.get("")
async def billing_overview(ctx: WsCtx, db: DB) -> BillingOverview:
    ctx.require_any(Perm.BILLING_VIEW, Perm.BILLING_MANAGE)
    return await _overview(ctx, db)


@router.post("/checkout")
async def create_checkout(body: CheckoutIn, ctx: WsCtx, db: DB, meta: Meta) -> CheckoutOut:
    ctx.require(Perm.BILLING_MANAGE)
    if ctx.workspace.suspended_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This workspace is suspended.")
    url = await billing.create_checkout(
        db, ctx.workspace, ctx.user, body.amount_cents, body.save_card
    )
    audit.record(
        db,
        action="billing.checkout_started",
        actor=ctx.user,
        meta=meta,
        workspace_id=ctx.workspace.id,
        details={"amount_cents": body.amount_cents},
    )
    await db.commit()
    return CheckoutOut(url=url)


@router.patch("/settings")
async def update_billing_settings(
    body: BillingSettingsIn, ctx: WsCtx, db: DB, meta: Meta
) -> BillingOverview:
    ctx.require(Perm.BILLING_MANAGE)
    ws = ctx.workspace
    config = await platform.get_config(db)
    changed: dict[str, object] = {}
    for field in body.model_fields_set:
        value = getattr(body, field)
        if (
            field
            in (
                "low_balance_threshold_micros",
                "auto_recharge_enabled",
                "auto_recharge_threshold_micros",
                "auto_recharge_amount_cents",
            )
            and value is None
        ):
            continue
        if field == "auto_recharge_enabled" and value:
            if not config.auto_recharge_allowed:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "Auto recharge is turned off on this platform."
                )
            if ws.stripe_payment_method_id is None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Save a card first: buy credits with “Save card for auto recharge” checked.",
                )
        if field == "auto_recharge_amount_cents" and not (
            config.topup_min_cents <= value <= config.topup_max_cents
        ):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "The recharge amount is outside the allowed range.",
            )
        if getattr(ws, field) != value:
            changed[field] = value
            setattr(ws, field, value)
    if changed:
        if "spend_alert_micros" in changed:
            ws.spend_alert_notified_period = None
        if "monthly_spend_limit_micros" in changed:
            ws.spend_limit_notified_period = None
        audit.record(
            db,
            action="billing.settings_changed",
            actor=ctx.user,
            meta=meta,
            workspace_id=ws.id,
            details={k: v for k, v in changed.items()},
        )
    await db.commit()
    return await _overview(ctx, db)


@router.put("/details")
async def update_billing_details(
    body: BillingDetails, ctx: WsCtx, db: DB, meta: Meta
) -> BillingOverview:
    ctx.require(Perm.BILLING_MANAGE)
    ws = ctx.workspace
    ws.billing_name = body.name
    ws.billing_email = str(body.email) if body.email else None
    ws.billing_address = body.address.model_dump(exclude_none=True)
    ws.tax_id_type = body.tax_id_type or None
    ws.tax_id = body.tax_id or None
    await billing.sync_customer(ws)
    audit.record(
        db, action="billing.details_changed", actor=ctx.user, meta=meta, workspace_id=ws.id
    )
    await db.commit()
    return await _overview(ctx, db)


@router.delete("/payment-method")
async def remove_payment_method(ctx: WsCtx, db: DB, meta: Meta) -> BillingOverview:
    ctx.require(Perm.BILLING_MANAGE)
    await billing.detach_payment_method(db, ctx.workspace)
    audit.record(
        db, action="billing.card_removed", actor=ctx.user, meta=meta, workspace_id=ctx.workspace.id
    )
    await db.commit()
    return await _overview(ctx, db)


def payment_out(p: Payment, user_name: str | None) -> PaymentOut:
    return PaymentOut(
        id=p.id,
        workspace_id=p.workspace_id,
        workspace_name=p.workspace_name,
        user_name=user_name,
        kind=p.kind,
        amount_cents=p.amount_cents,
        refunded_cents=p.refunded_cents,
        currency=p.currency,
        status=p.status,
        receipt_url=p.receipt_url,
        invoice_url=p.invoice_url,
        invoice_pdf_url=p.invoice_pdf_url,
        failure_message=p.failure_message,
        livemode=p.livemode,
        stripe_payment_intent_id=p.stripe_payment_intent_id,
        created_at=p.created_at,
        completed_at=p.completed_at,
    )


@router.get("/payments")
async def list_payments(ctx: WsCtx, db: DB) -> list[PaymentOut]:
    ctx.require_any(Perm.BILLING_VIEW, Perm.BILLING_MANAGE)
    rows = await db.execute(
        select(Payment, User.name)
        .outerjoin(User, User.id == Payment.user_id)
        .where(Payment.workspace_id == ctx.workspace.id, Payment.status != "expired")
        .order_by(Payment.created_at.desc())
        .limit(200)
    )
    return [payment_out(p, name) for p, name in rows]


async def ledger_rows(db: DB, entries: Sequence[LedgerEntry]) -> list[LedgerOut]:
    ids = {e.actor_id for e in entries if e.actor_id}
    names = (
        dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())
        if ids
        else {}
    )
    return [
        LedgerOut(
            id=e.id,
            workspace_id=e.workspace_id,
            created_at=e.created_at,
            kind=e.kind,
            amount_micros=e.amount_micros,
            balance_after_micros=e.balance_after_micros,
            description=e.description,
            actor_name=names.get(e.actor_id) if e.actor_id else None,
            request_id=e.request_id,
        )
        for e in entries
    ]


@router.get("/ledger")
async def ledger(
    ctx: WsCtx,
    db: DB,
    kind: str | None = Query(default=None, max_length=20),
    before_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> LedgerPage:
    ctx.require_any(Perm.BILLING_VIEW, Perm.BILLING_MANAGE)
    stmt = select(LedgerEntry).where(LedgerEntry.workspace_id == ctx.workspace.id)
    if kind:
        stmt = stmt.where(LedgerEntry.kind == kind)
    if before_id is not None:
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


@router.get("/ledger/export.csv", include_in_schema=False)
async def export_ledger(ctx: WsCtx, db: DB) -> StreamingResponse:
    ctx.require_any(Perm.BILLING_VIEW, Perm.BILLING_MANAGE)
    entries = list(
        (
            await db.execute(
                select(LedgerEntry)
                .where(LedgerEntry.workspace_id == ctx.workspace.id)
                .order_by(LedgerEntry.id.desc())
                .limit(200_000)
            )
        ).scalars()
    )
    rows = [
        [
            e.created_at.astimezone(UTC).isoformat(),
            e.kind,
            f"{e.amount_micros / 1_000_000:.6f}",
            f"{e.balance_after_micros / 1_000_000:.6f}",
            e.description,
            e.request_id,
        ]
        for e in entries
    ]
    return csv_stream(
        ["time_utc", "kind", "amount_usd", "balance_after_usd", "description", "request_id"],
        rows,
        f"ledger-{ctx.workspace.slug}-{utcnow().date().isoformat()}.csv",
    )


# ---- Stripe webhook ----------------------------------------------------------------------------


@webhook_router.post("/stripe/webhook", include_in_schema=False)
async def stripe_webhook(request: Request) -> Message:
    payload = await request.body()
    event = billing.verify_event(payload, request.headers.get("stripe-signature"))
    result = await billing.handle_event(event)
    return Message(message=result)
