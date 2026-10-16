import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import Field, StringConstraints

from dockwell_api.schemas.common import APIModel

Capability = Literal["chat", "completions", "tools", "vision", "embeddings"]
ModelStatus = Literal["ready", "downloading", "starting", "failed", "stopped"]
PublicId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._:/@-]+$"
    ),
]


def _default_capabilities() -> list[Capability]:
    return ["chat", "completions"]


class PriceOut(APIModel):
    input_micros_per_m: int
    output_micros_per_m: int
    cached_input_micros_per_m: int | None
    min_charge_micros: int
    is_free: bool


class CatalogModel(APIModel):
    """A model as users see it (playground picker, key settings, public pages)."""

    id: str
    name: str
    description: str
    owned_by: str
    context_length: int
    max_output_tokens: int | None
    capabilities: list[str]
    status: ModelStatus
    deprecated: bool
    retirement_date: datetime | None
    price: PriceOut


# ---- Playground --------------------------------------------------------------------------------


class ChatMessage(APIModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]] | None = None
    name: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None


class PlaygroundChatIn(APIModel):
    model: str = Field(min_length=1, max_length=200)
    messages: list[ChatMessage] = Field(min_length=1, max_length=500)
    project_id: uuid.UUID | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1, le=1_000_000)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    stop: list[str] | None = Field(default=None, max_length=4)
    seed: int | None = None


class ConversationSummary(APIModel):
    id: uuid.UUID
    title: str
    model: str
    created_at: datetime
    updated_at: datetime


class ConversationOut(ConversationSummary):
    settings: dict[str, Any]
    messages: list[dict[str, Any]]


class ConversationIn(APIModel):
    title: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    settings: dict[str, Any] | None = None
    messages: list[dict[str, Any]] | None = Field(default=None, max_length=1000)


# ---- Admin: providers, models, deployments, prices --------------------------------------------


ProviderKind = Literal["vllm", "llamacpp", "groq", "openai_compatible"]


class ProviderOut(APIModel):
    id: uuid.UUID
    name: str
    kind: ProviderKind
    base_url: str
    has_api_key: bool
    api_key_hint: str | None
    enabled: bool
    managed: bool
    model_count: int
    last_check_at: datetime | None
    last_check_ok: bool | None
    last_error: str | None


class ProviderIn(APIModel):
    name: str = Field(min_length=1, max_length=100)
    kind: ProviderKind
    base_url: str = Field(min_length=8, max_length=500, pattern=r"^https?://")
    api_key: str | None = Field(default=None, max_length=500)
    enabled: bool = True


class ProviderUpdate(APIModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    base_url: str | None = Field(default=None, min_length=8, max_length=500, pattern=r"^https?://")
    api_key: str | None = Field(default=None, max_length=500)
    clear_api_key: bool = False
    enabled: bool | None = None


class RemoteModel(APIModel):
    id: str
    owned_by: str | None
    context_length: int | None
    already_added: bool


class ProviderCheck(APIModel):
    ok: bool
    message: str
    models: list[RemoteModel]


class AdminModelOut(APIModel):
    id: uuid.UUID
    provider_id: uuid.UUID
    provider_name: str
    provider_kind: str
    public_id: str
    upstream_id: str
    display_name: str
    description: str
    owned_by: str
    context_length: int
    max_output_tokens: int | None
    capabilities: list[str]
    enabled: bool
    visibility: Literal["all", "selected"]
    allowed_workspace_ids: list[uuid.UUID]
    deprecated_at: datetime | None
    retirement_date: datetime | None
    status: ModelStatus
    status_message: str | None
    sort_order: int
    price: PriceOut | None
    deployment_id: uuid.UUID | None
    requests_30d: int


class ModelIn(APIModel):
    provider_id: uuid.UUID
    public_id: PublicId
    upstream_id: str = Field(min_length=1, max_length=300)
    display_name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    owned_by: str = Field(default="", max_length=100)
    context_length: int = Field(default=8192, ge=256, le=10_000_000)
    max_output_tokens: int | None = Field(default=None, ge=1, le=10_000_000)
    capabilities: list[Capability] = Field(default_factory=_default_capabilities)
    enabled: bool = True
    visibility: Literal["all", "selected"] = "all"
    allowed_workspace_ids: list[uuid.UUID] = Field(default_factory=list)
    sort_order: int = Field(default=100, ge=0, le=100_000)
    input_price_micros_per_m: int = Field(default=0, ge=0)
    output_price_micros_per_m: int = Field(default=0, ge=0)
    is_free: bool = False


class ModelUpdate(APIModel):
    public_id: PublicId | None = None
    upstream_id: str | None = Field(default=None, min_length=1, max_length=300)
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    owned_by: str | None = Field(default=None, max_length=100)
    context_length: int | None = Field(default=None, ge=256, le=10_000_000)
    max_output_tokens: int | None = Field(default=None, ge=1, le=10_000_000)
    capabilities: list[Capability] | None = None
    enabled: bool | None = None
    visibility: Literal["all", "selected"] | None = None
    allowed_workspace_ids: list[uuid.UUID] | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100_000)


