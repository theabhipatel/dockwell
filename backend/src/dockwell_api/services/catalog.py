"""Model lookup, visibility and pricing (list price, then per-workspace discounts)."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.db import utcnow
from dockwell_api.models import AIModel, ModelPrice, Provider, WorkspacePrice
from dockwell_api.money import token_cost


@dataclass(frozen=True)
class EffectivePrice:
    input_micros_per_m: int
    output_micros_per_m: int
    cached_input_micros_per_m: int | None
    min_charge_micros: int
    is_free: bool
    price_id: uuid.UUID | None = None

    def cost(self, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> int:
        if self.is_free:
            return 0
        cached = min(max(cached_tokens, 0), max(input_tokens, 0))
        if self.cached_input_micros_per_m is not None and cached:
            input_cost = token_cost(input_tokens - cached, self.input_micros_per_m) + token_cost(
                cached, self.cached_input_micros_per_m
            )
        else:
            input_cost = token_cost(input_tokens, self.input_micros_per_m)
        total = input_cost + token_cost(output_tokens, self.output_micros_per_m)
        if input_tokens + output_tokens > 0:
            total = max(total, self.min_charge_micros)
        return total

    def max_cost(self, input_tokens: int, output_tokens: int) -> int:
        """Upper bound used for reservations (cached discounts are ignored)."""
        if self.is_free:
            return 0
        total = token_cost(input_tokens, self.input_micros_per_m) + token_cost(
            output_tokens, self.output_micros_per_m
        )
        return max(total, self.min_charge_micros)


FREE = EffectivePrice(0, 0, None, 0, True)


async def current_price(
    db: AsyncSession, model_id: uuid.UUID, at: datetime | None = None
) -> ModelPrice | None:
    return await db.scalar(
        select(ModelPrice)
        .where(ModelPrice.model_id == model_id, ModelPrice.effective_from <= (at or utcnow()))
        .order_by(ModelPrice.effective_from.desc(), ModelPrice.created_at.desc())
        .limit(1)
    )


async def current_prices(db: AsyncSession) -> dict[uuid.UUID, ModelPrice]:
    """The price in force right now for every model."""
    rows = (
        await db.execute(
            select(ModelPrice)
            .where(ModelPrice.effective_from <= utcnow())
            .order_by(
                ModelPrice.model_id, ModelPrice.effective_from.desc(), ModelPrice.created_at.desc()
            )
            .ext(distinct_on(ModelPrice.model_id))
        )
    ).scalars()
    return {p.model_id: p for p in rows}


def _apply_override(base: EffectivePrice, override: WorkspacePrice | None) -> EffectivePrice:
    if override is None or base.is_free:
        return base
    if override.input_micros_per_m is not None or override.output_micros_per_m is not None:
        return EffectivePrice(
            input_micros_per_m=(
                override.input_micros_per_m
                if override.input_micros_per_m is not None
                else base.input_micros_per_m
            ),
            output_micros_per_m=(
                override.output_micros_per_m
                if override.output_micros_per_m is not None
                else base.output_micros_per_m
            ),
            cached_input_micros_per_m=base.cached_input_micros_per_m,
            min_charge_micros=base.min_charge_micros,
            is_free=False,
            price_id=base.price_id,
        )
    if override.discount_percent:
        keep = 100 - max(0, min(100, override.discount_percent))

        def cut(value: int) -> int:
            return value * keep // 100

        return EffectivePrice(
            input_micros_per_m=cut(base.input_micros_per_m),
            output_micros_per_m=cut(base.output_micros_per_m),
            cached_input_micros_per_m=(
                cut(base.cached_input_micros_per_m)
                if base.cached_input_micros_per_m is not None
                else None
            ),
            min_charge_micros=cut(base.min_charge_micros),
            is_free=keep == 0,
            price_id=base.price_id,
        )
    return base


def to_effective(price: ModelPrice | None) -> EffectivePrice:
    if price is None:
        # A model without a price is free until an admin sets one.
        return FREE
    return EffectivePrice(
        input_micros_per_m=price.input_micros_per_m,
        output_micros_per_m=price.output_micros_per_m,
        cached_input_micros_per_m=price.cached_input_micros_per_m,
        min_charge_micros=price.min_charge_micros,
        is_free=price.is_free,
        price_id=price.id,
    )


async def effective_price(
    db: AsyncSession, model_id: uuid.UUID, workspace_id: uuid.UUID
) -> EffectivePrice:
    base = to_effective(await current_price(db, model_id))
    overrides = (
        (
            await db.execute(
                select(WorkspacePrice).where(
                    WorkspacePrice.workspace_id == workspace_id,
                    or_(WorkspacePrice.model_id == model_id, WorkspacePrice.model_id.is_(None)),
                )
            )
        )
        .scalars()
        .all()
    )
    specific = next((o for o in overrides if o.model_id == model_id), None)
    general = next((o for o in overrides if o.model_id is None), None)
    return _apply_override(base, specific or general)


async def workspace_overrides(
    db: AsyncSession, workspace_id: uuid.UUID
) -> dict[uuid.UUID | None, WorkspacePrice]:
    rows = (
        await db.execute(select(WorkspacePrice).where(WorkspacePrice.workspace_id == workspace_id))
    ).scalars()
    return {r.model_id: r for r in rows}


def price_for(
    model_id: uuid.UUID,
    prices: dict[uuid.UUID, ModelPrice],
    overrides: dict[uuid.UUID | None, WorkspacePrice],
) -> EffectivePrice:
    base = to_effective(prices.get(model_id))
    return _apply_override(base, overrides.get(model_id) or overrides.get(None))


def is_retired(model: AIModel, now: datetime | None = None) -> bool:
    return model.retirement_date is not None and model.retirement_date <= (now or utcnow())


def visible_to(model: AIModel, workspace_id: uuid.UUID | None) -> bool:
    if model.visibility == "all":
        return True
    return workspace_id is not None and workspace_id in (model.allowed_workspace_ids or [])


async def find_model(db: AsyncSession, public_id: str) -> tuple[AIModel, Provider] | None:
    row = (
        await db.execute(
            select(AIModel, Provider)
            .join(Provider, Provider.id == AIModel.provider_id)
            .where(AIModel.public_id == public_id)
        )
    ).one_or_none()
    if row is None:
        return None
    model, provider = row
    return model, provider


async def models_for_workspace(
    db: AsyncSession, workspace_id: uuid.UUID | None, *, include_unavailable: bool = False
) -> list[tuple[AIModel, Provider]]:
    """Enabled, visible, not retired models (optionally including ones not ready yet)."""
    rows = (
        await db.execute(
            select(AIModel, Provider)
            .join(Provider, Provider.id == AIModel.provider_id)
            .where(AIModel.enabled.is_(True), Provider.enabled.is_(True))
            .order_by(AIModel.sort_order, AIModel.display_name)
        )
    ).all()
    now = utcnow()
    out: list[tuple[AIModel, Provider]] = []
    for model, provider in rows:
        if is_retired(model, now) or not visible_to(model, workspace_id):
            continue
        if not include_unavailable and model.status != "ready":
            continue
        out.append((model, provider))
    return out
