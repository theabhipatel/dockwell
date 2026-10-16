"""Session creation, cookies, single-use email tokens and the `Me` view of a user."""

from datetime import timedelta
from typing import cast

from fastapi import Response
from sqlalchemy import delete, exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.config import get_settings
from dockwell_api.db import utcnow
from dockwell_api.models import AuditLog, EmailToken, User, UserSession
from dockwell_api.schemas.auth import Me, Theme
from dockwell_api.schemas.common import avatar_url
from dockwell_api.security.tokens import generate_token, hash_token
from dockwell_api.services import audit, email, notifications
from dockwell_api.services.audit import RequestMeta


def apply_admin_bootstrap(user: User) -> None:
    """Users whose address is in ADMIN_EMAILS are platform admins (the first admin)."""
    if not user.is_admin and user.email in get_settings().admin_email_set:
        user.is_admin = True


async def start_session(
    db: AsyncSession, response: Response, user: User, meta: RequestMeta, method: str
) -> None:
    """Create a session, set the cookie, and audit + alert on sign-in from a new device."""
    settings = get_settings()
    token = generate_token()
    now = utcnow()
    apply_admin_bootstrap(user)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=settings.session_ttl_days),
            ip=meta.ip,
            user_agent=(meta.user_agent or "")[:512] or None,
        )
    )
    signed_in_before = await db.scalar(
        select(
            exists().where(
                AuditLog.actor_id == user.id,
                AuditLog.action == "auth.sign_in",
                AuditLog.result == "success",
            )
        )
    )
    known_device = await db.scalar(
        select(
            exists().where(
                AuditLog.actor_id == user.id,
                AuditLog.action == "auth.sign_in",
                AuditLog.result == "success",
                AuditLog.user_agent == meta.user_agent,
            )
        )
    )
    if signed_in_before and not known_device:
        email.send_new_sign_in(
            db, user.email, now.strftime("%d %b %Y at %H:%M UTC"), meta.ip, meta.user_agent
        )
    user.last_sign_in_at = now
    audit.record(db, action="auth.sign_in", actor=user, meta=meta, details={"method": method})
    await db.commit()
    set_session_cookie(response, token)


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.session_cookie_name,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


async def revoke_all_sessions(db: AsyncSession, user: User, *, except_id: object = None) -> None:
    stmt = delete(UserSession).where(UserSession.user_id == user.id)
    if except_id is not None:
        stmt = stmt.where(UserSession.id != except_id)
    await db.execute(stmt)


async def issue_email_token(
    db: AsyncSession,
    user: User,
    purpose: str,
    ttl: timedelta,
    password_hash: str | None = None,
    data: dict[str, str] | None = None,
) -> str:
    """Create a single-use token, invalidating older unused ones for the same purpose."""
    now = utcnow()
    await db.execute(
        update(EmailToken)
        .where(
            EmailToken.user_id == user.id,
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    token = generate_token()
    db.add(
        EmailToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=hash_token(token),
            created_at=now,
            expires_at=now + ttl,
            password_hash=password_hash,
            data=data or {},
        )
    )
    return token


async def consume_email_token(
    db: AsyncSession, token: str, purpose: str
) -> tuple[User, EmailToken] | None:
    row = (
        await db.execute(
            select(EmailToken, User)
            .join(User, User.id == EmailToken.user_id)
            .where(EmailToken.token_hash == hash_token(token), EmailToken.purpose == purpose)
            .with_for_update(of=EmailToken)
        )
    ).one_or_none()
    if row is None:
        return None
    record, user = row
    if record.used_at is not None or record.expires_at <= utcnow():
        return None
    record.used_at = utcnow()
    return user, record


def me(user: User) -> Me:
    prefs = {key: notifications.email_enabled(user, key) for key in notifications.EMAIL_CATEGORIES}
    return Me(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=avatar_url(user),
        theme=cast(Theme, user.theme),
        email_verified=user.email_verified_at is not None,
        has_password=user.password_hash is not None,
        google_linked=user.google_sub is not None,
        two_factor_enabled=user.totp_enabled_at is not None,
        backup_codes_remaining=len(user.backup_code_hashes or []),
        is_admin=user.is_admin,
        default_workspace_id=user.default_workspace_id,
        needs_onboarding=user.onboarded_at is None,
        notification_prefs=prefs,
        created_at=user.created_at,
    )
