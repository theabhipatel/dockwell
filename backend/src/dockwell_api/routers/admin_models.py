"""Platform admin: providers, models, managed deployments (vLLM / llama.cpp) and prices."""

import uuid
from collections.abc import Sequence
from datetime import UTC, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.deps import DB, AdminAuth, Meta
from dockwell_api.models import AIModel, Deployment, ModelPrice, Provider, UsageDaily, User
from dockwell_api.permissions import Perm
from dockwell_api.routers.playground import price_out
from dockwell_api.schemas.catalog import (
    AdminModelOut,
    DeploymentIn,
    DeploymentOut,
    DeprecateIn,
    EngineLogs,
    ModelIn,
    ModelUpdate,
    PriceHistoryOut,
    PriceIn,
    ProviderCheck,
    ProviderIn,
    ProviderOut,
    ProviderUpdate,
    RemoteModel,
)
from dockwell_api.schemas.common import APIModel, Message
from dockwell_api.security.crypto import decrypt, encrypt, mask
from dockwell_api.services import audit, catalog, engines, notifications

router = APIRouter(prefix="/admin", tags=["admin"])


def _record(db: DB, admin: User, meta: Meta, action: str, **kwargs: object) -> None:
    audit.record(db, action=f"admin.{action}", actor=admin, meta=meta, admin=True, **kwargs)


# ---- Providers ---------------------------------------------------------------------------------


async def _provider_out(db: DB, providers: list[Provider]) -> list[ProviderOut]:
    counts = dict(
        (
            await db.execute(
                select(AIModel.provider_id, func.count()).group_by(AIModel.provider_id)
            )
        ).all()
    )
    return [
        ProviderOut(
            id=p.id,
            name=p.name,
            kind=p.kind,
            base_url=p.base_url,
            has_api_key=bool(p.api_key_enc),
            api_key_hint=mask(decrypt(p.api_key_enc)),
            enabled=p.enabled,
            managed=p.managed,
            model_count=counts.get(p.id, 0),
            last_check_at=p.last_check_at,
            last_check_ok=p.last_check_ok,
            last_error=p.last_error,
        )
        for p in providers
    ]


@router.get("/providers")
async def list_providers(auth: AdminAuth, db: DB) -> list[ProviderOut]:
    rows = list(
        (await db.execute(select(Provider).order_by(Provider.managed, Provider.name))).scalars()
    )
    return await _provider_out(db, rows)


@router.post("/providers", status_code=status.HTTP_201_CREATED)
async def create_provider(body: ProviderIn, auth: AdminAuth, db: DB, meta: Meta) -> ProviderOut:
    provider = Provider(
        name=body.name.strip(),
        kind=body.kind,
        base_url=body.base_url.rstrip("/"),
        api_key_enc=encrypt(body.api_key) if body.api_key else None,
        enabled=body.enabled,
    )
    db.add(provider)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A provider with that name already exists."
        ) from exc
    _record(
        db,
        auth.user,
        meta,
        "provider_created",
        target_type="provider",
        target_id=provider.id,
        target_label=provider.name,
        details={"kind": body.kind, "base_url": provider.base_url},
    )
    await db.commit()
    return (await _provider_out(db, [provider]))[0]


async def _provider(db: DB, provider_id: uuid.UUID) -> Provider:
    provider = await db.get(Provider, provider_id)
    if provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found.")
    return provider


@router.patch("/providers/{provider_id}")
async def update_provider(
    provider_id: uuid.UUID, body: ProviderUpdate, auth: AdminAuth, db: DB, meta: Meta
) -> ProviderOut:
    provider = await _provider(db, provider_id)
    changed: list[str] = []
    if body.name is not None and body.name != provider.name:
        provider.name = body.name.strip()
        changed.append("name")
    if body.base_url is not None and not provider.managed:
        provider.base_url = body.base_url.rstrip("/")
        changed.append("base_url")
    if body.clear_api_key:
        provider.api_key_enc = None
        changed.append("api_key")
    elif body.api_key:
        provider.api_key_enc = encrypt(body.api_key)
        changed.append("api_key")
    if body.enabled is not None and body.enabled != provider.enabled:
        provider.enabled = body.enabled
        changed.append("enabled")
    _record(
        db,
        auth.user,
        meta,
        "provider_updated",
        target_type="provider",
        target_id=provider.id,
        target_label=provider.name,
        details={"changed": changed},
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A provider with that name already exists."
        ) from exc
    return (await _provider_out(db, [provider]))[0]


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta) -> Message:
    provider = await _provider(db, provider_id)
    if provider.managed:
        raise HTTPException(status.HTTP_409_CONFLICT, "Delete the deployment instead.")
    _record(
        db,
        auth.user,
        meta,
        "provider_deleted",
        target_type="provider",
        target_id=provider.id,
        target_label=provider.name,
    )
    await db.delete(provider)
    await db.commit()
    return Message(message="Provider and its models deleted.")


