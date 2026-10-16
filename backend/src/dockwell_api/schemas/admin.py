import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import EmailStr, Field

from dockwell_api.schemas.billing import PaymentOut
from dockwell_api.schemas.common import APIModel, Name, UserRef
from dockwell_api.schemas.project import ActivityOut
from dockwell_api.schemas.usage import UsageTotals


class DailyStat(APIModel):
    day: date
    requests: int
    errors: int
    tokens: int
    cost_micros: int
    revenue_cents: int


class TopRow(APIModel):
    id: str
    label: str
    requests: int
    tokens: int
    cost_micros: int


class AdminOverview(APIModel):
    users_total: int
    users_active_30d: int
    users_new_7d: int
    workspaces_total: int
    revenue_cents_30d: int
    revenue_cents_total: int
    credits_sold_micros: int
    credits_granted_micros: int
    credits_used_micros: int
    outstanding_balance_micros: int
    requests_today: int
    requests_30d: int
    tokens_30d: int
    errors_30d: int
    avg_latency_ms_30d: int
    top_models: list[TopRow]
    top_workspaces: list[TopRow]
    daily: list[DailyStat]


class AdminUserOut(APIModel):
    id: uuid.UUID
    email: str
    name: str
    avatar_url: str | None
    is_admin: bool
    email_verified: bool
    suspended: bool
    suspended_reason: str | None
    two_factor_enabled: bool
    google_linked: bool
    created_at: datetime
    last_sign_in_at: datetime | None
    workspace_count: int


class AdminUserWorkspace(APIModel):
    id: uuid.UUID
    name: str
    role_name: str
    is_owner: bool
    balance_micros: int


class AdminUserDetail(AdminUserOut):
    workspaces: list[AdminUserWorkspace]
    activity: list[ActivityOut]
    usage_30d: UsageTotals
    payments: list[PaymentOut]
    session_count: int


class AdminUserPage(APIModel):
    items: list[AdminUserOut]
    total: int


class AdminUserCreate(APIModel):
    email: EmailStr
    name: Name
    password: str | None = Field(default=None, min_length=8, max_length=256)
    is_admin: bool = False


class SuspendIn(APIModel):
    reason: str = Field(default="", max_length=500)


class SetAdminIn(APIModel):
    is_admin: bool


class AdminWorkspaceOut(APIModel):
    id: uuid.UUID
    name: str
    slug: str
    owner: UserRef | None
    member_count: int
    balance_micros: int
    reserved_micros: int
    period_spend_micros: int
    monthly_spend_limit_micros: int | None
    rpm_limit: int | None
    tpm_limit: int | None
    suspended: bool
    suspended_reason: str | None
    created_at: datetime


class AdminWorkspacePage(APIModel):
    items: list[AdminWorkspaceOut]
    total: int


class AdminMember(APIModel):
    user_id: uuid.UUID
    name: str
    email: str
    role_name: str
    is_owner: bool


class AdminWorkspaceDetail(AdminWorkspaceOut):
    members: list[AdminMember]
    project_count: int
    key_count: int
    usage_30d: UsageTotals
    payments: list[PaymentOut]
    auto_recharge_enabled: bool
    card_last4: str | None


class CreditAdjustIn(APIModel):
    amount_micros: int = Field(ge=-(10**13), le=10**13)
    reason: str = Field(min_length=3, max_length=300)


class WorkspaceLimitsIn(APIModel):
    rpm_limit: int | None = Field(default=None, ge=1, le=100_000_000)
    tpm_limit: int | None = Field(default=None, ge=1, le=10_000_000_000)
    monthly_spend_limit_micros: int | None = Field(default=None, ge=0, le=10**15)


class AnnouncementIn(APIModel):
    message: str = Field(default="", max_length=500)
    level: Literal["info", "warning", "critical"] = "info"
    link: str | None = Field(default=None, max_length=500)


