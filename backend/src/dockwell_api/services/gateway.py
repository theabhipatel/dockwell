"""The metering gateway. Every API and playground request passes through here before it
reaches an engine (vLLM, llama.cpp, Groq or any OpenAI-compatible provider).

For each request:
 1. the caller (API key or signed-in user) has been authenticated; the workspace, project and
    key are checked to be active;
 2. the model must exist, be enabled, ready, visible to the workspace and allowed for the key;
 3. rate limits (key, project, workspace, platform) and spend limits are applied;
 4. the most the request could cost (input estimate + max output tokens) is *reserved* against
    the balance in one atomic UPDATE, so parallel requests can never overspend;
 5. the request is forwarded and the reply streamed back;
 6. the real token usage is read at the end (also for streamed and cancelled requests), the
    exact cost is charged and the rest of the reservation released;
 7. the request log and usage rollup are written and alerts / auto recharge triggered.

Engines only generate text: all accounting is DockWell's own, identical for every provider.
"""

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator, Awaitable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Literal

import httpx
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import case, delete, select, update
from sqlalchemy.dialects.postgresql import insert

from dockwell_api.config import get_settings
from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.logs import get_logger
from dockwell_api.metrics import observe_request
from dockwell_api.models import (
    AIModel,
    ApiKey,
    LedgerEntry,
    Project,
    Provider,
    RequestLog,
    Reservation,
    UsageDaily,
    Workspace,
)
from dockwell_api.money import ceil_div, current_period, dollars
from dockwell_api.security import ratelimit
from dockwell_api.security.crypto import decrypt
from dockwell_api.services import alerts, catalog, platform
from dockwell_api.services.catalog import EffectivePrice

log = get_logger("gateway")

Endpoint = Literal["chat.completions", "completions", "embeddings"]
Source = Literal["api", "playground"]

UPSTREAM_PATHS: dict[str, str] = {
    "chat.completions": "/chat/completions",
    "completions": "/completions",
    "embeddings": "/embeddings",
}
IMAGE_TOKEN_ESTIMATE = 1500
MAX_LOGGED_RESPONSE_CHARS = 64_000


class GatewayError(Exception):
    """An error returned to the client in OpenAI's error format."""

    def __init__(
        self,
        status: int,
        message: str,
        *,
        type: str = "invalid_request_error",
        code: str | None = None,
        param: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.type = type
        self.code = code
        self.param = param
        self.headers = headers or {}

    def body(self) -> dict[str, Any]:
        return {
            "error": {
                "message": self.message,
                "type": self.type,
                "param": self.param,
                "code": self.code,
            }
        }

    def response(self) -> JSONResponse:
        return JSONResponse(self.body(), status_code=self.status, headers=self.headers)


@dataclass
class Caller:
    workspace_id: uuid.UUID
    project_id: uuid.UUID | None
    source: Source
    api_key: ApiKey | None = None
    # The member the usage is attributed to: the signed-in user in the playground, the key's
    # creator for API requests.
    user_id: uuid.UUID | None = None
    ip: str | None = None


@dataclass
class Prepared:
    caller: Caller
    endpoint: Endpoint
    model: AIModel
    provider: Provider
    price: EffectivePrice
    body: dict[str, Any]
    stream: bool
    reservation_id: uuid.UUID
    reserved: int
    fair_input_estimate: int
    limits: list[ratelimit.Limit]
    store_content: bool
    request_id: uuid.UUID = field(default_factory=uuid.uuid4)
    started: float = field(default_factory=time.monotonic)


@dataclass
class Outcome:
    status: Literal["success", "error", "cancelled"]
    http_status: int = 200
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    ttft_ms: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    response_text: str | None = None


@dataclass(frozen=True)
class Settled:
    cost_micros: int
    balance_after: int


# ---- Background work ----------------------------------------------------------------------------

_background: set[asyncio.Task[None]] = set()


async def run_after(coro: Awaitable[None]) -> None:
    """Run follow-up work (alerts, auto recharge) without delaying the response.

    Serverless platforms may freeze the process once the response is sent, so there it runs
    inline before the response finishes.
    """
    if get_settings().serverless:
        try:
            await coro
        except Exception:
            log.exception("Follow-up task failed")
        return

    async def wrapper() -> None:
        try:
            await coro
        except Exception:
            log.exception("Follow-up task failed")

    task = asyncio.create_task(wrapper())
    _background.add(task)
    task.add_done_callback(_background.discard)


# ---- HTTP client --------------------------------------------------------------------------------

_client: httpx.AsyncClient | None = None


def http_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        s = get_settings()
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                s.upstream_timeout_seconds, connect=s.upstream_connect_timeout_seconds
            ),
            limits=httpx.Limits(max_connections=500, max_keepalive_connections=100),
        )
    return _client


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def upstream_headers(provider: Provider) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key = decrypt(provider.api_key_enc)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