@router.post("/providers/{provider_id}/check")
async def check_provider(provider_id: uuid.UUID, auth: AdminAuth, db: DB) -> ProviderCheck:
    """Test the connection and list the models the provider offers."""
    provider = await _provider(db, provider_id)
    ok, message = await engines.probe_provider(provider)
    provider.last_check_at = utcnow()
    provider.last_check_ok = ok
    provider.last_error = None if ok else message
    models: list[RemoteModel] = []
    if ok:
        try:
            remote = await engines.list_remote_models(provider)
        except (httpx.HTTPError, ValueError):
            remote = []
        added = set(
            (
                await db.execute(
                    select(AIModel.upstream_id).where(AIModel.provider_id == provider.id)
                )
            ).scalars()
        )
        for m in remote:
            ctx = m.get("context_window") or m.get("max_model_len") or m.get("context_length")
            models.append(
                RemoteModel(
                    id=str(m["id"]),
                    owned_by=str(m.get("owned_by") or "") or None,
                    context_length=int(ctx) if isinstance(ctx, int) else None,
                    already_added=str(m["id"]) in added,
                )
            )
    await db.commit()
    return ProviderCheck(ok=ok, message=message, models=models)


# ---- Models ------------------------------------------------------------------------------------


async def _models_out(db: DB, rows: Sequence[tuple[AIModel, Provider]]) -> list[AdminModelOut]:
    prices = await catalog.current_prices(db)
    deployments = dict((await db.execute(select(Deployment.model_id, Deployment.id))).all())
    since = utcnow().date() - timedelta(days=30)
    usage = dict(
        (
            await db.execute(
                select(UsageDaily.model_id, func.sum(UsageDaily.requests))
                .where(UsageDaily.day >= since)
                .group_by(UsageDaily.model_id)
            )
        ).all()
    )
    return [
        AdminModelOut(
            id=m.id,
            provider_id=p.id,
            provider_name=p.name,
            provider_kind=p.kind,
            public_id=m.public_id,
            upstream_id=m.upstream_id,
            display_name=m.display_name,
            description=m.description,
            owned_by=m.owned_by,
            context_length=m.context_length,
            max_output_tokens=m.max_output_tokens,
            capabilities=list(m.capabilities or []),
            enabled=m.enabled,
            visibility=m.visibility,
            allowed_workspace_ids=list(m.allowed_workspace_ids or []),
            deprecated_at=m.deprecated_at,
            retirement_date=m.retirement_date,
            status=m.status,
            status_message=m.status_message,
            sort_order=m.sort_order,
            price=price_out(catalog.to_effective(prices[m.id])) if m.id in prices else None,
            deployment_id=deployments.get(m.id),
            requests_30d=int(usage.get(m.id) or 0),
        )
        for m, p in rows
    ]


@router.get("/models")
async def list_models(auth: AdminAuth, db: DB) -> list[AdminModelOut]:
    rows = list(
        (
            await db.execute(
                select(AIModel, Provider)
                .join(Provider, Provider.id == AIModel.provider_id)
                .order_by(AIModel.sort_order, AIModel.display_name)
            )
        ).all()
    )
    return await _models_out(db, rows)


