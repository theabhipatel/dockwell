"""Request logs (one row per gateway request) and daily usage rollups for charts."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from dockwell_api.db import Base, new_id, utcnow


class RequestLog(Base):
    """`workspace_id` and friends are not foreign keys: logs outlive deleted keys and projects
    (and are pruned by retention instead)."""

    __tablename__ = "request_logs"
    __table_args__ = (
        Index("ix_request_logs_workspace_created", "workspace_id", "created_at"),
        Index("ix_request_logs_created", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    model: Mapped[str] = mapped_column(String(200))
    provider_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # chat.completions | completions | embeddings
    endpoint: Mapped[str] = mapped_column(String(32))
    # api | playground
    source: Mapped[str] = mapped_column(String(16))
    stream: Mapped[bool] = mapped_column(Boolean, default=False)
    # success | error | cancelled
    status: Mapped[str] = mapped_column(String(16))
    http_status: Mapped[int] = mapped_column(Integer, default=200)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(String(1000))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    ttft_ms: Mapped[int | None] = mapped_column(Integer)
    ip: Mapped[str | None] = mapped_column(INET)
    # Prompt / response content, only when logging is allowed by the admin and the workspace.
    request_body: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    response_body: Mapped[str | None] = mapped_column(Text)


class UsageDaily(Base):
    __tablename__ = "usage_daily"
    __table_args__ = (
        UniqueConstraint(
            "day",
            "workspace_id",
            "project_id",
            "api_key_id",
            "user_id",
            "model_id",
            "source",
            name="uq_usage_daily_dims",
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_usage_daily_workspace_day", "workspace_id", "day"),
        Index("ix_usage_daily_day", "day"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    day: Mapped[date] = mapped_column(Date)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    model: Mapped[str] = mapped_column(String(200), default="")
    source: Mapped[str] = mapped_column(String(16))
    requests: Mapped[int] = mapped_column(BigInteger, default=0)
    errors: Mapped[int] = mapped_column(BigInteger, default=0)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    latency_ms_total: Mapped[int] = mapped_column(BigInteger, default=0)
