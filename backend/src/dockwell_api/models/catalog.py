"""Providers (inference endpoints), models, deployments (managed engines) and prices."""

import uuid
from datetime import datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from dockwell_api.db import Base, TimestampMixin, new_id, utcnow


class Provider(TimestampMixin, Base):
    """An OpenAI-compatible endpoint: a vLLM or llama.cpp engine, Groq, or any other API."""

    __tablename__ = "providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    # vllm | llamacpp | groq | openai_compatible
    kind: Mapped[str] = mapped_column(String(32))
    # Base URL including /v1, e.g. http://vllm:8000/v1
    base_url: Mapped[str] = mapped_column(String(500))
    api_key_enc: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # Engines started and stopped by DockWell's engine manager.
    managed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    last_check_at: Mapped[datetime | None]
    last_check_ok: Mapped[bool | None]
    last_error: Mapped[str | None] = mapped_column(String(500))


class AIModel(TimestampMixin, Base):
    __tablename__ = "models"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE"), index=True
    )
    # The id clients send in `model`.
    public_id: Mapped[str] = mapped_column(String(200), unique=True)
    # The model name the provider expects.
    upstream_id: Mapped[str] = mapped_column(String(300))
    display_name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(2000), default="", server_default="")
    owned_by: Mapped[str] = mapped_column(String(100), default="", server_default="")
    context_length: Mapped[int] = mapped_column(Integer, default=8192)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer)
    # chat | completions | tools | vision | embeddings
    capabilities: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default="{}"
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # all | selected
    visibility: Mapped[str] = mapped_column(String(10), default="all", server_default="all")
    allowed_workspace_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), default=list, server_default="{}"
    )
    deprecated_at: Mapped[datetime | None]
    retirement_date: Mapped[datetime | None]
    retirement_notified_at: Mapped[datetime | None]
    # ready | downloading | starting | failed | stopped
    status: Mapped[str] = mapped_column(String(16), default="ready", server_default="ready")
    status_message: Mapped[str | None] = mapped_column(String(1000))
    sort_order: Mapped[int] = mapped_column(Integer, default=100, server_default="100")


class Deployment(TimestampMixin, Base):
    """A model served by an engine container that DockWell manages (vLLM or llama.cpp)."""

    __tablename__ = "deployments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE"), unique=True
    )
    # vllm | llamacpp
    engine: Mapped[str] = mapped_column(String(16))
    # Hugging Face repository id, e.g. Qwen/Qwen2.5-7B-Instruct
    hf_repo: Mapped[str] = mapped_column(String(300))
    # llama.cpp only: the GGUF file (or quantization tag) inside the repository.
    hf_file: Mapped[str | None] = mapped_column(String(300))
    gpu_count: Mapped[int] = mapped_column(Integer, default=1)
    quantization: Mapped[str | None] = mapped_column(String(32))
    dtype: Mapped[str] = mapped_column(String(16), default="auto")
    gpu_memory_utilization: Mapped[float] = mapped_column(Float, default=0.9)
    max_model_len: Mapped[int | None] = mapped_column(Integer)
    extra_args: Mapped[list[str]] = mapped_column(
        ARRAY(String(200)), default=list, server_default="{}"
    )
    container_id: Mapped[str | None] = mapped_column(String(80))
    container_name: Mapped[str] = mapped_column(String(100), unique=True)
    host_port: Mapped[int | None] = mapped_column(Integer)
    # running | stopped (what the admin asked for)
    desired_state: Mapped[str] = mapped_column(String(10), default="running")
    started_at: Mapped[datetime | None]
    last_health_at: Mapped[datetime | None]


class ModelPrice(Base):
    """A model's price from `effective_from` on. Past rows are never changed, so recorded
    charges always match the price that applied when the request ran."""

    __tablename__ = "model_prices"
    __table_args__ = (Index("ix_model_prices_model_effective", "model_id", "effective_from"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE")
    )
    # Micro-dollars per 1M tokens: $0.50 / 1M = 500_000.
    input_micros_per_m: Mapped[int] = mapped_column(BigInteger, default=0)
    output_micros_per_m: Mapped[int] = mapped_column(BigInteger, default=0)
    cached_input_micros_per_m: Mapped[int | None] = mapped_column(BigInteger)
    min_charge_micros: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    is_free: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    effective_from: Mapped[datetime] = mapped_column(default=utcnow)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class WorkspacePrice(Base):
    """A per-workspace discount or custom price, for one model or (model_id NULL) all models."""

    __tablename__ = "workspace_prices"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "model_id",
            name="uq_workspace_prices_workspace_model",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE")
    )
    # Percentage off the list price (0-100). Ignored when custom prices are set.
    discount_percent: Mapped[int] = mapped_column(Integer, default=0)
    input_micros_per_m: Mapped[int | None] = mapped_column(BigInteger)
    output_micros_per_m: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str] = mapped_column(String(300), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
