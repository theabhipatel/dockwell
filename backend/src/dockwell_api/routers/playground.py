"""The playground: chat with any available model, charged to the workspace like the API, and
saved conversations private to each user. Also the workspace's model catalogue."""

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, select

from dockwell_api.deps import DB, WsCtx, client_ip
from dockwell_api.models import AIModel, Conversation
from dockwell_api.permissions import Perm
from dockwell_api.schemas.catalog import (
    CatalogModel,
    ConversationIn,
    ConversationOut,
    ConversationSummary,
    PlaygroundChatIn,
    PriceOut,
)
from dockwell_api.schemas.common import Message
from dockwell_api.services import catalog, gateway
from dockwell_api.services.access import get_project
from dockwell_api.services.catalog import EffectivePrice

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["playground"])

MAX_CONVERSATIONS = 500


def price_out(price: EffectivePrice) -> PriceOut:
    return PriceOut(
        input_micros_per_m=price.input_micros_per_m,
        output_micros_per_m=price.output_micros_per_m,
        cached_input_micros_per_m=price.cached_input_micros_per_m,
        min_charge_micros=price.min_charge_micros,
        is_free=price.is_free,
    )


def catalog_model(model: AIModel, price: EffectivePrice) -> CatalogModel:
    return CatalogModel(
        id=model.public_id,
        name=model.display_name,
        description=model.description,
        owned_by=model.owned_by,
        context_length=model.context_length,
        max_output_tokens=model.max_output_tokens,
        capabilities=list(model.capabilities or []),
        status=model.status,
        deprecated=model.deprecated_at is not None,
        retirement_date=model.retirement_date,
        price=price_out(price),
    )


@router.get("/models")
async def workspace_models(ctx: WsCtx, db: DB) -> list[CatalogModel]:
    models = await catalog.models_for_workspace(db, ctx.workspace.id, include_unavailable=True)
    prices = await catalog.current_prices(db)
    overrides = await catalog.workspace_overrides(db, ctx.workspace.id)
    return [catalog_model(m, catalog.price_for(m.id, prices, overrides)) for m, _ in models]


@router.post("/playground/chat", response_model=None)
async def playground_chat(
    body: PlaygroundChatIn, ctx: WsCtx, db: DB, request: Request
) -> JSONResponse | StreamingResponse:
    ctx.require(Perm.PLAYGROUND_USE)
    project_id = body.project_id or ctx.workspace.default_project_id
    if project_id is not None:
        project = await get_project(ctx, db, project_id, writable=True)
        project_id = project.id
    payload = body.model_dump(exclude_none=True, exclude={"project_id"})
    payload["messages"] = [m.model_dump(exclude_none=True) for m in body.messages]
    payload["stream"] = True
    caller = gateway.Caller(
        workspace_id=ctx.workspace.id,
        project_id=project_id,
        source="playground",
        user_id=ctx.user.id,
        ip=client_ip(request),
    )
    # Release the request's database connection while the reply streams.
    await db.close()
    return await gateway.handle(caller, "chat.completions", payload)


# ---- Conversations -----------------------------------------------------------------------------


async def _conversation(ctx: WsCtx, db: DB, conversation_id: uuid.UUID) -> Conversation:
    conv = await db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == ctx.user.id,
            Conversation.workspace_id == ctx.workspace.id,
        )
    )
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    return conv


def _summary(c: Conversation) -> ConversationSummary:
    return ConversationSummary(
        id=c.id, title=c.title, model=c.model, created_at=c.created_at, updated_at=c.updated_at
    )


def _full(c: Conversation) -> ConversationOut:
    return ConversationOut(
        id=c.id,
        title=c.title,
        model=c.model,
        created_at=c.created_at,
        updated_at=c.updated_at,
        settings=c.settings or {},
        messages=c.messages or [],
    )


@router.get("/playground/conversations")
async def list_conversations(ctx: WsCtx, db: DB) -> list[ConversationSummary]:
    rows = (
        await db.execute(
            select(Conversation)
            .where(
                Conversation.user_id == ctx.user.id, Conversation.workspace_id == ctx.workspace.id
            )
            .order_by(Conversation.updated_at.desc())
            .limit(200)
        )
    ).scalars()
    return [_summary(c) for c in rows]


@router.post("/playground/conversations", status_code=status.HTTP_201_CREATED)
async def create_conversation(body: ConversationIn, ctx: WsCtx, db: DB) -> ConversationOut:
    ctx.require(Perm.PLAYGROUND_USE)
    count = await db.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.user_id == ctx.user.id, Conversation.workspace_id == ctx.workspace.id)
    )
    if (count or 0) >= MAX_CONVERSATIONS:
        raise HTTPException(status.HTTP_409_CONFLICT, "Delete some conversations first.")
    conv = Conversation(
        user_id=ctx.user.id,
        workspace_id=ctx.workspace.id,
        title=(body.title or "New chat").strip() or "New chat",
        model=body.model or "",
        settings=body.settings or {},
        messages=body.messages or [],
    )
    db.add(conv)
    await db.commit()
    return _full(conv)


@router.get("/playground/conversations/{conversation_id}")
async def get_conversation(conversation_id: uuid.UUID, ctx: WsCtx, db: DB) -> ConversationOut:
    return _full(await _conversation(ctx, db, conversation_id))


@router.patch("/playground/conversations/{conversation_id}")
async def update_conversation(
    conversation_id: uuid.UUID, body: ConversationIn, ctx: WsCtx, db: DB
) -> ConversationOut:
    conv = await _conversation(ctx, db, conversation_id)
    if body.title is not None:
        conv.title = body.title.strip() or "New chat"
    if body.model is not None:
        conv.model = body.model
    if body.settings is not None:
        conv.settings = body.settings
    if body.messages is not None:
        conv.messages = body.messages
    await db.commit()
    return _full(conv)


@router.delete("/playground/conversations/{conversation_id}")
async def delete_conversation(conversation_id: uuid.UUID, ctx: WsCtx, db: DB) -> Message:
    conv = await _conversation(ctx, db, conversation_id)
    await db.delete(conv)
    await db.commit()
    return Message(message="Conversation deleted.")
