"""The OpenAI-compatible API: /v1/chat/completions, /v1/completions, /v1/embeddings, /v1/models.

Works with the official OpenAI SDKs by changing only the base URL (<APP_URL>/v1) and the key.
Errors use OpenAI's error format and status codes.
"""

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select

from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.deps import client_ip
from dockwell_api.models import AIModel, ApiKey, Provider
from dockwell_api.security import api_keys
from dockwell_api.security.tokens import hash_token
from dockwell_api.services import catalog, gateway
from dockwell_api.services.gateway import Caller, GatewayError

router = APIRouter(prefix="/v1", tags=["openai"])

MISSING_KEY = (
    "You didn't provide an API key. You need to provide your API key in an Authorization "
    "header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY)."
)


async def authenticate(request: Request) -> Caller:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise GatewayError(401, MISSING_KEY, code="invalid_api_key")
    invalid = GatewayError(
        401,
        "Incorrect API key provided. You can find your API keys in your workspace settings.",
        code="invalid_api_key",
    )
    if not api_keys.looks_like_key(token):
        raise invalid
    async with SessionLocal() as db:
        key = await db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_token(token)))
    if key is None or key.revoked_at is not None:
        raise invalid
    if key.expires_at is not None and key.expires_at <= utcnow():
        raise GatewayError(401, "This API key has expired.", code="invalid_api_key")
    return Caller(
        workspace_id=key.workspace_id,
        project_id=key.project_id,
        source="api",
        api_key=key,
        user_id=key.created_by_id,
        ip=client_ip(request),
    )


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        body = json.loads(await request.body())
    except (ValueError, UnicodeDecodeError) as exc:
        raise GatewayError(400, "We could not parse the JSON body of your request.") from exc
    if not isinstance(body, dict):
        raise GatewayError(400, "The request body must be a JSON object.")
    return body


async def _run(request: Request, endpoint: gateway.Endpoint) -> JSONResponse | StreamingResponse:
    try:
        caller = await authenticate(request)
        body = await _json_body(request)
    except GatewayError as exc:
        return exc.response()
    return await gateway.handle(caller, endpoint, body)


@router.post("/chat/completions", response_model=None)
async def chat_completions(request: Request) -> JSONResponse | StreamingResponse:
    return await _run(request, "chat.completions")


@router.post("/completions", response_model=None)
async def completions(request: Request) -> JSONResponse | StreamingResponse:
    return await _run(request, "completions")


@router.post("/embeddings", response_model=None)
async def embeddings(request: Request) -> JSONResponse | StreamingResponse:
    return await _run(request, "embeddings")


def _model_object(model: AIModel, price: catalog.EffectivePrice) -> dict[str, Any]:
    return {
        "id": model.public_id,
        "object": "model",
        "created": int(model.created_at.timestamp()),
        "owned_by": model.owned_by or "dockwell",
        "name": model.display_name,
        "context_length": model.context_length,
        "capabilities": list(model.capabilities or []),
        "deprecated": model.deprecated_at is not None,
        "retirement_date": model.retirement_date.isoformat() if model.retirement_date else None,
        "pricing": {
            "currency": "usd",
            "input_per_million": price.input_micros_per_m / 1_000_000,
            "output_per_million": price.output_micros_per_m / 1_000_000,
            "free": price.is_free,
        },
    }


async def _visible(caller: Caller) -> list[tuple[AIModel, Provider, catalog.EffectivePrice]]:
    async with SessionLocal() as db:
        models = await catalog.models_for_workspace(db, caller.workspace_id)
        prices = await catalog.current_prices(db)
        overrides = await catalog.workspace_overrides(db, caller.workspace_id)
    key = caller.api_key
    out = []
    for model, provider in models:
        if key is not None and key.allowed_models and model.public_id not in key.allowed_models:
            continue
        out.append((model, provider, catalog.price_for(model.id, prices, overrides)))
    return out


@router.get("/models", response_model=None)
async def list_models(request: Request) -> JSONResponse:
    try:
        caller = await authenticate(request)
    except GatewayError as exc:
        return exc.response()
    data = [_model_object(m, price) for m, _, price in await _visible(caller)]
    return JSONResponse({"object": "list", "data": data})


@router.get("/models/{model_id:path}", response_model=None)
async def get_model(model_id: str, request: Request) -> JSONResponse:
    try:
        caller = await authenticate(request)
    except GatewayError as exc:
        return exc.response()
    for model, _, price in await _visible(caller):
        if model.public_id == model_id:
            return JSONResponse(_model_object(model, price))
    return GatewayError(
        404,
        f"The model `{model_id}` does not exist or you do not have access to it.",
        code="model_not_found",
        param="model",
    ).response()
