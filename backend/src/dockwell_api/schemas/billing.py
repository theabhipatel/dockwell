import uuid
from datetime import datetime
from typing import Literal

from pydantic import EmailStr, Field

from dockwell_api.schemas.common import APIModel


class BillingAddress(APIModel):
    line1: str | None = Field(default=None, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, min_length=2, max_length=2)


class BillingDetails(APIModel):
    name: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    address: BillingAddress = Field(default_factory=BillingAddress)
    tax_id_type: str | None = Field(default=None, max_length=20)
    tax_id: str | None = Field(default=None, max_length=64)


class SavedCard(APIModel):
    brand: str | None
    last4: str | None
    exp: str | None


class BillingOverview(APIModel):
    balance_micros: int
    reserved_micros: int
    available_micros: int
    period: str
    period_spend_micros: int
    monthly_spend_limit_micros: int | None
    spend_alert_micros: int | None
    low_balance_threshold_micros: int
    auto_recharge_enabled: bool
    auto_recharge_threshold_micros: int
    auto_recharge_amount_cents: int
    auto_recharge_allowed: bool
    card: SavedCard | None
    details: BillingDetails
    stripe_mode: Literal["live", "test", "off"]
    topup_presets_cents: list[int]
    topup_min_cents: int
    topup_max_cents: int
    can_manage: bool


class CheckoutIn(APIModel):
    amount_cents: int = Field(ge=50, le=10_000_000)
    save_card: bool = True


class CheckoutOut(APIModel):
    url: str


class BillingSettingsIn(APIModel):
    """Fields that are sent are changed; null clears a limit."""

    monthly_spend_limit_micros: int | None = Field(default=None, ge=0, le=10**15)
    spend_alert_micros: int | None = Field(default=None, ge=0, le=10**15)
    low_balance_threshold_micros: int | None = Field(default=None, ge=0, le=10**15)
    auto_recharge_enabled: bool | None = None
    auto_recharge_threshold_micros: int | None = Field(default=None, ge=0, le=10**15)
    auto_recharge_amount_cents: int | None = Field(default=None, ge=50, le=10_000_000)


class PaymentOut(APIModel):
    id: uuid.UUID
    workspace_id: uuid.UUID | None
    workspace_name: str
    user_name: str | None
    kind: str
    amount_cents: int
    refunded_cents: int
    currency: str
    status: str
    receipt_url: str | None
    invoice_url: str | None
    invoice_pdf_url: str | None
    failure_message: str | None
    livemode: bool | None
    stripe_payment_intent_id: str | None
    created_at: datetime
    completed_at: datetime | None


class LedgerOut(APIModel):
    id: int
    workspace_id: uuid.UUID
    created_at: datetime
    kind: str
    amount_micros: int
    balance_after_micros: int
    description: str
    actor_name: str | None
    request_id: uuid.UUID | None


class LedgerPage(APIModel):
    items: list[LedgerOut]
    next_before_id: int | None