async def _model(db: DB, model_id: uuid.UUID) -> tuple[AIModel, Provider]:
    row = (
        await db.execute(
            select(AIModel, Provider)
            .join(Provider, Provider.id == AIModel.provider_id)
            .where(AIModel.id == model_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found.")
    model, provider = row
    return model, provider


@router.post("/models", status_code=status.HTTP_201_CREATED)
async def create_model(body: ModelIn, auth: AdminAuth, db: DB, meta: Meta) -> AdminModelOut:
    provider = await _provider(db, body.provider_id)
    model = AIModel(
        provider_id=provider.id,
        public_id=body.public_id,
        upstream_id=body.upstream_id,
        display_name=body.display_name,
        description=body.description,
        owned_by=body.owned_by,
        context_length=body.context_length,
        max_output_tokens=body.max_output_tokens,
        capabilities=list(dict.fromkeys(body.capabilities)),
        enabled=body.enabled,
        visibility=body.visibility,
        allowed_workspace_ids=body.allowed_workspace_ids,
        sort_order=body.sort_order,
        status="ready",
    )
    db.add(model)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A model with that public id already exists."
        ) from exc
    db.add(
        ModelPrice(
            model_id=model.id,
            input_micros_per_m=body.input_price_micros_per_m,
            output_micros_per_m=body.output_price_micros_per_m,
            is_free=body.is_free,
            created_by_id=auth.user.id,
            effective_from=utcnow(),
        )
    )
    _record(
        db,
        auth.user,
        meta,
        "model_created",
        target_type="model",
        target_id=model.id,
        target_label=model.public_id,
        details={"provider": provider.name},
    )
    await db.commit()
    return (await _models_out(db, [(model, provider)]))[0]


class ImportModelsIn(APIModel):
    upstream_ids: list[str] = Field(min_length=1, max_length=100)
    input_price_micros_per_m: int = Field(default=0, ge=0)
    output_price_micros_per_m: int = Field(default=0, ge=0)


@router.post("/providers/{provider_id}/import")
async def import_models(
    provider_id: uuid.UUID, body: ImportModelsIn, auth: AdminAuth, db: DB, meta: Meta
) -> list[AdminModelOut]:
    """Expose models offered by an external provider (e.g. picked from Groq's list)."""
    provider = await _provider(db, provider_id)
    try:
        remote = {str(m["id"]): m for m in await engines.list_remote_models(provider)}
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Could not list the provider's models."
        ) from exc
    created: list[tuple[AIModel, Provider]] = []
    for upstream in body.upstream_ids:
        if upstream not in remote:
            continue
        public_id = upstream.split("/")[-1][:200]
        if await db.scalar(select(AIModel.id).where(AIModel.public_id == public_id)):
            public_id = f"{provider.name.lower().replace(' ', '-')}-{public_id}"[:200]
            if await db.scalar(select(AIModel.id).where(AIModel.public_id == public_id)):
                continue
        info = remote[upstream]
        ctx = info.get("context_window") or info.get("max_model_len") or info.get("context_length")
        caps = ["embeddings"] if "embed" in upstream.lower() else ["chat", "completions", "tools"]
        model = AIModel(
            provider_id=provider.id,
            public_id=public_id,
            upstream_id=upstream,
            display_name=upstream.split("/")[-1],
            owned_by=str(info.get("owned_by") or ""),
            context_length=int(ctx) if isinstance(ctx, int) else 8192,
            capabilities=caps,
            status="ready",
        )
        db.add(model)
        await db.flush()
        db.add(
            ModelPrice(
                model_id=model.id,
                input_micros_per_m=body.input_price_micros_per_m,
                output_micros_per_m=body.output_price_micros_per_m,
                created_by_id=auth.user.id,
                effective_from=utcnow(),
            )
        )
        created.append((model, provider))
        _record(
            db,
            auth.user,
            meta,
            "model_created",
            target_type="model",
            target_id=model.id,
            target_label=model.public_id,
            details={"provider": provider.name, "imported": True},
        )
    await db.commit()
    return await _models_out(db, created)


@router.patch("/models/{model_id}")
async def update_model(
    model_id: uuid.UUID, body: ModelUpdate, auth: AdminAuth, db: DB, meta: Meta
) -> AdminModelOut:
    model, provider = await _model(db, model_id)
    changed: list[str] = []
    for field in body.model_fields_set:
        value = getattr(body, field)
        if value is None and field != "max_output_tokens":
            continue
        if field == "capabilities":
            value = list(dict.fromkeys(value))
        if getattr(model, field) != value:
            setattr(model, field, value)
            changed.append(field)
    _record(
        db,
        auth.user,
        meta,
        "model_updated",
        target_type="model",
        target_id=model.id,
        target_label=model.public_id,
        details={"changed": changed},
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A model with that public id already exists."
        ) from exc
    return (await _models_out(db, [(model, provider)]))[0]


@router.post("/models/{model_id}/deprecate")
async def deprecate_model(
    model_id: uuid.UUID, body: DeprecateIn, auth: AdminAuth, db: DB, meta: Meta
) -> AdminModelOut:
    model, provider = await _model(db, model_id)
    if body.undo:
        model.deprecated_at = None
        model.retirement_date = None
        model.retirement_notified_at = None
        _record(
            db,
            auth.user,
            meta,
            "model_undeprecated",
            target_type="model",
            target_id=model.id,
            target_label=model.public_id,
        )
    else:
        retire = body.retirement_date
        if retire is not None and retire.tzinfo is None:
            retire = retire.replace(tzinfo=UTC)
        model.deprecated_at = model.deprecated_at or utcnow()
        model.retirement_date = retire
        _record(
            db,
            auth.user,
            meta,
            "model_deprecated",
            target_type="model",
            target_id=model.id,
            target_label=model.public_id,
            details={"retirement_date": retire.isoformat() if retire else None},
        )
        if model.retirement_notified_at is None:
            model.retirement_notified_at = utcnow()
            since = utcnow().date() - timedelta(days=30)
            workspace_ids = set(
                (
                    await db.execute(
                        select(UsageDaily.workspace_id).where(
                            UsageDaily.model_id == model.id, UsageDaily.day >= since
                        )
                    )
                ).scalars()
            )
            when = f" It will be retired on {retire:%d %b %Y}." if retire else ""
            for workspace_id in workspace_ids:
                people = await notifications.workspace_member_ids_with(
                    db, workspace_id, Perm.KEYS_MANAGE_ALL
                )
                await notifications.notify_users(
                    db,
                    people,
                    category="models",
                    type="model.retiring",
                    title=f"{model.display_name} is deprecated",
                    body=f"The model {model.public_id} used by your workspace is deprecated.{when} "
                    "Move to another model before then.",
                    link=f"/w/{workspace_id}/playground",
                    workspace_id=workspace_id,
                )
    await db.commit()
    return (await _models_out(db, [(model, provider)]))[0]


@router.delete("/models/{model_id}")
async def delete_model(model_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta) -> Message:
    model, _ = await _model(db, model_id)
    dep = await db.scalar(select(Deployment).where(Deployment.model_id == model.id))
    if dep is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This model is a deployment. Delete the deployment instead."
        )
    _record(
        db,
        auth.user,
        meta,
        "model_deleted",
        target_type="model",
        target_id=model.id,
        target_label=model.public_id,
    )
    await db.delete(model)
    await db.commit()
    return Message(message="Model deleted. Past usage and logs are kept.")


