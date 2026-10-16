"""Stripe webhooks: signature check, crediting only after confirmation, idempotency, refunds."""

import hashlib
import hmac
import json
import time
import uuid
from typing import Any

import pytest
from sqlalchemy import select

from dockwell_api.db import SessionLocal
from dockwell_api.models import LedgerEntry, Payment
from dockwell_api.services import billing
from tests.conftest import Client, get_workspace, signup_and_verify

SECRET = "whsec_dockwell_tests"


def signed(event: dict[str, Any]) -> tuple[bytes, dict[str, str]]:
    payload = json.dumps(event).encode()
    ts = int(time.time())
    sig = hmac.new(SECRET.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return payload, {"stripe-signature": f"t={ts},v1={sig}", "content-type": "application/json"}


def event(kind: str, obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"evt_{uuid.uuid4().hex}",
        "object": "event",
        "type": kind,
        "livemode": False,
        "data": {"object": obj},
        "api_version": "2025-01-01",
        "created": int(time.time()),
    }


@pytest.fixture(autouse=True)
def no_stripe_network(monkeypatch: pytest.MonkeyPatch) -> None:
    async def nothing(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(billing, "_enrich_from_intent", nothing)
    monkeypatch.setattr(billing, "_enrich_invoice", nothing)


async def pending_payment(workspace_id: str, cents: int = 1000) -> Payment:
    async with SessionLocal() as db:
        payment = Payment(
            workspace_id=uuid.UUID(workspace_id),
            kind="checkout",
            amount_cents=cents,
            status="pending",
            stripe_checkout_session_id=f"cs_test_{uuid.uuid4().hex}",
        )
        db.add(payment)
        await db.commit()
        return payment


async def test_bad_signature_is_rejected(client: Client) -> None:
    payload, headers = signed(event("checkout.session.completed", {}))
    headers["stripe-signature"] = headers["stripe-signature"][:-4] + "0000"
    res = await client.http.post("/api/stripe/webhook", content=payload, headers=headers)
    assert res.status_code == 400


async def test_checkout_credits_once_even_when_redelivered(client: Client) -> None:
    me = await signup_and_verify(client)
    ws = me["workspace_id"]
    before = (await get_workspace(ws)).balance_micros
    payment = await pending_payment(ws, 2500)
    intent = f"pi_{uuid.uuid4().hex}"
    session = {
        "id": payment.stripe_checkout_session_id,
        "object": "checkout.session",
        "payment_status": "paid",
        "payment_intent": intent,
        "metadata": {"payment_id": str(payment.id), "workspace_id": ws},
    }
    first = event("checkout.session.completed", session)
    payload, headers = signed(first)
    assert (await client.http.post("/api/stripe/webhook", content=payload, headers=headers)).json()[
        "message"
    ] == "credited"
    # Same event again: recorded once.
    payload, headers = signed(first)
    assert (await client.http.post("/api/stripe/webhook", content=payload, headers=headers)).json()[
        "message"
    ] == "duplicate"
    # A different event for the same payment intent: still credited once.
    payload, headers = signed(
        event(
            "payment_intent.succeeded",
            {"id": intent, "object": "payment_intent", "metadata": {"payment_id": str(payment.id)}},
        )
    )
    res = await client.http.post("/api/stripe/webhook", content=payload, headers=headers)
    assert res.json()["message"] == "already credited"
    assert (await get_workspace(ws)).balance_micros == before + 25_000_000
    async with SessionLocal() as db:
        stored = await db.get(Payment, payment.id)
        assert stored is not None and stored.status == "succeeded"


async def test_unpaid_checkout_is_not_credited(client: Client) -> None:
    me = await signup_and_verify(client)
    ws = me["workspace_id"]
    before = (await get_workspace(ws)).balance_micros
    payment = await pending_payment(ws)
    session = {
        "id": payment.stripe_checkout_session_id,
        "object": "checkout.session",
        "payment_status": "unpaid",
        "payment_intent": None,
        "metadata": {"payment_id": str(payment.id)},
    }
    payload, headers = signed(event("checkout.session.completed", session))
    assert (
        await client.http.post("/api/stripe/webhook", content=payload, headers=headers)
    ).status_code == 200
    assert (await get_workspace(ws)).balance_micros == before


async def test_refund_removes_credit_once(client: Client) -> None:
    me = await signup_and_verify(client)
    ws = me["workspace_id"]
    payment = await pending_payment(ws, 1000)
    intent = f"pi_{uuid.uuid4().hex}"
    payload, headers = signed(
        event(
            "payment_intent.succeeded",
            {"id": intent, "object": "payment_intent", "metadata": {"payment_id": str(payment.id)}},
        )
    )
    await client.http.post("/api/stripe/webhook", content=payload, headers=headers)
    credited = (await get_workspace(ws)).balance_micros
    charge = {
        "id": f"ch_{uuid.uuid4().hex}",
        "object": "charge",
        "payment_intent": intent,
        "amount_refunded": 400,
    }
    for _ in range(2):
        payload, headers = signed(event("charge.refunded", charge))
        await client.http.post("/api/stripe/webhook", content=payload, headers=headers)
    assert (await get_workspace(ws)).balance_micros == credited - 4_000_000
    async with SessionLocal() as db:
        refunds = (
            (
                await db.execute(
                    select(LedgerEntry).where(
                        LedgerEntry.kind == "refund", LedgerEntry.workspace_id == uuid.UUID(ws)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(refunds) == 1
        stored = await db.get(Payment, payment.id)
        assert stored is not None and stored.status == "partially_refunded"
