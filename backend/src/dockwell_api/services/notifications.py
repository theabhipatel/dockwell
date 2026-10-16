"""In-app notifications and the matching emails, honouring each user's preferences."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.models import Membership, Notification, Role, User
from dockwell_api.permissions import Perm
from dockwell_api.services import email

# Email categories a user can turn off. Security emails (sign-ins, password, 2FA) always go.
EMAIL_CATEGORIES: dict[str, tuple[str, str]] = {
    "billing": ("Billing", "Payments, low and zero balance, auto recharge."),
    "usage_alerts": ("Spend alerts", "Monthly spend threshold and limit reached."),
    "keys": ("API keys", "Keys that are about to expire."),
    "models": ("Models", "Models being deprecated or retired."),
    "workspace": ("Workspace", "Invitations, role changes and membership."),
}


def email_enabled(user: User, category: str) -> bool:
    prefs = user.notification_prefs or {}
    value = prefs.get(category, True)
    return bool(value)


def notify(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str = "",
    link: str | None = None,
    workspace_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    db.add(
        Notification(
            user_id=user_id,
            type=type,
            title=title[:200],
            body=body[:1000],
            link=link,
            workspace_id=workspace_id,
            data=data or {},
        )
    )


async def notify_users(
    db: AsyncSession,
    user_ids: list[uuid.UUID],
    *,
    category: str,
    type: str,
    title: str,
    body: str,
    link: str | None = None,
    workspace_id: uuid.UUID | None = None,
    email_paragraphs: list[str] | None = None,
) -> None:
    """In-app notification for everyone, plus an email to those who want this category."""
    if not user_ids:
        return
    users = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    for user in users:
        notify(
            db,
            user_id=user.id,
            type=type,
            title=title,
            body=body,
            link=link,
            workspace_id=workspace_id,
        )
        if email_enabled(user, category) and user.suspended_at is None:
            action = ("Open DockWell", email.link(link)) if link else None
            email.send_alert(db, user.email, title, email_paragraphs or [body], action)


async def workspace_member_ids_with(
    db: AsyncSession, workspace_id: uuid.UUID, perm: Perm
) -> list[uuid.UUID]:
    """The owner plus everyone whose role holds `perm`."""
    rows = await db.execute(
        select(Membership.user_id, Membership.is_owner, Role.permissions)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.workspace_id == workspace_id)
    )
    return [r.user_id for r in rows if r.is_owner or perm.value in (r.permissions or [])]
