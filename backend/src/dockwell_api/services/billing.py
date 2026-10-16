"""Stripe payments: Checkout for buying credits, webhooks, saved cards, auto recharge, refunds.

Credits are added only when Stripe's webhook confirms a payment, never from the browser
redirect. Webhooks are verified by signature and applied idempotently twice over: each event id
is recorded once, and each credit carries the payment intent id as a unique ledger reference.

Test and live mode differ only in the configured keys (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).
"""

import uuid
from datetime import timedelta
from typing import Any

import stripe
from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.config import get_settings
from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.logs import get_logger
from dockwell_api.models import Payment, StripeEvent, User, Workspace
from dockwell_api.money import cents_to_micros, dollars
from dockwell_api.permissions import Perm
from dockwell_api.services import audit, credits, notifications, platform

log = get_logger("billing")

AUTO_RECHARGE_RETRY = timedelta(minutes=15)
AUTO_RECHARGE_MAX_FAILURES = 3

_client: stripe.StripeClient | None = None


def stripe_client() -> stripe.StripeClient:
    global _client
    settings = get_settings()
    if not settings.stripe_configured or settings.stripe_secret_key is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Payments are not configured on this server. Ask the platform admin to set up Stripe.",
        )
    if _client is None:
        _client = stripe.StripeClient(
            settings.stripe_secret_key.get_secret_value(),
            http_client=stripe.HTTPXClient(allow_sync_methods=True),
            max_network_retries=2,
        )
    return _client


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Read a field from a StripeObject or a plain dict."""
    if obj is None:
        return default
    try:
        value = obj[key]
    except (KeyError, TypeError, AttributeError):
        return default
    return default if value is None else value


def _id(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    found = _get(value, "id")
    return str(found) if found else None


# ---- Customers --------------------------------------------------------------------------------


def _customer_params(ws: Workspace) -> dict[str, Any]:
    params: dict[str, Any] = {
        "name": ws.billing_name or ws.name,
        "metadata": {"workspace_id": str(ws.id)},
    }
    if ws.billing_email:
        params["email"] = ws.billing_email
    address = {k: v for k, v in (ws.billing_address or {}).items() if v}
    if address:
        params["address"] = address
    return params


async def ensure_customer(db: AsyncSession, ws: Workspace) -> str:
    if ws.stripe_customer_id:
        return ws.stripe_customer_id
    client = stripe_client()
    customer = await client.v1.customers.create_async(
        params=_customer_params(ws),  # type: ignore[arg-type]
        options={"idempotency_key": f"customer-{ws.id}"},
    )
    ws.stripe_customer_id = customer.id
    await db.flush()
    if ws.tax_id and ws.tax_id_type:
        await _sync_tax_id(ws)
    return customer.id


async def sync_customer(ws: Workspace) -> None:
    """Push billing details (name, address, tax id) to Stripe for invoices."""
    if not ws.stripe_customer_id or not get_settings().stripe_configured:
        return
    client = stripe_client()
    await client.v1.customers.update_async(ws.stripe_customer_id, params=_customer_params(ws))  # type: ignore[arg-type]
    await _sync_tax_id(ws)


async def _sync_tax_id(ws: Workspace) -> None:
    if not ws.stripe_customer_id:
        return
    client = stripe_client()
    existing = await client.v1.customers.tax_ids.list_async(ws.stripe_customer_id)
    for tax in existing.data:
        if tax.value != ws.tax_id or tax.type != ws.tax_id_type:
            await client.v1.customers.tax_ids.delete_async(ws.stripe_customer_id, tax.id)
    if (
        ws.tax_id
        and ws.tax_id_type
        and not any(t.value == ws.tax_id and t.type == ws.tax_id_type for t in existing.data)
    ):
        try:
            await client.v1.customers.tax_ids.create_async(
                ws.stripe_customer_id,
                params={"type": ws.tax_id_type, "value": ws.tax_id},
            )
        except stripe.InvalidRequestError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"Stripe rejected the tax id: {exc.user_message or 'invalid value'}",
            ) from exc


# ---- Checkout ---------------------------------------------------------------------------------


async def create_checkout(
    db: AsyncSession, ws: Workspace, user: User, amount_cents: int, save_card: bool
) -> str:
    config = await platform.get_config(db)
    if not config.topup_min_cents <= amount_cents <= config.topup_max_cents:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Choose an amount between {dollars(cents_to_micros(config.topup_min_cents))} and "
            f"{dollars(cents_to_micros(config.topup_max_cents))}.",
        )
    client = stripe_client()
    customer_id = await ensure_customer(db, ws)
    payment = Payment(
        workspace_id=ws.id,
        workspace_name=ws.name,
        user_id=user.id,
        kind="checkout",
        amount_cents=amount_cents,
        currency="usd",
        status="pending",
    )
    db.add(payment)
    await db.flush()
    base = get_settings().app_url.rstrip("/")
    metadata = {"workspace_id": str(ws.id), "payment_id": str(payment.id), "kind": "checkout"}
    intent_data: dict[str, Any] = {
        "metadata": metadata,
        "description": f"{config.platform_name} credits for {ws.name}",
    }
    if save_card:
        intent_data["setup_future_usage"] = "off_session"
    session = await client.v1.checkout.sessions.create_async(
        params={  # type: ignore[arg-type]
            "mode": "payment",
            "customer": customer_id,
            "client_reference_id": str(payment.id),
            "line_items": [
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": amount_cents,
                        "product_data": {
                            "name": f"{config.platform_name} credits",
                            "description": f"Pay-as-you-go credits for the {ws.name} workspace",
                        },
                    },
                }
            ],
            "payment_intent_data": intent_data,
            "invoice_creation": {
                "enabled": True,
                "invoice_data": {"metadata": metadata, "description": f"Credits for {ws.name}"},
            },
            "customer_update": {"address": "auto", "name": "auto"},
            "metadata": metadata,
            "success_url": f"{base}/w/{ws.id}/billing?checkout=success",
            "cancel_url": f"{base}/w/{ws.id}/billing?checkout=cancelled",
        },
        options={"idempotency_key": f"checkout-{payment.id}"},
    )
    payment.stripe_checkout_session_id = session.id
    if not session.url:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Stripe did not return a checkout page.")
    return session.url


# ---- Crediting ---------------------------------------------------------------------------------


async def _payment_for(
    db: AsyncSession, metadata: Any, intent_id: str | None, session_id: str | None = None
) -> Payment | None:
    payment_id = _get(metadata, "payment_id")
    payment: Payment | None = None
    if payment_id:
        try:
            payment = await db.get(Payment, uuid.UUID(str(payment_id)), with_for_update=True)
        except ValueError:
            payment = None
    if payment is None and intent_id:
        payment = await db.scalar(
            select(Payment).where(Payment.stripe_payment_intent_id == intent_id).with_for_update()
        )
    if payment is None and session_id:
        payment = await db.scalar(
            select(Payment)
            .where(Payment.stripe_checkout_session_id == session_id)
            .with_for_update()
        )
    return payment


async def _enrich_from_intent(db: AsyncSession, payment: Payment, intent_id: str) -> None:
    """Receipt URL, saved card details. Best effort: never blocks crediting."""
    try:
        client = stripe_client()
        intent = await client.v1.payment_intents.retrieve_async(
            intent_id, params={"expand": ["latest_charge", "payment_method"]}
        )
    except stripe.StripeError:
        log.warning("Could not load payment intent details for payment %s", payment.id)
        return
    charge = _get(intent, "latest_charge")
    if charge is not None and not isinstance(charge, str):
        payment.stripe_charge_id = _get(charge, "id")
        payment.receipt_url = _get(charge, "receipt_url")
    method = _get(intent, "payment_method")
    if (
        payment.workspace_id
        and method is not None
        and not isinstance(method, str)
        and _get(intent, "setup_future_usage") == "off_session"
    ):
        card = _get(method, "card")
        ws = await db.get(Workspace, payment.workspace_id)
        if ws is not None:
            ws.stripe_payment_method_id = _get(method, "id")
            if card is not None:
                ws.card_brand = _get(card, "brand")
                ws.card_last4 = _get(card, "last4")
                month, year = _get(card, "exp_month"), _get(card, "exp_year")
                ws.card_exp = f"{int(month):02d}/{year}" if month and year else None
            try:
                if ws.stripe_customer_id:
                    await client.v1.customers.update_async(
                        ws.stripe_customer_id,
                        params={
                            "invoice_settings": {
                                "default_payment_method": ws.stripe_payment_method_id
                            }
                        },
                    )
            except stripe.StripeError:
                log.warning("Could not set the default payment method for workspace %s", ws.id)


async def _enrich_invoice(payment: Payment, invoice_id: str | None) -> None:
    if not invoice_id:
        return
    try:
        invoice = await stripe_client().v1.invoices.retrieve_async(invoice_id)
    except stripe.StripeError:
        log.warning("Could not load invoice for payment %s", payment.id)
        return
    payment.invoice_url = _get(invoice, "hosted_invoice_url")
    payment.invoice_pdf_url = _get(invoice, "invoice_pdf")


async def credit_payment(
    db: AsyncSession,
    payment: Payment,
    intent_id: str,
    *,
    livemode: bool | None,
    invoice_id: str | None = None,
) -> bool:
    """Mark a payment succeeded and add its credits, once. Returns True if credit was added."""
    if payment.stripe_payment_intent_id is None:
        payment.stripe_payment_intent_id = intent_id
    payment.livemode = livemode
    newly = payment.status != "succeeded" and payment.status not in (
        "refunded",
        "partially_refunded",
    )
    if newly:
        payment.status = "succeeded"
        payment.completed_at = utcnow()
        payment.failure_message = None
    await _enrich_from_intent(db, payment, intent_id)
    await _enrich_invoice(payment, invoice_id)
    if payment.workspace_id is None:
        return False
    micros = cents_to_micros(payment.amount_cents)
    kind = "auto_recharge" if payment.kind == "auto_recharge" else "purchase"
    applied = await credits.apply(
        db,
        payment.workspace_id,
        micros,
        kind=kind,
        description=(
            f"Auto recharge {dollars(micros)}"
            if kind == "auto_recharge"
            else f"Credits purchased: {dollars(micros)}"
        ),
        reference=f"stripe:{intent_id}",
        actor_id=payment.user_id,
        payment_id=payment.id,
    )
    if applied is None:
        return False
    ws = await db.get(Workspace, payment.workspace_id)
    if ws is not None:
        if kind == "auto_recharge":
            ws.auto_recharge_pending_at = None
            ws.auto_recharge_failures = 0
        audit.record(
            db,
            action="billing.credits_added",
            actor=None,
            meta=None,
            workspace_id=ws.id,
            target_type="payment",
            target_id=payment.id,
            target_label=dollars(micros),
            details={"kind": kind, "amount_micros": micros, "source": "stripe"},
        )
        people = await notifications.workspace_member_ids_with(db, ws.id, Perm.BILLING_MANAGE)
        await notifications.notify_users(
            db,
            people,
            category="billing",
            type="billing.payment_succeeded",
            title=f"{dollars(micros)} added to {ws.name}",
            body=f"Payment received. Your balance is now {dollars(applied.balance_after)}.",
            link=f"/w/{ws.id}/billing",
            workspace_id=ws.id,
        )
    return True


async def fail_payment(db: AsyncSession, payment: Payment, message: str | None) -> None:
    if payment.status == "succeeded":
        return
    payment.status = "failed"
    payment.failure_message = (message or "The payment failed.")[:500]
    if payment.workspace_id is None:
        return
    ws = await db.get(Workspace, payment.workspace_id)
    if ws is None:
        return
    if payment.kind == "auto_recharge":
        ws.auto_recharge_pending_at = None
        ws.auto_recharge_failures += 1
        if ws.auto_recharge_failures >= AUTO_RECHARGE_MAX_FAILURES:
            ws.auto_recharge_enabled = False
    people = await notifications.workspace_member_ids_with(db, ws.id, Perm.BILLING_MANAGE)
    disabled = payment.kind == "auto_recharge" and not ws.auto_recharge_enabled
    await notifications.notify_users(
        db,
        people,
        category="billing",
        type="billing.payment_failed",
        title=f"Payment failed for {ws.name}",
        body=(payment.failure_message or "")
        + (" Auto recharge was turned off after repeated failures." if disabled else ""),
        link=f"/w/{ws.id}/billing",
        workspace_id=ws.id,
    )


# ---- Webhooks ---------------------------------------------------------------------------------


def verify_event(payload: bytes, signature: str | None) -> stripe.Event:
    settings = get_settings()
    if settings.stripe_webhook_secret is None or not settings.stripe_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe is not configured.")
    try:
        return stripe_client().construct_event(
            payload, signature, settings.stripe_webhook_secret.get_secret_value()
        )
    except (stripe.SignatureVerificationError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid signature.") from exc


async def handle_event(event: stripe.Event) -> str:
    """Apply one verified webhook event. Returns a short result for logging."""
    async with SessionLocal() as db:
        db.add(StripeEvent(id=event.id, type=event.type))
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            return "duplicate"
        obj = event.data.object
        livemode = bool(_get(event, "livemode", False))
        result = "ignored"
        if event.type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
            if _get(obj, "payment_status") == "paid":
                intent_id = _id(_get(obj, "payment_intent"))
                payment = await _payment_for(db, _get(obj, "metadata"), intent_id, _get(obj, "id"))
                if payment is not None and intent_id:
                    added = await credit_payment(
                        db,
                        payment,
                        intent_id,
                        livemode=livemode,
                        invoice_id=_id(_get(obj, "invoice")),
                    )
                    result = "credited" if added else "already credited"
        elif event.type == "checkout.session.async_payment_failed":
            payment = await _payment_for(db, _get(obj, "metadata"), None, _get(obj, "id"))
            if payment is not None:
                await fail_payment(db, payment, "The payment could not be completed.")
                result = "failed"
        elif event.type == "checkout.session.expired":
            payment = await _payment_for(db, _get(obj, "metadata"), None, _get(obj, "id"))
            if payment is not None and payment.status == "pending":
                payment.status = "expired"
                result = "expired"
        elif event.type == "payment_intent.succeeded":
            payment = await _payment_for(db, _get(obj, "metadata"), _get(obj, "id"))
            if payment is not None:
                added = await credit_payment(db, payment, str(_get(obj, "id")), livemode=livemode)
                result = "credited" if added else "already credited"
        elif event.type == "payment_intent.payment_failed":
            payment = await _payment_for(db, _get(obj, "metadata"), _get(obj, "id"))
            if payment is not None:
                error = _get(obj, "last_payment_error")
                await fail_payment(db, payment, _get(error, "message"))
                result = "failed"
        elif event.type == "charge.refunded":
            result = await _apply_refund(db, obj)
        await db.commit()
        log.info("Stripe event %s (%s): %s", event.id, event.type, result)
        return result


async def _apply_refund(db: AsyncSession, charge: Any) -> str:
    intent_id = _id(_get(charge, "payment_intent"))
    payment = await _payment_for(db, None, intent_id)
    if payment is None:
        return "unknown payment"
    refunded_total = int(_get(charge, "amount_refunded", 0))
    delta_cents = refunded_total - payment.refunded_cents
    if delta_cents <= 0:
        return "no change"
    payment.refunded_cents = refunded_total
    payment.status = "refunded" if refunded_total >= payment.amount_cents else "partially_refunded"
    if payment.workspace_id is None:
        return "refunded (workspace deleted)"
    micros = cents_to_micros(delta_cents)
    applied = await credits.apply(
        db,
        payment.workspace_id,
        -micros,
        kind="refund",
        description=f"Refund of {dollars(micros)}",
        reference=f"stripe_refund:{_get(charge, 'id')}:{refunded_total}",
        payment_id=payment.id,
    )
    if applied is not None:
        audit.record(
            db,
            action="billing.refunded",
            actor=None,
            meta=None,
            workspace_id=payment.workspace_id,
            target_type="payment",
            target_id=payment.id,
            target_label=dollars(micros),
            details={"amount_micros": micros},
        )
    return "refunded"


# ---- Auto recharge -----------------------------------------------------------------------------


async def trigger_auto_recharge(workspace_id: uuid.UUID) -> None:
    """Charge the saved card when the balance is below the threshold. Claimed with a
    conditional UPDATE so only one recharge runs at a time; credit arrives by webhook."""
    if not get_settings().stripe_configured:
        return
    config = await platform.get_config()
    if not config.auto_recharge_allowed:
        return
    now = utcnow()
    async with SessionLocal() as db:
        ws = await db.scalar(
            update(Workspace)
            .where(
                Workspace.id == workspace_id,
                Workspace.auto_recharge_enabled.is_(True),
                Workspace.stripe_payment_method_id.is_not(None),
                Workspace.stripe_customer_id.is_not(None),
                Workspace.suspended_at.is_(None),
                Workspace.balance_micros < Workspace.auto_recharge_threshold_micros,
                (Workspace.auto_recharge_pending_at.is_(None))
                | (Workspace.auto_recharge_pending_at < now - AUTO_RECHARGE_RETRY),
            )
            .values(auto_recharge_pending_at=now)
            .returning(Workspace)
        )
        if ws is None:
            await db.rollback()
            return
        amount = max(
            min(ws.auto_recharge_amount_cents, config.topup_max_cents), config.topup_min_cents
        )
        payment = Payment(
            workspace_id=ws.id,
            workspace_name=ws.name,
            kind="auto_recharge",
            amount_cents=amount,
            currency="usd",
            status="pending",
        )
        db.add(payment)
        await db.commit()
        try:
            intent = await stripe_client().v1.payment_intents.create_async(
                params={
                    "amount": amount,
                    "currency": "usd",
                    "customer": ws.stripe_customer_id,
                    "payment_method": ws.stripe_payment_method_id,
                    "off_session": True,
                    "confirm": True,
                    "description": f"{config.platform_name} auto recharge for {ws.name}",
                    "metadata": {
                        "workspace_id": str(ws.id),
                        "payment_id": str(payment.id),
                        "kind": "auto_recharge",
                    },
                },
                options={"idempotency_key": f"auto-recharge-{payment.id}"},
            )
            payment.stripe_payment_intent_id = intent.id
            await db.merge(payment)
            await db.commit()
        except stripe.StripeError as exc:
            log.warning("Auto recharge failed for workspace %s: %s", ws.id, type(exc).__name__)
            fresh = await db.get(Payment, payment.id)
            if fresh is not None:
                await fail_payment(db, fresh, exc.user_message or "Your card was declined.")
                await db.commit()


async def detach_payment_method(db: AsyncSession, ws: Workspace) -> None:
    if ws.stripe_payment_method_id and get_settings().stripe_configured:
        try:
            await stripe_client().v1.payment_methods.detach_async(ws.stripe_payment_method_id)
        except stripe.StripeError:
            log.warning("Could not detach payment method for workspace %s", ws.id)
    ws.stripe_payment_method_id = None
    ws.card_brand = None
    ws.card_last4 = None
    ws.card_exp = None
    ws.auto_recharge_enabled = False


async def refund(payment: Payment, amount_cents: int | None, reason: str) -> None:
    """Issue a refund through Stripe. Credits are removed when the charge.refunded webhook
    arrives, so a refund made in the Stripe dashboard is handled the same way."""
    if not payment.stripe_payment_intent_id or payment.status not in (
        "succeeded",
        "partially_refunded",
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only completed payments can be refunded.")
    remaining = payment.amount_cents - payment.refunded_cents
    amount = amount_cents or remaining
    if not 0 < amount <= remaining:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That amount cannot be refunded."
        )
    try:
        await stripe_client().v1.refunds.create_async(
            params={
                "payment_intent": payment.stripe_payment_intent_id,
                "amount": amount,
                "metadata": {"payment_id": str(payment.id), "reason": reason[:200]},
            },
            options={"idempotency_key": f"refund-{payment.id}-{payment.refunded_cents}-{amount}"},
        )
    except stripe.StripeError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Stripe refused the refund: {exc.user_message or 'error'}"
        ) from exc


async def webhook_health(db: AsyncSession) -> dict[str, Any]:
    last = await db.scalar(select(StripeEvent).order_by(StripeEvent.received_at.desc()).limit(1))
    return {
        "last_event_at": last.received_at if last else None,
        "last_event_type": last.type if last else None,
    }
