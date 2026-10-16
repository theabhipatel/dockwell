import uuid
from datetime import date, datetime
from typing import Any, Literal

from dockwell_api.schemas.common import APIModel
from dockwell_api.schemas.project import ActivityOut

GroupBy = Literal["model", "project", "api_key", "user", "workspace", "source"]


class UsageTotals(APIModel):
    requests: int
    errors: int
    input_tokens: int
    output_tokens: int
    cost_micros: int


class UsagePoint(UsageTotals):
    day: date


class UsageGroupRow(UsageTotals):
    key: str
    label: str


class UsageGroupPoint(UsageTotals):
    day: date
    key: str


class UsageReport(APIModel):
    date_from: date
    date_to: date
    group_by: GroupBy
    totals: UsageTotals
    series: list[UsagePoint]
    breakdown: list[UsageGroupRow]
    group_series: list[UsageGroupPoint]


class RequestLogOut(APIModel):
    id: uuid.UUID
    created_at: datetime
    workspace_id: uuid.UUID
    workspace_name: str | None
    project_id: uuid.UUID | None
    project_name: str | None
    api_key_id: uuid.UUID | None
    api_key_name: str | None
    user_id: uuid.UUID | None
    user_name: str | None
    model: str
    endpoint: str
    source: str
    stream: bool
    status: str
    http_status: int
    error_code: str | None
    error_message: str | None
    input_tokens: int
    output_tokens: int
    cached_tokens: int
    cost_micros: int
    latency_ms: int
    ttft_ms: int | None


class RequestLogDetail(RequestLogOut):
    ip: str | None
    request_body: dict[str, Any] | None
    response_body: str | None
    content_logged: bool


class LogPage(APIModel):
    items: list[RequestLogOut]
    next_before: datetime | None


class TopModel(APIModel):
    model: str
    requests: int
    tokens: int
    cost_micros: int


class Checklist(APIModel):
    has_api_key: bool
    used_playground: bool
    added_credits: bool


class DashboardOut(APIModel):
    balance_micros: int
    available_micros: int
    low_balance: bool
    period_spend_micros: int
    monthly_spend_limit_micros: int | None
    can_view_usage: bool
    can_manage_billing: bool
    requests_today: int
    tokens_today: int
    cost_today_micros: int
    requests_month: int
    tokens_month: int
    input_tokens_month: int
    output_tokens_month: int
    top_models: list[TopModel]
    daily: list[UsagePoint]
    recent_activity: list[ActivityOut]
    api_base_url: str
    example_model: str | None
    checklist: Checklist