# ---- Prices ------------------------------------------------------------------------------------


@router.get("/models/{model_id}/prices")
async def price_history(model_id: uuid.UUID, auth: AdminAuth, db: DB) -> list[PriceHistoryOut]:
    await _model(db, model_id)
    current = await catalog.current_price(db, model_id)
    rows = await db.execute(
        select(ModelPrice, User.name)
        .outerjoin(User, User.id == ModelPrice.created_by_id)
        .where(ModelPrice.model_id == model_id)
        .order_by(ModelPrice.effective_from.desc(), ModelPrice.created_at.desc())
    )
    return [
        PriceHistoryOut(
            id=p.id,
            input_micros_per_m=p.input_micros_per_m,
            output_micros_per_m=p.output_micros_per_m,
            cached_input_micros_per_m=p.cached_input_micros_per_m,
            min_charge_micros=p.min_charge_micros,
            is_free=p.is_free,
            effective_from=p.effective_from,
            created_at=p.created_at,
            created_by_name=name,
            current=current is not None and p.id == current.id,
        )
        for p, name in rows.all()
    ]


@router.post("/models/{model_id}/prices", status_code=status.HTTP_201_CREATED)
async def set_price(
    model_id: uuid.UUID, body: PriceIn, auth: AdminAuth, db: DB, meta: Meta
) -> list[PriceHistoryOut]:
    """Add a price taking effect now or at a future date. Past charges never change."""
    model, _ = await _model(db, model_id)
    effective = body.effective_from or utcnow()
    if effective.tzinfo is None:
        effective = effective.replace(tzinfo=UTC)
    if effective < utcnow() - timedelta(minutes=1):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A price can only take effect now or in the future.",
        )
    db.add(
        ModelPrice(
            model_id=model.id,
            input_micros_per_m=body.input_micros_per_m,
            output_micros_per_m=body.output_micros_per_m,
            cached_input_micros_per_m=body.cached_input_micros_per_m,
            min_charge_micros=body.min_charge_micros,
            is_free=body.is_free,
            effective_from=max(effective, utcnow()),
            created_by_id=auth.user.id,
        )
    )
    _record(
        db,
        auth.user,
        meta,
        "price_set",
        target_type="model",
        target_id=model.id,
        target_label=model.public_id,
        details=body.model_dump(mode="json"),
    )
    await db.commit()
    return await price_history(model_id, auth, db)