class PlatformSettingsOut(APIModel):
    signup_enabled: bool
    google_signin_enabled: bool
    require_email_verification: bool
    free_credit_enabled: bool
    free_credit_micros: int
    topup_presets_cents: list[int]
    topup_min_cents: int
    topup_max_cents: int
    auto_recharge_allowed: bool
    default_workspace_rpm: int | None
    default_workspace_tpm: int | None
    default_workspace_monthly_limit_micros: int | None
    default_key_rpm: int | None
    default_key_tpm: int | None
    platform_rpm: int | None
    prompt_logging_allowed: bool
    log_retention_days: int
    blocked_email_domains: list[str]
    blocked_ips: list[str]
    maintenance_mode: bool
    maintenance_message: str
    announcement: AnnouncementIn
    platform_name: str
    hf_token_set: bool
    has_logo: bool


class PlatformSettingsIn(APIModel):
    """Only the fields sent are changed."""

    signup_enabled: bool | None = None
    google_signin_enabled: bool | None = None
    require_email_verification: bool | None = None
    free_credit_enabled: bool | None = None
    free_credit_micros: int | None = Field(default=None, ge=0, le=10**12)
    topup_presets_cents: list[int] | None = Field(default=None, max_length=8)
    topup_min_cents: int | None = Field(default=None, ge=50)
    topup_max_cents: int | None = Field(default=None, ge=100)
    auto_recharge_allowed: bool | None = None
    default_workspace_rpm: int | None = Field(default=None, ge=1)
    default_workspace_tpm: int | None = Field(default=None, ge=1)
    default_workspace_monthly_limit_micros: int | None = Field(default=None, ge=0)
    default_key_rpm: int | None = Field(default=None, ge=1)
    default_key_tpm: int | None = Field(default=None, ge=1)
    platform_rpm: int | None = Field(default=None, ge=1)
    prompt_logging_allowed: bool | None = None
    log_retention_days: int | None = Field(default=None, ge=1, le=3650)
    blocked_email_domains: list[str] | None = Field(default=None, max_length=1000)
    blocked_ips: list[str] | None = Field(default=None, max_length=1000)
    maintenance_mode: bool | None = None
    maintenance_message: str | None = Field(default=None, max_length=500)
    announcement: AnnouncementIn | None = None
    platform_name: str | None = Field(default=None, min_length=1, max_length=60)


class HfTokenIn(APIModel):
    token: str | None = Field(default=None, max_length=300)


class TestEmailIn(APIModel):
    to: EmailStr | None = None


class TestEmailOut(APIModel):
    ok: bool
    message: str


class ServiceStatus(APIModel):
    ok: bool
    label: str
    detail: str


class PlatformStatus(APIModel):
    database: ServiceStatus
    email: ServiceStatus
    stripe: ServiceStatus
    google: ServiceStatus
    engine_manager: ServiceStatus
    stripe_mode: Literal["live", "test", "off"]
    stripe_last_event_at: datetime | None
    stripe_last_event_type: str | None
    serverless: bool
    demo_mode: bool
    version: str


class RefundIn(APIModel):
    amount_cents: int | None = Field(default=None, ge=1)
    reason: str = Field(min_length=3, max_length=200)


class PaymentPage(APIModel):
    items: list[PaymentOut]
    total: int


class RevenuePoint(APIModel):
    day: date
    revenue_cents: int
    refunds_cents: int
    payments: int


class RevenueReport(APIModel):
    total_cents: int
    refunds_cents: int
    payments: int
    failed: int
    series: list[RevenuePoint]


class EngineHealth(APIModel):
    provider_id: uuid.UUID
    provider_name: str
    kind: str
    managed: bool
    ok: bool
    message: str
    models: list[str]
    model_status: str | None
    running: float | None
    waiting: float | None
    kv_cache_usage: float | None
    tokens_per_second: float | None


class GpuStat(APIModel):
    gpu: str
    utilization: float | None
    memory_used_mb: float | None
    memory_total_mb: float | None


class SystemHealth(APIModel):
    engines: list[EngineHealth]
    gpus: list[GpuStat]
    gpu_source: str
    requests_in_flight: int
    requests_5m: int
    errors_5m: int
    error_rate_5m: float
    tokens_per_second_5m: float
    avg_latency_ms_5m: int
    database_ok: bool
    database_latency_ms: int
    email_pending: int
    email_failed: int


class AdminAuditOut(ActivityOut):
    workspace_id: uuid.UUID | None
