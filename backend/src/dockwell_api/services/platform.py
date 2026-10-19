"""Admin-editable platform settings, stored in the `platform_settings` table.

Defaults live in `PlatformConfig`; only values an admin changed are stored. Reads are cached for
a few seconds per process, which keeps every request cheap (also in serverless mode).
"""

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.db import SessionLocal
from dockwell_api.models import PlatformSetting

CACHE_SECONDS = 5.0
LOGO_KEY = "branding_logo"


class Announcement(BaseModel):
    message: str = Field(default="", max_length=500)
    level: Literal["info", "warning", "critical"] = "info"
    link: str | None = Field(default=None, max_length=500)


class PlatformConfig(BaseModel):
    # Accounts
    signup_enabled: bool = True
    google_signin_enabled: bool = True
    require_email_verification: bool = True
    # Starter credit, granted once per account after the email is verified.
    free_credit_enabled: bool = True
    free_credit_micros: int = Field(default=3_000_000, ge=0)
    # Credit purchases (whole US dollars in cents)
    topup_presets_cents: list[int] = Field(default_factory=lambda: [500, 1000, 2500, 5000, 10000])
    topup_min_cents: int = Field(default=500, ge=50)
    topup_max_cents: int = Field(default=100_000, ge=100)
    auto_recharge_allowed: bool = True
    # Defaults for new workspaces and keys (None = unlimited)
    default_workspace_rpm: int | None = Field(default=600, ge=1)
    default_workspace_tpm: int | None = Field(default=1_000_000, ge=1)
    default_workspace_monthly_limit_micros: int | None = Field(default=None, ge=0)
    default_key_rpm: int | None = Field(default=None, ge=1)
    default_key_tpm: int | None = Field(default=None, ge=1)
    # Lifetime spend limit given to new API keys whose creator doesn't set one.
    default_key_spend_limit_micros: int | None = Field(default=None, ge=0)
    platform_rpm: int | None = Field(default=None, ge=1)
    # Prompt / response logging (off by default) and log retention
    prompt_logging_allowed: bool = False
    log_retention_days: int = Field(default=30, ge=1, le=3650)
    # Abuse controls
    blocked_email_domains: list[str] = Field(default_factory=list)
    blocked_ips: list[str] = Field(default_factory=list)
    # Operations
    maintenance_mode: bool = False
    maintenance_message: str = Field(
        default="DockWell is down for maintenance. Please try again shortly.", max_length=500
    )
    announcement: Announcement = Field(default_factory=Announcement)
    # Branding
    platform_name: str = Field(default="DockWell", min_length=1, max_length=60)
    # Self-hosted: optional Hugging Face token (encrypted) for gated models.
    hf_token_enc: str | None = None


_cache: tuple[float, PlatformConfig] | None = None


def invalidate() -> None:
    global _cache
    _cache = None


async def get_config(db: AsyncSession | None = None) -> PlatformConfig:
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    if db is None:
        async with SessionLocal() as own:
            stored = await _load(own)
    else:
        stored = await _load(db)
    config = PlatformConfig.model_validate(stored)
    _cache = (now, config)
    return config


async def _load(db: AsyncSession) -> dict[str, Any]:
    rows = (
        await db.execute(select(PlatformSetting).where(PlatformSetting.key != LOGO_KEY))
    ).scalars()
    known = PlatformConfig.model_fields
    return {r.key: r.value for r in rows if r.key in known}


async def update_config(
    db: AsyncSession, changes: dict[str, Any], actor_id: uuid.UUID | None
) -> PlatformConfig:
    current = (await get_config(db)).model_dump()
    current.update(changes)
    validated = PlatformConfig.model_validate(current)
    for key in changes:
        value = validated.model_dump(mode="json")[key]
        stmt = insert(PlatformSetting).values(key=key, value=value, updated_by_id=actor_id)
        stmt = stmt.on_conflict_do_update(
            index_elements=[PlatformSetting.key],
            set_={"value": value, "updated_by_id": actor_id},
        )
        await db.execute(stmt)
    invalidate()
    return validated


async def get_logo(db: AsyncSession) -> dict[str, str] | None:
    row = await db.get(PlatformSetting, LOGO_KEY)
    return row.value if row is not None and isinstance(row.value, dict) else None


async def set_logo(
    db: AsyncSession, data_b64: str | None, content_type: str | None, actor_id: uuid.UUID
) -> None:
    row = await db.get(PlatformSetting, LOGO_KEY)
    if data_b64 is None:
        if row is not None:
            await db.delete(row)
        return
    value = {"data": data_b64, "content_type": content_type or "image/png"}
    if row is None:
        db.add(PlatformSetting(key=LOGO_KEY, value=value, updated_by_id=actor_id))
    else:
        row.value = value
        row.updated_by_id = actor_id