# ---- Deployments (managed engines) -------------------------------------------------------------


async def _deployments_out(
    db: DB, rows: Sequence[tuple[Deployment, AIModel]]
) -> list[DeploymentOut]:
    return [
        DeploymentOut(
            id=d.id,
            model_id=m.id,
            public_id=m.public_id,
            display_name=m.display_name,
            engine=d.engine,
            hf_repo=d.hf_repo,
            hf_file=d.hf_file,
            gpu_count=d.gpu_count,
            quantization=d.quantization,
            dtype=d.dtype,
            gpu_memory_utilization=d.gpu_memory_utilization,
            max_model_len=d.max_model_len,
            extra_args=list(d.extra_args or []),
            container_name=d.container_name,
            host_port=d.host_port,
            desired_state=d.desired_state,
            status=m.status,
            status_message=m.status_message,
            started_at=d.started_at,
            last_health_at=d.last_health_at,
            created_at=d.created_at,
        )
        for d, m in rows
    ]


class EngineManagerInfo(APIModel):
    enabled: bool
    ok: bool
    message: str
    network: str | None
    vllm_image: str
    llamacpp_image: str


@router.get("/engine-manager")
async def engine_manager_info(auth: AdminAuth) -> EngineManagerInfo:
    s = get_settings()
    ok, message = await engines.docker_status()
    return EngineManagerInfo(
        enabled=engines.enabled(),
        ok=ok,
        message=message,
        network=s.engine_network,
        vllm_image=s.vllm_image,
        llamacpp_image=s.llamacpp_image,
    )


@router.get("/deployments")
async def list_deployments(auth: AdminAuth, db: DB) -> list[DeploymentOut]:
    rows = list(
        (
            await db.execute(
                select(Deployment, AIModel)
                .join(AIModel, AIModel.id == Deployment.model_id)
                .order_by(Deployment.created_at)
            )
        ).all()
    )
    return await _deployments_out(db, rows)


