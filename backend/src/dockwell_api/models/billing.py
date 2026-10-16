"""Credits ledger, Stripe payments, processed webhook events and in-flight reservations."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from dockwell_api.db import Base, new_id, utcnow


class LedgerEntry(Base):
    """Every change to a workspace balance, with the balance after it. Append-only."""

    __tablename__ = "ledger_entries"
    __table_args__ = (Index("ix_ledger_entries_workspace_id_desc", "workspace_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    # grant | purchase | auto_recharge | charge | refund | adjustment
    kind: Mapped[str] = mapped_column(String(20))
    # Signed: credits added are positive, charges and refunds negative.
    amount_micros: Mapped[int] = mapped_column(BigInteger)
    balance_after_micros: Mapped[int] = mapped_column(BigInteger)
    description: Mapped[str] = mapped_column(String(500), default="")
    # Unique external reference (Stripe payment intent / refund id, free credit claim...) so a
    # credit can never be applied twice.
    reference: Mapped[str | None] = mapped_column(String(200), unique=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    payment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (Index("ix_payments_workspace_created", "workspace_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    # Kept (as NULL) when the workspace is deleted, so revenue history survives.
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="SET NULL")
    )
    workspace_name: Mapped[str] = mapped_column(String(80), default="")
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # checkout | auto_recharge
    kind: Mapped[str] = mapped_column(String(20))
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="usd")
    # pending | succeeded | failed | expired | refunded | partially_refunded
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    stripe_checkout_session_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    stripe_charge_id: Mapped[str | None] = mapped_column(String(100))
    receipt_url: Mapped[str | None] = mapped_column(String(1000))
    invoice_url: Mapped[str | None] = mapped_column(String(1000))
    invoice_pdf_url: Mapped[str | None] = mapped_column(String(1000))
    refunded_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    failure_message: Mapped[str | None] = mapped_column(String(500))
    livemode: Mapped[bool | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    completed_at: Mapped[datetime | None]


class StripeEvent(Base):
    """Webhook events already processed (Stripe retries; each event is applied once)."""

    __tablename__ = "stripe_events"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    type: Mapped[str] = mapped_column(String(100))
    received_at: Mapped[datetime] = mapped_column(default=utcnow)


class Reservation(Base):
    """Credit held by a request in flight: the most it could cost. Released on completion."""

    __tablename__ = "reservations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    amount_micros: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(index=True)