# ---- Token estimates ---------------------------------------------------------------------------


def _text_bytes(value: Any) -> tuple[int, int]:
    """(bytes of text, number of images) in a prompt / messages structure."""
    if value is None:
        return 0, 0
    if isinstance(value, str):
        return len(value.encode()), 0
    if isinstance(value, int | float | bool):
        return 4, 0
    if isinstance(value, list):
        total, images = 0, 0
        for item in value:
            b, i = _text_bytes(item)
            total += b
            images += i
        return total, images
    if isinstance(value, dict):
        if value.get("type") in ("image_url", "input_image", "image"):
            return 0, 1
        total, images = 0, 0
        for key, item in value.items():
            if key in ("role", "type", "name"):
                total += 4
                continue
            b, i = _text_bytes(item)
            total += b
            images += i
        return total, images
    return 0, 0


def estimate_input_tokens(endpoint: Endpoint, body: dict[str, Any]) -> tuple[int, int]:
    """(conservative upper estimate for the reservation, fair estimate for charging when the
    engine reports no usage)."""
    if endpoint == "chat.completions":
        messages = body.get("messages") or []
        text, images = _text_bytes(messages)
        text += _text_bytes(body.get("tools"))[0]
        overhead = 8 * (len(messages) if isinstance(messages, list) else 1) + 16
    elif endpoint == "completions":
        text, images = _text_bytes(body.get("prompt"))
        overhead = 8
    else:
        text, images = _text_bytes(body.get("input"))
        overhead = 8
    upper = ceil_div(text, 2) + overhead + images * IMAGE_TOKEN_ESTIMATE
    fair = ceil_div(text, 4) + overhead + images * IMAGE_TOKEN_ESTIMATE
    return upper, fair


def _has_images(messages: Any) -> bool:
    return _text_bytes(messages)[1] > 0


# ---- Preparation: checks, limits and the reservation ---------------------------------------------


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise GatewayError(400, "max_tokens must be an integer.", param="max_tokens")
    return value