@router.post("/deployments", status_code=status.HTTP_201_CREATED)
async def create_deployment(
    body: DeploymentIn, auth: AdminAuth, db: DB, meta: Meta
) -> DeploymentOut:
    """Add a model by Hugging Face id: DockWell starts an engine that downloads and serves it."""
    if not engines.enabled():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Deployments need ENGINE_MANAGER=docker (self-hosted). "
            "Attach an existing endpoint as a provider instead.",
        )
    ok, message = await engines.docker_status()
    if not ok:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, message)
    if await db.scalar(select(AIModel.id).where(AIModel.public_id == body.public_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A model with that public id already exists.")
    name = engines.container_name(body.public_id)
    dep = Deployment(
        engine=body.engine,
        hf_repo=body.hf_repo,
        hf_file=body.hf_file or None,
        gpu_count=body.gpu_count if body.engine == "vllm" else min(body.gpu_count, 1),
        quantization=body.quantization or None,
        dtype=body.dtype,
        gpu_memory_utilization=body.gpu_memory_utilization,
        max_model_len=body.context_length,
        extra_args=body.extra_args,
        container_name=name,
        host_port=None if get_settings().engine_network else await engines.next_host_port(),
        desired_state="running",
    )
    provider = Provider(
        name=f"Engine {body.public_id}"[:100],
        kind=body.engine,
        base_url="pending",
        managed=True,
    )
    db.add(provider)
    await db.flush()
    model = AIModel(
        provider_id=provider.id,
        public_id=body.public_id,
        upstream_id=body.public_id,
        display_name=body.display_name,
        description=body.description,
        owned_by=body.hf_repo.split("/")[0],
        context_length=body.context_length,
        capabilities=list(dict.fromkeys(body.capabilities)),
        status="downloading",
        status_message="Queued",
    )
    db.add(model)
    await db.flush()
    dep.model_id = model.id
    db.add(dep)
    await db.flush()
    provider.base_url = engines.base_url(dep)
    db.add(
        ModelPrice(
            model_id=model.id,
            input_micros_per_m=body.input_price_micros_per_m,
            output_micros_per_m=body.output_price_micros_per_m,
            created_by_id=auth.user.id,
            effective_from=utcnow(),
        )
    )
    _record(
        db,
        auth.user,
        meta,
        "deployment_created",
        target_type="model",
        target_id=model.id,
        target_label=model.public_id,
        details={"engine": body.engine, "hf_repo": body.hf_repo},
    )
    await db.commit()
    engines.launch_in_background(dep.id)
    return (await _deployments_out(db, [(dep, model)]))[0]


async def _deployment(db: DB, deployment_id: uuid.UUID) -> tuple[Deployment, AIModel]:
    row = (
        await db.execute(
            select(Deployment, AIModel)
            .join(AIModel, AIModel.id == Deployment.model_id)
            .where(Deployment.id == deployment_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deployment not found.")
    dep, model = row
    return dep, model


@router.post("/deployments/{deployment_id}/{action}")
async def deployment_action(
    deployment_id: uuid.UUID, action: str, auth: AdminAuth, db: DB, meta: Meta
) -> DeploymentOut:
    if action not in ("start", "stop", "restart"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown action.")
    dep, model = await _deployment(db, deployment_id)
    try:
        await engines.container_action(dep, action)
    except (engines.EngineError, httpx.HTTPError, OSError) as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc) or "Docker error") from exc
    dep.desired_state = "stopped" if action == "stop" else "running"
    if action == "stop":
        model.status, model.status_message = "stopped", "Stopped by an admin."
    else:
        model.status, model.status_message = "starting", "Starting the engine"
        dep.started_at = utcnow()
    _record(
        db,
        auth.user,
        meta,
        f"deployment_{action}",
        target_type="model",
        target_id=model.id,
        target_label=model.public_id,
    )
    await db.commit()
    return (await _deployments_out(db, [(dep, model)]))[0]


@router.delete("/deployments/{deployment_id}")
async def delete_deployment(
    deployment_id: uuid.UUID, auth: AdminAuth, db: DB, meta: Meta
) -> Message:
    dep, model = await _deployment(db, deployment_id)
    try:
        await engines.container_action(dep, "remove")
    except (engines.EngineError, httpx.HTTPError, OSError) as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc) or "Docker error") from exc
    provider = await db.get(Provider, model.provider_id)
    _record(
        db,
        auth.user,
        meta,
        "deployment_deleted",
        target_type="model",
        target_id=model.id,
        target_label=model.public_id,
    )
    if provider is not None:
        await db.delete(provider)  # cascades to the model and the deployment
    await db.commit()
    return Message(message="Deployment removed. Downloaded weights stay in the cache volume.")


@router.get("/deployments/{deployment_id}/logs")
async def deployment_logs(
    deployment_id: uuid.UUID,
    auth: AdminAuth,
    db: DB,
    tail: int = Query(default=300, ge=10, le=2000),
) -> EngineLogs:
    dep, _ = await _deployment(db, deployment_id)
    try:
        lines = await engines.container_logs(dep, tail)
    except (httpx.HTTPError, OSError) as exc:
        lines = [f"Could not read the engine logs: {type(exc).__name__}"]
    return EngineLogs(lines=lines)
