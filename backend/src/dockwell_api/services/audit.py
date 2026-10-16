"""Append-only activity and admin audit trail.

Never pass secret content, passwords, API keys or prompt text in `details`.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.db import SessionLocal
from dockwell_api.models import AuditLog, User


@dataclass(frozen=True)
class RequestMeta:
    ip: str | None
    user_agent: str | None


def build_entry(
    *,
    action: str,
    actor: User | None,
    meta: RequestMeta | None,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | str | None = None,
    target_label: str | None = None,
    result: str = "success",
    details: dict[str, Any] | None = None,
    actor_email: str | None = None,
    admin: bool = False,
) -> AuditLog:
    return AuditLog(
        action=action,
        workspace_id=workspace_id,
        project_id=project_id,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else actor_email,
        actor_name=actor.name if actor else None,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        target_label=target_label[:320] if target_label else None,
        result=result,
        admin=admin,
        ip=meta.ip if meta else None,
        user_agent=meta.user_agent[:512] if meta and meta.user_agent else None,
        details=details or {},
    )


def record(db: AsyncSession, **kwargs: Any) -> None:
    """Add an audit entry to the caller's transaction (committed with the change it describes)."""
    db.add(build_entry(**kwargs))


async def record_now(**kwargs: Any) -> None:
    """Record in a separate transaction; used for failures where the request itself rolls back."""
    async with SessionLocal() as db:
        db.add(build_entry(**kwargs))
        await db.commit()