class DeprecateIn(APIModel):
    retirement_date: datetime | None = None
    undo: bool = False


class PriceIn(APIModel):
    input_micros_per_m: int = Field(ge=0, le=10**12)
    output_micros_per_m: int = Field(ge=0, le=10**12)
    cached_input_micros_per_m: int | None = Field(default=None, ge=0, le=10**12)
    min_charge_micros: int = Field(default=0, ge=0, le=10**9)
    is_free: bool = False
    effective_from: datetime | None = None


class PriceHistoryOut(PriceOut):
    id: uuid.UUID
    effective_from: datetime
    created_at: datetime
    created_by_name: str | None
    current: bool


class DeploymentIn(APIModel):
    engine: Literal["vllm", "llamacpp"]
    hf_repo: str = Field(min_length=3, max_length=300, pattern=r"^[\w.-]+/[\w.-]+$")
    hf_file: str | None = Field(default=None, max_length=300)
    public_id: PublicId
    display_name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    capabilities: list[Capability] = Field(default_factory=_default_capabilities)
    context_length: int = Field(default=8192, ge=256, le=10_000_000)
    gpu_count: int = Field(default=1, ge=0, le=16)
    quantization: str | None = Field(default=None, max_length=32)
    dtype: str = Field(default="auto", max_length=16)
    gpu_memory_utilization: float = Field(default=0.9, gt=0, le=1)
    extra_args: list[str] = Field(default_factory=list, max_length=40)
    input_price_micros_per_m: int = Field(default=0, ge=0)
    output_price_micros_per_m: int = Field(default=0, ge=0)


class DeploymentOut(APIModel):
    id: uuid.UUID
    model_id: uuid.UUID
    public_id: str
    display_name: str
    engine: str
    hf_repo: str
    hf_file: str | None
    gpu_count: int
    quantization: str | None
    dtype: str
    gpu_memory_utilization: float
    max_model_len: int | None
    extra_args: list[str]
    container_name: str
    host_port: int | None
    desired_state: str
    status: ModelStatus
    status_message: str | None
    started_at: datetime | None
    last_health_at: datetime | None
    created_at: datetime


class EngineLogs(APIModel):
    lines: list[str]


class WorkspacePriceIn(APIModel):
    model_id: uuid.UUID | None = None
    discount_percent: int = Field(default=0, ge=0, le=100)
    input_micros_per_m: int | None = Field(default=None, ge=0)
    output_micros_per_m: int | None = Field(default=None, ge=0)
    note: str = Field(default="", max_length=300)


class WorkspacePriceOut(WorkspacePriceIn):
    id: uuid.UUID
    model_public_id: str | None
    created_at: datetime
