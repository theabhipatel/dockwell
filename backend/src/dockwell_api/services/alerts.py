"""Balance and spend alerts, triggered after charges. Each alert is claimed with a conditional
UPDATE so it fires once even when many requests finish at the same moment."""

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.models import Workspace
from dockwell_api.money import current_period, dollars
from dockwell_api.permissions import Perm
from dockwell_api.services import notifications


async def _billing_people(db: AsyncSession, workspace_id: uuid.UUID) -> list[uuid.UUID]:
    return await notifications.workspace_member_ids_with(db, workspace_id, Perm.BILLING_MANAGE)


async def after_charge(workspace_id: uuid.UUID) -> None:
    from dockwell_api.services import billing

    period = current_period()
    async with SessionLocal() as db:
        ws = await db.get(Workspace, workspace_id)
        if ws is None:
            return
        link = f"/w/{ws.id}/billing"
        people: list[uuid.UUID] | None = None

        low = await db.scalar(
            update(Workspace)
            .where(
                Workspace.id == workspace_id,
                Workspace.low_balance_notified_at.is_(None),
                Workspace.balance_micros < Workspace.low_balance_threshold_micros,
                Workspace.balance_micros > 0,
            )
            .values(low_balance_notified_at=utcnow())
            .returning(Workspace.balance_micros)
        )
        if low is not None:
            people = people or await _billing_people(db, workspace_id)
            await notifications.notify_users(
                db,
                people,
                category="billing",
                type="billing.low_balance",
                title=f"Low balance in {ws.name}",
                body=f"Your balance is {dollars(low)}. Add credits to avoid interruptions.",
                link=link,
                workspace_id=ws.id,
            )

        zero = await db.scalar(
            update(Workspace)
            .where(
                Workspace.id == workspace_id,
                Workspace.zero_balance_notified_at.is_(None),
                Workspace.balance_micros <= 0,
            )
            .values(zero_balance_notified_at=utcnow())
            .returning(Workspace.balance_micros)
        )
        if zero is not None:
            people = people or await _billing_people(db, workspace_id)
            await notifications.notify_users(
                db,
                people,
                category="billing",
                type="billing.zero_balance",
                title=f"{ws.name} is out of credits",
                body="API and playground requests are paused until credits are added.",
                link=link,
                workspace_id=ws.id,
            )

        spent = await db.scalar(
            update(Workspace)
            .where(
                Workspace.id == workspace_id,
                Workspace.spend_alert_micros.is_not(None),
                Workspace.period == period,
                Workspace.period_spend_micros >= Workspace.spend_alert_micros,
                Workspace.spend_alert_notified_period.is_distinct_from(period),
            )
            .values(spend_alert_notified_period=period)
            .returning(Workspace.period_spend_micros)
        )
        if spent is not None:
            people = people or await _billing_people(db, workspace_id)
            await notifications.notify_users(
                db,
                people,
                category="usage_alerts",
                type="billing.spend_alert",
                title=f"{ws.name} passed its spend alert",
                body=f"Spend this month has reached {dollars(spent)}.",
                link=link,
                workspace_id=ws.id,
            )
        await db.commit()
        recharge = (
            ws.auto_recharge_enabled
            and ws.stripe_payment_method_id is not None
            and ws.balance_micros < ws.auto_recharge_threshold_micros
        )
    if recharge:
        await billing.trigger_auto_recharge(workspace_id)


async def out_of_credit(workspace_id: uuid.UUID) -> None:
    """A request was refused for lack of credit: alert (once) and try auto recharge."""
    await after_charge(workspace_id)


async def spend_limit_reached(workspace_id: uuid.UUID, period: str) -> None:
    async with SessionLocal() as db:
        claimed = await db.scalar(
            update(Workspace)
            .where(
                Workspace.id == workspace_id,
                Workspace.spend_limit_notified_period.is_distinct_from(period),
            )
            .values(spend_limit_notified_period=period)
            .returning(Workspace.name)
        )
        if claimed is None:
            await db.rollback()
            return
        people = await _billing_people(db, workspace_id)
        await notifications.notify_users(
            db,
            people,
            category="usage_alerts",
            type="billing.spend_limit_reached",
            title=f"{claimed} reached its monthly spend limit",
            body="Requests are refused until next month or until the limit is raised.",
            link=f"/w/{workspace_id}/billing",
            workspace_id=workspace_id,
        )
        await db.commit()


async def workspace_ids_low() -> list[uuid.UUID]:
    async with SessionLocal() as db:
        rows = await db.execute(
            select(Workspace.id).where(
                Workspace.auto_recharge_enabled.is_(True),
                Workspace.balance_micros < Workspace.auto_recharge_threshold_micros,
                Workspace.stripe_payment_method_id.is_not(None),
            )
        )
        return list(rows.scalars())
