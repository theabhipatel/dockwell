import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ARRAY, Boolean, ForeignKey, Index, Integer, LargeBinary, String, Text, text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from dockwell_api.db import Base, TimestampMixin, new_id, utcnow


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    # Always stored lower-cased and trimmed; uniqueness is enforced on this column.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(Text)
    password_changed_at: Mapped[datetime | None]
    email_verified_at: Mapped[datetime | None]
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    theme: Mapped[str] = mapped_column(String(10), default="system", server_default="system")
    avatar: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    avatar_content_type: Mapped[str | None] = mapped_column(String(50))
    avatar_updated_at: Mapped[datetime | None]
    default_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="SET NULL", use_alter=True)
    )
    onboarded_at: Mapped[datetime | None]
    last_sign_in_at: Mapped[datetime | None]

    # Platform administration (separate from workspace roles).
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    suspended_at: Mapped[datetime | None]
    suspended_reason: Mapped[str | None] = mapped_column(String(500))

    # Two-factor authentication (TOTP). The secret is encrypted at rest.
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)
    totp_enabled_at: Mapped[datetime | None]
    # Last accepted time step, so a code cannot be replayed.
    totp_last_counter: Mapped[int | None] = mapped_column(Integer)
    backup_code_hashes: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)), default=list, server_default="{}"
    )

    notification_prefs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default="{}"
    )
    # Set when this account's one-time starter credit was granted.
    free_credit_granted_at: Mapped[datetime | None]


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # SHA-256 of the opaque cookie value; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(512))


class EmailToken(Base):
    """Single-use tokens sent by email (verification, password reset, email change)."""

    __tablename__ = "email_tokens"
    __table_args__ = (Index("ix_email_tokens_user_purpose", "user_id", "purpose"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    purpose: Mapped[str] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    # For sign-up verification: the password chosen in *that* sign-up, applied on verification.
    password_hash: Mapped[str | None] = mapped_column(Text)
    # Purpose-specific data, e.g. the new address for an email change.
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")


class FreeCreditClaim(Base):
    """Remembers which email addresses already received the starter credit, so deleting and
    re-creating an account never grants it twice. Stores only a hash of the address."""

    __tablename__ = "free_credit_claims"

    email_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    claimed_at: Mapped[datetime] = mapped_column(default=utcnow)
