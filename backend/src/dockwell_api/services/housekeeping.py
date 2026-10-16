"""Periodic maintenance. On a long-running server it runs in background loops; on serverless
hosting the cron endpoint (Vercel Cron) calls `run_once`.

- expired sessions, email tokens, invitations and rate-limit windows are removed;
- abandoned reservations (a crashed request) are released;
- request logs are pruned to the retention period;
- API keys about to expire and models reaching their retirement date are announced.
"""

import asyncio
from contextlib import suppress
from datetime import timedelta

from sqlalchemy import delete, select, update

from dockwell_api.db import SessionLocal, utcnow
from dockwell_api.logs import get_logger
from dockwell_api.models import (
    AIModel,
    ApiKey,
    EmailToken,
    Invitation,
    Project,
    RequestLog,
    Reservation,
    UserSession,
    Workspace,
)
from dockwell_api.security import ratelimit
from dockwell_api.services import engines, notifications, platform

log = get_logger("housekeeping")

KEY_EXPIRY_NOTICE = timedelta(days=3)


async def release_stale_reservations() -> int:
    released = 0
    async with SessionLocal() as db:
        stale = list(
            (
                await db.execute(
                    select(Reservation).where(Reservation.expires_at < utcnow()).limit(500)
                )
            ).scalars()
        )
        for res in stale:
            await db.execute(
                update(Workspace)
                .where(Workspace.id == res.workspace_id)
                .values(reserved_micros=Workspace.reserved_micros - res.amount_micros)
            )
            await db.delete(res)
            released += 1
        # Guard against drift: reserved can never be negative.
        await db.execute(
            update(Workspace).where(Workspace.reserved_micros < 0).values(reserved_micros=0)
        )
        await db.commit()
    if released:
        log.warning("Released %s abandoned reservations", released)
    return released


async def prune_logs() -> None:
    config = await platform.get_config()
    now = utcnow()
    async with SessionLocal() as db:
        await db.execute(
            delete(RequestLog).where(
                RequestLog.created_at < now - timedelta(days=config.log_retention_days)
            )
        )
        custom = await db.execute(
            select(Workspace.id, Workspace.log_retention_days).where(
                Workspace.log_retention_days.is_not(None),
                Workspace.log_retention_days < config.log_retention_days,
            )
        )
        for workspace_id, days in custom:
            await db.execute(
                delete(RequestLog).where(
                    RequestLog.workspace_id == workspace_id,
                    RequestLog.created_at < now - timedelta(days=days or config.log_retention_days),
                )
            )
        await db.commit()


async def announce_expiring_keys() -> None:
    now = utcnow()
    async with SessionLocal() as db:
        keys = list(
            (
                await db.execute(
                    select(ApiKey).where(
                        ApiKey.revoked_at.is_(None),
                        ApiKey.expires_at.is_not(None),
                        ApiKey.expires_at > now,
                        ApiKey.expires_at < now + KEY_EXPIRY_NOTICE,
                        ApiKey.expiry_notified_at.is_(None),
                    )
                )
            ).scalars()
        )
        for key in keys:
            key.expiry_notified_at = now
            if key.created_by_id is None:
                continue
            project = await db.get(Project, key.project_id)
            await notifications.notify_users(
                db,
                [key.created_by_id],
                category="keys",
                type="api_key.expiring",
                title=f"API key {key.name} expires soon",
                body=f"The key {key.prefix}... in {project.name if project else 'a project'} "
                f"expires on {key.expires_at:%d %b %Y %H:%M} UTC."
                if key.expires_at
                else "",
                link=f"/w/{key.workspace_id}/api-keys",
                workspace_id=key.workspace_id,
            )
        await db.commit()


async def retire_models() -> None:
    now = utcnow()
    async with SessionLocal() as db:
        models = list(
            (
                await db.execute(
                    select(AIModel).where(
                        AIModel.retirement_date.is_not(None),
                        AIModel.retirement_date <= now,
                        AIModel.enabled.is_(True),
                    )
                )
            ).scalars()
        )
        for model in models:
            model.enabled = False
            log.info("Model %s reached its retirement date and was disabled", model.public_id)
        await db.commit()


async def clean_up_expired() -> None:
    now = utcnow()
    async with SessionLocal() as db:
        await db.execute(delete(UserSession).where(UserSession.expires_at < now))
        await db.execute(delete(EmailToken).where(EmailToken.expires_at < now - timedelta(days=7)))
        await db.execute(
            update(Invitation)
            .where(Invitation.status == "pending", Invitation.expires_at < now)
            .values(status="expired")
        )
        await ratelimit.purge_expired(db, timedelta(days=1))
        await db.commit()


async def run_once() -> None:
    for step in (
        clean_up_expired,
        release_stale_reservations,
        prune_logs,
        announce_expiring_keys,
        retire_models,
    ):
        try:
            await step()
        except Exception:
            log.exception("Housekeeping step %s failed", step.__name__)


async def run_loop(stop: asyncio.Event, interval: float = 600) -> None:
    while not stop.is_set():
        await run_once()
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)


async def engine_loop(stop: asyncio.Event, interval: float = 10) -> None:
    """Watch engines and providers (long-running mode only)."""
    tick = 0
    while not stop.is_set():
        try:
            await engines.reconcile_all()
            if tick % 3 == 0:
                await engines.check_providers()
        except Exception:
            log.exception("Engine check failed")
        tick += 1
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)
