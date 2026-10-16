import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from dockwell_api.db import Base, TimestampMixin, new_id, utcnow


class Workspace(TimestampMixin, Base):
    """A team account. Credits, billing and spend limits belong to the workspace."""

    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    logo: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    logo_content_type: Mapped[str | None] = mapped_column(String(50))
    logo_updated_at: Mapped[datetime | None]
    default_project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="SET NULL", use_alter=True)
    )
    suspended_at: Mapped[datetime | None]
    suspended_reason: Mapped[str | None] = mapped_column(String(500))

    # ---- Money (micro-dollars: 1 USD = 1_000_000) -------------------------------------------
    balance_micros: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    # Sum of open reservations: requests in flight hold the most they could cost.
    reserved_micros: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    # Spend in the current calendar month (UTC), for the monthly limit and alert.
    period: Mapped[str] = mapped_column(String(7), default="", server_default="")
    period_spend_micros: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    monthly_spend_limit_micros: Mapped[int | None] = mapped_column(BigInteger)
    spend_alert_micros: Mapped[int | None] = mapped_column(BigInteger)
    spend_alert_notified_period: Mapped[str | None] = mapped_column(String(7))
    spend_limit_notified_period: Mapped[str | None] = mapped_column(String(7))
    low_balance_threshold_micros: Mapped[int] = mapped_column(
        BigInteger, default=1_000_000, server_default="1000000"
    )
    low_balance_notified_at: Mapped[datetime | None]
    zero_balance_notified_at: Mapped[datetime | None]

    # ---- Auto recharge -------------------------------------------------------------------------
    auto_recharge_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    auto_recharge_threshold_micros: Mapped[int] = mapped_column(
        BigInteger, default=5_000_000, server_default="5000000"
    )
    auto_recharge_amount_cents: Mapped[int] = mapped_column(
        Integer, default=2000, server_default="2000"
    )
    auto_recharge_pending_at: Mapped[datetime | None]
    auto_recharge_failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # ---- Stripe and billing details ------------------------------------------------------------
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    stripe_payment_method_id: Mapped[str | None] = mapped_column(String(64))
    card_brand: Mapped[str | None] = mapped_column(String(20))
    card_last4: Mapped[str | None] = mapped_column(String(4))
    card_exp: Mapped[str | None] = mapped_column(String(7))
    billing_name: Mapped[str | None] = mapped_column(String(200))
    billing_email: Mapped[str | None] = mapped_column(String(320))
    billing_address: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default="{}"
    )
    tax_id_type: Mapped[str | None] = mapped_column(String(20))
    tax_id: Mapped[str | None] = mapped_column(String(64))

    # ---- Limits and data ---------------------------------------------------------------------
    # Custom per-workspace rate limits set by a platform admin (NULL = platform default).
    rpm_limit: Mapped[int | None] = mapped_column(Integer)
    tpm_limit: Mapped[int | None] = mapped_column(Integer)
    log_retention_days: Mapped[int | None] = mapped_column(Integer)
    # The workspace can opt out of prompt / response logging even when the admin allows it.
    store_prompts: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class Role(TimestampMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_roles_workspace_name"),
        UniqueConstraint(
            "workspace_id",
            "rank",
            name="uq_roles_workspace_rank",
            deferrable=True,
            initially="DEFERRED",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(String(300), default="", server_default="")
    # Higher rank = more powerful. The owner role is always the highest.
    rank: Mapped[int] = mapped_column(Integer)
    # "owner" | "admin" | "manager" | "member" for built-in roles, NULL for custom roles.
    system_key: Mapped[str | None] = mapped_column(String(20))
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_memberships_workspace_user"),
        # Exactly one owner per workspace, enforced by the database.
        Index(
            "uq_memberships_one_owner",
            "workspace_id",
            unique=True,
            postgresql_where=text("is_owner"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # NO ACTION (checked at statement end) so deleting a workspace can cascade to both tables,
    # while deleting a role that is still in use is refused.
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id"), index=True
    )
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    joined_at: Mapped[datetime] = mapped_column(default=utcnow)


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        Index(
            "uq_invitations_pending_email",
            "workspace_id",
            "email",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_invitations_email_status", "email", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(320))
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE")
    )
    project_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # pending | accepted | declined | revoked | expired
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_sent_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    responded_at: Mapped[datetime | None]