async def prepare(caller: Caller, endpoint: Endpoint, body: dict[str, Any]) -> Prepared:
    config = await platform.get_config()
    if config.maintenance_mode:
        raise GatewayError(503, config.maintenance_message, type="server_error", code="maintenance")
    model_name = body.get("model")
    if not isinstance(model_name, str) or not model_name:
        raise GatewayError(400, "You must provide a model parameter.", param="model")

    async with SessionLocal() as db:
        workspace = await db.get(Workspace, caller.workspace_id)
        if workspace is None:
            raise GatewayError(
                401, "Invalid API key.", type="invalid_request_error", code="invalid_api_key"
            )
        if workspace.suspended_at is not None:
            raise GatewayError(
                403,
                "This workspace is suspended. Contact the platform administrator.",
                type="permission_error",
                code="workspace_suspended",
            )
        project: Project | None = None
        if caller.project_id is not None:
            project = await db.get(Project, caller.project_id)
            if project is None or project.workspace_id != workspace.id:
                raise GatewayError(401, "Invalid API key.", code="invalid_api_key")
            if project.archived_at is not None:
                raise GatewayError(
                    403,
                    "This project is archived.",
                    type="permission_error",
                    code="project_archived",
                )

        found = await catalog.find_model(db, model_name)
        not_found = GatewayError(
            404,
            f"The model `{model_name}` does not exist or you do not have access to it.",
            code="model_not_found",
            param="model",
        )
        if found is None:
            raise not_found
        model, provider = found
        if not model.enabled or not catalog.visible_to(model, workspace.id):
            raise not_found
        if catalog.is_retired(model):
            raise GatewayError(
                404,
                f"The model `{model_name}` has been retired.",
                code="model_retired",
                param="model",
            )
        if model.status != "ready" or not provider.enabled:
            raise GatewayError(
                503,
                f"The model `{model_name}` is not available right now. Please try again later.",
                type="server_error",
                code="model_unavailable",
            )
        key = caller.api_key
        if key is not None and key.allowed_models and model.public_id not in key.allowed_models:
            raise GatewayError(
                403,
                f"This API key is not allowed to use the model `{model_name}`.",
                type="permission_error",
                code="model_not_allowed",
            )
        caps = set(model.capabilities or [])
        if endpoint == "embeddings":
            if "embeddings" not in caps:
                raise GatewayError(400, f"`{model_name}` is not an embedding model.", param="model")
        elif not caps & {"chat", "completions"}:
            raise GatewayError(
                400, f"`{model_name}` does not support text generation.", param="model"
            )
        if endpoint == "chat.completions":
            if not isinstance(body.get("messages"), list) or not body["messages"]:
                raise GatewayError(400, "messages must be a non-empty array.", param="messages")
            if body.get("tools") and "tools" not in caps:
                raise GatewayError(400, f"`{model_name}` does not support tools.", param="tools")
            if "vision" not in caps and _has_images(body["messages"]):
                raise GatewayError(400, f"`{model_name}` does not accept images.", param="messages")
        if endpoint == "completions" and body.get("prompt") in (None, "", []):
            raise GatewayError(400, "prompt is required.", param="prompt")
        if endpoint == "embeddings" and body.get("input") in (None, "", []):
            raise GatewayError(400, "input is required.", param="input")

        price = await catalog.effective_price(db, model.id, workspace.id)
        upper_input, fair_input = estimate_input_tokens(endpoint, body)
        upper_input = min(upper_input, model.context_length)

        # Bound the output so the reservation is a true upper limit.
        forward = dict(body)
        forward["model"] = model.upstream_id
        stream = bool(body.get("stream")) and endpoint != "embeddings"
        max_output = 0
        if endpoint != "embeddings":
            n = body.get("n") or 1
            if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 16:
                raise GatewayError(400, "n must be between 1 and 16.", param="n")
            requested = _int_or_none(body.get("max_completion_tokens")) or _int_or_none(
                body.get("max_tokens")
            )
            room = max(model.context_length - min(fair_input, model.context_length), 16)
            ceiling = min(model.max_output_tokens or room, room)
            if requested is None:
                requested = min(get_settings().default_max_tokens, ceiling)
                forward["max_tokens"] = requested
            elif requested < 1:
                raise GatewayError(400, "max_tokens must be at least 1.", param="max_tokens")
            elif model.max_output_tokens and requested > model.max_output_tokens:
                raise GatewayError(
                    400,
                    f"max_tokens is too large: this model allows at most "
                    f"{model.max_output_tokens}.",
                    param="max_tokens",
                )
            max_output = requested * n
            if stream:
                options = dict(forward.get("stream_options") or {})
                options["include_usage"] = True
                forward["stream_options"] = options
        amount = price.max_cost(upper_input, max_output)

        # Spend limits on the key and project (the workspace limit is enforced atomically below).
        period = current_period()
        if (
            key is not None
            and key.spend_limit_micros is not None
            and (key.spent_micros + amount > key.spend_limit_micros)
        ):
            raise GatewayError(
                429,
                "This API key has reached its spend limit.",
                type="insufficient_quota",
                code="key_spend_limit_reached",
            )
        if project is not None and project.monthly_spend_limit_micros is not None:
            spent = project.period_spend_micros if project.period == period else 0
            if spent + amount > project.monthly_spend_limit_micros:
                raise GatewayError(
                    429,
                    "This project has reached its monthly spend limit.",
                    type="insufficient_quota",
                    code="project_spend_limit_reached",
                )

        limits = [
            ratelimit.Limit("platform", "platform", config.platform_rpm, None),
            ratelimit.Limit(
                "workspace",
                f"ws:{workspace.id}",
                workspace.rpm_limit or config.default_workspace_rpm,
                workspace.tpm_limit or config.default_workspace_tpm,
            ),
        ]
        if project is not None:
            limits.append(
                ratelimit.Limit(
                    "project", f"project:{project.id}", project.rpm_limit, project.tpm_limit
                )
            )
        if key is not None:
            limits.append(
                ratelimit.Limit(
                    "key",
                    f"key:{key.id}",
                    key.rpm_limit or config.default_key_rpm,
                    key.tpm_limit or config.default_key_tpm,
                )
            )
        store_content = config.prompt_logging_allowed and workspace.store_prompts

    try:
        await ratelimit.check_and_count_request(limits)
    except ratelimit.RateLimited as exc:
        raise GatewayError(
            429,
            f"Rate limit reached for this {exc.scope or 'account'}. "
            f"Please try again in {exc.retry_after}s.",
            type="requests",
            code="rate_limit_exceeded",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    reservation_id = await reserve(caller.workspace_id, amount, period)
    return Prepared(
        caller=caller,
        endpoint=endpoint,
        model=model,
        provider=provider,
        price=price,
        body=forward,
        stream=stream,
        reservation_id=reservation_id,
        reserved=amount,
        fair_input_estimate=fair_input,
        limits=limits,
        store_content=store_content,
    )


async def reserve(workspace_id: uuid.UUID, amount: int, period: str) -> uuid.UUID:
    """Hold `amount` against the balance. One conditional UPDATE: of any number of parallel
    requests, only those that fit in the available balance (and the monthly limit) succeed."""
    period_spend = case((Workspace.period == period, Workspace.period_spend_micros), else_=0)
    reservation_id = uuid.uuid4()
    async with SessionLocal() as db:
        result = await db.execute(
            update(Workspace)
            .where(
                Workspace.id == workspace_id,
                Workspace.balance_micros - Workspace.reserved_micros >= amount,
                (Workspace.monthly_spend_limit_micros.is_(None))
                | (
                    period_spend + Workspace.reserved_micros + amount
                    <= Workspace.monthly_spend_limit_micros
                ),
            )
            .values(reserved_micros=Workspace.reserved_micros + amount)
            .returning(Workspace.id)
        )
        if result.scalar_one_or_none() is None:
            await db.rollback()
            ws = await db.get(Workspace, workspace_id)
            if ws is not None and ws.monthly_spend_limit_micros is not None:
                spent = ws.period_spend_micros if ws.period == period else 0
                if spent + ws.reserved_micros + amount > ws.monthly_spend_limit_micros:
                    await run_after(alerts.spend_limit_reached(workspace_id, period))
                    raise GatewayError(
                        429,
                        "Your workspace has reached its monthly spend limit. "
                        "An admin can raise it on the billing page.",
                        type="insufficient_quota",
                        code="spend_limit_reached",
                    )
            await run_after(alerts.out_of_credit(workspace_id))
            raise GatewayError(
                429,
                "You've run out of credits. Add credits to your workspace to continue.",
                type="insufficient_quota",
                code="insufficient_quota",
            )
        now = utcnow()
        db.add(
            Reservation(
                id=reservation_id,
                workspace_id=workspace_id,
                amount_micros=amount,
                created_at=now,
                expires_at=now + timedelta(minutes=get_settings().reservation_ttl_minutes),
            )
        )
        await db.commit()
    return reservation_id


# ---- Settlement -------------------------------------------------------------------------------


async def settle(prep: Prepared, outcome: Outcome) -> Settled:
    """Charge the exact cost, release the reservation, write the log and usage rollup."""
    caller = prep.caller
    if outcome.status == "error":
        cost = 0
    else:
        cost = prep.price.cost(outcome.input_tokens, outcome.output_tokens, outcome.cached_tokens)
    period = current_period()
    latency_ms = int((time.monotonic() - prep.started) * 1000)
    now = utcnow()
    async with SessionLocal() as db:
        ws = await db.scalar(
            select(Workspace).where(Workspace.id == caller.workspace_id).with_for_update()
        )
        reservation = await db.get(Reservation, prep.reservation_id)
        held = reservation.amount_micros if reservation is not None else 0
        charged = 0
        balance_after = 0
        if ws is not None:
            # Never take more than this request's hold plus credit nobody else is holding, so
            # the balance cannot be driven below what other in-flight requests reserved.
            free = max(ws.balance_micros - ws.reserved_micros, 0)
            charged = min(cost, held + free)
            ws.reserved_micros = max(ws.reserved_micros - held, 0)
            ws.balance_micros -= charged
            if ws.period != period:
                ws.period = period
                ws.period_spend_micros = 0
            ws.period_spend_micros += charged
            balance_after = ws.balance_micros
            if charged > 0:
                db.add(
                    LedgerEntry(
                        workspace_id=ws.id,
                        kind="charge",
                        amount_micros=-charged,
                        balance_after_micros=balance_after,
                        description=f"{prep.model.public_id}: {outcome.input_tokens} in / "
                        f"{outcome.output_tokens} out ({caller.source})",
                        actor_id=caller.user_id,
                        request_id=prep.request_id,
                    )
                )
        if reservation is not None:
            await db.execute(delete(Reservation).where(Reservation.id == reservation.id))
        if caller.project_id is not None:
            project = await db.get(Project, caller.project_id, with_for_update=True)
            if project is not None:
                if project.period != period:
                    project.period = period
                    project.period_spend_micros = 0
                project.period_spend_micros += charged
        if caller.api_key is not None:
            await db.execute(
                update(ApiKey)
                .where(ApiKey.id == caller.api_key.id)
                .values(spent_micros=ApiKey.spent_micros + charged, last_used_at=now)
            )
        request_body: dict[str, Any] | None = None
        if prep.store_content:
            request_body = {
                k: v
                for k, v in prep.body.items()
                if k
                in ("messages", "prompt", "input", "tools", "temperature", "top_p", "max_tokens")
            }
        db.add(
            RequestLog(
                id=prep.request_id,
                created_at=now,
                workspace_id=caller.workspace_id,
                project_id=caller.project_id,
                api_key_id=caller.api_key.id if caller.api_key else None,
                user_id=caller.user_id,
                model_id=prep.model.id,
                model=prep.model.public_id,
                provider_id=prep.provider.id,
                endpoint=prep.endpoint,
                source=caller.source,
                stream=prep.stream,
                status=outcome.status,
                http_status=outcome.http_status,
                error_code=outcome.error_code,
                error_message=(outcome.error_message or "")[:1000] or None,
                input_tokens=outcome.input_tokens,
                output_tokens=outcome.output_tokens,
                cached_tokens=outcome.cached_tokens,
                cost_micros=charged,
                latency_ms=latency_ms,
                ttft_ms=outcome.ttft_ms,
                ip=caller.ip,
                request_body=request_body,
                response_body=(
                    outcome.response_text[:MAX_LOGGED_RESPONSE_CHARS]
                    if prep.store_content and outcome.response_text
                    else None
                ),
            )
        )
        stmt = insert(UsageDaily).values(
            day=now.date(),
            workspace_id=caller.workspace_id,
            project_id=caller.project_id,
            api_key_id=caller.api_key.id if caller.api_key else None,
            user_id=caller.user_id,
            model_id=prep.model.id,
            model=prep.model.public_id,
            source=caller.source,
            requests=1,
            errors=1 if outcome.status == "error" else 0,
            input_tokens=outcome.input_tokens,
            output_tokens=outcome.output_tokens,
            cost_micros=charged,
            latency_ms_total=latency_ms,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_usage_daily_dims",
            set_={
                "requests": UsageDaily.requests + stmt.excluded.requests,
                "errors": UsageDaily.errors + stmt.excluded.errors,
                "input_tokens": UsageDaily.input_tokens + stmt.excluded.input_tokens,
                "output_tokens": UsageDaily.output_tokens + stmt.excluded.output_tokens,
                "cost_micros": UsageDaily.cost_micros + stmt.excluded.cost_micros,
                "latency_ms_total": UsageDaily.latency_ms_total + stmt.excluded.latency_ms_total,
            },
        )
        await db.execute(stmt)
        await ratelimit.add_tokens(db, prep.limits, outcome.input_tokens + outcome.output_tokens)
        await db.commit()

    observe_request(
        model=prep.model.public_id,
        source=caller.source,
        status=outcome.status,
        input_tokens=outcome.input_tokens,
        output_tokens=outcome.output_tokens,
        cost_micros=charged,
        latency_s=latency_ms / 1000,
        ttft_s=outcome.ttft_ms / 1000 if outcome.ttft_ms is not None else None,
    )
    if charged > 0:
        await run_after(alerts.after_charge(caller.workspace_id))
    return Settled(cost_micros=charged, balance_after=balance_after)


async def release(prep: Prepared, outcome: Outcome) -> None:
    """Settle a request that failed before producing anything (nothing is charged)."""
    try:
        await settle(prep, outcome)
    except Exception:
        log.exception("Releasing reservation %s failed", prep.reservation_id)


# ---- Upstream errors ---------------------------------------------------------------------------


def _upstream_message(payload: Any) -> str | None:
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            return str(err["message"])
        if isinstance(err, str):
            return err
        if isinstance(payload.get("message"), str):
            return str(payload["message"])
        if isinstance(payload.get("detail"), str):
            return str(payload["detail"])
    return None


def map_upstream_error(status: int, payload: Any, provider: Provider) -> GatewayError:
    message = _upstream_message(payload)
    if status in (400, 422):
        return GatewayError(400, message or "The request was rejected by the model.")
    if status == 413:
        return GatewayError(400, message or "The request is too large for this model.")
    log.warning("Provider %s answered HTTP %s", provider.name, status)
    if status == 429:
        return GatewayError(
            503,
            "The model is overloaded right now. Please try again shortly.",
            type="server_error",
            code="model_overloaded",
        )
    return GatewayError(
        503,
        "The model is temporarily unavailable. Please try again later.",
        type="server_error",
        code="model_unavailable",
    )


def _usage_numbers(usage: Any) -> tuple[int, int, int] | None:
    if not isinstance(usage, dict):
        return None
    prompt = usage.get("prompt_tokens")
    completion = usage.get("completion_tokens", 0)
    if not isinstance(prompt, int):
        return None
    details = usage.get("prompt_tokens_details") or {}
    cached = details.get("cached_tokens", 0) if isinstance(details, dict) else 0
    return (
        max(prompt, 0),
        max(completion if isinstance(completion, int) else 0, 0),
        max(cached if isinstance(cached, int) else 0, 0),
    )


# ---- Forwarding ------------------------------------------------------------------------------


async def forward(prep: Prepared) -> JSONResponse | StreamingResponse:
    url = prep.provider.base_url.rstrip("/") + UPSTREAM_PATHS[prep.endpoint]
    headers = upstream_headers(prep.provider)
    if prep.stream:
        return await _forward_stream(prep, url, headers)
    return await _forward_json(prep, url, headers)


async def _forward_json(prep: Prepared, url: str, headers: dict[str, str]) -> JSONResponse:
    try:
        response = await http_client().post(url, json=prep.body, headers=headers)
    except httpx.HTTPError as exc:
        log.warning("Provider %s unreachable: %s", prep.provider.name, type(exc).__name__)
        error = GatewayError(
            503,
            "The model is temporarily unavailable. Please try again later.",
            type="server_error",
            code="model_unavailable",
        )
        await release(
            prep, Outcome("error", 503, error_code=error.code, error_message=error.message)
        )
        raise error from exc
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if response.status_code >= 400 or not isinstance(payload, dict):
        error = map_upstream_error(
            response.status_code if response.status_code >= 400 else 502, payload, prep.provider
        )
        await release(
            prep, Outcome("error", error.status, error_code=error.code, error_message=error.message)
        )
        raise error

    numbers = _usage_numbers(payload.get("usage"))
    text = _response_text(payload)
    if numbers is None:
        output = 0 if prep.endpoint == "embeddings" else ceil_div(len(text.encode()), 4)
        numbers = (prep.fair_input_estimate, output, 0)
        payload["usage"] = {
            "prompt_tokens": numbers[0],
            "completion_tokens": numbers[1],
            "total_tokens": numbers[0] + numbers[1],
        }
    payload["model"] = prep.model.public_id
    elapsed = int((time.monotonic() - prep.started) * 1000)
    settled = await settle(
        prep,
        Outcome(
            "success",
            200,
            input_tokens=numbers[0],
            output_tokens=numbers[1],
            cached_tokens=numbers[2],
            ttft_ms=elapsed,
            response_text=text if prep.store_content else None,
        ),
    )
    return JSONResponse(payload, headers=_result_headers(prep, settled))


def _result_headers(prep: Prepared, settled: Settled | None) -> dict[str, str]:
    headers = {"x-request-id": str(prep.request_id)}
    if settled is not None:
        headers["x-dockwell-cost-usd"] = dollars(settled.cost_micros).lstrip("$")
    return headers


def _response_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for choice in payload.get("choices") or []:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if isinstance(message, dict):
            if isinstance(message.get("content"), str):
                parts.append(message["content"])
            if message.get("tool_calls"):
                parts.append(json.dumps(message["tool_calls"]))
        elif isinstance(choice.get("text"), str):
            parts.append(choice["text"])
    return "\n".join(parts)


async def _forward_stream(prep: Prepared, url: str, headers: dict[str, str]) -> StreamingResponse:
    client = http_client()
    request = client.build_request("POST", url, json=prep.body, headers=headers)
    try:
        upstream = await client.send(request, stream=True)
    except httpx.HTTPError as exc:
        log.warning("Provider %s unreachable: %s", prep.provider.name, type(exc).__name__)
        error = GatewayError(
            503,
            "The model is temporarily unavailable. Please try again later.",
            type="server_error",
            code="model_unavailable",
        )
        await release(
            prep, Outcome("error", 503, error_code=error.code, error_message=error.message)
        )
        raise error from exc
    if upstream.status_code >= 400:
        raw = await upstream.aread()
        await upstream.aclose()
        try:
            payload: Any = json.loads(raw)
        except ValueError:
            payload = None
        error = map_upstream_error(upstream.status_code, payload, prep.provider)
        await release(
            prep, Outcome("error", error.status, error_code=error.code, error_message=error.message)
        )
        raise error

    return StreamingResponse(
        _relay(prep, upstream),
        media_type="text/event-stream",
        headers={
            **_result_headers(prep, None),
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _relay(prep: Prepared, upstream: httpx.Response) -> AsyncIterator[bytes]:
    """Pass the SSE stream through, watching usage, and settle before the final [DONE]."""
    usage: tuple[int, int, int] | None = None
    output_chunks = 0
    text_parts: list[str] = []
    text_chars = 0
    ttft_ms: int | None = None
    settled = False
    status: Literal["success", "error", "cancelled"] = "cancelled"
    error_message: str | None = None

    def outcome(final_status: Literal["success", "error", "cancelled"]) -> Outcome:
        if usage is not None:
            numbers = usage
        else:
            estimated = max(output_chunks, ceil_div(text_chars, 4)) if text_chars else output_chunks
            numbers = (prep.fair_input_estimate, estimated, 0)
        return Outcome(
            final_status,
            200 if final_status != "error" else 502,
            input_tokens=numbers[0],
            output_tokens=numbers[1],
            cached_tokens=numbers[2],
            ttft_ms=ttft_ms,
            error_code="upstream_stream_error" if final_status == "error" else None,
            error_message=error_message,
            response_text="".join(text_parts) if prep.store_content else None,
        )

    async def finish(final_status: Literal["success", "error", "cancelled"]) -> Settled | None:
        nonlocal settled
        if settled:
            return None
        settled = True
        try:
            return await settle(prep, outcome(final_status))
        except Exception:
            log.exception("Settlement failed for request %s", prep.request_id)
            return None

    try:
        async for line in upstream.aiter_lines():
            if not line.startswith("data:"):
                if line.strip():
                    yield (line + "\n").encode()
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                result = await finish("success")
                if prep.caller.source == "playground" and result is not None:
                    meta = {
                        "dockwell": {
                            "request_id": str(prep.request_id),
                            "cost_micros": result.cost_micros,
                            "balance_micros": result.balance_after,
                        }
                    }
                    yield f"data: {json.dumps(meta)}\n\n".encode()
                yield b"data: [DONE]\n\n"
                status = "success"
                continue
            try:
                chunk = json.loads(data)
            except ValueError:
                yield (line + "\n\n").encode()
                continue
            if isinstance(chunk, dict):
                if "error" in chunk:
                    error_message = _upstream_message(chunk) or "Stream error"
                found = _usage_numbers(chunk.get("usage"))
                if found is None and isinstance(chunk.get("x_groq"), dict):
                    found = _usage_numbers(chunk["x_groq"].get("usage"))
                if found is not None:
                    usage = found
                for choice in chunk.get("choices") or []:
                    if not isinstance(choice, dict):
                        continue
                    delta = choice.get("delta") or {}
                    piece = ""
                    if isinstance(delta, dict):
                        if isinstance(delta.get("content"), str):
                            piece = delta["content"]
                        reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                        if isinstance(reasoning, str):
                            piece += reasoning
                        if delta.get("tool_calls"):
                            piece += json.dumps(delta["tool_calls"])
                    elif isinstance(choice.get("text"), str):
                        piece = choice["text"]
                    if piece:
                        output_chunks += 1
                        text_chars += len(piece)
                        if ttft_ms is None:
                            ttft_ms = int((time.monotonic() - prep.started) * 1000)
                        if prep.store_content and text_chars <= MAX_LOGGED_RESPONSE_CHARS:
                            text_parts.append(piece)
                chunk["model"] = prep.model.public_id
                yield f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n".encode()
        if not settled:
            # The upstream ended without [DONE]: finish the stream properly ourselves.
            status = "error" if error_message and output_chunks == 0 else "success"
            result = await finish(status)
            if prep.caller.source == "playground" and result is not None:
                meta = {
                    "dockwell": {
                        "request_id": str(prep.request_id),
                        "cost_micros": result.cost_micros,
                        "balance_micros": result.balance_after,
                    }
                }
                yield f"data: {json.dumps(meta)}\n\n".encode()
            yield b"data: [DONE]\n\n"
    except httpx.HTTPError as exc:
        error_message = f"Upstream stream interrupted ({type(exc).__name__})"
        status = "error" if output_chunks == 0 else "cancelled"
        error = GatewayError(
            502, "The model stopped responding.", type="server_error", code="upstream_stream_error"
        )
        yield f"data: {json.dumps(error.body())}\n\n".encode()
    finally:
        await upstream.aclose()
        if not settled:
            # Client disconnected (or the upstream failed): charge what was generated. Shielded,
            # because the task running this generator is being cancelled.
            task = asyncio.ensure_future(finish(status))
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                _keep(task)


def _keep(task: asyncio.Future[Settled | None]) -> None:
    async def wait() -> None:
        await task

    background = asyncio.ensure_future(wait())
    _background.add(background)
    background.add_done_callback(_background.discard)


async def handle(
    caller: Caller, endpoint: Endpoint, body: dict[str, Any]
) -> JSONResponse | StreamingResponse:
    """Run one request through the gateway, returning an OpenAI-format error on failure."""
    try:
        prep = await prepare(caller, endpoint, body)
        return await forward(prep)
    except GatewayError as exc:
        return exc.response()
